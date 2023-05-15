function fanLevelToHK(value, fanLevels) {
	if (value === 'auto') {
		return 0
	}

	fanLevels = fanLevels.filter(level => {
		return level !== 'auto'
	})

	const totalLevels = fanLevels.length > 0 ? fanLevels.length : 1
	const valueIndex = fanLevels.indexOf(value) + 1

	return Math.round(100 * valueIndex / totalLevels)
}

function HKToFanLevel(value, fanLevels) {
	let selected = 'auto'

	if (!fanLevels.includes('auto')) {
		selected = fanLevels[0]
	}

	if (value !== 0) {
		fanLevels = fanLevels.filter(level => {
			return level !== 'auto'
		})
		const totalLevels = fanLevels.length

		for (let i = 0; i < fanLevels.length; i++) {
			if (value <= (100 * (i + 1) / totalLevels)) {
				selected = fanLevels[i]
				break
			}
		}
	}

	return selected
}

function toFahrenheit(value) {
	return Math.round((value * 1.8) + 32)
}

function toCelsius(value) {
	return (value - 32) / 1.8
}

module.exports = {

	deviceInformation: device => {
		return {
			id: device.id,
			model: device.productModel ?? device.model,
			serial: device.serial,
			manufacturer: 'Sensibo Inc.',
			appId: 'com.sensibo.Sensibo',
			roomName: device.room?.name ?? device.roomName,
			temperatureUnit: device.temperatureUnit,
			filterService: device.filtersCleaning ? true : false,
		}
	},

	sensorInformation: sensor => {
		return {
			id: sensor.id,
			model: sensor.productModel,
			serial: sensor.serial
		}
	},

	locationInformation: location => {
		return {
			id: location.id,
			name: location.name,
			serial: location.id
		}
	},

	capabilities: (device, platform) => {
		const capabilities = {}

		for (const [key, modeCapabilities] of Object.entries(device.remoteCapabilities.modes)) {
			// Mode options are COOL, HEAT, AUTO, FAN, DRY
			const mode = key.toUpperCase()

			capabilities[mode] = {}

			if (!['DRY','FAN'].includes(mode)) {
				capabilities[mode].homeAppEnabled = true
			}

			// set temperatures min & max
			platform.log.easyDebug(`Capabilities, temperature scales available, C: ${'C' in modeCapabilities.temperatures} F: ${'F' in modeCapabilities.temperatures}`)
			// TODO: check if we even need to bother setting F below because it's never used...
			if (modeCapabilities.temperatures?.C) {
				capabilities[mode].temperatures = {
					C: {
						min: Math.min(...modeCapabilities.temperatures.C.values),
						max: Math.max(...modeCapabilities.temperatures.C.values)
					},
					F: {
						min: Math.min(...modeCapabilities.temperatures.F.values),
						max: Math.max(...modeCapabilities.temperatures.F.values)
					}
				}
			}

			// set fanSpeeds
			if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length) {
				capabilities[mode].fanSpeeds = modeCapabilities.fanLevels

				// set AUTO fanSpeed
				if (capabilities[mode].fanSpeeds.includes('auto')) {
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

			platform.log.easyDebug(`Mode: ${mode}, Capabilities: `)
			platform.log.easyDebug(capabilities[mode])
		}

		return capabilities
	},

	acState: device => {
		const state = {
			active: device.acState.on,
			mode: device.acState.mode.toUpperCase(),
			targetTemperature: !device.acState.targetTemperature ? null : device.acState.temperatureUnit === 'C' ? device.acState.targetTemperature : toCelsius(device.acState.targetTemperature),
			currentTemperature: device.measurements.temperature,
			relativeHumidity: device.measurements.humidity,
			smartMode: device.smartMode && device.smartMode.enabled,
			light: device.acState.light && device.acState.light !== 'off',
			pureBoost: device.pureBoostConfig && device.pureBoostConfig.enabled
		}

		if (device.filtersCleaning) {
			state.filterChange = device.filtersCleaning.shouldCleanFilters ? 'CHANGE_FILTER' : 'FILTER_OK'
			const acOnSecondsSinceLastFiltersClean = device.filtersCleaning.acOnSecondsSinceLastFiltersClean
			const filtersCleanSecondsThreshold = device.filtersCleaning.filtersCleanSecondsThreshold

			if (acOnSecondsSinceLastFiltersClean > filtersCleanSecondsThreshold) {
				state.filterLifeLevel = 0
			} else {
				state.filterLifeLevel = 100 - Math.floor(acOnSecondsSinceLastFiltersClean / filtersCleanSecondsThreshold * 100)
			}
		}

		state.horizontalSwing = 'SWING_DISABLED'
		state.verticalSwing = 'SWING_DISABLED'

		if (device.acState.swing) {
			if (device.acState.swing === 'rangeFull') {
				state.verticalSwing = 'SWING_ENABLED'
			} else if (device.acState.swing === 'horizontal') {
				state.horizontalSwing = 'SWING_ENABLED'
			} else if (device.acState.swing === 'both') {
				state.horizontalSwing = 'SWING_ENABLED'
				state.verticalSwing = 'SWING_ENABLED'
			}
		}

		if (device.acState.horizontalSwing && device.acState.horizontalSwing === 'rangeFull') {
			state.horizontalSwing = 'SWING_ENABLED'
		}

		const modeCapabilities = device.remoteCapabilities.modes[device.acState.mode]

		if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length) {
			state.fanSpeed = fanLevelToHK(device.acState.fanLevel, modeCapabilities.fanLevels) || 0
		}

		return state
	},

	airQualityState: (device, Constants) => {
		const state = {}

		state.airQuality = device.measurements?.pm25 ?? 0

		if (device.measurements?.tvoc && device.measurements.tvoc > 0) {
			// convert ppb to μg/m3
			const VOCDensity = Math.round(device.measurements.tvoc * 4.57)

			state.VOCDensity = VOCDensity < Constants.VOCDENSITY_MAX ? VOCDensity : Constants.VOCDENSITY_MAX

			if (state.airQuality !== 0) {
				// don't overwrite airQuality if already retrieved from Sensibo
			} else if (device.measurements.tvoc > 1500) {
				state.airQuality = 5
			} else if (device.measurements.tvoc > 1000) {
				state.airQuality = 4
			} else if (device.measurements.tvoc > 500) {
				state.airQuality = 3
			} else if (device.measurements.tvoc > 250) {
				state.airQuality = 2
			} else {
				state.airQuality = 1
			}
		}

		if (device.measurements?.co2 && device.measurements.co2 > 0) {
			state.carbonDioxideLevel = device.measurements.co2
			state.carbonDioxideDetected = device.measurements.co2 < Constants.carbonDioxideAlertThreshold ? 0 : 1
		}

		return state
	},

	sensorState: sensor => {
		const state = {
			motionDetected: sensor.measurements.motion,
			currentTemperature: sensor.measurements.temperature,
			relativeHumidity: sensor.measurements.humidity,
			lowBattery: sensor.measurements.batteryVoltage > 100 ? 'BATTERY_LEVEL_NORMAL' : 'BATTERY_LEVEL_LOW'
		}

		return state
	},

	occupancyState: location => {
		const state = { occupancy: (location.occupancy === 'me' || location.occupancy === 'someone') ? 'OCCUPANCY_DETECTED' : 'OCCUPANCY_NOT_DETECTED' }

		return state
	},

	sensiboFormattedState: (device, state) => {
		device.log.easyDebug(`${device.name} -> sensiboFormattedState: ${JSON.stringify(state, null, 4)}`)
		const acState = {
			on: state.active,
			mode: state.mode.toLowerCase(),
			temperatureUnit: device.temperatureUnit,
			targetTemperature: device.usesFahrenheit ? toFahrenheit(state.targetTemperature) : state.targetTemperature
		}

		if ('threeDimensionalSwing' in device.capabilities[state.mode]) {
			if ((state.horizontalSwing === 'SWING_ENABLED') && (state.verticalSwing === 'SWING_ENABLED')) {
				acState.swing = 'both'
			} else if (state.verticalSwing === 'SWING_ENABLED') {
				acState.swing =  'rangeFull'
			} else if (state.horizontalSwing === 'SWING_ENABLED') {
				acState.swing = 'horizontal'
			} else {
				acState.swing = 'stopped'
			}
		} else {
			if ('verticalSwing' in device.capabilities[state.mode]) {
				acState.swing = state.verticalSwing === 'SWING_ENABLED' ? 'rangeFull' : 'stopped'
			}

			if ('horizontalSwing' in device.capabilities[state.mode]) {
				acState.horizontalSwing = state.horizontalSwing === 'SWING_ENABLED' ? 'rangeFull' : 'stopped'
			}
		}

		if ('fanSpeeds' in device.capabilities[state.mode]) {
			acState.fanLevel = HKToFanLevel(state.fanSpeed, device.capabilities[state.mode].fanSpeeds)
		}

		if ('light' in device.capabilities[state.mode]) {
			acState.light = state.light ? 'on' : 'off'
		}

		return acState
	}

}