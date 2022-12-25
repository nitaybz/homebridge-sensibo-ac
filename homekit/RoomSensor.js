const unified = require('../sensibo/unified')
let Characteristic, Service, FAHRENHEIT_UNIT

class RoomSensor {
	constructor(sensor, device, platform) {

		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic
		FAHRENHEIT_UNIT = platform.FAHRENHEIT_UNIT

		const deviceInfo = unified.deviceInformation(device)
		const sensorInfo = unified.sensorInformation(sensor)
		
		this.log = platform.log
		this.api = platform.api
		this.storage = platform.storage
		this.cachedState = platform.cachedState
		this.id = sensorInfo.id
		this.deviceId = deviceInfo.id
		this.model = sensorInfo.model
		this.serial = sensorInfo.serial
		this.appId = deviceInfo.appId
		this.manufacturer = deviceInfo.manufacturer
		this.roomName = deviceInfo.roomName
		this.name = this.roomName + ' Sensor' 
		this.type = 'RoomSensor'
		this.displayName = this.name
		this.temperatureUnit = deviceInfo.temperatureUnit
		this.usesFahrenheit = this.temperatureUnit === FAHRENHEIT_UNIT

		this.state = this.cachedState.sensors[this.id] = unified.sensorState(sensor)
		
		const StateHandler = require('../sensibo/StateHandler')(this, platform)
		this.state = new Proxy(this.state, StateHandler)

		this.stateManager = require('./StateManager')(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id)
		this.accessory = platform.cachedAccessories.find(accessory => accessory.UUID === this.UUID)

		if (!this.accessory) {
			this.log(`Creating New ${platform.PLATFORM_NAME} ${this.type} Accessory in the ${this.roomName}`)
			this.accessory = new this.api.platformAccessory(this.name, this.UUID)
			this.accessory.context.type = this.type
			this.accessory.context.sensorId = this.id
			this.accessory.context.deviceId = this.deviceId

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

		this.addMotionSensor()
		this.addTemperatureSensor()
		this.addHumiditySensor()

	}

	addMotionSensor() {
		this.log.easyDebug(`Adding MotionSensorService in the ${this.roomName}`)
		this.MotionSensorService = this.accessory.getService(Service.MotionSensor)
		if (!this.MotionSensorService)
			this.MotionSensorService = this.accessory.addService(Service.MotionSensor, this.roomName + ' Motion Sensor', this.type)

		this.MotionSensorService.getCharacteristic(Characteristic.MotionDetected)
			.on('get', this.stateManager.get.MotionDetected)

		this.MotionSensorService.getCharacteristic(Characteristic.StatusLowBattery)
			.on('get', this.stateManager.get.StatusLowBattery)
	}


	addTemperatureSensor() {
		this.log.easyDebug(`Adding TemperatureSensorService in the ${this.roomName}`)
		this.TemperatureSensorService = this.accessory.getService(Service.TemperatureSensor)
		if (!this.TemperatureSensorService)
			this.TemperatureSensorService = this.accessory.addService(Service.TemperatureSensor, this.name + ' Temperature', 'TemperatureSensor')

		this.TemperatureSensorService.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: -100,
				maxValue: 100,
				minStep: 0.1
			})
			.on('get', this.stateManager.get.CurrentTemperature)

		this.TemperatureSensorService.getCharacteristic(Characteristic.StatusLowBattery)
			.on('get', this.stateManager.get.StatusLowBattery)
	}


	addHumiditySensor() {
		this.log.easyDebug(`Adding HumiditySensorService in the ${this.roomName}`)
		this.HumiditySensorService = this.accessory.getService(Service.HumiditySensor)
		if (!this.HumiditySensorService)
			this.HumiditySensorService = this.accessory.addService(Service.HumiditySensor, this.name + ' Humidity', 'HumiditySensor')

		this.HumiditySensorService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.stateManager.get.CurrentRelativeHumidity)


		this.HumiditySensorService.getCharacteristic(Characteristic.StatusLowBattery)
			.on('get', this.stateManager.get.StatusLowBattery)

	}


	updateHomeKit() {
		// log new state with FakeGato
		if (this.loggingService) {
			this.loggingService.addEntry({
				time: Math.floor((new Date()).getTime()/1000),
				temp: this.state.currentTemperature, 
				humidity: this.state.relativeHumidity
			})
		}
		
		// update measurements
		this.updateValue('MotionSensorService', 'MotionDetected', this.state.motionDetected)
		this.updateValue('TemperatureSensorService', 'CurrentTemperature', this.state.currentTemperature)
		this.updateValue('HumiditySensorService', 'CurrentRelativeHumidity', this.state.relativeHumidity)
		
		// update Low Battery Status
		this.updateValue('MotionSensorService', 'StatusLowBattery', Characteristic.StatusLowBattery[this.state.lowBattery])
		this.updateValue('TemperatureSensorService', 'StatusLowBattery', Characteristic.StatusLowBattery[this.state.lowBattery])
		this.updateValue('HumiditySensorService', 'StatusLowBattery', Characteristic.StatusLowBattery[this.state.lowBattery])

		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

	updateValue (serviceName, characteristicName, newValue) {
		if (this[serviceName].getCharacteristic(Characteristic[characteristicName]).value !== newValue) {
			this[serviceName].getCharacteristic(Characteristic[characteristicName]).updateValue(newValue)
			this.log.easyDebug(`${this.roomName} - Updated '${characteristicName}' for ${serviceName} with NEW VALUE: ${newValue}`)
		}
	}

	
}


module.exports = RoomSensor