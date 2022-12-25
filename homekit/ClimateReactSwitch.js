let Characteristic, Service

class ClimateReactSwitch {
	constructor(airConditioner, platform) {

		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic
		
		this.log = airConditioner.log
		this.api = airConditioner.api
		this.id = airConditioner.id
		this.model = airConditioner.model + '_CR'
		this.serial = airConditioner.serial + '_CR'
		this.manufacturer = airConditioner.manufacturer
		this.roomName = airConditioner.roomName
		this.name = this.roomName + ' Climate React' 
		this.type = 'ClimateReact'
		this.displayName = this.name
		this.state = airConditioner.state

		this.stateManager = airConditioner.stateManager

		this.UUID = this.api.hap.uuid.generate(this.id + '_CR')
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

		this.accessory.context.roomName = this.roomName

		let informationService = this.accessory.getService(Service.AccessoryInformation)

		if (!informationService)
			informationService = this.accessory.addService(Service.AccessoryInformation)

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		this.addClimateReactService()
	}

	
	addClimateReactService() {
		this.log.easyDebug(`Adding ClimateReactService in the ${this.roomName}`)

		this.ClimateReactService = this.accessory.getService(Service.Switch)
		if (!this.ClimateReactService)
			this.ClimateReactService = this.accessory.addService(Service.Switch, this.name, this.type)

			
		this.ClimateReactService.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.ClimateReact)
			.on('set', this.stateManager.set.ClimateReact)

	}

	updateHomeKit() {
		// update Climate React Service
		this.updateValue('ClimateReactService', 'On', this.state.smartMode)
	}

	updateValue (serviceName, characteristicName, newValue) {
		if (this[serviceName].getCharacteristic(Characteristic[characteristicName]).value !== newValue) {
			this[serviceName].getCharacteristic(Characteristic[characteristicName]).updateValue(newValue)
			this.log.easyDebug(`${this.roomName} - Updated '${characteristicName}' for ${serviceName} with NEW VALUE: ${newValue}`)
		}
	}

	
}


module.exports = ClimateReactSwitch