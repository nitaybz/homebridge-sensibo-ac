const sensibo = require('./api')
module.exports = function (Accessory, Service, Characteristic, HomebridgeAPI, uuid, FakeGatoHistoryService) {



	/********************************************************************************************************************************************************/
	/********************************************************************************************************************************************************/
	/**************************************************************  Heater Cooler Accessory ****************************************************************/
	/********************************************************************************************************************************************************/
	/********************************************************************************************************************************************************/

	const CELSIUS_UNIT = 'C'
	const FAHRENHEIT_UNIT = 'F'

	function acAccessory(config) {

		this.type = config.type
		this.id = config.id
		this.model = config.model
		this.name = config.name
		this.displayName = this.name
		this.temperatureUnit = config.temperatureUnit
		this.capabilities = config.capabilities
		this.disableFan = config.disableFan
		this.disableDry = config.disableDry
		this.enableHistoryStorage = config.enableHistoryStorage,
		this.log = config.log
		this.debug = config.debug
		this.state = config.state
		this.setCommands = {}
		this.setProcessing = false
		this.enableSyncButton = config.enableSyncButton
		this.enableClimateReactSwitch = config.enableClimateReactSwitch,
		this.refreshState = config.refreshState

		if (this.enableHistoryStorage)
			this.loggingService = new FakeGatoHistoryService('weather', this, { storage: 'fs', path: HomebridgeAPI.user.persistPath() + '/../sensibo-persist' })

	}


	acAccessory.prototype.getServices = function () {

		const informationService = new Service.AccessoryInformation()
			.setCharacteristic(Characteristic.Manufacturer, 'Sensibo')
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.id)

		const services = [informationService]


		if (this.loggingService) {
			services.push(this.loggingService)
		}


		// HeaterCooler Service
		if (this.debug)
			this.log('Setting HeaterCooler Service for', this.name)

		this.HeaterCoolerService = new Service.HeaterCooler(this.name)

		this.HeaterCoolerService.getCharacteristic(Characteristic.Active)
			.on('get', this.getACActive.bind(this))
			.on('set', this.setACActive.bind(this))

		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.on('get', this.getCurrentHeaterCoolerState.bind(this))


		const props = []

		if (this.capabilities.cool) props.push(Characteristic.TargetHeaterCoolerState.COOL)
		if (this.capabilities.heat) props.push(Characteristic.TargetHeaterCoolerState.HEAT)
		if (this.capabilities.auto) props.push(Characteristic.TargetHeaterCoolerState.AUTO)

		this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.setProps({validValues: props})
			.on('get', this.getTargetHeaterCoolerState.bind(this))
			.on('set', this.setTargetHeaterCoolerState.bind(this))


		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', this.getCurrentTemperature.bind(this))

		if (this.capabilities.cool) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
				.setProps({
					minValue: this.capabilities.cool.temperatures[CELSIUS_UNIT].values[0],
					maxValue: this.capabilities.cool.temperatures[CELSIUS_UNIT].values[this.capabilities.cool.temperatures[CELSIUS_UNIT].values.length - 1],
					minStep: 0.1
				})
				.on('get', this.getCoolingThresholdTemperature.bind(this))
				.on('set', this.setCoolingThresholdTemperature.bind(this))
		}

		if (this.capabilities.heat) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
				.setProps({
					minValue: this.capabilities.heat.temperatures[CELSIUS_UNIT].values[0],
					maxValue: this.capabilities.heat.temperatures[CELSIUS_UNIT].values[this.capabilities.cool.temperatures[CELSIUS_UNIT].values.length - 1],
					minStep: 0.1
				})
				.on('get', this.getHeatingThresholdTemperature.bind(this))
				.on('set', this.setHeatingThresholdTemperature.bind(this))
		}


		this.HeaterCoolerService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.on('get', this.getTemperatureDisplayUnits.bind(this))

		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.getCurrentRelativeHumidity.bind(this))


		if (	(this.capabilities.cool && this.capabilities.cool.swing && this.capabilities.cool.swing.includes('rangeFull'))
     || (this.capabilities.heat && this.capabilities.heat.swing && this.capabilities.heat.swing.includes('rangeFull'))) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode)
				.on('get', this.getACSwing.bind(this))
				.on('set', this.setACSwing.bind(this))
		}

		if (	(this.capabilities.cool && this.capabilities.cool.fanLevels && this.capabilities.cool.fanLevels.length)
      || (this.capabilities.fanLevels && this.capabilities.fanLevels && this.capabilities.heat.fanLevels.length)) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.getACRotationSpeed.bind(this))
				.on('set', this.setACRotationSpeed.bind(this))
		}


		services.push(this.HeaterCoolerService)


		// Fan Service
		if (this.capabilities.fan && !this.disableFan) {
			if (this.debug)
				this.log('Setting Fanv2 Service for', this.name)
			this.FanService = new Service.Fanv2(this.name + ' Fan')

			this.FanService.getCharacteristic(Characteristic.Active)
				.on('get', this.getFanActive.bind(this))
				.on('set', this.setFanActive.bind(this))

			if (this.capabilities.fan.swing && this.capabilities.fan.swing.length) {
				this.FanService.getCharacteristic(Characteristic.SwingMode)
					.on('get', this.getFanSwing.bind(this))
					.on('set', this.setFanSwing.bind(this))
			}


			if (this.capabilities.fan.fanLevels && this.capabilities.fan.fanLevels.length) {
				this.FanService.getCharacteristic(Characteristic.RotationSpeed)
					.on('get', this.getFanRotationSpeed.bind(this))
					.on('set', this.setFanRotationSpeed.bind(this))
			}

			services.push(this.FanService)
		}


		// HumidifierDehumidifier Service
		if (this.capabilities.dry && !this.disableDry) {
			if (this.debug)
				this.log('Setting HumidifierDehumidifier Service for', this.name)
			this.DryService = new Service.HumidifierDehumidifier(this.name + ' Dry')

			this.DryService.getCharacteristic(Characteristic.Active)
				.on('get', this.getDryActive.bind(this))
				.on('set', this.setDryActive.bind(this))


			this.DryService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
				.on('get', this.getCurrentRelativeHumidity.bind(this))

			this.DryService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
				.on('get', this.getCurrentHumidifierDehumidifierState.bind(this))

			this.DryService.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
				.setProps({
					minValue: 2,
					maxValue: 2,
					validValues: [Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER]
				})
				.on('get', this.getTargetHumidifierDehumidifierState.bind(this))
				.on('set', this.setTargetHumidifierDehumidifierState.bind(this))

			if (this.capabilities.dry.swing && this.capabilities.dry.swing.length) {
				this.DryService.getCharacteristic(Characteristic.SwingMode)
					.on('get', this.getDrySwing.bind(this))
					.on('set', this.setDrySwing.bind(this))
			}


			if (this.capabilities.dry.fanLevels && this.capabilities.fan.fanLevels.length) {
				this.DryService.getCharacteristic(Characteristic.RotationSpeed)
					.on('get', this.getDryRotationSpeed.bind(this))
					.on('set', this.setDryRotationSpeed.bind(this))
			}

			services.push(this.DryService)
		}

		// Sync Button Switch Service
		if (this.enableSyncButton) {
			if (this.debug)
				this.log('Setting AC Sync Button for', this.name)
			this.SyncButtonService = new Service.Switch(this.name + ' Sync', 'sync')

			this.SyncButtonService.getCharacteristic(Characteristic.On)
				.on('get', this.getSyncState.bind(this))
				.on('set', this.setSyncState.bind(this))

			services.push(this.SyncButtonService)
		}


		// Climate React Switch Service
		if (this.enableClimateReactSwitch) {
			if (this.debug)
				this.log('Setting Climate React Button for', this.name)
			this.climateReactService = new Service.Switch(this.name + ' Climate React', 'smartMode')

			this.climateReactService.getCharacteristic(Characteristic.On)
				.on('get', this.getClimateReactState.bind(this))
				.on('set', this.setClimateReactState.bind(this))

			services.push(this.climateReactService)
		}



		return services
	}

	acAccessory.prototype.getACActive = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Active State', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on

		if (!on || mode === 'fan' || mode === 'dry') {
			if (this.debug)
				this.log(this.name, 'Active AC State is 0')
			callback(null, 0)
		} else {
			if (this.debug)
				this.log(this.name, 'Active AC State is 1')
			callback(null, 1)
		}
	}


	acAccessory.prototype.setACActive = function (state, callback) {
		state = !!state
		if (this.debug)
			this.log(this.name + ' -> Setting AC state Active:', 'on', state)
		this.setNewState('acPower', state)
		callback()
	}


	acAccessory.prototype.getCurrentHeaterCoolerState = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Current HeaterCooler State:', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on
		let targetTemp = this.state.acState.targetTemperature
		if (this.usesFahrenheit())
			targetTemp = toCelsius(targetTemp)

		const temp = this.state.measurements.temperature

		this.log(this.name + ' Mode is ', on !== false ? mode.toUpperCase() : 'OFF')

		if (!on || mode === 'fan' || mode === 'dry')
			callback(null, Characteristic.CurrentHeaterCoolerState.INACTIVE)
		else if (mode === 'cool')
			callback(null, Characteristic.CurrentHeaterCoolerState.COOLING)
		else if (mode === 'heat')
			callback(null, Characteristic.CurrentHeaterCoolerState.HEATING)
		else if (temp > targetTemp)
			callback(null, Characteristic.CurrentHeaterCoolerState.COOLING)
		else
			callback(null, Characteristic.CurrentHeaterCoolerState.HEATING)
	}

	acAccessory.prototype.getTargetHeaterCoolerState = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Target HeaterCooler State', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on

		if (!on || mode === 'fan' || mode === 'dry')
			callback(null, null)
		else if (mode === 'cool')
			callback(null, Characteristic.TargetHeaterCoolerState.COOL)
		else if (mode === 'heat')
			callback(null, Characteristic.TargetHeaterCoolerState.HEAT)
		else if (mode === 'auto')
			callback(null, Characteristic.TargetHeaterCoolerState.AUTO)
		else
			callback(null, null)
	}

	acAccessory.prototype.setTargetHeaterCoolerState = function (state, callback) {
		let mode
		switch (state) {
		case Characteristic.TargetHeaterCoolerState.COOL:
			mode = 'cool'
			break
		case Characteristic.TargetHeaterCoolerState.HEAT:
			mode = 'heat'
			break
		case Characteristic.TargetHeaterCoolerState.AUTO:
			mode = 'auto'
			break
		}

		if (this.debug)
			this.log(this.name + ' -> Setting Target Thermostat State:', mode)
		this.setNewState('acMode', mode)
		callback()
	}


	acAccessory.prototype.getCurrentTemperature = function (callback) {
		this.refreshState()
		if (this.debug) this.log('Getting Room Temperature', this.name)

		let temp = this.state.measurements.temperature
		if (this.usesFahrenheit())
			this.log(this.name + ' Current Temperature is ' + toFahrenheit(temp) + 'º' + this.temperatureUnit)
		else
			this.log(this.name + ' Current Temperature is ' + temp + 'º' + this.temperatureUnit)

		callback(null, temp)
	}

	acAccessory.prototype.getCoolingThresholdTemperature = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Cooling Threshold Temperature', this.name)

		let targetTemp = this.getNormalizedTargetTemperature()
		this.log(this.name + ' Target COOL Temperature is ' + targetTemp + 'º' + CELSIUS_UNIT)

		callback(null, targetTemp)
	}

	acAccessory.prototype.setCoolingThresholdTemperature = function (temp, callback) {
		if (this.usesFahrenheit())
			temp = toFahrenheit(temp)

		if (this.debug)
			this.log(this.name + ' -> Setting Cooling Threshold Temperature:', temp)

		this.setNewState('coolTemp', temp)
		callback()
	}

	acAccessory.prototype.getHeatingThresholdTemperature = function (callback) {
		this.refreshState()
		if (this.debug) this.log('Getting Heating Threshold Temperature', this.name)

		this.log(this.name + ' Target HEAT Temperature is ' + this.state.acState.targetTemperature + 'º' + this.temperatureUnit)

		const targetTemp = this.getNormalizedTargetTemperature()

		callback(null, targetTemp)
	}

	acAccessory.prototype.setHeatingThresholdTemperature = function (temp, callback) {
		if (this.usesFahrenheit())
			temp = toFahrenheit(temp)

		if (this.debug)
			this.log(this.name + ' -> Setting Heating Threshold Temperature:', temp)

		this.setNewState('heatTemp', temp)
		callback()
	}

	acAccessory.prototype.getTemperatureDisplayUnits = function (callback) {
		if (this.debug) {
			this.log('Getting Temperature Display Units', this.name)
			this.log('The current temperature display unit is ' + ('º' + this.temperatureUnit))
		}

		callback(null, this.usesFahrenheit() ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS)
	}

	acAccessory.prototype.getCurrentRelativeHumidity = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Current Relative Humidity', this.name)
		const humidity = this.state.measurements.humidity
		this.log(this.name + ' Humidity is ' + humidity + '%')
		callback(null, humidity)
	}

	acAccessory.prototype.getACSwing = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting AC Swing State', this.name)
		const mode = this.state.acState.mode
		const on = this.state.acState.on
		const swing = this.state.acState.swing

		if (!on || mode === 'fan' || mode === 'dry') {
			if (this.debug) this.log(this.name + ' Swing - Device is OFF')
			callback(null, null)
		} else {
			if (this.debug) this.log(this.name + ' AC Swing is ' + swing)
			callback(null, swing === 'rangeFull' ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED)
		}

	}

	acAccessory.prototype.setACSwing = function (state, callback) {
		if (this.debug) this.log(this.name + ' -> Setting AC Swing:', state)
		state = state === Characteristic.SwingMode.SWING_ENABLED ? 'rangeFull' : 'stopped'
		this.setNewState('acSwing', state)
		callback()
	}

	acAccessory.prototype.getACRotationSpeed = function (callback) {
		this.refreshState()
		if (this.debug) this.log('Getting AC Rotation Speed', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on
		const fanLevel = this.state.acState.fanLevel

		if (!on || mode === 'fan' || mode === 'dry') {
			if (this.debug) this.log(this.name + ' AC Rotation Speed - Device is OFF')
			callback(null, null)
		} else {
			if (this.debug) this.log(this.name + ' AC Rotation Speed is ' + fanLevel)
			callback(null, fanLeveltoHK(fanLevel, (this.capabilities.cool || this.capabilities.heat || this.capabilities.auto).fanLevels))
		}
	}

	acAccessory.prototype.setACRotationSpeed = function (speed, callback) {
		if (this.debug) this.log(this.name + ' -> Setting AC Rotation Speed:', speed)
		speed = HKtoFanLevel(speed, (this.capabilities.cool || this.capabilities.heat || this.capabilities.auto).fanLevels)
		this.setNewState('acFanLevel', speed)
		callback()
	}



	// FAN
	acAccessory.prototype.getFanActive = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Fan Active State', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on

		if (!on || mode !== 'fan') {
			if (this.debug)
				this.log(this.name, 'Fan Active State is 0')
			callback(null, 0)
		} else {
			if (this.debug)
				this.log(this.name, ' Fan Active State is 1')
			callback(null, 1)
		}
	}

	acAccessory.prototype.setFanActive = function (state, callback) {
		state = !!state
		if (this.debug)
			this.log(this.name + ' -> Setting Fan state Active:', state)
		this.setNewState('fanPower', state)
		callback()
	}

	acAccessory.prototype.getFanSwing = function (callback) {
		this.refreshState()
		if (this.debug) this.log('Getting Fan Swing State', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on
		const swing = this.state.acState.swing

		if (!on || mode !== 'fan') {
			if (this.debug) this.log(this.name + ' Fan Swing - Device is OFF')
			callback(null, null)
		} else {
			if (this.debug) this.log(this.name + ' Fan Swing is ' + swing)
			callback(null, swing === 'rangeFull' ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED)
		}
	}
	acAccessory.prototype.setFanSwing = function (state, callback) {
		if (this.debug) this.log(this.name + ' -> Setting Fan Swing:', state)
		state = state === Characteristic.SwingMode.SWING_ENABLED ? 'rangeFull' : 'stopped'
		this.setNewState('fanSwing', state)
		callback()
	}

	acAccessory.prototype.getFanRotationSpeed = function (callback) {
		this.refreshState()
		if (this.debug) this.log('Getting Fan Rotation Speed', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on
		const fanLevel = this.state.acState.fanLevel

		if (!on || mode !== 'fan') {
			if (this.debug) this.log(this.name + ' Fan Rotation Speed - Device is OFF')
			callback(null, null)
		} else {
			if (this.debug) this.log(this.name + ' Fan Rotation Speed is ' + fanLevel)
			callback(null, fanLeveltoHK(fanLevel, this.capabilities.fan.fanLevels))
		}
	}

	acAccessory.prototype.setFanRotationSpeed = function (speed, callback) {
		if (this.debug) this.log(this.name + ' -> Setting Fan Rotation Speed:', speed)
		speed = HKtoFanLevel(speed, this.capabilities.fan.fanLevels)
		this.setNewState('fanFanLevel', speed)
		callback()
	}





	// DEHUMIDIFIER
	acAccessory.prototype.getDryActive = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Dry Active State', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on

		if (!on || mode !== 'dry') {
			if (this.debug)
				this.log(this.name, 'Dry Active State is 0')
			callback(null, 0)
		} else {
			if (this.debug)
				this.log(this.name, ' Dry Active State is 1')
			callback(null, 1)
		}
	}

	acAccessory.prototype.setDryActive = function (state, callback) {
		this.refreshState()
		state = !!state
		if (this.debug)
			this.log(this.name + ' -> Setting Dry state Active:', state)
		this.setNewState('dryPower', state)
		callback()
	}


	acAccessory.prototype.getCurrentHumidifierDehumidifierState = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting Current HumidifierDehumidifier State:', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on

		this.log(this.name + ' Dehumidifier is ', (!on || mode !== 'dry') ? 'OFF' : 'ON')

		if (!on || mode !== 'dry')
			callback(null, Characteristic.CurrentHumidifierDehumidifierState.INACTIVE)
		else
			callback(null, Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING)
	}

	acAccessory.prototype.getTargetHumidifierDehumidifierState = function (callback) {
		this.refreshState()
		callback(null, Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
	}

	acAccessory.prototype.setTargetHumidifierDehumidifierState = function (state, callback) {
		if (this.debug)
			this.log(this.name + ' -> Setting Dry State:  ON')
		this.setNewState('dryPower', true)
		callback()
	}

	acAccessory.prototype.getDrySwing = function (callback) {
		this.refreshState()
		if (this.debug) this.log('Getting Dry Swing State', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on
		const swing = this.state.acState.swing

		if (!on || mode !== 'dry') {
			if (this.debug) this.log(this.name + ' Dry Swing - Device is OFF')
			callback(null, null)
		} else {
			if (this.debug) this.log(this.name + ' Dry Swing is ' + swing)
			callback(null, swing === 'rangeFull' ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED)
		}
	}
	acAccessory.prototype.setDrySwing = function (state, callback) {
		if (this.debug) this.log(this.name + ' -> Setting Dry Swing:', state)
		state = state === Characteristic.SwingMode.SWING_ENABLED ? 'rangeFull' : 'stopped'
		this.setNewState('drySwing', state)
		callback()
	}

	acAccessory.prototype.getDryRotationSpeed = function (callback) {
		this.refreshState()
		if (this.debug) this.log('Getting Dry Rotation Speed', this.name)

		const mode = this.state.acState.mode
		const on = this.state.acState.on
		const fanLevel = this.state.acState.fanLevel

		if (!on || mode !== 'dry') {
			if (this.debug) this.log(this.name + ' Dry Rotation Speed - Device is OFF')
			callback(null, null)
		} else {
			if (this.debug) this.log(this.name + ' Dry Rotation Speed is ' + fanLevel)
			callback(null, fanLeveltoHK(fanLevel, this.capabilities.dry.fanLevels))
		}
	}

	acAccessory.prototype.setDryRotationSpeed = function (speed, callback) {
		if (this.debug) this.log(this.name + ' -> Setting Dry Rotation Speed:', speed)
		speed = HKtoFanLevel(speed, this.capabilities.dry.fanLevels)
		this.setNewState('dryFanLevel', speed)
		callback()
	}


	//
	acAccessory.prototype.getSyncState = function (callback) {
		callback(null, 0)
	}

	acAccessory.prototype.setSyncState = function (state, callback) {
		if (state) {
			this.log(this.name + ' - Syncing AC State => Setting ' + (this.state.acState.on ? 'OFF' : 'ON') + ' state without sending commands')
			setTimeout(() => {
				this.SyncButtonService.getCharacteristic(Characteristic.On).updateValue(0)
			}, 1000)

			sensibo.syncDeviceState(this.id, !this.state.acState.on)
				.then(syncResponse => {
					if (syncResponse.status !== 'success')
						callback(syncResponse.result.failureReason)
					else {
						const newState = syncResponse.result.acState
						this.state.acState = newState
						this.state.last[newState.mode] = newState
						if (newState.mode !== 'fan' && newState.mode !== 'dry')
							this.state.last.mode = newState.mode

						setTimeout(() => {
							// this.log('updating HomeKit from setSyncState', newState)
							this.updateHomeKit(newState)
						}, 200);
						callback()
					}

				}).catch(err => {
					this.log('Could not Sync AC State for', this.name)
					if (this.debug)
						this.log(err)
					callback(err)

				})
		} else {
			callback()
		}
	}


	acAccessory.prototype.getClimateReactState = function (callback) {
		this.refreshState()
		if (this.debug)
			this.log('Getting', this.name, 'Climate React State')

		const on = this.state.smartMode ? this.state.smartMode.enabled : false
		this.log(this.name, 'Climate React State is ', (on ? 'ON' : 'OFF'))
		callback(null, on)
	}

	acAccessory.prototype.setClimateReactState = function (on, callback) {
		this.log(this.name + ' - Turning ' + (on ? 'ON' : 'OFF') + ' Climate React')

		sensibo.enableDisableClimateReact(this.id, on)
			.then(syncResponse => {
				if (syncResponse.status !== 'success')
					setTimeout(() => {
						this.climateReactService.getCharacteristic(Characteristic.On).updateValue(0)
					}, 500)

				callback()

			}).catch(err => {
				this.log('Could not set Climate React State for', this.name)
				if (this.debug)
					this.log(err)
				callback(err)

			})
	}

	acAccessory.prototype.getNormalizedTargetTemperature = function () {
		if (this.usesFahrenheit()) {
			return toCelsius(this.state.acState.targetTemperature)
		}

		return this.state.acState.targetTemperature
	}

	acAccessory.prototype.usesFahrenheit = function () {
		return this.temperatureUnit === FAHRENHEIT_UNIT
	}

	acAccessory.prototype.setNewState = function (key, value) {
		this.setCommands[key] = value
		if (this.debug)
			this.log(`new command: ${key}: ${value}`)
		if (!this.setProcessing) {
			this.setProcessing = true
			setTimeout(() => {
				const commands = this.setCommands

				let newState =  {
					...this.state.acState
				}

				if (('acPower' in commands && commands['acPower'] === false && (this.state.acState.mode === 'cool' || this.state.acState.mode === 'heat' || this.state.acState.mode === 'auto') && !('acFanLevel' in commands))
				|| ('fanPower' in commands && commands['fanPower'] === false && this.state.acState.mode === 'fan' && !('fanFanLevel' in commands))
				|| ('dryPower' in commands && commands['dryPower'] === false && this.state.acState.mode === 'dry' && !('dryFanLevel' in commands))) {
					this.log('Turning OFF ' + this.name)
					newState.on = false
				} else {
					if ('acMode' in commands){
						if (this.state.last[commands['acMode']])
							newState = {
								...this.state.last[commands['acMode']]
							}
						newState.on = true
						newState.mode = commands['acMode']
					} else if ('acPower' in commands || 'coolTemp' in commands || 'heatTemp' in commands || 'acSwing' in commands || 'acFanLevel' in commands){
						if (this.state.last.mode && this.state.last[this.state.last.mode])
							newState = {
								...this.state.last[this.state.last.mode]
							}
						else
							newState.mode = this.capabilities.cool ? 'cool' : 'heat'

						newState.on = true
					} else if (('fanPower' in commands && commands['fanPower'] === true) || 'fanSwing' in commands || 'fanFanLevel' in commands) {
						if (this.state.last.fan)
							newState = {
								...this.state.last.fan
							}
						newState.on = true
						newState.mode = 'fan'
					} else if (('dryPower' in commands && commands['dryPower'] === true) || 'drySwing' in commands || 'dryFanLevel' in commands) {
						if (this.state.last.dry)
							newState = {
								...this.state.last.dry
							}
						newState.on = true
						newState.mode = 'dry'
					}
				}

				switch (newState.mode) {
				case 'fan':
					if ('fanSwing' in commands)
						newState.swing = commands['fanSwing']
					if ('fanFanLevel' in commands)
						newState.fanLevel = commands['fanFanLevel']
					break;
				case 'dry':
					if ('drySwing' in commands)
						newState.swing = commands['drySwing']
					if ('dryFanLevel' in commands)
						newState.fanLevel = commands['dryFanLevel']
					break;
				default:
					if ('coolTemp' in commands && this.mode !== 'heat')
						newState.targetTemperature = commands['coolTemp']
					else if ('heatTemp' in commands && this.mode !== 'cool')
						newState.targetTemperature = commands['heatTemp']
					if ('acSwing' in commands)
						newState.swing = commands['acSwing']
					if ('acFanLevel' in commands)
						newState.fanLevel = commands['acFanLevel']
					break;

				}

				if (JSON.stringify(this.state.acState) !== JSON.stringify(newState)) {

					this.state.acState = newState
					this.state.last[newState.mode] = newState
					if (newState.mode !== 'fan' && newState.mode !== 'dry')
						this.state.last.mode = newState.mode

					this.log(this.name + ' - Setting New State:')
					this.log(newState)
					sensibo.setDeviceState(this.id, newState)
					if (this.debug) {
						this.log(`Finished setting state for ${this.id}:`)
						this.log(newState)
					}
					setTimeout(() => {
						// this.log('updating HomeKit from setNewState', newState)
						this.updateHomeKit(newState)
					}, 200);
				}

				this.setCommands = {}
				this.setProcessing = false

			}, 500)
		}
	}


	acAccessory.prototype.updateHomeKit = function (acState, measurements, smartMode) {
		if (measurements) {
			if (this.debug) {
				this.log(this.name, '*New State* - Room Temperature -', (this.usesFahrenheit() ? toFahrenheit(measurements.temperature) : measurements.temperature), 'º' + this.temperatureUnit)
				this.log(this.name, '*New State* - Relative Humidity -', measurements.humidity, '%')
			}
			this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(measurements.temperature)
			this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(measurements.humidity)
			// log new state
			this.loggingService && this.loggingService.addEntry({ time: Math.floor((new Date()).getTime()/1000), temp: measurements.temperature, humidity: measurements.humidity })

		}

		if (acState && !this.setProcessing) {
			if (this.debug)
				this.log(this.name, '*New State* - ', )

			// if ac is off
			if (acState.on === false && !this.setProcessing) {
				this.log('TURNING OFF')
				this.HeaterCoolerService.getCharacteristic(Characteristic.Active).updateValue(0)
				this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.OFF)

				if (this.capabilities.fan && !this.disableFan && !this.setProcessing)
					this.FanService.getCharacteristic(Characteristic.Active).updateValue(0)

				if (this.capabilities.dry && !this.disableDry && !this.setProcessing) {
					this.DryService.getCharacteristic(Characteristic.Active).updateValue(0)
					this.DryService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState).updateValue(Characteristic.CurrentHumidifierDehumidifierState.INACTIVE)
				}

			// if ac is on
			} else if (!this.setProcessing) {
				let swingMode, rotationSpeed, targetTemperature
				if (acState.swing)
					swingMode = acState.swing === 'rangeFull' ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED
				if (acState.fanLevel)
					rotationSpeed = fanLeveltoHK(acState.fanLevel, this.capabilities[acState.mode].fanLevels)
				if (acState.targetTemperature)
					targetTemperature = this.getNormalizedTargetTemperature()

				// if mode is fan
				if (acState.mode === 'fan' && !this.setProcessing) {

					this.HeaterCoolerService.getCharacteristic(Characteristic.Active).updateValue(0)
					this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.OFF)

					if (this.capabilities.fan && !this.disableFan && !this.setProcessing) {
						this.FanService.getCharacteristic(Characteristic.Active).updateValue(1)

						if (acState.swing && !this.setProcessing)
							this.FanService.getCharacteristic(Characteristic.SwingMode).updateValue(swingMode)

						if (acState.fanLevel && !this.setProcessing)
							this.FanService.getCharacteristic(Characteristic.RotationSpeed).updateValue(rotationSpeed)

					}

					if (this.capabilities.dry && !this.disableDry && !this.setProcessing) {
						this.DryService.getCharacteristic(Characteristic.Active).updateValue(0)
						this.DryService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState).updateValue(Characteristic.CurrentHumidifierDehumidifierState.INACTIVE)
					}

				// if mode is dry
				} else if (acState.mode === 'dry' && !this.setProcessing) {

					this.HeaterCoolerService.getCharacteristic(Characteristic.Active).updateValue(0)
					this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.OFF)

					if (this.capabilities.fan && !this.disableFan && !this.setProcessing) {
						this.FanService.getCharacteristic(Characteristic.Active).updateValue(0)
					}

					if (this.capabilities.dry && !this.disableDry && !this.setProcessing) {
						this.DryService.getCharacteristic(Characteristic.Active).updateValue(1)
						this.DryService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState).updateValue(Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING)

						if (acState.swing && !this.setProcessing)
							this.DryService.getCharacteristic(Characteristic.SwingMode).updateValue(swingMode)

						if (acState.fanLevel && !this.setProcessing)
							this.DryService.getCharacteristic(Characteristic.RotationSpeed).updateValue(rotationSpeed)
					}

				// if mode is cool, heat or auto
				} else if (!this.setProcessing) {
					this.HeaterCoolerService.getCharacteristic(Characteristic.Active).updateValue(1)

					if (acState.mode === 'cool' && !this.setProcessing) {
						this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(targetTemperature)
						this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(targetTemperature)
						this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.COOL)
						this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING)
					} else if (acState.mode === 'heat' && !this.setProcessing) {
						this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(targetTemperature)
						this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(targetTemperature)
						this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.HEAT)
						this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.HEATING)
					} else if (acState.mode === 'auto' && !this.setProcessing) {

						this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(targetTemperature)
						this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(targetTemperature)

						this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.AUTO)

						if (this.state.measurements.temperature > targetTemperature)
							this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING)
						else
							this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.HEATING)

					}


					if (acState.swing && !this.setProcessing)
						this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode).updateValue(swingMode)

					if (acState.fanLevel && !this.setProcessing)
						this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed).updateValue(rotationSpeed)

					if (this.capabilities.fan && !this.disableFan && !this.setProcessing)
						this.FanService.getCharacteristic(Characteristic.Active).updateValue(0)

					if (this.capabilities.dry && !this.disableDry && !this.setProcessing) {
						this.DryService.getCharacteristic(Characteristic.Active).updateValue(0)
						this.DryService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState).updateValue(Characteristic.CurrentHumidifierDehumidifierState.INACTIVE)
					}
				}
			}

		}


		if (smartMode && !this.setProcessing) {
			if (this.debug)
				this.log(this.name, 'Climate React *New State* - ', smartMode.enabled ? 'ON' : 'OFF')

			this.climateReactService.getCharacteristic(Characteristic.On).updateValue(smartMode.enabled)

		}


		if (this.debug && !this.setProcessing && (acState || measurements || smartMode)) {
			this.log(`Finished updating state in HomeKit for ${this.id}:`)
			this.log(`Target Temp:`, this.getNormalizedTargetTemperature())
			if (acState)
				this.log('acState:', acState)
			if (measurements)
				this.log('measurements:', measurements)
			if (smartMode)
				this.log('Climate React:', smartMode)
		}
	}

	/********************************************************************************************************************************************************/
	/********************************************************************************************************************************************************/
	/*******************************************************************  Occupancy Sensor ******************************************************************/
	/********************************************************************************************************************************************************/
	/********************************************************************************************************************************************************/


	function occupancySensor(config) {
		this.occupied = config.occupied
		this.type = config.type
		this.name = config.name
		this.log = config.log
		this.debug = config.debug
		this.refreshState = config.refreshState
	}

	occupancySensor.prototype.getServices = function () {

		this.informationService = new Service.AccessoryInformation()
			.setCharacteristic(Characteristic.Manufacturer, 'Sensibo')
			.setCharacteristic(Characteristic.Model, 'Geofence & Locations')
			.setCharacteristic(Characteristic.SerialNumber, 'sensibo_occupancy')

		this.OccupancySensor = new Service.OccupancySensor(this.name)

		this.OccupancySensor.getCharacteristic(Characteristic.OccupancyDetected)
			.on('get', this.getStatus.bind(this))

		return [this.informationService, this.OccupancySensor]
	}

	occupancySensor.prototype.getStatus = function (callback) {
		this.refreshState()
		if (this.occupied)
			this.log('Someone is Home')
		else
			this.log('Everyone is away')
		callback(null, (this.occupied ? 1 : 0))
	}

	occupancySensor.prototype.updateHomeKit = function (occupied) {

		if (this.debug)
			this.log("Occupancy Status Changed")
		if (occupied) {
			this.log('Someone is Home')
			this.OccupancySensor.getCharacteristic(Characteristic.OccupancyDetected).updateValue(1)
		} else {
			this.log('Everyone is away')
			this.OccupancySensor.getCharacteristic(Characteristic.OccupancyDetected).updateValue(0)
		}
	}

	return {acAccessory, occupancySensor}
}

function toCelsius(value) {
	return (value - 32) / 1.8
}

function toFahrenheit(value) {
	return Math.round((value * 1.8) + 32)
}


function fanLeveltoHK(value, fanLevels) {
	if (value === 'auto')
		return 0

	fanLevels = fanLevels.filter(level => level !== 'auto')
	const totalLevels = fanLevels.length
	const valueIndex = fanLevels.indexOf(value) + 1
	return Math.round(100 * valueIndex / totalLevels)
}

function HKtoFanLevel(value, fanLevels) {
	let selected = 'auto'
	if (!fanLevels.includes('auto'))
		selected = fanLevels[0]

	if (value !== 0) {
		fanLevels = fanLevels.filter(level => level !== 'auto')
		const totalLevels = fanLevels.length
		for (let i = 0; i < fanLevels.length; i++) {
			if (value < (100 * (i + 1) / totalLevels))	{
				selected = fanLevels[i]
				break;
			}
		}
	}

	return selected
}
