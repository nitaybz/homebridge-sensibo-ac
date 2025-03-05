// FIXME: This files location should move...
// TODO: move unifed.js funcs in to here
module.exports = (device, platform) => {
	const Characteristic = platform.api.hap.Characteristic
	const log = platform.log

	return {

		/**
		 * Returns a list of 'capabilities' (measurements), pulled by checking the "measurements" object of a device returned from Sensibo.
		 * Also marks if a given capability is 'supported' by Homekit (and this plugin) by name checking a hard-coded list.
		 * @returns {object}     List of measurements, and if it is homeKitSupported (true/false), e.g. iaq.homeKitSupported: true
		 */
		airQualityCapabilities: () => {
			const capabilities = {}

			log.easyDebug(`${device.name} - Utils airQualityCapabilities - start, measurements:`)

			for (const [measurement, value] of Object.entries(device.measurements)) {
				// measurement can include: time, temperature, humidity, feelsLike, rssi (Received Signal Strength Indicator),
				// motion, roomIsOccupied, tvoc, co2, pm25, etoh (ethanol), iaq (indoor air quality?)

				// TODO: this list should probably move else where? Maybe in to a config, or to index.js
				if (['temperature', 'humidity', 'iaq', 'co2', 'pm25', 'tvoc'].includes(measurement)) {
					capabilities[measurement] = { homeKitSupported: true }
				} else {
					capabilities[measurement] = { homeKitSupported: false }
				}

				log.easyDebug(`${device.name} - name: ${measurement}, value: ${value}, homeKitSupported: ${capabilities[measurement].homeKitSupported}`)
			}

			log.easyDebug(`${device.name} - Utils airQualityCapabilities - end`)

			return capabilities
		},

		/**
		 * Returns the Sensibo fanLevel for a given percentage
		 * @param  {number}         percentValue  The fan percentage from Homekit
		 * @param  {string[]}       fanLevels     The list of fan levels supported by Sensibo for the device
		 * @returns {string}                      The single fan level that matches the percentage from Homekit
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
		 * @param  {object}    deviceCapabilitiesForMode  The device options available given its current mode
		 * @param  {object}    deviceState                Devices current state in Homekit 'model'
		 * @returns {object}                              The Sensibo formatted swing and horizontalSwing values
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
		 * Convert degrees F to degrees C
		 * @param  {number} degreesF The degrees in F to convert
		 * @returns {number}         The degrees in C
		 */
		toCelsius: degreesF => {
			const degreesC = (degreesF - 32) / 1.8

			log.easyDebug(`${device.name} - Utils toCelsius - degreesF: ${degreesF}, degreesC: ${degreesC}`)

			return degreesC
		},

		/**
		 * Convert degrees C to degrees F
		 * @param  {number} degreesC The degrees in C to convert
		 * @returns {number}         The degrees in F
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
		 * @param  {string}        serviceName        The Service to update
		 * @param  {string}        characteristicName The Characteristic to update
		 * @param  {number|string} newValue           The value that the Characteristic should be set to
		 * @returns {void}
		 */
		updateValue: (serviceName, characteristicName, newValue) => {
			// log.easyDebug(`${device.name} - updateValue: ${newValue} for characteristic ${characteristicName} on service ${serviceName}`)
			// Could we use .validateUserInput or .validateClientSuppliedValue from HAP Characteristics definition? Probably not as both are private...

			const characteristic = device[serviceName]?.getCharacteristic(Characteristic[characteristicName])

			if (typeof characteristic === 'undefined') {
				log.easyDebug(`${device.name} - characteristic undefined for serviceName: ${serviceName} and/or characteristicName: ${characteristicName} while trying to set '${newValue}'... skipping update`)

				return
			}

			// FIXME: what does this line actually check for? Does it look for not false and false (not true) at the same time?
			if (newValue !== 0 && newValue !== false && (typeof newValue === 'undefined' || !newValue)) {
				log.easyDebug(`${device.name} - '${newValue}' bad value for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			if (newValue === undefined || newValue === null) {
				log.easyDebug(`${device.name} - '${newValue}' undefined or null for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

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
				log.easyDebug(`${device.name} - '${newValue}' is not a number for characteristic ${characteristicName} (expected format '${format}') on service ${serviceName}... continuing`)
			}

			if (validValues && !validValues.includes(newValue)) {
				log.easyDebug(`${device.name} - '${newValue}' not in validValues: ${validValues} for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			// TODO: CurrentTemperature value being returned seems to need rounding?
			// e.g. "22.60000000000001"

			if (minStep) {
				const roundedValue = minStep < 1 ? Math.round((newValue + Number.EPSILON) * 10) / 10 : Math.round(newValue + Number.EPSILON)

				if (roundedValue !== newValue) {
					log.easyDebug(`${device.name} - '${newValue}' doesn't meet the rounding required by minStep: ${minStep} for characteristic ${characteristicName} on service ${serviceName}... rounding to ${roundedValue}`)
					newValue = roundedValue
				}
			}

			if (minValue && newValue < minValue) {
				log.easyDebug(`${device.name} - '${newValue}' less than minValue: ${minValue} for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			} else if (maxValue && newValue > maxValue) {
				log.easyDebug(`${device.name} - '${newValue}' greater than maxValue: ${maxValue} for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			if (currentValue === newValue) {
				log.easyDebug(`${device.name} - '${newValue}' equals '${currentValue}' for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			log.easyDebug(`${device.name} - Setting '${newValue}' for characteristic ${characteristicName} on service ${serviceName}, value was '${currentValue}'`)
			// TODO: investigate using this instead: https://developers.homebridge.io/#/api/service#serviceupdatecharacteristic
			characteristic.updateValue(newValue)

			return
		}

	}
}
