const unified = require('../sensibo/unified')
let Characteristic, Service

class OccupancySensor {

	constructor(device, platform) {
		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic

		this.Utils = require('../sensibo/Utils')(this, platform)

		const deviceInfo = unified.deviceInformation(device)
		const locationInfo = unified.locationInformation(device.location)

		this.log = platform.log
		this.api = platform.api
		this.storage = platform.storage
		this.cachedState = platform.cachedState
		this.id = locationInfo.id
		this.model = deviceInfo.model + '_occupancy'
		this.serial = locationInfo.id
		this.manufacturer = deviceInfo.manufacturer
		this.locationName = locationInfo.name
		this.name = this.locationName + ' Occupancy'
		this.type = 'OccupancySensor'

		const StateHandler = require('./StateHandler')(this, platform)

		this.state = this.cachedState.occupancy[this.id] = unified.occupancyState(device.location)
		this.state = new Proxy(this.state, StateHandler)
		this.stateManager = require('./StateManager')(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id)
		this.accessory = platform.cachedAccessories.find(accessory => {
			return accessory.UUID === this.UUID
		})

		if (!this.accessory) {
			this.log(`Creating New ${platform.PLATFORM_NAME} ${this.type} Accessory at ${this.locationName}`)
			this.accessory = new this.api.platformAccessory(this.name, this.UUID)
			this.accessory.context.type = this.type
			this.accessory.context.locationId = this.id

			platform.cachedAccessories.push(this.accessory)

			// register the accessory
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory])
		}

		this.accessory.context.locationName = this.locationName

		let informationService = this.accessory.getService(Service.AccessoryInformation)

		if (!informationService) {
			informationService = this.accessory.addService(Service.AccessoryInformation)
		}

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		this.addOccupancySensor()
	}

	addOccupancySensor() {
		this.log.easyDebug(`${this.name} - Adding OccupancySensorService`)

		this.OccupancySensorService = this.accessory.getService(Service.OccupancySensor)
		if (!this.OccupancySensorService) {
			this.OccupancySensorService = this.accessory.addService(Service.OccupancySensor, this.name, this.type)
		}

		this.OccupancySensorService.getCharacteristic(Characteristic.OccupancyDetected)
			.on('get', this.stateManager.get.OccupancyDetected)
	}

	updateHomeKit() {
		// update measurements
		this.Utils.updateValue('OccupancySensorService', 'OccupancyDetected', Characteristic.OccupancyDetected[this.state.occupancy])

		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

}

module.exports = OccupancySensor