import StateHandler from './StateHandler.js'
import StateManager from './StateManager.js'
import Utils from '../sensibo/Utils.js'

let Characteristic, Service

class OccupancySensor {

	constructor(device, platform) {
		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic

		this.Utils = Utils(this, platform)

		const deviceInfo = this.Utils.deviceInformation(device)
		const locationInfo = this.Utils.locationInformation(device.location)

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

		this.state = this.cachedState.occupancy[this.id] = this.Utils.occupancyStateFromDeviceLocation(device.location)
		this.state = new Proxy(this.state, StateHandler(this, platform))
		this.stateManager = StateManager(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id)
		this.accessory = platform.cachedAccessories.find(accessory => {
			return accessory.UUID === this.UUID
		})

		if (!this.accessory) {
			this.log.info(`Creating New ${platform.PLATFORM_NAME} ${this.type} Accessory at ${this.locationName}`)
			this.accessory = new this.api.platformAccessory(this.name, this.UUID)
			this.accessory.context.type = this.type
			this.accessory.context.locationId = this.id

			platform.cachedAccessories.push(this.accessory)

			// register the accessory
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory])
		}

		// This isn't with the others above as roomName can change
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

export default OccupancySensor
