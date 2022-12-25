const unified = require('../sensibo/unified')
let Characteristic, Service

class AirPurifier {
	constructor(device, platform) {

		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic

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
		this.name = this.roomName + ' Pure' 
		this.type = 'AirPurifier'
		this.displayName = this.name
		this.disableLightSwitch = platform.disableLightSwitch
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

		// if (platform.enableHistoryStorage) {
		// 	const FakeGatoHistoryService = require("fakegato-history")(this.api)
		// 	this.loggingService = new FakeGatoHistoryService('weather', this.accessory, { storage: 'fs', path: platform.persistPath })
		// }

		this.accessory.context.roomName = this.roomName

		let informationService = this.accessory.getService(Service.AccessoryInformation)

		if (!informationService)
			informationService = this.accessory.addService(Service.AccessoryInformation)

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		this.addAirPurifierService()

		if (this.capabilities.FAN && this.capabilities.FAN.light && !this.disableLightSwitch)
			this.addLightSwitch()
		else
			this.removeLightSwitch()
	}

	addAirPurifierService() {
		this.log.easyDebug(`Adding AirPurifierService in the ${this.roomName}`)
		this.AirPurifierService = this.accessory.getService(Service.AirPurifier)
		if (!this.AirPurifierService)
			this.AirPurifierService = this.accessory.addService(Service.AirPurifier, this.name, this.type)

		this.AirPurifierService.getCharacteristic(Characteristic.Active)
			.on('get', this.stateManager.get.PureActive)
			.on('set', this.stateManager.set.PureActive)

		this.AirPurifierService.getCharacteristic(Characteristic.CurrentAirPurifierState)
			.on('get', this.stateManager.get.CurrentAirPurifierState)

		this.AirPurifierService.getCharacteristic(Characteristic.TargetAirPurifierState)
			.on('get', this.stateManager.get.TargetAirPurifierState)
			.on('set', this.stateManager.set.TargetAirPurifierState)

		this.AirPurifierService.getCharacteristic(Characteristic.RotationSpeed)
			.on('get', this.stateManager.get.PureRotationSpeed)
			.on('set', this.stateManager.set.PureRotationSpeed)

		if (this.filterService) {
			this.AirPurifierService.getCharacteristic(Characteristic.FilterChangeIndication)
				.on('get', this.stateManager.get.FilterChangeIndication)
	
			this.AirPurifierService.getCharacteristic(Characteristic.FilterLifeLevel)
				.on('get', this.stateManager.get.FilterLifeLevel)

			this.AirPurifierService.getCharacteristic(Characteristic.ResetFilterIndication)
				.on('set', this.stateManager.set.ResetFilterIndication)
		}
	}

	addLightSwitch() {
		this.log.easyDebug(`Adding PureLightSwitchService in the ${this.roomName}`)

		this.LightSwitch = this.accessory.getService(this.roomName + ' Pure Light')
		if (!this.LightSwitch)
			this.LightSwitch = this.accessory.addService(Service.Lightbulb, this.roomName + ' Pure Light', 'PureLightSwitch')

		this.LightSwitch.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.LightSwitch)
			.on('set', this.stateManager.set.LightSwitch)
	}

	removeLightSwitch() {
		let LightSwitch = this.accessory.getService(this.roomName + ' Pure Light')
		if (LightSwitch) {
			// remove service
			this.log.easyDebug(`Removing Pure Light Service from the ${this.roomName}`)
			this.accessory.removeService(LightSwitch)
		}
	}

	updateHomeKit() {
		// log new state with FakeGato
		// if (this.loggingService) {
		// 	this.loggingService.addEntry({
		// 		time: Math.floor((new Date()).getTime()/1000),
		// 		temp: this.state.currentTemperature, 
		// 		humidity: this.state.relativeHumidity
		// 	})
		// }
		
		// if status is OFF, set all services to INACTIVE
		if (!this.state.active) {
			this.updateValue('AirPurifierService', 'Active', 0)
			this.updateValue('AirPurifierService', 'CurrentAirPurifierState', Characteristic.CurrentAirPurifierState.INACTIVE)
		} else {
			this.updateValue('AirPurifierService', 'Active', 1)
			this.updateValue('AirPurifierService', 'CurrentAirPurifierState', Characteristic.CurrentAirPurifierState.PURIFYING_AIR)

			// update fanSpeed for AirPurifierService
			this.updateValue('AirPurifierService', 'RotationSpeed', this.state.fanSpeed)
		}

		this.updateValue('AirPurifierService', 'TargetAirPurifierState', this.state.pureBoost ? 1 : 0)
				
		// update filter characteristics for AirPurifierService
		if (this.filterService) {
			this.updateValue('AirPurifierService', 'FilterChangeIndication', Characteristic.FilterChangeIndication[this.state.filterChange])
			this.updateValue('AirPurifierService', 'FilterLifeLevel', this.state.filterLifeLevel)
		}

		// update light switch for AirPurifierService
		if (this.LightSwitch)
			this.updateValue('PureLightSwitch', 'On', this.state.light)

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


module.exports = AirPurifier