import fakegato from 'fakegato-history'
import StateHandler from './StateHandler.js'
import StateManager from './StateManager.js'
import Utils from '../sensibo/Utils.js'

let Characteristic, Service

class AirQualitySensor {

	constructor(device, platform) {
		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic
		const FAHRENHEIT_UNIT = platform.FAHRENHEIT_UNIT

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
		this.name = this.roomName + ' Air Quality'
		this.type = 'AirQualitySensor'

		this.temperatureUnit = deviceInfo.temperatureUnit
		this.usesFahrenheit = this.temperatureUnit === FAHRENHEIT_UNIT

		this.disableAirQuality = platform.disableAirQuality
		this.disableCarbonDioxide = platform.disableCarbonDioxide

		this.capabilities = this.Utils.airQualityCapabilities(device.measurements)

		// Required to add airQuality to this.cachedState for existing installs
		if ('airQuality' in this.cachedState === false) {
			this.cachedState.airQuality = {}
		}

		this.state = this.cachedState.airQuality[this.id] = this.Utils.airQualityStateFromDeviceMeasurements(device.measurements)
		this.state = new Proxy(this.state, StateHandler(this, platform))
		this.stateManager = StateManager(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id + '_airQuality')
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

		if (platform.enableHistoryStorage) {
			const FakeGatoHistoryService = fakegato(this.api)

			this.loggingService = new FakeGatoHistoryService('room2', this.accessory, {
				log: this.log,
				storage: 'fs',
				path: platform.persistPath
			})
		}

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

		// Add temperature service to enable showing of history in Eve app
		if (!this.disableAirQuality && platform.enableHistoryStorage) {
			this.addTemperatureSensorService()
		} else {
			this.removeTemperatureSensorService()
		}
	}

	// TODO: see if additional values from Elements could be added as custom characteristics
	//       e.g. ethanol, PM10... - see Github issue #103
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
				.setProps({ maxValue: this.Utils.Constants().VOCDENSITY_MAX })
				.on('get', this.stateManager.get.VOCDensity)
		}

		if (this.capabilities.pm25?.homeKitSupported) {
			this.AirQualitySensorService.getCharacteristic(Characteristic.PM2_5Density)
				.setProps({ maxValue: this.Utils.Constants().PM2_5DENSITY_MAX })
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

	addTemperatureSensorService() {
		this.log.info(`${this.name} - Adding TemperatureSensorService as required for FakeGato logging to show history in Eve app.`)
		this.TemperatureSensorService = this.accessory.getService(Service.TemperatureSensor)

		if (!this.TemperatureSensorService) {
			this.TemperatureSensorService = this.accessory.addService(Service.TemperatureSensor, this.name, 'TemperatureSensor')
		}

		this.TemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
			.on('get', this.stateManager.get.CurrentTemperature)

		this.log.info(`${this.name} - Adding TemperatureDisplayUnits as required for FakeGato logging. Homebridge warning expected and can be ignored.`)
		this.TemperatureSensorService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
			.on('get', this.stateManager.get.TemperatureDisplayUnits)
	}

	removeTemperatureSensorService() {
		const TemperatureSensor = this.accessory.getService(Service.TemperatureSensor) || this.accessory.getService('TemperatureSensor')

		if (TemperatureSensor) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing TemperatureSensorService`)
			this.accessory.removeService(TemperatureSensor)
		}
	}

	updateHomeKit() {
		// log new state with FakeGato
		// Note: Display of CO2 history doesn't appear to be possible due to Eve / FakeGato limitations - see Github issue #110
		if (this.loggingService) {
			this.log.easyDebug(`${this.name} - Making FakeGato log entry`)

			this.loggingService.addEntry({
				time: Math.floor((new Date()).getTime() / 1000),
				temp: this.state.currentTemperature,
				voc: this.state.VOCDensity,
				ppm: this.state.carbonDioxideLevel
			})

			this.Utils.updateValue('TemperatureSensorService', 'CurrentTemperature', this.state.currentTemperature)
		}

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

export default AirQualitySensor
