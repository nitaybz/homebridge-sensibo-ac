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
		this.name = this.roomName + ' Air Quality' 
		this.type = 'AirQualitySensor'
		this.displayName = this.name

		this.state = this.cachedState.devices[this.id] = unified.airQualityState(device)
		
		const StateHandler = require('../sensibo/StateHandler')(this, platform)
		this.state = new Proxy(this.state, StateHandler)

		this.stateManager = require('./StateManager')(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id + '_airQuality')
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
			
		this.addAirQualitySensor()

	}

	addAirQualitySensor() {
		this.log.easyDebug(`Adding AirQualitySensor Service in the ${this.roomName}`)
		this.AirQualitySensor = this.accessory.getService(Service.AirQualitySensor)

		if (!this.AirQualitySensor)
			this.AirQualitySensor = this.accessory.addService(Service.AirQualitySensor, this.name, 'AirQuality')

		this.AirQualitySensor.getCharacteristic(Characteristic.AirQuality)
			.on('get', this.stateManager.get.AirQuality)

	}

	updateHomeKit() {
		this.updateValue('AirQualitySensor', 'AirQuality', Characteristic.AirQuality[this.state.airQuality])
				
		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

	updateValue (serviceName, characteristicName, newValue) {
		if (newValue !== 0 && (typeof newValue === 'undefined' || !newValue)) {
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