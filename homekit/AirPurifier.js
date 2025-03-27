// import fakegato from 'fakegato-history'
import StateHandler from './StateHandler.js'
import StateManager from './StateManager.js'
import Utils from '../sensibo/Utils.js'

let Characteristic, Service

class AirPurifier {

	constructor(device, platform) {
		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic

		this.Utils = Utils(this, platform)

		const deviceInfo = this.Utils.deviceInformation(device)

		this.log = platform.log
		this.api = platform.api
		this.storage = platform.storage
		this.cachedState = platform.cachedState
		this.id = deviceInfo.id
		this.model = deviceInfo.model
		this.serial = deviceInfo.serial
		this.manufacturer = deviceInfo.manufacturer
		this.roomName = deviceInfo.roomName
		this.name = this.roomName + ' Pure'
		this.type = 'AirPurifier'

		this.sensiboFilterValuesExist = deviceInfo.filterService
		this.disableLightSwitch = platform.disableLightSwitch

		this.capabilities = this.Utils.airPurifierCapabilities(device.remoteCapabilities.modes)

		this.state = this.cachedState.devices[this.id] = this.Utils.airPurifierStateFromDevice(device)
		this.state = new Proxy(this.state, StateHandler(this, platform))
		this.stateManager = StateManager(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id)
		this.accessory = platform.cachedAccessories.find(accessory => {
			return accessory.UUID === this.UUID
		})

		if (!this.accessory) {
			this.log.info(`Creating New ${platform.PLATFORM_NAME} ${this.type} Accessory in the ${this.roomName}`)
			this.accessory = new this.api.platformAccessory(this.name, this.UUID)
			this.accessory.context.type = this.type
			this.accessory.context.deviceId = this.id

			platform.cachedAccessories.push(this.accessory)

			// register the accessory
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory])
		}

		// This isn't with the others above as roomName can change
		this.accessory.context.roomName = this.roomName

		// Note: At this time (March 2025) FakeGato and Eve don't support logging any values relevant to AirPurifier
		// if (platform.enableHistoryStorage) {
		// 	const FakeGatoHistoryService = fakegato(this.api)

		// 	this.loggingService = new FakeGatoHistoryService('room2', this.accessory, {
		//		log: this.log,
		// 		storage: 'fs',
		// 		path: platform.persistPath
		// 	})
		// }

		let informationService = this.accessory.getService(Service.AccessoryInformation)

		if (!informationService) {
			informationService = this.accessory.addService(Service.AccessoryInformation)
		}

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		this.addAirPurifierService()

		if (this.capabilities.FAN && this.capabilities.FAN.light && !this.disableLightSwitch) {
			this.addLightSwitch()
		} else {
			this.removeLightSwitch()
		}
	}

	addAirPurifierService() {
		this.log.easyDebug(`${this.name} - Adding AirPurifierService`)

		this.AirPurifierService = this.accessory.getService(Service.AirPurifier)
		if (!this.AirPurifierService) {
			this.AirPurifierService = this.accessory.addService(Service.AirPurifier, this.name, this.type)
		}

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

		if (this.sensiboFilterValuesExist) {
			this.AirPurifierService.getCharacteristic(Characteristic.FilterChangeIndication)
				.on('get', this.stateManager.get.FilterChangeIndication)

			this.AirPurifierService.getCharacteristic(Characteristic.FilterLifeLevel)
				.on('get', this.stateManager.get.FilterLifeLevel)

			this.AirPurifierService.getCharacteristic(Characteristic.ResetFilterIndication)
				.on('set', this.stateManager.set.ResetFilterIndication)
		}
	}

	addLightSwitch() {
		this.log.easyDebug(`${this.name} - Adding LightSwitchService`)

		this.PureLightSwitchService = this.accessory.getService(this.roomName + ' Pure Light')
		if (!this.PureLightSwitchService) {
			this.PureLightSwitchService = this.accessory.addService(Service.Lightbulb, this.roomName + ' Pure Light', 'PureLightSwitch')
		}

		this.PureLightSwitchService.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.LightSwitch)
			.on('set', this.stateManager.set.LightSwitch)
	}

	removeLightSwitch() {
		const LightSwitch = this.accessory.getService(this.roomName + ' Pure Light')

		if (LightSwitch) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing LightSwitchService`)
			this.accessory.removeService(LightSwitch)
			delete this.PureLightSwitchService
		}
	}

	updateHomeKit() {
		// Note: At this time (March 2025) FakeGato and Eve don't support logging any values relevant to AirPurifier
		// log new state with FakeGato
		// if (this.loggingService) {
		// 	this.loggingService.addEntry({
		// 		time: Math.floor((new Date()).getTime()/1000),
		// 		voc: this.state.VOCDensity,
		// 	})
		// }

		// if status is OFF, set all services to INACTIVE
		if (!this.state.active) {
			this.Utils.updateValue('AirPurifierService', 'Active', 0)
			this.Utils.updateValue('AirPurifierService', 'CurrentAirPurifierState', Characteristic.CurrentAirPurifierState.INACTIVE)
		} else {
			this.Utils.updateValue('AirPurifierService', 'Active', 1)
			this.Utils.updateValue('AirPurifierService', 'CurrentAirPurifierState', Characteristic.CurrentAirPurifierState.PURIFYING_AIR)

			// update fanSpeed for AirPurifierService
			this.Utils.updateValue('AirPurifierService', 'RotationSpeed', this.state.fanSpeed)
		}

		this.Utils.updateValue('AirPurifierService', 'TargetAirPurifierState', this.state.pureBoost ? 1 : 0)

		// update filter characteristics for AirPurifierService
		if (this.sensiboFilterValuesExist) {
			this.Utils.updateValue('AirPurifierService', 'FilterChangeIndication', Characteristic.FilterChangeIndication[this.state.filterChange])
			this.Utils.updateValue('AirPurifierService', 'FilterLifeLevel', this.state.filterLifeLevel)
		}

		// update light switch for AirPurifierService
		if (this.PureLightSwitchService) {
			const switchValue = this.state?.light ?? false

			this.Utils.updateValue('PureLightSwitchService', 'On', switchValue)
		}

		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

}

export default AirPurifier
