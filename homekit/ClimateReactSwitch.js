let Characteristic, Service

class ClimateReactSwitch {

	constructor(airConditioner, platform) {
		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic

		this.Utils = require('../sensibo/Utils')(this, platform)

		this.log = airConditioner.log
		this.api = airConditioner.api
		this.id = airConditioner.id
		this.model = airConditioner.model + '_CR'
		this.serial = airConditioner.serial + '_CR'
		this.manufacturer = airConditioner.manufacturer
		this.roomName = airConditioner.roomName
		this.name = this.roomName + ' ClimateReact'
		this.type = 'ClimateReactSwitch'

		this.state = airConditioner.state
		this.stateManager = airConditioner.stateManager

		this.UUID = this.api.hap.uuid.generate(this.id + '_CR')
		this.accessory = platform.cachedAccessories.find(accessory => {
			return accessory.UUID === this.UUID
		})

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

		if (!informationService) {
			informationService = this.accessory.addService(Service.AccessoryInformation)
		}

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		this.addClimateReactSwitchService()
	}

	addClimateReactSwitchService() {
		this.log.easyDebug(`${this.name} - Adding ClimateReactSwitchService`)

		this.ClimateReactSwitchService = this.accessory.getService(this.name)
		if (!this.ClimateReactSwitchService) {
			this.ClimateReactSwitchService = this.accessory.addService(Service.Switch, this.name, this.type)
		}

		this.ClimateReactSwitchService.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.ClimateReactSwitch)
			.on('set', this.stateManager.set.ClimateReactSwitch)
	}

	updateHomeKit() {
		const smartModeEnabledState = this.state?.smartMode?.enabled ?? false

		// update Climate React Service
		this.Utils.updateValue('ClimateReactSwitchService', 'On', smartModeEnabledState)
	}

}

module.exports = ClimateReactSwitch