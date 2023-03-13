module.exports = (platform) => {
	const Characteristic = platform.api.hap.Characteristic
	const log = platform.log

	return {

		updateValue: (device, serviceName, characteristicName, newValue) => {
			// log.easyDebug(`${device.name} - updateValue: ${newValue} for characteristic ${characteristicName} on service ${serviceName}`)

			const characteristic = device[serviceName]?.getCharacteristic(Characteristic[characteristicName])

			if (typeof characteristic === 'undefined') {
				log.easyDebug(`${device.name} - characteristic undefined for serviceName: ${serviceName} and/or characteristicName: ${characteristicName} while trying to set '${newValue}'`)

				return
			}

			if (newValue !== 0 && newValue !== false && (typeof newValue === 'undefined' || !newValue)) {
				log.easyDebug(`${device.name} - '${newValue}' bad value for characteristic ${characteristicName} on service ${serviceName}`)

				return
			}

			if (newValue !== 0 && newValue !== false && (typeof newValue === 'undefined' || !newValue)) {
				log.easyDebug(`${device.name} - '${newValue}' bad value for characteristic ${characteristicName} on service ${serviceName}`)

				return
			}

			if (newValue === undefined || newValue === null) {
				log.easyDebug(`${device.name} - '${newValue}' undefined or null for characteristic ${characteristicName} on service ${serviceName}`)

				return
			}

			if (Number.isNaN(newValue)) {
				// non-number is valid for many usecases
				log.easyDebug(`${device.name} - '${newValue}' is not a number for characteristic ${characteristicName} on service ${serviceName}... continuing`)
			}

			const minValue = characteristic.props.minValue
			const maxValue = characteristic.props.maxValue
			const validValues = characteristic.props.validValues
			const currentValue = characteristic.value

			if (validValues && !validValues.includes(newValue)) {
				log.easyDebug(`${device.name} - '${newValue}' not in validValues: ${validValues} for characteristic ${characteristicName} on service ${serviceName}`)

				return
			}

			if (minValue && newValue < minValue) {
				log.easyDebug(`${device.name} - '${newValue}' less than minValue: ${minValue} for characteristic ${characteristicName} on service ${serviceName}`)

				return
			} else if (maxValue && newValue > maxValue) {
				log.easyDebug(`${device.name} - '${newValue}' greater than maxValue: ${maxValue} for characteristic ${characteristicName} on service ${serviceName}`)

				return
			}

			if (currentValue === newValue) {
				log.easyDebug(`${device.name} - '${newValue}' equals '${currentValue}' for characteristic ${characteristicName} on service ${serviceName}`)

				return
			}

			log.easyDebug(`${device.name} - Setting '${newValue}' for characteristic ${characteristicName} on service ${serviceName}`)
			characteristic.updateValue(newValue)

			return
		},

		test: () => {
			return
		}

	}
}