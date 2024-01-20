module.exports = (device, platform) => {
	const Characteristic = platform.api.hap.Characteristic
	const log = platform.log

	return {

		// TODO: round numbers to 0 or 1 decimals?
		// Probably should be done when _calling_ updateValue rather than in it? (So it's not "hidden" functionality)
		// E.g. humidity should be a full percentage, temp seems to support 1 decimal
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

			// TODO: CurrentTemperature value being returned seems to need rounding?
			// e.g. "22.60000000000001"

			if (validValues && !validValues.includes(newValue)) {
				log.easyDebug(`${device.name} - '${newValue}' not in validValues: ${validValues} for characteristic ${characteristicName} on service ${serviceName}... skipping update`)

				return
			}

			if (minStep) {
				const roundedValue = minStep < 1 ? Math.round((newValue + Number.EPSILON) * 10) / 10 : Math.round(newValue + Number.EPSILON)

				if (roundedValue !== newValue) {
					log.easyDebug(`${device.name} - '${newValue}' doesn't meet the rounding requird by minStep: ${minStep} for characteristic ${characteristicName} on service ${serviceName}... rounding to ${roundedValue}`)
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
			characteristic.updateValue(newValue)

			return
		},

		test: () => {
			return
		}

	}
}