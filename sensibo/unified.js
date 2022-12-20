

function fanLevelToHK(value, fanLevels) {
	if (value === 'auto')
		return 0

	fanLevels = fanLevels.filter(level => level !== 'auto')
	const totalLevels = fanLevels.length
	const valueIndex = fanLevels.indexOf(value) + 1
	return Math.round(100 * valueIndex / totalLevels)
}

function HKToFanLevel(value, fanLevels) {

	let selected = 'auto'
	if (!fanLevels.includes('auto'))
		selected = fanLevels[0]

	if (value !== 0) {
		fanLevels = fanLevels.filter(level => level !== 'auto')
		const totalLevels = fanLevels.length
		for (let i = 0; i < fanLevels.length; i++) {
			if (value <= (100 * (i + 1) / totalLevels))	{
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

	capabilities: device => {

		const capabilities = {}

		for (const [key, modeCapabilities] of Object.entries(device.remoteCapabilities.modes)) {

			// Mode options are COOL, HEAT, AUTO, FAN, DRY
			const mode = key.toUpperCase()

			capabilities[mode] = {}

			// set temperatures min & max
			if (['COOL', 'HEAT', 'AUTO', 'DRY'].includes(mode) && modeCapabilities.temperatures && modeCapabilities.temperatures.C) {
				capabilities[mode].temperatures = {
					C: {
						min: modeCapabilities.temperatures.C.values[0],
						max: modeCapabilities.temperatures.C.values[modeCapabilities.temperatures.C.values.length - 1]
					},
					F: {
						min: modeCapabilities.temperatures.F.values[0],
						max: modeCapabilities.temperatures.F.values[modeCapabilities.temperatures.F.values.length - 1]
					}
				}
			}

			// set fanSpeeds
			if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length) {
				capabilities[mode].fanSpeeds = modeCapabilities.fanLevels

				// set AUTO fanSpeed
				if (capabilities[mode].fanSpeeds.includes('auto'))
					capabilities[mode].autoFanSpeed = true
				else
					capabilities[mode].autoFanSpeed = false
			}

			// set swing
			if (modeCapabilities.swing && modeCapabilities.swing.includes('rangeFull')) {
				capabilities[mode].swing = true
			}

			// set horizontal swing
			if (modeCapabilities.horizontalSwing && modeCapabilities.horizontalSwing.includes('rangeFull')) {
				capabilities[mode].horizontalSwing = true
			}

			// set light
			if (modeCapabilities.light) {
				capabilities[mode].light = true
			}

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
			if (acOnSecondsSinceLastFiltersClean > filtersCleanSecondsThreshold)
				state.filterLifeLevel = 0
			else
				state.filterLifeLevel =  100 - Math.floor(acOnSecondsSinceLastFiltersClean/filtersCleanSecondsThreshold*100)
		}

		const modeCapabilities = device.remoteCapabilities.modes[device.acState.mode]

		if (modeCapabilities.swing && modeCapabilities.swing.includes('rangeFull'))
			state.swing = device.acState.swing === 'rangeFull' ? 'SWING_ENABLED' : 'SWING_DISABLED'


		if (modeCapabilities.horizontalSwing && modeCapabilities.horizontalSwing.includes('rangeFull'))
			state.horizontalSwing = device.acState.horizontalSwing === 'rangeFull' ? 'SWING_ENABLED' : 'SWING_DISABLED'

		if (modeCapabilities.fanLevels && modeCapabilities.fanLevels.length)
			state.fanSpeed = fanLevelToHK(device.acState.fanLevel, modeCapabilities.fanLevels) || 0

		return state
	},

	airQualityState: device => {
		const state = {}

		state.airQuality = device.measurements?.pm25 ?? 0

		if (device.measurements?.tvoc && device.measurements.tvoc > 0) {
			// convert ppb to μg/m3
			let VOCDensity = Math.round(device.measurements.tvoc * 4.57)
			// Homebridge currently has max value of 1000 for VOCDensity
			state.VOCDensity = VOCDensity < 1000 ? VOCDensity : 1000

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
			state.carbonDioxideDetected = device.measurements.co2 > 1000 ? 1 : 0
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

		const state = {
			occupancy: (location.occupancy === 'me' || location.occupancy === 'someone') ? 'OCCUPANCY_DETECTED' : 'OCCUPANCY_NOT_DETECTED'
		}

		return state
	},

	sensiboFormattedState: (device, state) => {

		const acState = {
			on: state.active,
			mode: state.mode.toLowerCase(),
			temperatureUnit: device.temperatureUnit,
			targetTemperature: device.usesFahrenheit ? toFahrenheit(state.targetTemperature) : state.targetTemperature
		}

		if ('swing' in device.capabilities[state.mode])
			acState.swing = state.swing === 'SWING_ENABLED' ? 'rangeFull' : 'stopped'

		if ('horizontalSwing' in device.capabilities[state.mode])
			acState.horizontalSwing = state.horizontalSwing ==='SWING_ENABLED' ? 'rangeFull' : 'stopped'

		if ('fanSpeeds' in device.capabilities[state.mode])
			acState.fanLevel = HKToFanLevel(state.fanSpeed, device.capabilities[state.mode].fanSpeeds)

		if ('light' in device.capabilities[state.mode])
			acState.light = state.light ? 'on' : 'off'

		return acState
	}
}