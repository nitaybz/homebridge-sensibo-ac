const unified = require('../sensibo/unified')
let Characteristic, Service
const Constants = {}

class AirQualitySensor {

	constructor(device, platform) {
		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic

		Constants.carbonDioxideAlertThreshold = platform.carbonDioxideAlertThreshold
		Constants.PM2_5DENSITY_MAX = platform.PM2_5DENSITY_MAX
		Constants.VOCDENSITY_MAX = platform.VOCDENSITY_MAX

		this.Utils = require('../sensibo/Utils')(this, platform)

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
		this.disableAirQuality = platform.disableAirQuality
		this.disableCarbonDioxide = platform.disableCarbonDioxide
		this.measurements = device.measurements
		this.capabilities = this.Utils.airQualityCapabilities()

		const StateHandler = require('./StateHandler')(this, platform)

		// Required to add airQuality to this.cachedState for existing installs
		if ('airQuality' in this.cachedState === false) {
			this.cachedState.airQuality = {}
		}

		this.state = this.cachedState.airQuality[this.id] = unified.airQualityStateFromDevice(device, Constants)
		this.state = new Proxy(this.state, StateHandler)
		this.stateManager = require('./StateManager')(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id + '_airQuality')
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

		// FIXME: Add support for Sensibo Elements - see Github issue #103

		// TODO: enable logging? See also line 143
		// if (platform.enableHistoryStorage) {
		// 	const FakeGatoHistoryService = require('fakegato-history')(this.api)

		// 	this.loggingService = new FakeGatoHistoryService('weather', this.accessory, {
		// 		storage: 'fs',
		// 		path: platform.persistPath
		// 	})
		// }

		this.accessory.context.roomName = this.roomName

		let informationService = this.accessory.getService(Service.AccessoryInformation)

		if (!informationService) {
			informationService = this.accessory.addService(Service.AccessoryInformation)
		}

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		// Air Quality Sensor, iaq, tvoc or pm25
		if (!this.disableAirQuality && (this.capabilities.iaq?.homeKitSupported || this.capabilities.tvoc?.homeKitSupported || this.capabilities.pm25?.homeKitSupported)) {
			this.addAirQualityService()
		} else {
			this.removeAirQualityService()
		}

		// Carbon Dioxide Sensor, co2
		if (!this.disableCarbonDioxide && this.capabilities.co2.homeKitSupported) {
			this.addCarbonDioxideService()
		} else {
			this.removeCarbonDioxideService()
		}
	}

	addAirQualityService() {
		this.log.easyDebug(`${this.name} - Adding AirQualitySensorService`)
		this.AirQualitySensorService = this.accessory.getService(Service.AirQualitySensor)

		if (!this.AirQualitySensorService) {
			this.AirQualitySensorService = this.accessory.addService(Service.AirQualitySensor, this.name, 'AirQualitySensor')
		}

		this.AirQualitySensorService.getCharacteristic(Characteristic.AirQuality)
			.on('get', this.stateManager.get.AirQuality)

		if (this.capabilities.tvoc?.homeKitSupported) {
			this.AirQualitySensorService.getCharacteristic(Characteristic.VOCDensity)
				.setProps({ maxValue: Constants.VOCDENSITY_MAX })
				.on('get', this.stateManager.get.VOCDensity)
		}

		if (this.capabilities.pm25?.homeKitSupported) {
			this.AirQualitySensorService.getCharacteristic(Characteristic.PM2_5Density)
				.setProps({ maxValue: Constants.PM2_5DENSITY_MAX })
				.on('get', this.stateManager.get.PM2_5Density)
		}
	}

	removeAirQualityService() {
		const AirQualitySensor = this.accessory.getService(Service.AirQualitySensor) || this.accessory.getService('AirQualitySensor')

		if (AirQualitySensor) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing AirQualitySensorService`)
			this.accessory.removeService(AirQualitySensor)
		}
	}

	addCarbonDioxideService() {
		this.log.easyDebug(`${this.name} - Adding CarbonDioxideSensorService`)
		this.CarbonDioxideSensorService = this.accessory.getService(Service.CarbonDioxideSensor)

		if (!this.CarbonDioxideSensorService) {
			this.CarbonDioxideSensorService = this.accessory.addService(Service.CarbonDioxideSensor, this.name, 'CarbonDioxideSensor')
		}

		this.CarbonDioxideSensorService.getCharacteristic(Characteristic.CarbonDioxideDetected)
			.on('get', this.stateManager.get.CarbonDioxideDetected)
		this.CarbonDioxideSensorService.getCharacteristic(Characteristic.CarbonDioxideLevel)
			.on('get', this.stateManager.get.CarbonDioxideLevel)
	}

	removeCarbonDioxideService() {
		const CarbonDioxideSensor = this.accessory.getService(Service.CarbonDioxideSensor) || this.accessory.getService('CarbonDioxideSensor')

		if (CarbonDioxideSensor) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing CarbonDioxideSensorService`)
			this.accessory.removeService(CarbonDioxideSensor)
		}
	}

	updateHomeKit() {
		// TODO: add logging of CO2 and VOCs? See also line 57 - see Github issue #110
		// log new state with FakeGato
		// if (this.loggingService) {
		// 	this.loggingService.addEntry({
		// 		time: Math.floor((new Date()).getTime()/1000),
		// 		temp: this.state.currentTemperature,
		// 		humidity: this.state.relativeHumidity
		// 	})
		// }

		if (!this.disableAirQuality) {
			this.Utils.updateValue('AirQualitySensorService', 'AirQuality', this.state.airQuality)

			if (this.capabilities.tvoc?.homeKitSupported) {
				this.Utils.updateValue('AirQualitySensorService', 'VOCDensity', this.state.VOCDensity)
			}

			if (this.capabilities.pm25?.homeKitSupported) {
				this.Utils.updateValue('AirQualitySensorService', 'PM2_5Density', this.state.PM2_5Density)
			}
		}

		if (!this.disableCarbonDioxide) {
			this.Utils.updateValue('CarbonDioxideSensorService', 'CarbonDioxideDetected', this.state.carbonDioxideDetected)
			this.Utils.updateValue('CarbonDioxideSensorService', 'CarbonDioxideLevel', this.state.carbonDioxideLevel)
		}

		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

}

module.exports = AirQualitySensor
