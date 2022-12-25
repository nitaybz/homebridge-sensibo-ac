let Characteristic, Service

class HumiditySensor {
	constructor(airConditioner, platform) {

		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic
		
		this.log = airConditioner.log
		this.api = airConditioner.api
		this.id = airConditioner.id
		this.model = airConditioner.model + '_humidity'
		this.serial = airConditioner.serial + '_humidity'
		this.manufacturer = airConditioner.manufacturer
		this.roomName = airConditioner.roomName
		this.name = this.roomName + ' Humidity' 
		this.type = 'HumiditySensor'
		this.displayName = this.name
		this.state = airConditioner.state

		this.stateManager = airConditioner.stateManager

		this.UUID = this.api.hap.uuid.generate(this.id + '_humidity')
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

		
		this.addHumiditySensorService()
	}

	addHumiditySensorService() {
		this.log.easyDebug(`Adding HumiditySensorService in the ${this.roomName}`)
		this.HumiditySensorService = this.accessory.getService(Service.HumiditySensor)
		if (!this.HumiditySensorService)
			this.HumiditySensorService = this.accessory.addService(Service.HumiditySensor, this.name, this.type)

		this.HumiditySensorService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.stateManager.get.CurrentRelativeHumidity)

	}

	updateHomeKit() {
		// log new state with FakeGato
		if (this.loggingService) {
			this.loggingService.addEntry({
				time: Math.floor((new Date()).getTime()/1000),
				humidity: this.state.relativeHumidity
			})
		}
		
		this.updateValue('HumiditySensorService', 'CurrentRelativeHumidity', this.state.relativeHumidity)
	}

	updateValue (serviceName, characteristicName, newValue) {
		if (this[serviceName].getCharacteristic(Characteristic[characteristicName]).value !== newValue) {
			this[serviceName].getCharacteristic(Characteristic[characteristicName]).updateValue(newValue)
			this.log.easyDebug(`${this.roomName} - Updated '${characteristicName}' for ${serviceName} with NEW VALUE: ${newValue}`)
		}
	}

	
}


module.exports = HumiditySensor