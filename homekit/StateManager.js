let Characteristic
let log
let MINIMUM_NODE

function characteristicToMode(characteristic) {
	// log.easyDebug(`characteristicToMode - characteristic: ${characteristic}`)
	switch (characteristic) {
		case Characteristic.TargetHeaterCoolerState.AUTO:
			return 'AUTO'

		case Characteristic.TargetHeaterCoolerState.COOL:
			return 'COOL'

		case Characteristic.TargetHeaterCoolerState.HEAT:
			return 'HEAT'
	}
}

/**
 * Updates device.state.smartMode with a new ClimateReact state, should be called whenever a (relevant) change is made to the accessory.
 * Note: Currently only works for AC (Auto, Cool, Heat) as Dry and Fan are separate accessories.
 * @param   {Object}   device                       Object containing devices current settings and state, including current smartMode
 * @param   {boolean}  enableClimateReactAutoSetup  Should auto setup (auto update) be run
 * @returns {void}
 */
function updateClimateReact(device, enableClimateReactAutoSetup) {
	// TODO: Invoking this could (should?) be moved to within StateHandler.js 'set' proxy, e.g. whenever fanSpeed is changed and
	//       enableClimateReactAutoSetup is true the new value also gets passed to ClimateReact (smartMode), however that would then
	//       required a way to check if the changing prop(erty) was "valid" for ClimateReact, for example fanSpeed being changed when
	//       operating on Dry mode wouldn't be relevant.

	// TODO: Need to check if ClimateReact is even valid for Pure (Air Purifier), as set PureActive and set PureRotationSpeed call this.

	if (!enableClimateReactAutoSetup) {
		return
	}

	log.easyDebug(`${device.name} updateClimateReact`)

	// If nothing (relevant) has changed should we skip...? Like we do in StateHandler for SET?

	const smartModeState = device.state.smartMode

	smartModeState.type = 'temperature'
	smartModeState.highTemperatureWebhook = null
	smartModeState.lowTemperatureWebhook = null
	smartModeState.highTemperatureState = {
		targetTemperature: device.state.targetTemperature,
		temperatureUnit: device.temperatureUnit,
		mode: device.state.mode.toLowerCase()
	}

	if (typeof structuredClone === 'function') {
		// NOTE: structuredClone was introduced in Node 17, so won't exist for older implementations and will causes issues for anyone using Node <= 16
		smartModeState.lowTemperatureState = structuredClone(smartModeState.highTemperatureState)
	} else {
		// FIXME: remove this "fallback" with next major version of plugin
		log.error(`Warning: you are using an old version of Node.js (v${process.versions.node}), please update to Node.js v${MINIMUM_NODE} at a minimum.`)
		log.warn('Node.js v18 support ends April 30 2025, so we recommend you upgrade to at least Node.js v20. See https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js.')
		smartModeState.lowTemperatureState = JSON.parse(JSON.stringify(smartModeState.highTemperatureState))
	}

	if (device.state.mode === 'COOL') {
		smartModeState.highTemperatureThreshold = device.state.targetTemperature + (device.usesFahrenheit ? 1.8 : 1)
		smartModeState.highTemperatureState.on = true
		smartModeState.lowTemperatureThreshold = device.state.targetTemperature - (device.usesFahrenheit ? 1.8 : 1)
		smartModeState.lowTemperatureState.on = false
	} else if (device.state.mode === 'HEAT') {
		smartModeState.highTemperatureThreshold = device.state.targetTemperature + (device.usesFahrenheit ? 1.8 : 1)
		smartModeState.highTemperatureState.on = false
		smartModeState.lowTemperatureThreshold = device.state.targetTemperature - (device.usesFahrenheit ? 1.8 : 1)
		smartModeState.lowTemperatureState.on = true
	}

	if ('fanSpeeds' in device.capabilities[device.state.mode] && 'fanSpeed' in device.state) {
		const currentFanLevel = device.Utils.percentToFanLevel(device.state.fanSpeed, device.capabilities[device.state.mode].fanSpeeds)

		smartModeState.highTemperatureState.fanLevel = currentFanLevel
		smartModeState.lowTemperatureState.fanLevel = currentFanLevel
	}

	if ('light' in device.state) {
		const lightValue = device.state.light ? 'on' : 'off'

		smartModeState.highTemperatureState.light = lightValue
		smartModeState.lowTemperatureState.light = lightValue
	}

	const swingModes = device.Utils.sensiboFormattedSwingModes(device.capabilities[device.state.mode], device.state)

	// be mindful .assign() copies references (not a deep clone): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign#examples
	Object.assign(smartModeState.highTemperatureState, swingModes)
	Object.assign(smartModeState.lowTemperatureState, swingModes)

	// StateHandler is invoked as a Proxy, and therefore overwrites/intercepts the default get()/set() commands [traps]
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy

	// NOTE: device.state is of "type" StateHandler. When one of its properties is "set" (e.g. device.state.<property> = <val>),
	//       that's where we actually send commands to the appropriate Sensibo devices. If a property is not set, the aformentioned
	//       code will not execute and the changes would not take effect.
	//
	//       For example, if we set a property of smartMode directly, e.g. device.state.smartMode.enabled = true, StateHandler's
	//       setter will not get called and so any changes will not take effect. This is why we MUST update a device's property as
	//       a whole, and do it only once (otherwise's the setter will get called multiple times which will send repeated commands
	//       to the Sensibo devices).
	device.state.smartMode = smartModeState
}

export default (device, platform) => {
	Characteristic = platform.api.hap.Characteristic
	log = platform.log
	MINIMUM_NODE = platform.MINIMUM_NODE

	const enableClimateReactAutoSetup = platform.enableClimateReactAutoSetup

	return {

		get: {
			// AC (Auto, Cool, Heat only)
			// TODO: refactor this similar to PureActive below?
			ACActive: callback => {
				const active = device.state.active
				const mode = device.state.mode

				if (!active || mode === 'FAN' || mode === 'DRY') {
					log.easyDebug(device.name, '(GET) - AC Active State: false')

					callback(null, 0)
				} else {
					log.easyDebug(device.name, '(GET) - AC Active State: true')

					callback(null, 1)
				}
			},

			CurrentHeaterCoolerState: callback => {
				const active = device.state.active
				const deviceCurrentModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).value
				const stateCurrentMode = device.state.mode
				const currentTemp = device.state.currentTemperature
				const targetTemp = device.state.targetTemperature

				log.easyDebug(device.name, '(GET) - Current HeaterCooler State:', active ? stateCurrentMode + ' (' + deviceCurrentModeValue + ')' : 'OFF')

				if (!active || stateCurrentMode === 'FAN' || stateCurrentMode === 'DRY') {
					callback(null, Characteristic.CurrentHeaterCoolerState.INACTIVE)
				} else if (stateCurrentMode === 'COOL') {
					callback(null, Characteristic.CurrentHeaterCoolerState.COOLING)
				} else if (stateCurrentMode === 'HEAT') {
					callback(null, Characteristic.CurrentHeaterCoolerState.HEATING)
				} else if (currentTemp > targetTemp) {
					callback(null, Characteristic.CurrentHeaterCoolerState.COOLING)
				} else {
					callback(null, Characteristic.CurrentHeaterCoolerState.HEATING)
				}
			},

			TargetHeaterCoolerState: callback => {
				const active = device.state.active
				const deviceCurrentModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const stateCurrentMode = device.state.mode
				const stateCurrentModeValue = stateCurrentMode ? Characteristic.TargetHeaterCoolerState[stateCurrentMode] ??= deviceCurrentModeValue : deviceCurrentModeValue

				log.easyDebug(device.name, '(GET) - Target HeaterCooler State:', active ? stateCurrentMode + ' (' + stateCurrentModeValue + ')' : 'OFF (' + stateCurrentModeValue + ')')
				if (!active || stateCurrentMode === 'FAN' || stateCurrentMode === 'DRY') {
					callback(null, deviceCurrentModeValue)
				} else {
					callback(null, stateCurrentModeValue)
				}
			},

			CurrentTemperature: callback => {
				let currentTemp = device.state.currentTemperature

				if (typeof currentTemp === 'undefined') {
					log.warn(device.name, '(GET) - currentTemperature is undefined, defaulting to 21')

					currentTemp = 21
				}

				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(GET) - Current Temperature:', device.Utils.toFahrenheit(currentTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(GET) - Current Temperature:', currentTemp + 'ºC')
				}

				callback(null, currentTemp)
			},

			CoolingThresholdTemperature: callback => {
				const targetTemp = device.state.targetTemperature ?? device.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature).value

				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(GET) - Target Cooling Temperature:', device.Utils.toFahrenheit(targetTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(GET) - Target Cooling Temperature:', targetTemp + 'ºC')
				}

				callback(null, targetTemp)
			},

			HeatingThresholdTemperature: callback => {
				const targetTemp = device.state.targetTemperature ?? device.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature).value

				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(GET) - Target Heating Temperature:', device.Utils.toFahrenheit(targetTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(GET) - Target Heating Temperature:', targetTemp + 'ºC')
				}

				callback(null, targetTemp)
			},

			TemperatureDisplayUnits: callback => {
				log.easyDebug(device.name, '(GET) - Temperature Display Units:', device.temperatureUnit)

				callback(null, device.usesFahrenheit ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS)
			},

			ACSwing: callback => {
				const swing = device.state.verticalSwing

				log.easyDebug(device.name, '(GET) - AC Swing:', swing)

				callback(null, Characteristic.SwingMode[swing])
			},

			ACRotationSpeed: callback => {
				const fanSpeed = device.state.fanSpeed ?? 0

				log.easyDebug(device.name, '(GET) - AC Rotation Speed:', fanSpeed + '%')

				callback(null, fanSpeed)
			},

			// PURE
			PureActive: callback => {
				const active = device.state.active

				log.easyDebug(`${device.name} (GET) - Pure Active State: ${active}`)

				callback(null, active ? 1 : 0)
			},

			CurrentAirPurifierState: callback => {
				const active = device.state.active

				log.easyDebug(`${device.name} (GET) - Pure Current State: ${active ? 'PURIFYING_AIR' : 'INACTIVE'}`)

				callback(null, active ? 2 : 0)
			},

			TargetAirPurifierState: callback => {
				const pureBoost = device.state.pureBoost

				log.easyDebug(`${device.name} (GET) - Pure Target State (Boost): ${pureBoost ? 'AUTO' : 'MANUAL'}`)

				callback(null, pureBoost ? 1 : 0)
			},

			PureRotationSpeed: callback => {
				const fanSpeed = device.state.fanSpeed ?? 0

				log.easyDebug(device.name, '(GET) - Pure Rotation Speed:', fanSpeed + '%')

				callback(null, fanSpeed)
			},

			// FILTER
			FilterChangeIndication: callback => {
				const filterChange = device.state.filterChange

				log.easyDebug(device.name, '(GET) - Filter Change Indication:', filterChange)

				callback(null, Characteristic.FilterChangeIndication[filterChange])
			},

			FilterLifeLevel: callback => {
				const filterLifeLevel = device.state.filterLifeLevel

				log.easyDebug(device.name, '(GET) - Filter Life Level:', filterLifeLevel + '%')

				callback(null, filterLifeLevel)
			},

			// FAN
			FanActive: callback => {
				const active = device.state.active
				const mode = device.state.mode

				if (!active || mode !== 'FAN') {
					log.easyDebug(device.name, '(GET) - Fan Active State: false')

					callback(null, 0)
				} else {
					log.easyDebug(device.name, '(GET) - Fan Active State: true')

					callback(null, 1)
				}
			},

			FanSwing: callback => {
				const swing = device.state.verticalSwing

				log.easyDebug(device.name, '(GET) - Fan Swing:', swing)

				callback(null, Characteristic.SwingMode[swing])
			},

			FanRotationSpeed: callback => {
				const fanSpeed = device.state.fanSpeed ?? 0

				log.easyDebug(device.name, '(GET) - Fan Rotation Speed:', fanSpeed + '%')

				callback(null, fanSpeed)
			},

			// DEHUMIDIFIER
			DryActive: callback => {
				const active = device.state.active
				const mode = device.state.mode

				if (!active || mode !== 'DRY') {
					log.easyDebug(device.name, '(GET) - Dry Active State: false')

					callback(null, 0)
				} else {
					log.easyDebug(device.name, '(GET) - Dry Active State: true')

					callback(null, 1)
				}
			},

			CurrentHumidifierDehumidifierState: callback => {
				const active = device.state.active
				const mode = device.state.mode

				if (!active || mode !== 'DRY') {
					log.easyDebug(device.name, '(GET) - Dry Current Dehumidifier State: INACTIVE', '(' + Characteristic.CurrentHumidifierDehumidifierState.INACTIVE + ')')

					callback(null, Characteristic.CurrentHumidifierDehumidifierState.INACTIVE)
				} else {
					log.easyDebug(device.name, '(GET) - Dry Current Dehumidifier State: DEHUMIDIFYING', '(' + Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING + ')')

					callback(null, Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING)
				}
			},

			TargetHumidifierDehumidifierState: callback => {
				log.easyDebug(device.name, '(GET) - Dry Target Dehumidifier State: DEHUMIDIFIER', '(' + Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER + ')')

				callback(null, Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
			},

			CurrentRelativeHumidity: callback => {
				log.easyDebug(device.name, '(GET) - Current Relative Humidity:', device.state.relativeHumidity, '%')

				callback(null, device.state.relativeHumidity)
			},

			DrySwing: callback => {
				const swing = device.state.verticalSwing

				log.easyDebug(device.name, '(GET) - Dry Swing:', swing)

				callback(null, Characteristic.SwingMode[swing])
			},

			DryRotationSpeed: callback => {
				const fanSpeed = device.state.fanSpeed ?? 0

				log.easyDebug(device.name, '(GET) - Dry Rotation Speed:', fanSpeed + '%')

				callback(null, fanSpeed)
			},

			// HORIZONTAL SWING
			HorizontalSwing: callback => {
				const horizontalSwing = device.state.horizontalSwing

				log.easyDebug(device.name, '(GET) - Horizontal Swing:', horizontalSwing)

				callback(null, horizontalSwing === 'SWING_ENABLED')
			},

			// AIR CONDITIONER/PURIFIER LIGHT
			LightSwitch: callback => {
				const light = device.state.light

				log.easyDebug(device.name, '(GET) - Light:', light ? 'ON' : 'OFF')

				callback(null, light)
			},

			// ROOM SENSOR
			MotionDetected: callback => {
				const motionDetected = device.state.motionDetected

				log.easyDebug(device.name, '(GET) - Motion Detected:', motionDetected)

				callback(null, motionDetected)
			},

			StatusLowBattery: callback => {
				const lowBattery = device.state.lowBattery

				log.easyDebug(device.name, '(GET) - Status Low Battery:', lowBattery)

				callback(null, Characteristic.StatusLowBattery[lowBattery])
			},

			// OCCUPANCY SENSOR
			OccupancyDetected: callback => {
				const occupancy = device.state.occupancy

				log.easyDebug(device.name, '(GET) Occupancy Detected:', occupancy)

				callback(null, Characteristic.OccupancyDetected[occupancy])
			},

			// Air Quality Sensor
			AirQuality: callback => {
				const airQuality = device.state.airQuality

				log.easyDebug(device.name, '(GET) - Air Quality:', airQuality)

				callback(null, airQuality)
			},

			VOCDensity: callback => {
				const vocDensity = device.state.VOCDensity

				log.easyDebug(device.name, '(GET) - Volatile Organic Compound Density:', vocDensity)

				callback(null, vocDensity)
			},

			PM2_5Density: callback => {
				const pm2_5Density = device.state.PM2_5Density

				log.easyDebug(device.name, '(GET) - PM2.5 Density:', pm2_5Density)

				callback(null, pm2_5Density)
			},

			// Carbon Dioxide Sensor
			CarbonDioxideDetected: callback => {
				const carbonDioxideDetected = device.state.carbonDioxideDetected

				log.easyDebug(device.name, '(GET) - Carbon Dioxide Detected:', carbonDioxideDetected)

				callback(null, carbonDioxideDetected)
			},

			CarbonDioxideLevel: callback => {
				const carbonDioxideLevel = device.state.carbonDioxideLevel

				log.easyDebug(device.name, '(GET) - Carbon Dioxide Level:', carbonDioxideLevel)

				callback(null, carbonDioxideLevel)
			},

			// AC SYNC BUTTON
			SyncButton: callback => {
				log.easyDebug(device.name, '(GET) - Sync Button, no state change')

				callback(null, false)
			},

			// CLIMATE REACT
			ClimateReactSwitch: callback => {
				const smartModeEnabled = device.state.smartMode.enabled

				log.easyDebug(device.name, '(GET) - Climate React Enabled Switch:', smartModeEnabled)

				callback(null, smartModeEnabled)
			}
		},

		set: {
			// AC (Auto, Cool, Heat only)
			ACActive: (state, callback) => {
				const acActive = !!state

				log.easyDebug(device.name, '(SET) - AC Active State:', acActive)

				if (acActive) {
					device.state.active = true
					const lastModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
					const lastMode = characteristicToMode(lastModeValue)

					log.easyDebug(device.name, '(SET) - HeaterCooler State:', lastMode, '(' + lastModeValue + ')')
					device.state.mode = lastMode
				} else if (device.state.mode === 'COOL' || device.state.mode === 'HEAT' || device.state.mode === 'AUTO') {
					device.state.active = false
				}

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			TargetHeaterCoolerState: (state, callback) => {
				const mode = characteristicToMode(state)

				log.easyDebug(device.name, '(SET) - Target HeaterCooler State:', mode, '(' + state + ')')
				device.state.mode = mode
				device.state.active = true

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			CoolingThresholdTemperature: (targetTemp, callback) => {
				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(SET) - Target Cooling Temperature:', device.Utils.toFahrenheit(targetTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(SET) - Target Cooling Temperature:', targetTemp + 'ºC')
				}

				const lastModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const lastMode = characteristicToMode(lastModeValue)

				device.state.targetTemperature = targetTemp
				// TODO: Check on the below. It turns the unit ON if it's currently off. Maybe it's required by API?
				log.easyDebug(device.name, '(SET) - HeaterCooler State:', lastMode, '(' + lastModeValue + ')')
				device.state.active = true
				device.state.mode = lastMode

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			HeatingThresholdTemperature: (targetTemp, callback) => {
				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(SET) - Target Heating Temperature:', device.Utils.toFahrenheit(targetTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(SET) - Target Heating Temperature:', targetTemp + 'ºC')
				}

				const lastModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const lastMode = characteristicToMode(lastModeValue)

				device.state.targetTemperature = targetTemp
				// TODO: Check on the below. It turns the unit ON if it's currently off. Maybe it's required by API?
				log.easyDebug(device.name, '(SET) - HeaterCooler State:', lastMode, '(' + lastModeValue + ')')
				device.state.active = true
				device.state.mode = lastMode

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			ACSwing: (state, callback) => {
				state = state === Characteristic.SwingMode.SWING_ENABLED ? 'SWING_ENABLED' : 'SWING_DISABLED'
				log.easyDebug(device.name, '(SET) - AC Swing:', state)
				device.state.verticalSwing = state

				const lastModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const lastMode = characteristicToMode(lastModeValue)

				// TODO: Check on the below. It turns the unit ON if it's currently off. Maybe it's required by API?
				log.easyDebug(device.name, '(SET) - HeaterCooler State:', lastMode, '(' + lastModeValue + ')')
				device.state.active = true
				device.state.mode = lastMode

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			ACRotationSpeed: (speed, callback) => {
				log.easyDebug(device.name, '(SET) - AC Rotation Speed:', speed + '%')
				device.state.fanSpeed = speed

				const lastModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const lastMode = characteristicToMode(lastModeValue)

				// TODO: Check on the below. It turns the unit ON if it's currently off. Maybe it's required by API?
				log.easyDebug(device.name, '(SET) - HeaterCooler State:', lastMode, '(' + lastModeValue + ')')
				device.state.active = true
				device.state.mode = lastMode

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			// PURE
			PureActive: (state, callback) => {
				state = !!state
				log.easyDebug(device.name, '(SET) - Pure Active State:', state)
				device.state.active = state

				// TODO: check if ClimateReact is valid for Pure
				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			TargetAirPurifierState: (state, callback) => {
				const pureBoost = !!state

				log.easyDebug(device.name, '(SET) - Pure Target State (Boost):', pureBoost ? 'AUTO' : 'MANUAL')
				device.state.pureBoost = pureBoost

				callback()
			},

			PureRotationSpeed: (speed, callback) => {
				if (speed) {
					log.easyDebug(device.name, '(SET) - Pure Rotation Speed:', speed + '%')
					device.state.fanSpeed = speed
					device.state.active = true
				} else {
					device.state.active = false
				}

				// TODO: check if ClimateReact is valid for Pure
				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			// FILTER
			ResetFilterIndication: (value, callback) => {
				log.easyDebug(device.name, '(SET) - Filter Change Indication: RESET')
				device.state.filterChange = 0
				device.state.filterLifeLevel = 100

				callback()
			},

			// FAN
			FanActive: (state, callback) => {
				state = !!state
				log.easyDebug(device.name, '(SET) - Fan state Active:', state)

				if (state) {
					log.easyDebug(device.name, '(SET) - Mode to: FAN')
					device.state.mode = 'FAN'
					device.state.active = true
				} else if (device.state.mode === 'FAN') {
					device.state.active = false
				}

				callback()
			},

			FanSwing: (state, callback) => {
				state = state === Characteristic.SwingMode.SWING_ENABLED ? 'SWING_ENABLED' : 'SWING_DISABLED'
				log.easyDebug(device.name, '(SET) - Fan Swing:', state)
				device.state.verticalSwing = state
				device.state.active = true
				log.easyDebug(device.name, '(SET) - Mode to: FAN')
				device.state.mode = 'FAN'

				callback()
			},

			FanRotationSpeed: (speed, callback) => {
				log.easyDebug(device.name, '(SET) - Fan Rotation Speed:', speed + '%')
				device.state.fanSpeed = speed
				device.state.active = true
				log.easyDebug(device.name, '(SET) - Mode to: FAN')
				device.state.mode = 'FAN'

				callback()
			},

			// DEHUMIDIFIER
			DryActive: (state, callback) => {
				state = !!state
				log.easyDebug(device.name, '(SET) - Dry state Active:', state)

				if (state) {
					log.easyDebug(device.name, '(SET) - Mode to: DRY')
					device.state.mode = 'DRY'
					device.state.active = true
				} else if (device.state.mode === 'DRY') {
					device.state.active = false
				}

				callback()
			},

			TargetHumidifierDehumidifierState: (state, callback) => {
				device.state.active = true
				log.easyDebug(device.name, '(SET) - HeaterCooler State: DRY')
				device.state.mode = 'DRY'

				callback()
			},

			DrySwing: (state, callback) => {
				state = state === Characteristic.SwingMode.SWING_ENABLED ? 'SWING_ENABLED' : 'SWING_DISABLED'
				log.easyDebug(device.name, '(SET) - Dry Swing:', state)
				device.state.verticalSwing = state
				device.state.active = true
				log.easyDebug(device.name, '(SET) - Mode to: DRY')
				device.state.mode = 'DRY'

				callback()
			},

			DryRotationSpeed: (speed, callback) => {
				log.easyDebug(device.name, '(SET) - Dry Rotation Speed:', speed + '%')
				device.state.fanSpeed = speed
				device.state.active = true
				log.easyDebug(device.name, '(SET) - Mode to: DRY')
				device.state.mode = 'DRY'

				callback()
			},

			// HORIZONTAL SWING
			HorizontalSwing: (state, callback) => {
				// TODO: alternative is to prevent swing changes when device is inactive
				// if (!device.state.active) {
				// 	log.easyDebug(device.name, '(SET) - Changing Horizontal Swing does not work when unit is inactive, not updating')

				// 	// TODO: set switch state back immediately in Home app?
				// 	// device.Utils.updateValue('HorizontalSwingSwitchService', 'On', this.state.horizontalSwing === 'SWING_ENABLED')
				// 	//    OR
				// 	// device.updateHomeKit()

				// 	return callback()
				// }

				const swingState = state ? 'SWING_ENABLED' : 'SWING_DISABLED'

				log.easyDebug(device.name, '(SET) - Horizontal Swing:', swingState)

				device.state.horizontalSwing = swingState

				// log.warn(device.name, 'in HorizontalSwing, mode:', device.state.mode, 'active:', device.state.active)

				const lastModeValue = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const lastMode = characteristicToMode(lastModeValue)

				// TODO: Check on the below. It turns the unit ON if it's currently OFF. Maybe it's required by API?
				log.easyDebug(device.name, '(SET) - HeaterCooler State (HorizontalSwing):', lastMode, '(' + lastModeValue + ')')
				device.state.active = true
				// device.state.mode = lastMode

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			// AIR CONDITIONER/PURIFIER LIGHT
			LightSwitch: (state, callback) => {
				log.easyDebug(device.name, '(SET) - Light to', state ? 'ON' : 'OFF')
				device.state.light = state

				updateClimateReact(device, enableClimateReactAutoSetup)

				callback()
			},

			// AC SYNC BUTTON
			// TODO: should be moved to be a 'set' in StateHanlder??
			SyncButton: (state, callback) => {
				if (state) {
					log.easyDebug(device.name, '(SYNC) - AC Active State:', device.state.active)
					device.state.syncState()
				}

				callback()
			},

			// CLIMATE REACT
			ClimateReactSwitch: (state, callback) => {
				log.easyDebug(device.name, '(SET) - Climate React Enabled Switch:', state)
				const smartModeState = device.state.smartMode

				smartModeState.enabled = !!state

				// NOTE: we must set the 'smartMode' property directly (and NOT for example like so: device.state.smartMode.enabled = true),
				//       otherwise the StateHandler's setter code will not be executed and any changes will not take effect.
				device.state.smartMode = smartModeState

				callback()
			}
		}

	}
}
