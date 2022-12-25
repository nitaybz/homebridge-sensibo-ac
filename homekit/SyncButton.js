let Characteristic, Service

class SyncButton {
	constructor(airConditioner, platform) {

		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic
		
		this.log = airConditioner.log
		this.api = airConditioner.api
		this.id = airConditioner.id
		this.model = airConditioner.model + '_sync'
		this.serial = airConditioner.serial + '_sync'
		this.manufacturer = airConditioner.manufacturer
		this.roomName = airConditioner.roomName
		this.name = this.roomName + ' AC Sync' 
		this.type = 'SyncButton'
		this.displayName = this.name
		this.state = airConditioner.state

		this.stateManager = airConditioner.stateManager

		this.UUID = this.api.hap.uuid.generate(this.id + '_sync')
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

		
		this.addSyncButtonService()
	}

	addSyncButtonService() {
		this.log.easyDebug(`Adding SyncButtonService in the ${this.roomName}`)
		this.SyncButtonService = this.accessory.getService(Service.Switch)
		if (!this.SyncButtonService)
			this.SyncButtonService = this.accessory.addService(Service.Switch, this.name, this.type)


		this.SyncButtonService.getCharacteristic(Characteristic.On)
			.on('get', (callback) => { callback(null, false) })
			.on('set', (state, callback) => {
				this.stateManager.set.SyncState(state, callback)
				setTimeout(() => {
					this.SyncButtonService.getCharacteristic(Characteristic.On).updateValue(0)
				}, 1000)
			})

	}
}


module.exports = SyncButton