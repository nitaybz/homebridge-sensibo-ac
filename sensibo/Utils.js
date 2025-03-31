let deviceNamePrivate
let logPrivate

/**
 * Returns the HomeKit percentage for a given Sensibo fanLevel
 * @param   {string}    currentLevel  The name of the current fan level
 * @param   {string[]}  fanLevels     The list of fan levels supported by Sensibo for the device
 * @returns {number}                  The fan percentage for Homekit
 */
function fanLevelToPercentPrivate(currentLevel, fanLevels) {
	logPrivate.easyDebug(`${deviceNamePrivate} - Utils fanLevelToPercentPrivate - start, currentLevel: ${currentLevel}`)

	if (currentLevel === 'auto') {
		logPrivate.easyDebug(`${deviceNamePrivate} - Utils fanLevelToPercentPrivate - end, percentage: 0 (auto)`)

		return 0
	}

	fanLevels = fanLevels.filter(level => {
		return level !== 'auto'
	})

	const totalLevels = fanLevels.length > 0 ? fanLevels.length : 1
	const levelIndex = fanLevels.indexOf(currentLevel) + 1
	const percentage = Math.round(100 * levelIndex / totalLevels)

	logPrivate.easyDebug(`${deviceNamePrivate} - Utils fanLevelToPercentPrivate - end, percentage: ${percentage}`)

	return percentage
}

/**
 * Convert degrees F to degrees C
 * @param   {number}  degreesF  The degrees in F to convert
 * @returns {number}            The degrees in C
 */
function toCelsiusPrivate(degreesF) {
	const degreesC = (degreesF - 32) / 1.8

	logPrivate.easyDebug(`${deviceNamePrivate} - Utils toCelsiusPrivate - degreesF: ${degreesF}, degreesC: ${degreesC}`)

	return degreesC
}

// FIXME: This files location should move...
export default (device, platform) => {
	const Characteristic = platform.api.hap.Characteristic
	const Constants = {
		CO2_ALERT_THRESHOLD: platform.carbonDioxideAlertThreshold,
		PM2_5DENSITY_MAX: platform.PM2_5DENSITY_MAX,
		VOCDENSITY_MAX: platform.VOCDENSITY_MAX
	}
	const log = platform.log

	logPrivate = log

	return {

		/**
		 * Returns a list of 'capabilities' (modes, speeds, swings, temperatures), formed by checking the "remoteCapabilities.modes" object
		 * of a device from the Sensibo API response.
		 * @param   {Object}  deviceRemoteModes  The possible modes, speeds, swings and temperatures from the Sensibo API response for the device
		 * @returns {Object}                     Reformatted list of valid light, modes, fan speeds, swing types and max/min temperatures
		 */
		airConditionerCapabilities: deviceRemoteModes => {
			log.easyDebug(`${device.name} - Utils airConditionerCapabilities - start`)

			const capabilities = {}

			for (const [key, modeCapabilities] of Object.entries(deviceRemoteModes)) {
				// Mode options are COOL, HEAT, AUTO, FAN, DRY
				const mode = key.toUpperCase()

				capabilities[mode] = {}

				if (['AUTO', 'COOL', 'HEAT'].includes(mode)) {
					capabilities[mode].homeKitSupported = true
				}

				if ('C' in modeCapabilities.temperatures || 'F' in modeCapabilities.temperatures) {
					capabilities[mode].temperatures = {}
				}

				// set min & max temperatures
				if (modeCapabilities.temperatures?.C) {
					capabilities[mode].temperatures.C = {
						min: Math.min(...modeCapabilities.temperatures.C.values),
						max: Math.max(...modeCapabilities.temperatures.C.values)
					}
				}

				// TODO: check if we actaully need F, does Sensibo always return C if it has F?
				if (modeCapabilities.temperatures?.F) {
					capabilities[mode].temperatures.F = {
						min: Math.min(...modeCapabilities.temperatures.F.values),
						max: Math.max(...modeCapabilities.temperatures.F.values)
					}
				}

				// set fanSpeeds
				// Note: it looks like when .length evaluates to 0 then that is treated the same as false
				if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length) {
					capabilities[mode].fanSpeeds = modeCapabilities.fanLevels

					// set AUTO fanSpeed
					if (modeCapabilities.fanLevels.includes('auto')) {
						capabilities[mode].autoFanSpeed = true
					} else {
						capabilities[mode].autoFanSpeed = false
					}
				}

				// set vertical swing
				if (modeCapabilities.swing) {
					if (modeCapabilities.swing.includes('both')) {
						capabilities[mode].horizontalSwing = true
						capabilities[mode].verticalSwing = true
						capabilities[mode].threeDimensionalSwing = true
					} else {
						if (modeCapabilities.swing.includes('rangeFull')) {
							capabilities[mode].verticalSwing = true
						}

						if (modeCapabilities.swing.includes('horizontal')) {
							capabilities[mode].horizontalSwing = true
						}
					}
				}

				// set horizontal swing
				if (!capabilities[mode].horizontalSwing && modeCapabilities.horizontalSwing && modeCapabilities.horizontalSwing.includes('rangeFull')) {
					capabilities[mode].horizontalSwing = true
				}

				// set light
				if (modeCapabilities.light) {
					capabilities[mode].light = true
				}

				log.easyDebug(`${device.name} - Utils airConditionerCapabilities - Mode: ${mode}, Capabilities:`)
				log.easyDebug(capabilities[mode])
			}

			return capabilities
		},

		/**
		 * Returns a state object of settings and measurements for the given Sensibo device
		 * @param   {Object}  deviceFromSensiboResponse  The device object from the Sensibo API response
		 * @returns {Object}                             The new object containing the formatted settings and measurements (state), e.g.
		 *                                               active, mode, currentTemperature, targetTemperature, relativeHumidity, smartMode,
		 *                                               pureBoost(?), light, filterChange, filterLifeLevel, horizontalSwing, verticalSwing
		 *                                               and fanSpeed
		 */
		airConditionerStateFromDevice: deviceFromSensiboResponse => {
			// TODO: BIG change, but consider moving smartMode out to be a sibling of state, rather than a child
			// This would have impacts in a number of places, including StateHandler (might need a separate Proxy?), but could simplify
			// other object interactions? E.g. changing a single property within smartMode

			// TODO: remove pureBoost? Not sure if relevant for ACs.

			log.easyDebug(`${device.name} - Utils airConditionerStateFromDevice - start`)

			// The following is used to ensure the device name is correctly set when logging in "private" functions at the top of this file
			deviceNamePrivate = device.name

			const state = {
				active: deviceFromSensiboResponse.acState.on,
				mode: deviceFromSensiboResponse.acState.mode.toUpperCase(),
				// Note: targetTemperature can be null / missing from device.acState when unit is set to FAN (or DRY) mode
				targetTemperature: !deviceFromSensiboResponse.acState.targetTemperature ? null : deviceFromSensiboResponse.acState.temperatureUnit === 'C' ? deviceFromSensiboResponse.acState.targetTemperature : toCelsiusPrivate(deviceFromSensiboResponse.acState.targetTemperature),
				currentTemperature: deviceFromSensiboResponse.measurements.temperature,
				relativeHumidity: deviceFromSensiboResponse.measurements.humidity,
				smartMode: deviceFromSensiboResponse.smartMode,
				pureBoost: deviceFromSensiboResponse.pureBoostConfig && deviceFromSensiboResponse.pureBoostConfig.enabled
			}

			if ('light' in deviceFromSensiboResponse.acState) {
				state.light = deviceFromSensiboResponse.acState.light !== 'off'
			}

			if (deviceFromSensiboResponse.filtersCleaning) {
				state.filterChange = deviceFromSensiboResponse.filtersCleaning.shouldCleanFilters ? 'CHANGE_FILTER' : 'FILTER_OK'
				const acOnSecondsSinceLastFiltersClean = deviceFromSensiboResponse.filtersCleaning.acOnSecondsSinceLastFiltersClean
				const filtersCleanSecondsThreshold = deviceFromSensiboResponse.filtersCleaning.filtersCleanSecondsThreshold

				if (acOnSecondsSinceLastFiltersClean > filtersCleanSecondsThreshold) {
					state.filterLifeLevel = 0
				} else {
					state.filterLifeLevel = 100 - Math.floor(acOnSecondsSinceLastFiltersClean / filtersCleanSecondsThreshold * 100)
				}
			}

			state.horizontalSwing = 'SWING_DISABLED'
			state.verticalSwing = 'SWING_DISABLED'

			if (deviceFromSensiboResponse.acState.swing) {
				if (deviceFromSensiboResponse.acState.swing === 'rangeFull') {
					state.verticalSwing = 'SWING_ENABLED'
				} else if (deviceFromSensiboResponse.acState.swing === 'horizontal') {
					state.horizontalSwing = 'SWING_ENABLED'
				} else if (deviceFromSensiboResponse.acState.swing === 'both') {
					state.horizontalSwing = 'SWING_ENABLED'
					state.verticalSwing = 'SWING_ENABLED'
				}
			}

			if (deviceFromSensiboResponse.acState.horizontalSwing && deviceFromSensiboResponse.acState.horizontalSwing === 'rangeFull') {
				state.horizontalSwing = 'SWING_ENABLED'
			}

			const modeCapabilities = deviceFromSensiboResponse.remoteCapabilities.modes[deviceFromSensiboResponse.acState.mode]

			if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length) {
				state.fanSpeed = fanLevelToPercentPrivate(deviceFromSensiboResponse.acState.fanLevel, modeCapabilities.fanLevels) || 0
			}

			log.easyDebug(`${device.name} - Utils airConditionerStateFromDevice - end, state:`)
			log.easyDebug(state)

			return state
		},

		/**
		 * Returns a list of 'capabilities' (modes, speeds, swings, temperatures), formed by checking the "remoteCapabilities.modes" object
		 * of a device from the Sensibo API response.
		 * @param   {Object}  deviceRemoteModes  The possible modes, speeds, swings and temperatures from the Sensibo API response for the device
		 * @returns {Object}                     Reformatted list of valid light, modes, fan speeds, swing types and max/min temperatures
		 */
		airPurifierCapabilities: deviceRemoteModes => {
			// FIXME: need to update this function once we get example payload from Sensibo

			log.easyDebug(`${device.name} - Utils airPurifierCapabilities - start`)

			const capabilities = {}

			for (const [key, modeCapabilities] of Object.entries(deviceRemoteModes)) {
				// Mode options are COOL, HEAT, AUTO, FAN, DRY
				const mode = key.toUpperCase()

				capabilities[mode] = {}

				if (['AUTO', 'COOL', 'HEAT'].includes(mode)) {
					capabilities[mode].homeKitSupported = true
				}

				if ('C' in modeCapabilities.temperatures || 'F' in modeCapabilities.temperatures) {
					capabilities[mode].temperatures = {}
				}

				// set min & max temperatures
				if (modeCapabilities.temperatures?.C) {
					capabilities[mode].temperatures.C = {
						min: Math.min(...modeCapabilities.temperatures.C.values),
						max: Math.max(...modeCapabilities.temperatures.C.values)
					}
				}

				// TODO: check if we actaully need F, does Sensibo always return C if it has F?
				if (modeCapabilities.temperatures?.F) {
					capabilities[mode].temperatures.F = {
						min: Math.min(...modeCapabilities.temperatures.F.values),
						max: Math.max(...modeCapabilities.temperatures.F.values)
					}
				}

				// set fanSpeeds
				// Note: it looks like when .length evaluates to 0 then that is treated the same as false
				if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length) {
					capabilities[mode].fanSpeeds = modeCapabilities.fanLevels

					// set AUTO fanSpeed
					if (modeCapabilities.fanLevels.includes('auto')) {
						capabilities[mode].autoFanSpeed = true
					} else {
						capabilities[mode].autoFanSpeed = false
					}
				}

				// set vertical swing
				if (modeCapabilities.swing) {
					if (modeCapabilities.swing.includes('both')) {
						capabilities[mode].horizontalSwing = true
						capabilities[mode].verticalSwing = true
						capabilities[mode].threeDimensionalSwing = true
					} else {
						if (modeCapabilities.swing.includes('rangeFull')) {
							capabilities[mode].verticalSwing = true
						}

						if (modeCapabilities.swing.includes('horizontal')) {
							capabilities[mode].horizontalSwing = true
						}
					}
				}

				// set horizontal swing
				if (!capabilities[mode].horizontalSwing && modeCapabilities.horizontalSwing && modeCapabilities.horizontalSwing.includes('rangeFull')) {
					capabilities[mode].horizontalSwing = true
				}

				// set light
				if (modeCapabilities.light) {
					capabilities[mode].light = true
				}

				log.easyDebug(`${device.name} - Utils airPurifierCapabilities, Mode: ${mode}, Capabilities:`)
				log.easyDebug(capabilities[mode])
			}

			return capabilities
		},

		/**
		 * Returns a state object of settings and measurements for the given Sensibo device
		 * @param   {Object}  deviceFromSensiboResponse  The device object from the Sensibo API response
		 * @returns {Object}                             The new object containing the formatted settings and measurements (state), e.g.
		 *                                               active, mode, currentTemperature, targetTemperature, relativeHumidity, smartMode,
		 *                                               pureBoost(?), light, filterChange, filterLifeLevel, horizontalSwing, verticalSwing
		 *                                               and fanSpeed
		 */
		airPurifierStateFromDevice: deviceFromSensiboResponse => {
			// FIXME: need to update this function once we get example payload from Sensibo

			// TODO: check on pureBoost implementation

			log.easyDebug(`${device.name} - Utils airPurifierStateFromDevice - start`)

			// The following is used to ensure the device name is correctly set when logging in "private" functions at the top of this file
			deviceNamePrivate = device.name

			const state = {
				active: deviceFromSensiboResponse.acState.on,
				mode: deviceFromSensiboResponse.acState.mode.toUpperCase(),
				// FIXME: I think pureBoost should be true / false for airPurifier
				pureBoost: deviceFromSensiboResponse.pureBoostConfig && deviceFromSensiboResponse.pureBoostConfig.enabled
			}

			if ('light' in deviceFromSensiboResponse.acState) {
				state.light = deviceFromSensiboResponse.acState.light !== 'off'
			}

			if (deviceFromSensiboResponse.filtersCleaning) {
				state.filterChange = deviceFromSensiboResponse.filtersCleaning.shouldCleanFilters ? 'CHANGE_FILTER' : 'FILTER_OK'
				const acOnSecondsSinceLastFiltersClean = deviceFromSensiboResponse.filtersCleaning.acOnSecondsSinceLastFiltersClean
				const filtersCleanSecondsThreshold = deviceFromSensiboResponse.filtersCleaning.filtersCleanSecondsThreshold

				if (acOnSecondsSinceLastFiltersClean > filtersCleanSecondsThreshold) {
					state.filterLifeLevel = 0
				} else {
					state.filterLifeLevel = 100 - Math.floor(acOnSecondsSinceLastFiltersClean / filtersCleanSecondsThreshold * 100)
				}
			}

			// TODO: SwingMode EXISTS for AirPurifier service, but I don't belive it's enabled for Sensibo devices
			state.horizontalSwing = 'SWING_DISABLED'
			state.verticalSwing = 'SWING_DISABLED'

			// TODO: SwingMode EXISTS for AirPurifier service, but I don't belive it's enabled for Sensibo devices
			if (deviceFromSensiboResponse.acState.swing) {
				if (deviceFromSensiboResponse.acState.swing === 'rangeFull') {
					state.verticalSwing = 'SWING_ENABLED'
				} else if (deviceFromSensiboResponse.acState.swing === 'horizontal') {
					state.horizontalSwing = 'SWING_ENABLED'
				} else if (deviceFromSensiboResponse.acState.swing === 'both') {
					state.horizontalSwing = 'SWING_ENABLED'
					state.verticalSwing = 'SWING_ENABLED'
				}
			}

			// TODO: SwingMode EXISTS for AirPurifier service, but I don't belive it's enabled for Sensibo devices
			if (deviceFromSensiboResponse.acState.horizontalSwing && deviceFromSensiboResponse.acState.horizontalSwing === 'rangeFull') {
				state.horizontalSwing = 'SWING_ENABLED'
			}

			const modeCapabilities = deviceFromSensiboResponse.remoteCapabilities.modes[deviceFromSensiboResponse.acState.mode]

			if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length) {
				state.fanSpeed = fanLevelToPercentPrivate(deviceFromSensiboResponse.acState.fanLevel, modeCapabilities.fanLevels) || 0
			}

			log.easyDebug(`${device.name} - Utils airPurifierStateFromDevice - end, state:`)
			log.easyDebug(state)

			return state
		},

		/**
		 * Returns a list of 'capabilities', pulled by checking the "measurements" object of a device returned from Sensibo.
		 * Also marks if a given capability is 'supported' by Homekit (and this plugin) by name checking a hard-coded list.
		 * @param   {Object}  deviceMeasurements  The measurements/readings from the Sensibo API response for the device
		 * @returns {Object}                      List of measurements, and if it is homeKitSupported (true/false), e.g. iaq.homeKitSupported: true
		 */
		airQualityCapabilities: deviceMeasurements => {
			const capabilities = {}

			log.easyDebug(`${device.name} - Utils airQualityCapabilities - start, measurements:`)

			for (const [measurement, value] of Object.entries(deviceMeasurements)) {
				// measurement can include: time, temperature, humidity, feelsLike, rssi (Received Signal Strength Indicator),
				// motion, roomIsOccupied, tvoc, co2, pm25, etoh (ethanol), iaq (indoor air quality?)

				// TODO: this list should probably move else where? Maybe in to a config, or to index.js
				if (['temperature', 'humidity', 'iaq', 'co2', 'pm25', 'tvoc'].includes(measurement)) {
					capabilities[measurement] = { homeKitSupported: true }
				} else {
					capabilities[measurement] = { homeKitSupported: false }
				}

				log.easyDebug(`${device.name} - measurement name: ${measurement}, value: ${value}, homeKitSupported: ${capabilities[measurement].homeKitSupported}`)
			}

			log.easyDebug(`${device.name} - Utils airQualityCapabilities - end`)

			return capabilities
		},

		/**
		 * Returns an object of formatted measurements for the given Sensibo devices measurements object
		 * @param   {Object}  deviceMeasurements  The measurements/readings from the Sensibo API response for the device
		 * @returns {Object}                      The new object containing the formatted measurements (state), e.g. VOCDensity, airQuality,
		 *                                        carbonDioxideDetected, carbonDioxideLevel and PM2_5Density
		 */
		airQualityStateFromDeviceMeasurements: deviceMeasurements => {
			// TODO: see about adding custom characteristics for Element measurements like ethanol

			// log.easyDebug(`${device.name} - airQualityStateFromDeviceMeasurements start`)
			const formattedMeasurements = {}

			if (deviceMeasurements == null || (!deviceMeasurements.tvoc && !deviceMeasurements.co2 && !deviceMeasurements.pm25)) {
				log.warn(`${device.name} - Utils airQualityStateFromDeviceMeasurements no measurements available, returning empty state`)

				return formattedMeasurements
			}

			// Set AirQuality and TVOC. Note: tvoc is used as a fallback if iaq not set
			if (deviceMeasurements.tvoc && deviceMeasurements.tvoc > 0) {
				const iaqReading = deviceMeasurements?.iaq ?? 0
				const tvocReading = deviceMeasurements.tvoc
				// convert ppb to μg/m3
				const vocDensity = Math.round(tvocReading * 4.57)

				// NOTE: max value is overwritten to 10000 by VOCDENSITY_MAX
				formattedMeasurements.VOCDensity = vocDensity < Constants.VOCDENSITY_MAX ? vocDensity : Constants.VOCDENSITY_MAX

				if (iaqReading !== 0) {
					// don't overwrite airQuality if already retrieved from Sensibo

					// From Omer Enbar: the IAQ property returns the currently worst pollutant normalized. the values are 0-100 good, 100-150 moderate, 150+ poor
					const convertedQuality = Math.ceil(iaqReading / 50)
					// 0/50 = 0 = 0            Note: 0 = UNKNOWN
					// 1/50 = 0.02 = 1               1 = EXCELLENT
					// 30/50 = .6 = 1
					// 75/50 = 1.5 = 2               2 = GOOD
					// 140/50 = 2.8 = 3              3 = FAIR
					// 160/50 = 3.2 = 4              4 = INFERIOR
					// 207/50 = 4.14 = 5             5 = POOR
					// 260/50 = 5.2 = 6

					formattedMeasurements.airQuality = convertedQuality <= 5 ? convertedQuality : 5
				} else if (tvocReading > 1500) {
					// POOR
					formattedMeasurements.airQuality = 5
				} else if (tvocReading > 1000) {
					// INFERIOR
					formattedMeasurements.airQuality = 4
				} else if (tvocReading > 500) {
					// FAIR
					formattedMeasurements.airQuality = 3
				} else if (tvocReading > 250) {
					// GOOD
					formattedMeasurements.airQuality = 2
				} else {
					// EXCELLENT
					formattedMeasurements.airQuality = 1
				}
				// Note: 0 = UNKNOWN
			}

			// Set CO2
			if (deviceMeasurements.co2 && deviceMeasurements.co2 > 0) {
				// NOTE: max value is 100000
				formattedMeasurements.carbonDioxideLevel = deviceMeasurements.co2
				formattedMeasurements.carbonDioxideDetected = deviceMeasurements.co2 < Constants.CO2_ALERT_THRESHOLD ? 0 : 1
			}

			// Set PM2.5
			if (deviceMeasurements.pm25 && deviceMeasurements.pm25 > 0) {
				// Not sure what units value is in... might need to convert ppb to μg/m3?
				// NOTE: Looks like API can return decimal??
				const pm2_5Density = Math.round(deviceMeasurements.pm25)

				// NOTE: max value is overwritten to 10000 by PM2_5DENSITY_MAX
				formattedMeasurements.PM2_5Density = pm2_5Density < Constants.PM2_5DENSITY_MAX ? pm2_5Density : Constants.PM2_5DENSITY_MAX
			}

			// Set temp (required for FakeGato logging only)
			if (deviceMeasurements.temperature && platform.enableHistoryStorage) {
				formattedMeasurements.currentTemperature = deviceMeasurements.temperature
			}

			log.easyDebug(`${device.name} - Utils airQualityStateFromDeviceMeasurements, formattedMeasurements:`)
			log.easyDebug(formattedMeasurements)

			return formattedMeasurements
		},

		/**
		 * Returns the Constants object for easy use in other files, e.g. this.Utils.Constants().VOCDENSITY_MAX
		 * @param   {void}
		 * @returns {Object}
		 */
		Constants: () => {
			log.easyDebug(`${device.name} - Utils Constants`)

			return Constants
		},

		/**
		 * Returns a simplified object of information - such as id, model and roomName - about the given Sensibo device
		 * @param   {Object}  deviceFromSensiboResponse  The device details from the Sensibo API response
		 * @returns {Object}                             The new object containing simplified device information - such as id, model and roomName
		 */
		deviceInformation: deviceFromSensiboResponse => {
			const deviceInfo = {
				id: deviceFromSensiboResponse.id,
				model: deviceFromSensiboResponse.productModel ?? deviceFromSensiboResponse.model,
				serial: deviceFromSensiboResponse.serial,
				manufacturer: 'Sensibo Inc.',
				roomName: deviceFromSensiboResponse.room?.name ?? deviceFromSensiboResponse.roomName,
				temperatureUnit: deviceFromSensiboResponse.temperatureUnit,
				filterService: deviceFromSensiboResponse.filtersCleaning ? true : false
			}

			// Can't use device.name as this function is what helps set that value, using deviceInfo.roomName instead
			log.easyDebug(`${deviceInfo.roomName} - Utils deviceInformation, deviceInfo:`)
			log.easyDebug(deviceInfo)

			return deviceInfo
		},

		/**
		 * Returns a simplified object of information - such as id and name - about the given Sensibo device
		 * @param   {Object}  deviceLocation  The device details from the Sensibo API response
		 * @returns {Object}                  The new object containing simplified device information - such as id and name
		 */
		locationInformation: deviceLocation => {
			const locationInfo = {
				id: deviceLocation.id,
				name: deviceLocation.name
			}

			// Can't use device.name as this function is what helps set that value, using deviceInfo.roomName instead
			log.easyDebug(`${locationInfo.name} - Utils locationInformation, locationInfo:`)
			log.easyDebug(locationInfo)

			return locationInfo
		},

		/**
		 * Returns a formatted state object for the given Sensibo locations occupancy
		 * @param   {Object}  deviceLocation  The locations occupancy from the Sensibo API response for the device
		 * @returns {Object}                  The new object containing the occupancy (state)
		 */
		occupancyStateFromDeviceLocation: deviceLocation => {
			const state = { occupancy: (deviceLocation.occupancy === 'me' || deviceLocation.occupancy === 'someone') ? 'OCCUPANCY_DETECTED' : 'OCCUPANCY_NOT_DETECTED' }

			log.easyDebug(`${device.name} - Utils occupancyStateFromDeviceLocation, state:`)
			log.easyDebug(state)

			return state
		},

		/**
		 * Returns the Sensibo fanLevel for a given percentage
		 * @param   {number}    percentValue  The fan percentage from Homekit
		 * @param   {string[]}  fanLevels     The list of fan levels supported by Sensibo for the device
		 * @returns {string}                  The single fan level that matches the percentage from Homekit
		 */
		percentToFanLevel: (percentValue, fanLevels) => {
			let selected = 'auto'

			if (!fanLevels.includes('auto')) {
				selected = fanLevels[0]
			}

			if (percentValue !== 0) {
				fanLevels = fanLevels.filter(level => {
					return level !== 'auto'
				})
				const totalLevels = fanLevels.length

				for (let i = 0; i < fanLevels.length; i++) {
					if (percentValue <= Math.round(100 * (i + 1) / totalLevels)) {
						selected = fanLevels[i]
						break
					}
				}
			}

			log.easyDebug(`${device.name} - Utils percentToFanLevel - percentValue: ${percentValue}, selected: ${selected}`)

			return selected
		},

		/**
		 * Returns the Sensibo formatted swing values for a given device
		 * @param   {Object}  deviceCapabilitiesForMode  The device options available given its current mode
		 * @param   {Object}  deviceState                Devices current state in Homekit 'model'
		 * @returns {Object}                             The Sensibo formatted swing and horizontalSwing values
		 */
		sensiboFormattedSwingModes: (deviceCapabilitiesForMode, deviceState) => {
			// log.easyDebug(`${device.name} - sensiboFormattedSwingModes - state: ${deviceState}`)

			const apiSwingModes = {}

			if ('threeDimensionalSwing' in deviceCapabilitiesForMode) {
				if ((deviceState.horizontalSwing === 'SWING_ENABLED') && (deviceState.verticalSwing === 'SWING_ENABLED')) {
					apiSwingModes.swing = 'both'
				} else if (deviceState.verticalSwing === 'SWING_ENABLED') {
					apiSwingModes.swing = 'rangeFull'
				} else if (deviceState.horizontalSwing === 'SWING_ENABLED') {
					apiSwingModes.swing = 'horizontal'
				} else {
					apiSwingModes.swing = 'stopped'
				}
			} else {
				if ('verticalSwing' in deviceCapabilitiesForMode) {
					apiSwingModes.swing = deviceState.verticalSwing === 'SWING_ENABLED' ? 'rangeFull' : 'stopped'
				}

				if ('horizontalSwing' in deviceCapabilitiesForMode) {
					apiSwingModes.horizontalSwing = deviceState.horizontalSwing === 'SWING_ENABLED' ? 'rangeFull' : 'stopped'
				}
			}

			log.easyDebug(`${device.name} - Utils sensiboFormattedSwingModes - apiSwingModes: ${JSON.stringify(apiSwingModes)}`)

			return apiSwingModes
		},

		/**
		 * Returns a simplified object of information - such as id and model - about the given Sensibo device
		 * @param   {Object}  deviceMotionSensor  The device details from the Sensibo API response
		 * @returns {Object}                      The new object containing simplified device information - such as id and model
		 */
		sensorInformation: deviceMotionSensor => {
			const sensorInfo = {
				id: deviceMotionSensor.id,
				model: deviceMotionSensor.productModel,
				serial: deviceMotionSensor.serial
			}

			// Can't use device.name as this function is what helps set that value, using deviceInfo.roomName instead
			log.easyDebug(`${sensorInfo.id} - Utils sensorInformation, sensorInfo:`)
			log.easyDebug(sensorInfo)

			return sensorInfo
		},

		/**
		 * Returns an object of formatted measurements for the given Sensibo sensor measurements object
		 * @param   {Object}  sensorMeasurements  The measurements/readings from the Sensibo API response for the device
		 * @returns {Object}                      The new object containing the formatted measurements (state), e.g. currentTemperature,
		 *                                        lowBattery, motionDetected and relativeHumidity
		 */
		sensorStateFromSensorMeasurements: sensorMeasurements => {
			const formattedMeasurements = {
				currentTemperature: sensorMeasurements.temperature,
				lowBattery: sensorMeasurements.batteryVoltage > 100 ? 'BATTERY_LEVEL_NORMAL' : 'BATTERY_LEVEL_LOW',
				motionDetected: sensorMeasurements.motion,
				relativeHumidity: sensorMeasurements.humidity
			}

			log.easyDebug(`${device.name} - Utils sensorStateFromSensorMeasurements, formattedMeasurements:`)
			log.easyDebug(formattedMeasurements)

			return formattedMeasurements
		},

		/**
		 * Convert degrees F to degrees C
		 * @param   {number}  degreesF  The degrees in F to convert
		 * @returns {number}            The degrees in C
		 */
		toCelsius: degreesF => {
			// The following is used to ensure the device name is correctly set when logging in "private" functions at the top of this file
			deviceNamePrivate = device.name

			const degreesC = toCelsiusPrivate(degreesF)

			log.easyDebug(`${device.name} - Utils toCelsius - degreesF: ${degreesF}, degreesC: ${degreesC}`)

			return degreesC
		},

		/**
		 * Convert degrees C to degrees F
		 * @param   {number}  degreesC  The degrees in C to convert
		 * @returns {number}            The degrees in F
		 */
		toFahrenheit: degreesC => {
			const degreesF = Math.round((degreesC * 1.8) + 32)

			log.easyDebug(`${device.name} - Utils toFahrenheit - degreesC: ${degreesC}, degreesF: ${degreesF}`)

			return degreesF
		},

		// TODO: if this doesn't update accessory value, do we need to make sure state also doesn't get changed?

		// TODO: round numbers to 0 or 1 decimals?
		// Probably should be done when _calling_ updateValue rather than in it? (So it's not "hidden" functionality)
		// E.g. humidity should be a full percentage, temp seems to support 1 decimal
		// Note: some rounding is occurring below using minStep

		/**
		 * Checks the given Service for the given Characteristic, if found, validates the newValue and updates the Characteristic with it
		 * @param   {string}         serviceName         The Service to update
		 * @param   {string}         characteristicName  The Characteristic to update
		 * @param   {number|string}  newValue            The value that the Characteristic should be set to
		 * @returns {void}
		 */
		updateValue: (serviceName, characteristicName, newValue) => {
			// log.easyDebug(`${device.name} - Utils updateValue - start`)
			log.devDebug(`${device.name} - updateValue: ${newValue} for characteristic ${characteristicName} on service ${serviceName}`)
			// Could we use .validateUserInput or .validateClientSuppliedValue from HAP Characteristics definition? Probably not as both are private...

			const characteristic = device[serviceName]?.getCharacteristic(Characteristic[characteristicName])

			if (typeof characteristic === 'undefined') {
				log.easyDebug(`${device.name} - Utils updateValue - characteristic undefined for serviceName: ${serviceName} and/or characteristicName: ${characteristicName} while trying to set '${newValue}'... skipping update`)

				return
			}

			// FIXME: what does this line actually check for? Does it look for not false and false (not true) at the same time?
			if (newValue !== 0 && newValue !== false && (typeof newValue === 'undefined' || !newValue)) {
				log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' bad value for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			if (newValue === undefined || newValue === null) {
				log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' undefined or null for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			const currentValue = characteristic.value
			const format = characteristic.props.format ?? 'undefined'
			const maxValue = characteristic.props.maxValue
			const minValue = characteristic.props.minValue
			const minStep = characteristic.props.minStep
			const validValues = characteristic.props.validValues

			if (Number.isNaN(newValue)) {
				// non-number is valid for many usecases
				// TODO: could check if props.format is float or int, then compare and fail if needed?
				log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' is not a number for characteristic ${characteristicName} (expected format '${format}') on service ${serviceName}... continuing`)
			}

			if (validValues && !validValues.includes(newValue)) {
				log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' not in validValues: ${validValues} for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			// TODO: currentValue (characteristic.value) seems to need rounding... probably inherit JS issue
			// e.g. CurrentTemperature = "22.60000000000001"

			if (minStep) {
				const roundedValue = minStep < 1 ? Math.round((newValue + Number.EPSILON) * 10) / 10 : Math.round(newValue + Number.EPSILON)

				if (roundedValue !== newValue) {
					log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' doesn't meet the rounding required by minStep: ${minStep} for characteristic ${characteristicName} on service ${serviceName}... rounding to ${roundedValue}`)
					newValue = roundedValue
				}
			}

			if (minValue && newValue < minValue) {
				log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' less than minValue: ${minValue} for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			} else if (maxValue && newValue > maxValue) {
				log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' greater than maxValue: ${maxValue} for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			if (currentValue === newValue) {
				log.easyDebug(`${device.name} - Utils updateValue - '${newValue}' equals '${currentValue}' for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			log.easyDebug(`${device.name} - Utils updateValue - Setting '${newValue}' for characteristic ${characteristicName} on service ${serviceName}, value was '${currentValue}'`)
			// TODO: investigate using this instead: https://developers.homebridge.io/#/api/service#serviceupdatecharacteristic
			characteristic.updateValue(newValue)

			return
		}

	}
}
