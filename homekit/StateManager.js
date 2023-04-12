let Characteristic

function toFahrenheit(value) {
	return Math.round((value * 1.8) + 32)
}

function characteristicToMode(characteristic) {
	switch (characteristic) {
		case Characteristic.TargetHeaterCoolerState.AUTO:
			return 'AUTO'

		case Characteristic.TargetHeaterCoolerState.COOL:
			return 'COOL'

		case Characteristic.TargetHeaterCoolerState.HEAT:
			return 'HEAT'
	}
}

function sanitize(service, characteristic, value) {
	const minAllowed = service.getCharacteristic(Characteristic[characteristic]).props.minValue
	const maxAllowed = service.getCharacteristic(Characteristic[characteristic]).props.maxValue
	const validValues = service.getCharacteristic(Characteristic[characteristic]).props.validValues
	const currentValue = service.getCharacteristic(Characteristic[characteristic]).value

	if (value !== 0 && (typeof value === 'undefined' || !value)) {
		return currentValue
	}

	if (validValues && !validValues.includes(value)) {
		return currentValue
	}

	if (minAllowed && value < minAllowed) {
		return currentValue
	}

	if (maxAllowed && value > maxAllowed) {
		return currentValue
	}

	return value
}

// TODO: perhaps make this a class?
module.exports = (device, platform) => {
	Characteristic = platform.api.hap.Characteristic
	const log = platform.log

	return {

		get: {
			ACActive: (callback) => {
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

			PureActive: (callback) => {
				const active = device.state.active

				log.easyDebug(`${device.name} (GET) - Pure Active State: ${active}`)
				callback(null, active ? 1 : 0)
			},

			CurrentAirPurifierState: (callback) => {
				const active = device.state.active

				log.easyDebug(`${device.name} (GET) - Pure Current State: ${active ? 'PURIFYING_AIR' : 'INACTIVE'}`)
				callback(null, active ? 2 : 0)
			},

			TargetAirPurifierState: (callback) => {
				const pureBoost = device.state.pureBoost

				log.easyDebug(`${device.name} (GET) - Pure Target State (Boost): ${pureBoost ? 'AUTO' : 'MANUAL'}`)
				callback(null, pureBoost ? 1 : 0)
			},

			CurrentHeaterCoolerState: (callback) => {
				const active = device.state.active
				const mode = device.state.mode
				const targetTemp = device.state.targetTemperature
				const currentTemp = device.state.currentTemperature

				log.easyDebug(device.name, '(GET) - Current HeaterCooler State is:', active ? mode : 'OFF')

				if (!active || mode === 'FAN' || mode === 'DRY') {
					callback(null, Characteristic.CurrentHeaterCoolerState.INACTIVE)
				} else if (mode === 'COOL') {
					callback(null, Characteristic.CurrentHeaterCoolerState.COOLING)
				} else if (mode === 'HEAT') {
					callback(null, Characteristic.CurrentHeaterCoolerState.HEATING)
				} else if (currentTemp > targetTemp) {
					callback(null, Characteristic.CurrentHeaterCoolerState.COOLING)
				} else {
					callback(null, Characteristic.CurrentHeaterCoolerState.HEATING)
				}
			},

			TargetHeaterCoolerState: (callback) => {
				const active = device.state.active
				const mode = device.state.mode

				log.easyDebug(device.name, '(GET) - Target HeaterCooler State is:', active ? mode : 'OFF')

				if (!active || mode === 'FAN' || mode === 'DRY') {
					const lastMode = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value

					callback(null, lastMode)
				} else {
					callback(null, sanitize(device.HeaterCoolerService, 'TargetHeaterCoolerState', Characteristic.TargetHeaterCoolerState[mode]))
				}
			},

			CurrentTemperature: (callback) => {
				const currentTemp = device.state.currentTemperature

				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(GET) - Current Temperature is:', toFahrenheit(currentTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(GET) - Current Temperature is:', currentTemp + 'ºC')
				}

				callback(null, currentTemp)
			},

			CoolingThresholdTemperature: (callback) => {
				const targetTemp = sanitize(device.HeaterCoolerService, 'CoolingThresholdTemperature', device.state.targetTemperature)

				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(GET) - Target Cooling Temperature is:', toFahrenheit(targetTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(GET) - Target Cooling Temperature is:', targetTemp + 'ºC')
				}

				callback(null, targetTemp)
			},

			HeatingThresholdTemperature: (callback) => {
				const targetTemp = sanitize(device.HeaterCoolerService, 'HeatingThresholdTemperature', device.state.targetTemperature)

				if (device.usesFahrenheit) {
					log.easyDebug(device.name, '(GET) - Target Heating Temperature is:', toFahrenheit(targetTemp) + 'ºF')
				} else {
					log.easyDebug(device.name, '(GET) - Target Heating Temperature is:', targetTemp + 'ºC')
				}

				callback(null, targetTemp)
			},

			TemperatureDisplayUnits: (callback) => {
				log.easyDebug(device.name, '(GET) - Temperature Display Units is:', device.temperatureUnit)
				callback(null, device.usesFahrenheit ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS)
			},

			CurrentRelativeHumidity: (callback) => {
				log.easyDebug(device.name, '(GET) - Current Relative Humidity is:', device.state.relativeHumidity, '%')
				callback(null, device.state.relativeHumidity)
			},

			ACSwing: (callback) => {
				const swing = device.state.verticalSwing

				log.easyDebug(device.name, '(GET) - AC Swing is:', swing)
				callback(null, Characteristic.SwingMode[swing])
			},

			ACRotationSpeed: (callback) => {
				const fanSpeed = device.state.fanSpeed

				log.easyDebug(device.name, '(GET) - AC Rotation Speed is:', fanSpeed + '%')
				callback(null, fanSpeed)
			},

			PureRotationSpeed: (callback) => {
				const fanSpeed = device.state.fanSpeed

				log.easyDebug(device.name, '(GET) - Pure Rotation Speed is:', fanSpeed + '%')
				callback(null, fanSpeed)
			},

			// FILTER
			FilterChangeIndication: (callback) => {
				const filterChange = device.state.filterChange

				log.easyDebug(device.name, '(GET) - Filter Change Indication:', filterChange)
				callback(null, Characteristic.FilterChangeIndication[filterChange])
			},

			FilterLifeLevel: (callback) => {
				const filterLifeLevel = device.state.filterLifeLevel

				log.easyDebug(device.name, '(GET) - Filter Life Level:', filterLifeLevel + '%')
				callback(null, filterLifeLevel)
			},

			// FAN
			FanActive: (callback) => {
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

			FanSwing: (callback) => {
				const swing = device.state.verticalSwing

				log.easyDebug(device.name, '(GET) - Fan Swing is:', swing)
				callback(null, Characteristic.SwingMode[swing])
			},

			FanRotationSpeed: (callback) => {
				const fanSpeed = device.state.fanSpeed

				log.easyDebug(device.name, '(GET) - Fan Rotation Speed is:', fanSpeed + '%')
				callback(null, fanSpeed)
			},

			// DEHUMIDIFIER
			DryActive: (callback) => {
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

			CurrentHumidifierDehumidifierState: (callback) => {
				const active = device.state.active
				const mode = device.state.mode

				if (!active || mode !== 'DRY') {
					log.easyDebug(device.name, '(GET) - Dry Current Dehumidifier State: INACTIVE')
					callback(null, Characteristic.CurrentHumidifierDehumidifierState.INACTIVE)
				} else {
					log.easyDebug(device.name, '(GET) - Dry Current Dehumidifier State: DEHUMIDIFYING')
					callback(null, Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING)
				}
			},

			TargetHumidifierDehumidifierState: (callback) => {
				log.easyDebug(device.name, '(GET) - Target Dehumidifier State: DEHUMIDIFIER')
				callback(null, Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
			},

			DryRotationSpeed: (callback) => {
				const fanSpeed = device.state.fanSpeed

				log.easyDebug(device.name, '(GET) - Dry Rotation Speed is:', fanSpeed + '%')
				callback(null, fanSpeed)
			},

			DrySwing: (callback) => {
				const swing = device.state.verticalSwing

				log.easyDebug(device.name, '(GET) - Dry Swing is:', swing)
				callback(null, Characteristic.SwingMode[swing])
			},

			// ROOM SENSOR
			MotionDetected: (callback) => {
				const motionDetected = device.state.motionDetected

				log.easyDebug(device.name, '(GET) - Motion Detected is:', motionDetected)
				callback(null, motionDetected)
			},

			StatusLowBattery: (callback) => {
				const lowBattery = device.state.lowBattery

				log.easyDebug(device.name, '(GET) - Status Low Battery is:', lowBattery)
				callback(null, Characteristic.StatusLowBattery[lowBattery])
			},

			// HORIZONTAL SWING
			HorizontalSwing: (callback) => {
				const horizontalSwing = device.state.horizontalSwing

				log.easyDebug(device.name, '(GET) - Horizontal Swing is:', horizontalSwing)
				callback(null, horizontalSwing === 'SWING_ENABLED')
			},

			// AC LIGHT
			LightSwitch: (callback) => {
				const light = device.state.light

				log.easyDebug(device.name, '(GET) - Light is', light ? 'ON' : 'OFF')
				callback(null, light)
			},

			// CLIMATE REACT
			ClimateReact: (callback) => {
				const smartMode = device.state.smartMode

				log.easyDebug(device.name, '(GET) - Climate React Switch:', smartMode)
				callback(null, smartMode)
			},

			// OCCUPANCY SENSOR
			OccupancyDetected: (callback) => {
				const occupancy = device.state.occupancy

				log.easyDebug(device.name, '(GET) - is:', occupancy)
				callback(null, Characteristic.OccupancyDetected[occupancy])
			},

			// Air Quality
			AirQuality: (callback) => {
				const airQuality = device.state.airQuality

				log.easyDebug(device.name, '(GET) - Air Quality is:', airQuality)
				callback(null, airQuality)
			},

			VOCDensity: (callback) => {
				const VOCDensity = device.state.VOCDensity

				log.easyDebug(device.name, '(GET) - Volatile Organic Compound Density is:', VOCDensity)
				callback(null, VOCDensity)
			},

			CarbonDioxideDetected: (callback) => {
				const carbonDioxideDetected = device.state.carbonDioxideDetected

				log.easyDebug(device.name, '(GET) - Carbon Dioxide Detected is:', carbonDioxideDetected)
				callback(null, carbonDioxideDetected)
			},

			CarbonDioxideLevel: (callback) => {
				const carbonDioxideLevel = device.state.carbonDioxideLevel

				log.easyDebug(device.name, '(GET) - Carbon Dioxide Level is:', carbonDioxideLevel)
				callback(null, carbonDioxideLevel)
			},

			SyncButton: (callback) => {
				log.easyDebug(device.name, '(GET) - Sync Button, no state change')
				callback(null, false)
			}
		},

		set: {
			ACActive: (state, callback) => {
				const status = !!state

				log.easyDebug(device.name + ' -> Setting AC state Active:', status)

				if (status) {
					device.state.active = true
					const lastMode = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
					const mode = characteristicToMode(lastMode)

					log.easyDebug(device.name + ' -> Setting Mode to', mode)
					device.state.mode = mode
				} else if (device.state.mode === 'COOL' || device.state.mode === 'HEAT' || device.state.mode === 'AUTO') {
					device.state.active = false
				}

				callback()
			},

			PureActive: (state, callback) => {
				const status = !!state

				log.easyDebug(device.name + ' -> Setting Pure state Active:', status)
				device.state.active = status
				callback()
			},

			TargetHeaterCoolerState: (state, callback) => {
				const mode = characteristicToMode(state)

				log.easyDebug(device.name + ' -> Setting Target HeaterCooler State:', mode)
				device.state.mode = mode
				device.state.active = true
				callback()
			},

			CoolingThresholdTemperature: (temp, callback) => {
				if (device.usesFahrenheit) {
					log.easyDebug(device.name + ' -> Setting Cooling Threshold Temperature:', toFahrenheit(temp) + 'ºF')
				} else {
					log.easyDebug(device.name + ' -> Setting Cooling Threshold Temperature:', temp + 'ºC')
				}

				const lastMode = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const mode = characteristicToMode(lastMode)

				log.easyDebug(device.name + ' -> Setting Mode to:', mode)
				device.state.targetTemperature = temp
				device.state.mode = mode
				device.state.active = true
				callback()
			},

			HeatingThresholdTemperature: (temp, callback) => {
				if (device.usesFahrenheit) {
					log.easyDebug(device.name + ' -> Setting Heating Threshold Temperature:', toFahrenheit(temp) + 'ºF')
				} else {
					log.easyDebug(device.name + ' -> Setting Heating Threshold Temperature:', temp + 'ºC')
				}

				const lastMode = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const mode = characteristicToMode(lastMode)

				log.easyDebug(device.name + ' -> Setting Mode to:', mode)
				device.state.targetTemperature = temp
				device.state.mode = mode
				device.state.active = true
				callback()
			},

			ACSwing: (state, callback) => {
				const status = state === Characteristic.SwingMode.SWING_ENABLED ? 'SWING_ENABLED' : 'SWING_DISABLED'
				const lastMode = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const mode = characteristicToMode(lastMode)

				log.easyDebug(device.name + ' -> Setting AC Swing:', status)
				log.easyDebug(device.name + ' -> Setting Mode to', mode)
				device.state.verticalSwing = status
				device.state.mode = mode
				device.state.active = true
				callback()
			},

			ACRotationSpeed: (speed, callback) => {
				const lastMode = device.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).value
				const mode = characteristicToMode(lastMode)

				log.easyDebug(device.name + ' -> Setting AC Rotation Speed:', speed + '%')
				log.easyDebug(device.name + ' -> Setting Mode to', mode)
				device.state.fanSpeed = speed
				device.state.mode = mode
				device.state.active = true
				callback()
			},

			PureRotationSpeed: (speed, callback) => {
				if (speed) {
					log.easyDebug(device.name + ' -> Setting Pure Rotation Speed:', speed + '%')
					device.state.fanSpeed = speed
					device.state.active = true
				} else {
					device.state.active = false
				}

				callback()
			},

			// FILTER
			ResetFilterIndication: (value, callback) => {
				log.easyDebug(device.name + ' -> Resetting Filter Indication !!')
				device.state.filterChange = 0
				device.state.filterLifeLevel = 100
				callback()
			},

			// FAN
			FanActive: (state, callback) => {
				const status = !!state

				log.easyDebug(device.name + ' -> Setting Fan state Active:', status)

				if (status) {
					log.easyDebug(device.name + ' -> Setting Mode to: FAN')
					device.state.mode = 'FAN'
					device.state.active = true
				} else if (device.state.mode === 'FAN') {
					device.state.active = false
				}

				callback()
			},

			FanSwing: (state, callback) => {
				const status = state === Characteristic.SwingMode.SWING_ENABLED ? 'SWING_ENABLED' : 'SWING_DISABLED'

				log.easyDebug(device.name + ' -> Setting Fan Swing:', status)
				log.easyDebug(device.name + ' -> Setting Mode to: FAN')
				device.state.verticalSwing = status
				device.state.mode = 'FAN'
				device.state.active = true
				callback()
			},

			FanRotationSpeed: (speed, callback) => {
				log.easyDebug(device.name + ' -> Setting Fan Rotation Speed:', speed + '%')
				log.easyDebug(device.name + ' -> Setting Mode to: FAN')
				device.state.fanSpeed = speed
				device.state.mode = 'FAN'
				device.state.active = true
				callback()
			},

			// DEHUMIDIFIER
			DryActive: (state, callback) => {
				const status = !!state

				log.easyDebug(device.name + ' -> Setting Dry state Active:', status)

				if (status) {
					device.state.active = true
					log.easyDebug(device.name + ' -> Setting Mode to: DRY')
					device.state.mode = 'DRY'
				} else if (device.state.mode === 'DRY') {
					device.state.active = false
				}

				callback()
			},

			TargetHumidifierDehumidifierState: (state, callback) => {
				device.state.active = true
				log.easyDebug(device.name + ' -> Setting Mode to: DRY')
				device.state.mode = 'DRY'
				callback()
			},

			DrySwing: (state, callback) => {
				const status = state === Characteristic.SwingMode.SWING_ENABLED ? 'SWING_ENABLED' : 'SWING_DISABLED'

				log.easyDebug(device.name + ' -> Setting Dry Swing:', status)
				log.easyDebug(device.name + ' -> Setting Mode to: DRY')
				device.state.verticalSwing = status
				device.state.mode = 'DRY'
				device.state.active = true
				callback()
			},

			DryRotationSpeed: (speed, callback) => {
				log.easyDebug(device.name + ' -> Setting Dry Rotation Speed:', speed + '%')
				log.easyDebug(device.name + ' -> Setting Mode to: DRY')
				device.state.fanSpeed = speed
				device.state.mode = 'DRY'
				device.state.active = true
				callback()
			},

			// HORIZONTAL SWING
			HorizontalSwing: (state, callback) => {
				const status = state ? 'SWING_ENABLED' : 'SWING_DISABLED'

				log.easyDebug(device.name + ' -> Setting Horizontal Swing:', status)
				device.state.horizontalSwing = status
				callback()
			},

			// AC LIGHT
			LightSwitch: (state, callback) => {
				const lightState = state ?? false

				log.easyDebug(device.name + ' -> Setting AC Light to', lightState ? 'ON' : 'OFF')
				device.state.light = lightState
				callback()
			},

			// AC SYNC BUTTON
			// TODO: should be moved to be a 'set' in StateHanlder line 33
			SyncButton: (state, callback) => {
				if (state) {
					log.easyDebug(device.name + ' -> Syncing AC State => Setting ' + (device.state.active ? 'OFF' : 'ON') + ' state without sending commands')
					device.state.syncState()
				}

				callback()
			},

			// CLIMATE REACT
			ClimateReact: (state, callback) => {
				log.easyDebug(device.name + ' -> Setting Climate React Switch to', state)
				device.state.smartMode = state
				callback()
			},

			// PURE BOOST
			TargetAirPurifierState: (state, callback) => {
				const pureBoost = !!state

				log.easyDebug(device.name + ' -> Setting Target AirPurifier State (PURE BOOST) to', pureBoost ? 'enabled' : 'disabled')
				device.state.pureBoost = pureBoost
				callback()
			}
		}

	}
}