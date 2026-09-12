// Matter twin of the HomeKit AirConditioner accessory.
//
// Nothing here talks to Sensibo directly: every command lands on device.state, the same Proxy the HAP
// setters write to (see StateHandler.js), so both transports go through one code path and one debounce.
// Reads mirror what updateHomeKit() pushes into HAP, so the two can never disagree about the device.

// Matter carries temperatures as hundredths of a degree Celsius, while this plugin's state is in whole
// degrees Celsius (see Utils.airConditionerStateFromDevice) - every setpoint crosses that boundary here.
const HUNDREDTHS = 100
// The windows the Matter spec allows for the absolute setpoint limits, in hundredths of a degree. A
// value outside these is rejected when the endpoint is built, which would take the whole accessory
// down, so the AC's own range is clamped into them rather than passed straight through.
// Note the cool window sits at or above the heat window at BOTH ends, which is what keeps the
// zero deadband below satisfiable for every possible AC range.
const SETPOINT_BOUNDS = {
	cool: {
		max: 3200,
		min: 1600
	},
	heat: {
		max: 3000,
		min: 700
	}
}
// The modes a Matter thermostat endpoint can be commanded into by this plugin. FAN and DRY are separate
// accessories in HomeKit and have no equivalent split in Matter, so they are reported when the unit is
// in one (a controller should see the truth about a unit someone set from the Sensibo app) but are only
// commandable when enabled in the config.
const CLIMATE_MODES = ['AUTO', 'COOL', 'HEAT']

function toMatterTemperature(celsius) {
	return Math.round(celsius * HUNDREDTHS)
}

function fromMatterTemperature(value) {
	return Math.round(value) / HUNDREDTHS
}

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max)
}

/**
 * Map a fan speed percentage onto the Matter FanMode enum.
 * @param    {Object}  FanMode  The FanControl.FanMode enum from api.matter.types
 * @param    {number}  percent  Fan speed, 0-100 (0 is the plugin's "auto" fan speed)
 * @returns  {number}           The matching FanMode value
 */
function fanModeForPercent(FanMode, percent) {
	if (percent === 0) {
		return FanMode.Auto ?? FanMode.Off
	}

	if (percent <= 33) {
		return FanMode.Low
	}

	if (percent <= 66) {
		return FanMode.Medium
	}

	return FanMode.High
}

/**
 * Map a Matter FanMode back onto a fan speed percentage.
 * @param    {Object}  FanMode  The FanControl.FanMode enum from api.matter.types
 * @param    {number}  fanMode  The requested FanMode value
 * @returns  {number}           Fan speed, 0-100
 */
function percentForFanMode(FanMode, fanMode) {
	switch (fanMode) {
		case FanMode.Low:
			return 33

		case FanMode.Medium:
			return 66

		case FanMode.High:
		case FanMode.On:
			return 100

		default:
			// Off, Auto and Smart all land on 0, which is what this plugin already uses for "auto".
			return 0
	}
}

class MatterAirConditioner {

	constructor(device, platform) {
		this.device = device
		this.platform = platform
		this.log = platform.log
		this.matter = platform.api.matter
		this.types = this.matter.types
		this.name = device.name
		this.registered = false
		this.pushed = {}

		this.modes = this.supportedModes()
		this.defaultMode = CLIMATE_MODES.find(mode => {
			return this.modes[mode]
		})

		// The Thermostat device type has no on/off of its own - "off" is systemMode Off. Only
		// RoomAirConditioner carries an OnOff cluster.
		this.useOnOff = platform.matterAirConditionerDeviceType !== 'Thermostat'
		this.useFanControl = platform.matterExposeFanSpeed === true && this.fanSpeedsSupported()

		this.UUID = this.matter.uuid.generate(device.id + '_matter_ac')
		this.descriptor = this.buildDescriptor()
	}

	/**
	 * Which Sensibo modes this accessory is allowed to command, mirroring the checks AirConditioner.js
	 * makes before it adds the matching HomeKit service.
	 * @returns  {Object}  Map of Sensibo mode name to whether it is enabled
	 */
	supportedModes() {
		const device = this.device
		const excluded = mode => {
			return device.modesToExclude.includes(mode)
		}
		const climate = mode => {
			return !device.disableAirConditioner && device.capabilities[mode]?.homeKitSupported === true && !excluded(mode)
		}

		return {
			AUTO: climate('AUTO'),
			COOL: climate('COOL'),
			DRY: !device.disableDry && !!device.capabilities.DRY && !excluded('DRY'),
			FAN: !device.disableFan && !!device.capabilities.FAN && !excluded('FAN'),
			HEAT: climate('HEAT')
		}
	}

	/**
	 * @returns  {boolean}  Whether any enabled mode reports fan speeds the AC accepts
	 */
	fanSpeedsSupported() {
		const capabilities = this.device.capabilities

		return CLIMATE_MODES.some(mode => {
			return this.modes[mode] && Array.isArray(capabilities[mode]?.fanSpeeds) && capabilities[mode].fanSpeeds.length > 0
		})
	}

	/**
	 * The Matter Thermostat cluster is feature gated, and the features decide what a controller can do:
	 * AutoMode is what turns the tile into a two-ended range, which is exactly the Climate React band.
	 *
	 * The spec only allows AutoMode on a thermostat claiming both Heating and Cooling, so an AC with
	 * AUTO but no HEAT (a very common Sensibo setup) advertises a heating setpoint the unit never heats
	 * to. That is not a fudge for Matter's benefit - it is the same thing HomeKit's
	 * HeatingThresholdTemperature already does here: it is the bottom of the band.
	 * @returns  {string[]}  The matter.js Thermostat features to compose
	 */
	thermostatFeatures() {
		const features = []

		if (this.modes.HEAT || this.modes.AUTO) {
			features.push('Heating')
		}

		if (this.modes.COOL || this.modes.AUTO) {
			features.push('Cooling')
		}

		// The spec needs at least one. Homebridge's own detection falls back to Heating; match it.
		if (!features.length) {
			features.push('Heating')
		}

		if (this.modes.AUTO && features.length === 2) {
			features.push('AutoMode')
		}

		return features
	}

	/**
	 * The temperature span to advertise, in degrees Celsius. Mirrors the props the Home app slider gets
	 * in addHeaterCoolerService(), including the optional narrowing by climateReactAutoMin/MaxTemperature.
	 * @returns  {Object}  { max, min } in degrees Celsius
	 */
	temperatureRange() {
		const device = this.device
		const platform = this.platform
		let max = null
		let min = null

		CLIMATE_MODES.forEach(mode => {
			if (!this.modes[mode]) {
				return
			}

			const temperatures = device.capabilities[mode]?.temperatures

			if (!temperatures) {
				return
			}

			const celsius = temperatures[platform.CELSIUS_UNIT]
			const fahrenheit = temperatures[platform.FAHRENHEIT_UNIT]
			const range = celsius ?? (fahrenheit && {
				max: device.Utils.toCelsius(fahrenheit.max),
				min: device.Utils.toCelsius(fahrenheit.min)
			})

			if (!range) {
				return
			}

			max = max === null ? range.max : Math.max(max, range.max)
			min = min === null ? range.min : Math.min(min, range.min)
		})

		if (min === null || max === null) {
			this.log.easyDebug(`${this.name} - Matter - no temperature capabilities reported, falling back to 16-30ºC`)

			return {
				max: 30,
				min: 16
			}
		}

		if (platform.climateReactAsAutoMode) {
			const configuredMax = platform.climateReactAutoMaxTemperature
			const configuredMin = platform.climateReactAutoMinTemperature

			if (configuredMin !== null && configuredMin > min) {
				min = configuredMin
			}

			if (configuredMax !== null && configuredMax < max) {
				max = configuredMax
			}
		}

		return {
			max: max,
			min: min
		}
	}

	/**
	 * @returns  {Object}  The heat and cool setpoint limits, in Matter's hundredths of a degree
	 */
	setpointLimits() {
		const range = this.temperatureRange()
		const limits = {}

		Object.keys(SETPOINT_BOUNDS).forEach(scope => {
			const bounds = SETPOINT_BOUNDS[scope]

			limits[scope] = {
				max: clamp(toMatterTemperature(range.max), bounds.min, bounds.max),
				min: clamp(toMatterTemperature(range.min), bounds.min, bounds.max)
			}
		})

		return limits
	}

	/**
	 * @param    {string[]}     features  The Thermostat features to compose
	 * @returns  {Object|null}            The composed matter.js device type, or null if unavailable
	 */
	buildDeviceType(features) {
		const typeName = this.useOnOff ? 'RoomAirConditioner' : 'Thermostat'
		const deviceType = this.matter.deviceTypes[typeName]
		const requirements = this.matter.deviceRequirements[typeName]

		if (!deviceType) {
			this.log.warn(`Warning: ${this.name} - Matter device type ${typeName} is not available in this version of Homebridge`)

			return null
		}

		// Composing the cluster here rather than leaving it to Homebridge's detection is what makes
		// AutoMode reachable: RoomAirConditioner ships composed for Heating + Cooling only, and the
		// detection that would add AutoMode runs for the plain Thermostat device type alone.
		if (!requirements?.ThermostatServer) {
			this.log.easyDebug(`${this.name} - Matter - ${typeName} exposes no ThermostatServer requirement, using it as-is`)

			return deviceType
		}

		return deviceType.with(requirements.ThermostatServer.with(...features))
	}

	/**
	 * @returns  {Object|null}  The MatterAccessory descriptor, or null when there is nothing to publish
	 */
	buildDescriptor() {
		const device = this.device

		if (!this.defaultMode) {
			this.log.easyDebug(`${this.name} - Matter - no COOL/HEAT/AUTO mode enabled, skipping`)

			return null
		}

		const features = this.thermostatFeatures()
		const deviceType = this.buildDeviceType(features)

		if (!deviceType) {
			return null
		}

		this.features = features
		this.limits = this.setpointLimits()
		// Something has to be reported while the unit sits in FAN or DRY, where Sensibo reports no
		// target temperature at all.
		this.lastTarget = fromMatterTemperature(this.limits.cool.min)

		return {
			UUID: this.UUID,
			clusters: this.buildClusters(),
			context: {
				deviceId: device.id,
				type: device.type
			},
			deviceType: deviceType,
			displayName: this.name,
			firmwareRevision: device.firmwareRevision,
			handlers: this.buildHandlers(),
			manufacturer: device.manufacturer,
			model: device.model,
			serialNumber: device.serial
		}
	}

	buildClusters() {
		const clusters = { thermostat: this.thermostatState(true) }

		if (this.useOnOff) {
			clusters.onOff = this.onOffState()
		}

		if (this.useFanControl) {
			clusters.fanControl = this.fanControlState(true)
		}

		return clusters
	}

	buildHandlers() {
		const handlers = { thermostat: {} }

		handlers.thermostat.systemModeChange = args => {
			return this.onSystemMode(args.systemMode)
		}

		if (this.features.includes('Heating')) {
			handlers.thermostat.occupiedHeatingSetpointChange = args => {
				return this.onSetpoint('heating', args.occupiedHeatingSetpoint)
			}
		}

		if (this.features.includes('Cooling')) {
			handlers.thermostat.occupiedCoolingSetpointChange = args => {
				return this.onSetpoint('cooling', args.occupiedCoolingSetpoint)
			}
		}

		if (this.useOnOff) {
			handlers.onOff = {
				off: () => {
					return this.onPower(false)
				},
				on: () => {
					return this.onPower(true)
				}
			}
		}

		if (this.useFanControl) {
			handlers.fanControl = {
				fanModeChange: args => {
					return this.onFanMode(args.fanMode)
				},
				percentSettingChange: args => {
					return this.onFanSpeed(args.percentSetting)
				}
			}
		}

		return handlers
	}

	/**
	 * @param    {Object}  state  The device state to read the band from
	 * @returns  {Object}         { cooling, heating } setpoints in degrees Celsius
	 */
	setpoints(state) {
		const band = this.device.autoBand
		// climateReactAsAutoMode: AUTO is a range held in device.autoBand, never in state.targetTemperature
		// (a single value that both edges would collapse onto). Same split updateHomeKit() makes.
		const hasBand = this.platform.climateReactAsAutoMode
			&& state.mode === 'AUTO'
			&& typeof band?.low === 'number'
			&& typeof band?.high === 'number'

		if (hasBand) {
			return {
				cooling: band.high,
				heating: band.low
			}
		}

		if (typeof state.targetTemperature === 'number') {
			this.lastTarget = state.targetTemperature
		}

		return {
			cooling: this.lastTarget,
			heating: this.lastTarget
		}
	}

	/**
	 * @param    {boolean}  includeStatic  Whether to include the attributes that never change at runtime
	 * @returns  {Object}                  Thermostat cluster state
	 */
	thermostatState(includeStatic = false) {
		const state = this.device.state
		const setpoints = this.setpoints(state)
		const temperature = state.currentTemperature
		const thermostat = {
			localTemperature: typeof temperature === 'number' ? toMatterTemperature(temperature) : null,
			systemMode: this.matterSystemMode(state.active === true, state.mode)
		}

		if (this.features.includes('Heating')) {
			thermostat.occupiedHeatingSetpoint = clamp(toMatterTemperature(setpoints.heating), this.limits.heat.min, this.limits.heat.max)
		}

		if (this.features.includes('Cooling')) {
			thermostat.occupiedCoolingSetpoint = clamp(toMatterTemperature(setpoints.cooling), this.limits.cool.min, this.limits.cool.max)
		}

		if (!includeStatic) {
			return thermostat
		}

		thermostat.controlSequenceOfOperation = this.controlSequenceOfOperation()

		if (this.features.includes('Heating')) {
			thermostat.absMaxHeatSetpointLimit = this.limits.heat.max
			thermostat.absMinHeatSetpointLimit = this.limits.heat.min
			thermostat.maxHeatSetpointLimit = this.limits.heat.max
			thermostat.minHeatSetpointLimit = this.limits.heat.min
		}

		if (this.features.includes('Cooling')) {
			thermostat.absMaxCoolSetpointLimit = this.limits.cool.max
			thermostat.absMinCoolSetpointLimit = this.limits.cool.min
			thermostat.maxCoolSetpointLimit = this.limits.cool.max
			thermostat.minCoolSetpointLimit = this.limits.cool.min
		}

		if (this.features.includes('AutoMode')) {
			// The band's edges can sit a single step apart, or briefly on the same value while a
			// controller drags them. matter.js enforces the deadband against the LIMITS as well as the
			// setpoints, and the heat and cool limits here are deliberately the same span, so anything
			// above zero would reject every setpoint write for the life of the process.
			thermostat.minSetpointDeadBand = 0
		}

		return thermostat
	}

	onOffState() {
		return { onOff: this.device.state.active === true }
	}

	/**
	 * @param    {boolean}  includeStatic  Whether to include the attributes that never change at runtime
	 * @returns  {Object}                  FanControl cluster state
	 */
	fanControlState(includeStatic = false) {
		const FanControl = this.types.FanControl
		const speed = this.device.state.fanSpeed
		const percent = typeof speed === 'number' ? clamp(Math.round(speed), 0, 100) : 0
		const fanControl = {
			fanMode: fanModeForPercent(FanControl.FanMode, percent),
			percentCurrent: percent,
			percentSetting: percent
		}

		if (includeStatic) {
			fanControl.fanModeSequence = FanControl.FanModeSequence.OffLowMedHighAuto
		}

		return fanControl
	}

	controlSequenceOfOperation() {
		const ControlSequenceOfOperation = this.types.Thermostat.ControlSequenceOfOperation
		const cooling = this.features.includes('Cooling')
		const heating = this.features.includes('Heating')

		if (cooling && heating) {
			return ControlSequenceOfOperation.CoolingAndHeating
		}

		return cooling ? ControlSequenceOfOperation.CoolingOnly : ControlSequenceOfOperation.HeatingOnly
	}

	/**
	 * The mode to report when the unit is in one this endpoint does not advertise - someone changed it
	 * in the Sensibo app, or it is excluded in the config. Reporting a systemMode the composed feature
	 * set does not allow is out of spec, so the nearest advertised mode is reported instead.
	 * @returns  {number}  A systemMode this endpoint is allowed to report
	 */
	fallbackSystemMode() {
		const SystemMode = this.types.Thermostat.SystemMode

		return this.features.includes('Cooling') ? SystemMode.Cool : SystemMode.Heat
	}

	matterSystemMode(active, mode) {
		const SystemMode = this.types.Thermostat.SystemMode

		if (!active) {
			return SystemMode.Off
		}

		switch (mode) {
			case 'AUTO':
				return this.features.includes('AutoMode') ? SystemMode.Auto : this.fallbackSystemMode()

			case 'COOL':
				return this.features.includes('Cooling') ? SystemMode.Cool : this.fallbackSystemMode()

			case 'DRY':
				return SystemMode.Dry

			case 'FAN':
				return SystemMode.FanOnly

			case 'HEAT':
				return this.features.includes('Heating') ? SystemMode.Heat : this.fallbackSystemMode()

			default:
				return SystemMode.Off
		}
	}

	modeFromSystemMode(systemMode) {
		const SystemMode = this.types.Thermostat.SystemMode

		switch (systemMode) {
			case SystemMode.Auto:
				return 'AUTO'

			case SystemMode.Cool:
				return 'COOL'

			case SystemMode.Dry:
				return 'DRY'

			case SystemMode.FanOnly:
				return 'FAN'

			case SystemMode.Heat:
				return 'HEAT'

			default:
				return null
		}
	}

	/**
	 * The mode a command that carries no mode of its own should apply to.
	 *
	 * A Matter controller can send a setpoint before the mode change that belongs with it, so the
	 * cluster's own systemMode is read first - it is the closest equivalent to the HeaterCooler
	 * characteristic the HAP setters read for exactly this reason.
	 * @returns  {Promise<string>}  A Sensibo mode name
	 */
	async lastClimateMode() {
		const state = await this.matter.getAccessoryState(this.UUID, 'thermostat')
			.catch(() => {
				return undefined
			})
		const fromMatter = this.modeFromSystemMode(state?.systemMode)

		if (fromMatter && CLIMATE_MODES.includes(fromMatter)) {
			return fromMatter
		}

		const current = this.device.state.mode

		if (CLIMATE_MODES.includes(current)) {
			return current
		}

		return this.defaultMode
	}

	async onPower(on) {
		const device = this.device

		if (!on) {
			this.log.easyDebug(`${this.name} - Matter (SET) - AC Active State: false`)

			if (CLIMATE_MODES.includes(device.state.mode)) {
				device.state.active = false
			}

			device.stateManager.helpers.updateClimateReact()
			device.stateManager.helpers.updateClimateReactAutoMode()

			return
		}

		const mode = await this.lastClimateMode()

		this.log.easyDebug(`${this.name} - Matter (SET) - AC Active State: true, mode: ${mode}`)
		device.state.active = true
		device.state.mode = mode
		device.stateManager.helpers.updateClimateReact()
		device.stateManager.helpers.updateClimateReactAutoMode()
	}

	onSystemMode(systemMode) {
		const device = this.device
		const SystemMode = this.types.Thermostat.SystemMode

		if (systemMode === SystemMode.Off) {
			this.log.easyDebug(`${this.name} - Matter (SET) - System Mode: Off`)
			device.state.active = false
			device.stateManager.helpers.updateClimateReact()
			device.stateManager.helpers.updateClimateReactAutoMode()

			return
		}

		const mode = this.modeFromSystemMode(systemMode)

		if (!mode || !this.modes[mode]) {
			this.log.warn(`Warning: ${this.name} - Matter - systemMode ${systemMode} is not an enabled mode on this accessory`)

			throw new this.matter.status.ConstraintError(`${this.name} does not support the requested mode`)
		}

		this.log.easyDebug(`${this.name} - Matter (SET) - System Mode: ${mode}`)
		device.state.mode = mode
		device.state.active = true
		device.stateManager.helpers.updateClimateReact()
		device.stateManager.helpers.updateClimateReactAutoMode()
	}

	async onSetpoint(edge, value) {
		const device = this.device
		const temperature = fromMatterTemperature(value)
		const mode = await this.lastClimateMode()

		// climateReactAsAutoMode: in AUTO the two setpoints are the edges of the Climate React band and
		// must not touch state.targetTemperature - see the HeatingThresholdTemperature HAP setter.
		if (this.platform.climateReactAsAutoMode && mode === 'AUTO' && device.autoBand) {
			this.log.easyDebug(`${this.name} - Matter (SET) - AUTO band ${edge} edge: ${temperature}ºC`)
			device.autoBand[edge === 'cooling' ? 'high' : 'low'] = temperature
			device.autoBand.pending = true
			device.state.active = true
			device.state.mode = mode
			device.stateManager.helpers.updateClimateReactAutoMode()

			return
		}

		this.log.easyDebug(`${this.name} - Matter (SET) - Target Temperature: ${temperature}ºC`)
		device.state.targetTemperature = temperature
		device.state.active = true
		device.state.mode = mode
		device.stateManager.helpers.updateClimateReact()
		device.stateManager.helpers.updateClimateReactAutoMode()
	}

	async onFanSpeed(percent) {
		const device = this.device
		const speed = typeof percent === 'number' ? clamp(Math.round(percent), 0, 100) : 0
		const mode = await this.lastClimateMode()

		this.log.easyDebug(`${this.name} - Matter (SET) - AC Rotation Speed: ${speed}%`)
		device.state.fanSpeed = speed
		device.state.active = true
		device.state.mode = mode
		device.stateManager.helpers.updateClimateReact()
	}

	onFanMode(fanMode) {
		return this.onFanSpeed(percentForFanMode(this.types.FanControl.FanMode, fanMode))
	}

	/**
	 * Called once the descriptor has actually reached the Matter server.
	 * @returns  {void}
	 */
	markRegistered() {
		this.registered = true
		this.pushed = {}

		Object.keys(this.descriptor.clusters).forEach(cluster => {
			this.pushed[cluster] = { ...this.descriptor.clusters[cluster] }
		})
	}

	/**
	 * Mirror of updateHomeKit() - called from it, so Matter and HomeKit always see the same state.
	 * @returns  {void}
	 */
	update() {
		if (!this.registered) {
			return
		}

		this.push('thermostat', this.thermostatState())

		if (this.useOnOff) {
			this.push('onOff', this.onOffState())
		}

		if (this.useFanControl) {
			this.push('fanControl', this.fanControlState())
		}
	}

	push(cluster, attributes) {
		const previous = this.pushed[cluster]
		const changed = !previous || Object.keys(attributes).some(key => {
			return previous[key] !== attributes[key]
		})

		if (!changed) {
			return
		}

		this.pushed[cluster] = {
			...previous,
			...attributes
		}

		// Fire and forget, exactly as HAP's characteristic.updateValue is - a Matter controller that is
		// slow or gone must not hold up the HomeKit update this is riding along with.
		this.matter.updateAccessoryState(this.UUID, cluster, attributes)
			.catch(error => {
				this.log.easyDebug(`${this.name} - Matter - could not update ${cluster}: ${error.message || error}`)
			})
	}

}

export default MatterAirConditioner
