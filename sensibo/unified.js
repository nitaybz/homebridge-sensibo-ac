// FIXME: remove once acStateFromDevice moved to Utils (and use the version there instead)
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

// FIXME: remove once acStateFromDevice moved to Utils (and use the version there instead)
function toCelsius(value) {
	return (value - 32) / 1.8
}

// TODO: move all functions in to Utils
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
			filterService: device.filtersCleaning ? true : false
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
		const roomName = device.room?.name ?? device.roomName

		for (const [key, modeCapabilities] of Object.entries(device.remoteCapabilities.modes)) {
			// Mode options are COOL, HEAT, AUTO, FAN, DRY
			const mode = key.toUpperCase()

			capabilities[mode] = {}

			if (!['DRY', 'FAN'].includes(mode)) {
				capabilities[mode].homeKitSupported = true
			}

			platform.log.easyDebug(`${roomName} - Mode: ${mode} - Temperature scales, C: ${'C' in modeCapabilities.temperatures} F: ${'F' in modeCapabilities.temperatures}`)

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
			// TODO: fanLevels.length will evaluate to 0 if empty... should it be > 0?
			// Note: it looks like if .length evaluates to 0 then that is treated the same as 'false'?
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

			platform.log.easyDebug(`${roomName} - Mode: ${mode}, Capabilities: `)
			platform.log.easyDebug(capabilities[mode])
		}

		return capabilities
	},

	acStateFromDevice: device => {
		const state = {
			active: device.acState.on,
			mode: device.acState.mode.toUpperCase(),
			// targetTemperature can be null / missing from device.acState when unit is set to FAN (or DRY) mode
			targetTemperature: !device.acState.targetTemperature ? null : device.acState.temperatureUnit === 'C' ? device.acState.targetTemperature : toCelsius(device.acState.targetTemperature),
			currentTemperature: device.measurements.temperature,
			relativeHumidity: device.measurements.humidity,
			// TODO: BIG change, but consider moving smartMode out to be a sibling of state, rather than a child
			// This would have impacts in a number of places, including StateHandler (might need a separate Proxy?),
			// but could simplify other object interactions? E.g. changing a single property within smartMode
			smartMode: device.smartMode,
			pureBoost: device.pureBoostConfig && device.pureBoostConfig.enabled
		}

		if ('light' in device.acState) {
			state.light = device.acState.light !== 'off'
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

	// FIXME: likely needs a dedicated airPurifierStateFromDevice function

	airQualityStateFromDevice: (device, Constants) => {
		// device.log.easyDebug(`${device.name} - airQualityStateFromDevice start`)
		// FIXME: re-enable logs once moved to Utils
		// log.easyDebug(`${device.name} - airQualityStateFromDevice start`)
		const state = {}

		// Set AirQuality and TVOC. Note: tvoc is used as a fallback if iaq not set
		if (device.measurements?.tvoc && device.measurements.tvoc > 0) {
			const iaqReading = device.measurements?.iaq ?? 0
			const tvocReading = device.measurements.tvoc
			// convert ppb to μg/m3
			const vocDensity = Math.round(tvocReading * 4.57)

			// NOTE: max value is overwritten to 10000 by VOCDENSITY_MAX
			state.VOCDensity = vocDensity < Constants.VOCDENSITY_MAX ? vocDensity : Constants.VOCDENSITY_MAX

			if (iaqReading !== 0) {
				// don't overwrite airQuality if already retrieved from Sensibo
				// is pm25 the value returned by Sensibo Pure devices _instead_ of iaq?

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

				state.airQuality = convertedQuality <= 5 ? convertedQuality : 5
			} else if (tvocReading > 1500) {
				// POOR
				state.airQuality = 5
			} else if (tvocReading > 1000) {
				// INFERIOR
				state.airQuality = 4
			} else if (tvocReading > 500) {
				// FAIR
				state.airQuality = 3
			} else if (tvocReading > 250) {
				// GOOD
				state.airQuality = 2
			} else {
				// EXCELLENT
				state.airQuality = 1
			}
			// Note: 0 = UNKNOWN
		}

		// Set CO2
		if (device.measurements?.co2 && device.measurements.co2 > 0) {
			// NOTE: max value is 100000
			state.carbonDioxideLevel = device.measurements.co2
			state.carbonDioxideDetected = device.measurements.co2 < Constants.carbonDioxideAlertThreshold ? 0 : 1
		}

		// Set PM2.5
		if (device.measurements?.pm25 && device.measurements.pm25 > 0) {
			// Not sure what units value is in... might need to convert ppb to μg/m3?
			// NOTE: Looks like API can return decimal
			const pm2_5Density = Math.round(device.measurements.pm25)

			// NOTE: max value is overwritten to 10000 by PM2_5DENSITY_MAX
			state.PM2_5Density = pm2_5Density < Constants.PM2_5DENSITY_MAX ? pm2_5Density : Constants.PM2_5DENSITY_MAX

			// state.PM2_5Density = device.measurements.pm25
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
	}

}
