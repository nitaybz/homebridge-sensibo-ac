const unified = require('../sensibo/unified')
let Characteristic, Service, CELSIUS_UNIT, FAHRENHEIT_UNIT

class AirConditioner {
	constructor(device, platform) {

		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic
		CELSIUS_UNIT = platform.CELSIUS_UNIT
		FAHRENHEIT_UNIT = platform.FAHRENHEIT_UNIT

		const deviceInfo = unified.deviceInformation(device)
		
		this.log = platform.log
		this.api = platform.api
		this.storage = platform.storage
		this.cachedState = platform.cachedState
		this.id = deviceInfo.id
		this.appId = deviceInfo.appId
		this.model = deviceInfo.model
		this.serial = deviceInfo.serial
		this.manufacturer = deviceInfo.manufacturer
		this.roomName = deviceInfo.roomName
		this.name = this.roomName + ' AC' 
		this.type = 'AirConditioner'
		this.displayName = this.name
		this.temperatureUnit = deviceInfo.temperatureUnit
		this.usesFahrenheit = this.temperatureUnit === FAHRENHEIT_UNIT
		this.disableFan = platform.disableFan
		this.disableDry = platform.disableDry
		this.disableHorizontalSwing = platform.disableHorizontalSwing
		this.disableLightSwitch = platform.disableLightSwitch
		this.syncButtonInAccessory = platform.syncButtonInAccessory
		this.filterService = deviceInfo.filterService
		this.capabilities = unified.capabilities(device)

		this.state = this.cachedState.devices[this.id] = unified.acState(device)
		
		const StateHandler = require('../sensibo/StateHandler')(this, platform)
		this.state = new Proxy(this.state, StateHandler)

		this.stateManager = require('./StateManager')(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id)
		this.accessory = platform.cachedAccessories.find(accessory => accessory.UUID === this.UUID)

		if (!this.accessory) {
			this.log(`Creating New ${platform.PLATFORM_NAME} ${this.type} Accessory in the ${this.roomName}`)
			this.accessory = new this.api.platformAccessory(this.name, this.UUID)
			this.accessory.context.type = this.type
			this.accessory.context.deviceId = this.id

			platform.cachedAccessories.push(this.accessory)
			// register the accessory
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory])
		}

		if (platform.enableHistoryStorage) {
			const FakeGatoHistoryService = require('fakegato-history')(this.api)
			this.loggingService = new FakeGatoHistoryService('weather', this.accessory, { storage: 'fs', path: platform.persistPath })
		}

		this.accessory.context.roomName = this.roomName

		let informationService = this.accessory.getService(Service.AccessoryInformation)

		if (!informationService)
			informationService = this.accessory.addService(Service.AccessoryInformation)

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		this.addHeaterCoolerService()

		if (this.capabilities.FAN && !this.disableFan)
			this.addFanService()
		else
			this.removeFanService()

		if (this.capabilities.DRY && !this.disableDry)
			this.addDryService()
		else
			this.removeDryService()

		if (((this.capabilities.COOL && this.capabilities.COOL.horizontalSwing) || (this.capabilities.HEAT && this.capabilities.HEAT.horizontalSwing)) && !this.disableHorizontalSwing)
			this.addHorizontalSwingSwitch()
		else
			this.removeHorizontalSwingSwitch()

		if (this.syncButtonInAccessory)
			this.addSyncButtonService()
		else
			this.removeSyncButtonService()

		if (((this.capabilities.COOL && this.capabilities.COOL.light) || (this.capabilities.HEAT && this.capabilities.HEAT.light)) && !this.disableLightSwitch)
			this.addLightSwitch()
		else
			this.removeLightSwitch()
	}

	addHeaterCoolerService() {
		this.log.easyDebug(`Adding HeaterCoolerService in the ${this.roomName}`)
		this.HeaterCoolerService = this.accessory.getService(Service.HeaterCooler)
		if (!this.HeaterCoolerService)
			this.HeaterCoolerService = this.accessory.addService(Service.HeaterCooler, this.name, 'HeaterCooler')

		this.HeaterCoolerService.getCharacteristic(Characteristic.Active)
			.on('get', this.stateManager.get.ACActive)
			.on('set', this.stateManager.set.ACActive)

		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.on('get', this.stateManager.get.CurrentHeaterCoolerState)


		const props = []

		if (this.capabilities.AUTO) props.push(Characteristic.TargetHeaterCoolerState.AUTO)
		if (this.capabilities.COOL) props.push(Characteristic.TargetHeaterCoolerState.COOL)
		if (this.capabilities.HEAT) props.push(Characteristic.TargetHeaterCoolerState.HEAT)
	
		this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.setProps({validValues: props})
			.on('get', this.stateManager.get.TargetHeaterCoolerState)
			.on('set', this.stateManager.set.TargetHeaterCoolerState)


		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: -100,
				maxValue: 100,
				minStep: 0.1
			})
			.on('get', this.stateManager.get.CurrentTemperature)

		if (this.capabilities.COOL) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
				.setProps({
					minValue: this.capabilities.COOL.temperatures[CELSIUS_UNIT].min,
					maxValue: this.capabilities.COOL.temperatures[CELSIUS_UNIT].max,
					minStep: this.usesFahrenheit ? 0.1 : 1
				})
				.on('get', this.stateManager.get.CoolingThresholdTemperature)
				.on('set', this.stateManager.set.CoolingThresholdTemperature)
		}

		if (this.capabilities.HEAT) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
				.setProps({
					minValue: this.capabilities.HEAT.temperatures[CELSIUS_UNIT].min,
					maxValue: this.capabilities.HEAT.temperatures[CELSIUS_UNIT].max,
					minStep: this.usesFahrenheit ? 0.1 : 1
				})
				.on('get', this.stateManager.get.HeatingThresholdTemperature)
				.on('set', this.stateManager.set.HeatingThresholdTemperature)
		}

		if (this.capabilities.AUTO && !this.capabilities.COOL && this.capabilities.AUTO.temperatures) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
				.setProps({
					minValue: this.capabilities.AUTO.temperatures[CELSIUS_UNIT].min,
					maxValue: this.capabilities.AUTO.temperatures[CELSIUS_UNIT].max,
					minStep: this.usesFahrenheit ? 0.1 : 1
				})
				.on('get', this.stateManager.get.CoolingThresholdTemperature)
				.on('set', this.stateManager.set.CoolingThresholdTemperature)

		}

		if (this.capabilities.AUTO && !this.capabilities.HEAT && this.capabilities.AUTO.temperatures) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
				.setProps({
					minValue: this.capabilities.AUTO.temperatures[CELSIUS_UNIT].min,
					maxValue: this.capabilities.AUTO.temperatures[CELSIUS_UNIT].max,
					minStep: this.usesFahrenheit ? 0.1 : 1
				})
				.on('get', this.stateManager.get.HeatingThresholdTemperature)
				.on('set', this.stateManager.set.HeatingThresholdTemperature)
		}

		this.HeaterCoolerService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.on('get', this.stateManager.get.TemperatureDisplayUnits)

		//TODO check on this warning...
		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.stateManager.get.CurrentRelativeHumidity)

		if ((this.capabilities.COOL && this.capabilities.COOL.swing) || (this.capabilities.HEAT && this.capabilities.HEAT.swing)) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode)
				.on('get', this.stateManager.get.ACSwing)
				.on('set', this.stateManager.set.ACSwing)
		}

		if (	(this.capabilities.COOL && this.capabilities.COOL.fanSpeeds) || (this.capabilities.HEAT && this.capabilities.HEAT.fanSpeeds)) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.stateManager.get.ACRotationSpeed)
				.on('set', this.stateManager.set.ACRotationSpeed)
		}

		//TODO check on this warning...
		if (this.filterService) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.FilterChangeIndication)
				.on('get', this.stateManager.get.FilterChangeIndication)
	
			this.HeaterCoolerService.getCharacteristic(Characteristic.FilterLifeLevel)
				.on('get', this.stateManager.get.FilterLifeLevel)

			this.HeaterCoolerService.getCharacteristic(Characteristic.ResetFilterIndication)
				.on('set', this.stateManager.set.ResetFilterIndication)
		}

	}

	addFanService() {
		this.log.easyDebug(`Adding FanService in the ${this.roomName}`)

		this.FanService = this.accessory.getService(Service.Fanv2)
		if (!this.FanService)
			this.FanService = this.accessory.addService(Service.Fanv2, this.roomName + ' Fan', 'Fan')

		this.FanService.getCharacteristic(Characteristic.Active)
			.on('get', this.stateManager.get.FanActive)
			.on('set', this.stateManager.set.FanActive)

		if (this.capabilities.FAN.swing) {
			this.FanService.getCharacteristic(Characteristic.SwingMode)
				.on('get', this.stateManager.get.FanSwing)
				.on('set', this.stateManager.set.FanSwing)
		}

		if (this.capabilities.FAN.fanSpeeds) {
			this.FanService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.stateManager.get.FanRotationSpeed)
				.on('set', this.stateManager.set.FanRotationSpeed)
		}

	}

	removeFanService() {
		let FanService = this.accessory.getService(Service.Fanv2)
		if (FanService) {
			// remove service
			this.log.easyDebug(`Removing FanService from the ${this.roomName}`)
			this.accessory.removeService(FanService)
		}
	}
	
	addDryService() {
		this.log.easyDebug(`Adding DehumidifierService in the ${this.roomName}`)

		this.DryService = this.accessory.getService(Service.HumidifierDehumidifier)
		if (!this.DryService)
			this.DryService = this.accessory.addService(Service.HumidifierDehumidifier, this.roomName + ' Dry', 'Dry')

		this.DryService.getCharacteristic(Characteristic.Active)
			.on('get', this.stateManager.get.DryActive)
			.on('set', this.stateManager.set.DryActive)


		this.DryService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.stateManager.get.CurrentRelativeHumidity)

		this.DryService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
			.on('get', this.stateManager.get.CurrentHumidifierDehumidifierState)

		this.DryService.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
			.setProps({
				minValue: 2,
				maxValue: 2,
				validValues: [Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER]
			})
			.on('get', this.stateManager.get.TargetHumidifierDehumidifierState)
			.on('set', this.stateManager.set.TargetHumidifierDehumidifierState)

		if (this.capabilities.DRY.swing) {
			this.DryService.getCharacteristic(Characteristic.SwingMode)
				.on('get', this.stateManager.get.DrySwing)
				.on('set', this.stateManager.set.DrySwing)
		}

		if (this.capabilities.DRY.fanSpeeds) {
			this.DryService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.stateManager.get.DryRotationSpeed)
				.on('set', this.stateManager.set.DryRotationSpeed)
		}

	}

	removeDryService() {
		let DryService = this.accessory.getService(Service.HumidifierDehumidifier)
		if (DryService) {
			// remove service
			this.log.easyDebug(`Removing DehumidifierService from the ${this.roomName}`)
			this.accessory.removeService(DryService)
		}
	}

	addHorizontalSwingSwitch() {
		this.log.easyDebug(`Adding HorizontalSwingSwitchService in the ${this.roomName}`)

		this.HorizontalSwingSwitch = this.accessory.getService(this.roomName + ' Horizontal Swing')
		if (!this.HorizontalSwingSwitch)
			this.HorizontalSwingSwitch = this.accessory.addService(Service.Switch, this.roomName + ' Horizontal Swing', 'HorizontalSwingSwitch')

		this.HorizontalSwingSwitch.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.HorizontalSwing)
			.on('set', this.stateManager.set.HorizontalSwing)

	}

	removeHorizontalSwingSwitch() {
		let HorizontalSwingSwitch = this.accessory.getService(this.roomName + ' Horizontal Swing')
		if (HorizontalSwingSwitch) {
			// remove service
			this.log.easyDebug(`Removing HorizontalSwingSwitchService from the ${this.roomName}`)
			this.accessory.removeService(HorizontalSwingSwitch)
		}

	}

	addLightSwitch() {
		this.log.easyDebug(`Adding LightSwitchService to the AC in the ${this.roomName}`)

		this.LightSwitch = this.accessory.getService(this.roomName + ' AC Light')
		if (!this.LightSwitch)
			this.LightSwitch = this.accessory.addService(Service.Lightbulb, this.roomName + ' AC Light', 'LightSwitch')

		this.LightSwitch.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.LightSwitch)
			.on('set', this.stateManager.set.LightSwitch)

	}

	removeLightSwitch() {
		let LightSwitch = this.accessory.getService(this.roomName + ' AC Light')
		if (LightSwitch) {
			// remove service
			this.log.easyDebug(`Removing LightSwitchService from the AC in the ${this.roomName}`)
			this.accessory.removeService(LightSwitch)
		}

	}

	addSyncButtonService() {
		this.log.easyDebug(`Adding SyncButtonSwitchService in the ${this.roomName}`)
		
		this.SyncButtonService = this.accessory.getService('SyncButton')
		if (!this.SyncButtonService)
			this.SyncButtonService = this.accessory.addService(Service.Switch, this.name + ' Sync', 'SyncButton')


		this.SyncButtonService.getCharacteristic(Characteristic.On)
			.on('get', (callback) => { callback(null, false) })
			.on('set', (state, callback) => {
				this.stateManager.set.SyncState(state, callback)
				setTimeout(() => {
					this.SyncButtonService.getCharacteristic(Characteristic.On).updateValue(0)
				}, 1000)
			})

	}

	removeSyncButtonService() {
		let SyncButtonService = this.accessory.getService('SyncButton')
		if (SyncButtonService) {
			// remove service
			this.log.easyDebug(`Removing SyncButtonSwitchService from the ${this.roomName}`)
			this.accessory.removeService(SyncButtonService)
		}

	}

	updateHomeKit() {
		// log new state with FakeGato
		if (this.loggingService) {
			this.loggingService.addEntry({
				time: Math.floor((new Date()).getTime()/1000),
				temp: this.state.currentTemperature, 
				humidity: this.state.relativeHumidity
			})
		}
		
		// update measurements
		this.updateValue('HeaterCoolerService', 'CurrentTemperature', this.state.currentTemperature)
		this.updateValue('HeaterCoolerService', 'CurrentRelativeHumidity', this.state.relativeHumidity)
		if (this.capabilities.DRY && !this.disableDry)
			this.updateValue('DryService', 'CurrentRelativeHumidity', this.state.relativeHumidity)

		// if status is OFF, set all services to INACTIVE
		if (!this.state.active) {
			this.updateValue('HeaterCoolerService', 'Active', 0)
			this.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.INACTIVE)

			if (this.FanService)
				this.updateValue('FanService', 'Active', 0)


			if (this.DryService) {
				this.updateValue('DryService', 'Active', 0)
				this.updateValue('DryService', 'CurrentHumidifierDehumidifierState', 0)
			}

			return
		}

		switch (this.state.mode) {
		case 'COOL':
		case 'HEAT':
		case 'AUTO':

			// turn on HeaterCoolerService
			this.updateValue('HeaterCoolerService', 'Active', 1)

			// update temperatures for HeaterCoolerService
			this.updateValue('HeaterCoolerService', 'HeatingThresholdTemperature', this.state.targetTemperature)
			this.updateValue('HeaterCoolerService', 'CoolingThresholdTemperature', this.state.targetTemperature)

			// update swing for HeaterCoolerService
			if (this.capabilities[this.state.mode].swing)
				this.updateValue('HeaterCoolerService', 'SwingMode', Characteristic.SwingMode[this.state.swing])

			// update horizontal swing for HeaterCoolerService
			if (this.HorizontalSwingSwitch)
				this.updateValue('HorizontalSwingSwitch', 'On', this.state.horizontalSwing === 'SWING_ENABLED')

			// update light switch for HeaterCoolerService
			if (this.LightSwitch)
				this.updateValue('LightSwitch', 'On', this.state.light)

			// update fanSpeed for HeaterCoolerService
			if (this.capabilities[this.state.mode].fanSpeeds)
				this.updateValue('HeaterCoolerService', 'RotationSpeed', this.state.fanSpeed)

			// update filter characteristics for HeaterCoolerService
			if (this.filterService) {
				this.updateValue('HeaterCoolerService', 'FilterChangeIndication', Characteristic.FilterChangeIndication[this.state.filterChange])
				this.updateValue('HeaterCoolerService', 'FilterLifeLevel', this.state.filterLifeLevel)
			}

			// set proper target and current state of HeaterCoolerService
			if (this.state.mode === 'COOL') {
				this.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', Characteristic.TargetHeaterCoolerState.COOL)
				this.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.COOLING)
			} else if (this.state.mode === 'HEAT') {
				this.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', Characteristic.TargetHeaterCoolerState.HEAT)
				this.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.HEATING)
			} else if (this.state.mode === 'AUTO') {
				this.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', Characteristic.TargetHeaterCoolerState.AUTO)
				if (this.state.currentTemperature > this.state.targetTemperature)
					this.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.COOLING)
				else
					this.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.HEATING)
			}

			// turn off FanService
			if (this.FanService)
				this.updateValue('FanService', 'Active', 0)

			// turn off DryService
			if (this.DryService) {
				this.updateValue('DryService', 'Active', 0)
				this.updateValue('DryService', 'CurrentHumidifierDehumidifierState', 0)
			}
			break
		case 'FAN':
			if (this.FanService) {

				// turn on FanService
				this.updateValue('FanService', 'Active', 1)

				// update swing for FanService
				if (this.capabilities.FAN.swing)
					this.updateValue('FanService', 'SwingMode', Characteristic.SwingMode[this.state.swing])

				// update fanSpeed for FanService
				if (this.capabilities.FAN.fanSpeeds)
					this.updateValue('FanService', 'RotationSpeed', this.state.fanSpeed)
			}

			// turn off HeaterCoolerService
			this.updateValue('HeaterCoolerService', 'Active', 0)
			this.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.INACTIVE)

			// turn off DryService
			if (this.DryService) {
				this.updateValue('DryService', 'Active', 0)
				this.updateValue('DryService', 'CurrentHumidifierDehumidifierState', 0)
			}

			break
		case 'DRY':
			if (this.DryService) {

				// turn on FanService
				this.updateValue('DryService', 'Active', 1)
				this.updateValue('DryService', 'CurrentHumidifierDehumidifierState', Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING)

				// update swing for FanService
				if (this.capabilities.DRY.swing)
					this.updateValue('DryService', 'SwingMode', Characteristic.SwingMode[this.state.swing])

				// update fanSpeed for FanService
				if (this.capabilities.DRY.fanSpeeds)
					this.updateValue('DryService', 'RotationSpeed', this.state.fanSpeed)
			}

			// turn off HeaterCoolerService
			this.updateValue('HeaterCoolerService', 'Active', 0)
			this.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.INACTIVE)

			// turn off FanService
			if (this.FanService)
				this.updateValue('FanService', 'Active', 0)

			break
		}

		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

	updateValue (serviceName, characteristicName, newValue) {
		if (newValue !== 0 && newValue !== false && (typeof newValue === 'undefined' || !newValue)) {
			this.log.easyDebug(`${this.roomName} - WRONG VALUE -> '${characteristicName}' for ${serviceName} with VALUE: ${newValue}`)
			return
		}
		const minAllowed = this[serviceName].getCharacteristic(Characteristic[characteristicName]).props.minValue
		const maxAllowed = this[serviceName].getCharacteristic(Characteristic[characteristicName]).props.maxValue
		const validValues = this[serviceName].getCharacteristic(Characteristic[characteristicName]).props.validValues
		const currentValue = this[serviceName].getCharacteristic(Characteristic[characteristicName]).value

		if (validValues && !validValues.includes(newValue))
			newValue = currentValue
		if (minAllowed && newValue < minAllowed)
			newValue = currentValue
		else if (maxAllowed && newValue > maxAllowed)
			newValue = currentValue

		if (currentValue !== newValue) {
			this[serviceName].getCharacteristic(Characteristic[characteristicName]).updateValue(newValue)
			this.log.easyDebug(`${this.roomName} - Updated '${characteristicName}' for ${serviceName} with NEW VALUE: ${newValue}`)
		}
	}

	
}


module.exports = AirConditioner