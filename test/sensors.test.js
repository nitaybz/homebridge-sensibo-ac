import {
	afterEach, beforeEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import HumiditySensor from '../homekit/HumiditySensor.js'
import OccupancySensor from '../homekit/OccupancySensor.js'
import RoomSensor from '../homekit/RoomSensor.js'
import {
	acDevice, fakePlatform, homeKitGet, makeAirConditioner
} from './helpers.js'

const {
	CurrentRelativeHumidity, CurrentTemperature, MotionDetected, OccupancyDetected, StatusLowBattery
} = hap.Characteristic

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

/**
 * Invoke a sensor's StateManager getter the way HomeKit does
 * @param   {Object}  sensor
 * @param   {string}  characteristic  StateManager.get key
 * @returns {Promise<*>}
 */
function sensorGet(sensor, characteristic) {
	return new Promise(resolve => {
		sensor.stateManager.get[characteristic]((_error, value) => {
			resolve(value)
		})
	})
}

/**
 * An AC device with a location, as the API returns it
 * @param   {*}  occupancy  the location's occupancy value
 * @returns {Object}
 */
function deviceAtLocation(occupancy) {
	return {
		...acDevice({}),
		location: {
			id: 'loc1',
			name: 'Home',
			occupancy
		}
	}
}

/**
 * A Sensibo motion sensor as the API returns it
 * @param   {Object}  measurements  measurement fields to override
 * @returns {Object}
 */
function motionSensor(measurements) {
	return {
		id: 'sensor1',
		productModel: 'motion_sensor',
		serial: '5678',
		measurements: {
			temperature: 22.34,
			humidity: 45,
			motion: true,
			batteryVoltage: 2900,
			...measurements
		}
	}
}

test('the humidity sensor mirrors the AC humidity and derives its identity from the AC', async () => {
	const {
		ac, platform, calls
	} = makeAirConditioner({}, {})
	const sensor = new HumiditySensor(ac, platform)

	sensor.updateHomeKit()

	assert.equal(sensor.name, 'Study Humidity')
	assert.equal(sensor.model, 'skyv2_humidity')
	assert.equal(sensor.serial, '1234_humidity')
	assert.equal(sensor.UUID, hap.uuid.generate('pod1_humidity'))
	assert.equal(sensor.state, ac.state)
	assert.equal(sensor.HumiditySensorService.getCharacteristic(CurrentRelativeHumidity).value, 50)
	assert.equal(await homeKitGet(ac, 'CurrentRelativeHumidity'), 50)
	assert.equal(calls.length, 0)
})

test('the humidity sensor reuses a cached accessory instead of registering a new one', () => {
	const {
		ac, platform
	} = makeAirConditioner({}, {})
	const cachedBefore = platform.cachedAccessories.length
	let registrations = 0

	platform.api.registerPlatformAccessories = () => {
		registrations++
	}

	const first = new HumiditySensor(ac, platform)
	const second = new HumiditySensor(ac, platform)

	assert.equal(registrations, 1)
	assert.equal(second.accessory, first.accessory)
	assert.equal(platform.cachedAccessories.length, cachedBefore + 1)
})

test('occupancy converts "me" and "someone" to detected and anything else to not detected', () => {
	const platform = fakePlatform({})
	const convert = occupancy => {
		return new OccupancySensor(deviceAtLocation(occupancy), platform).state.occupancy
	}

	assert.equal(convert('me'), 'OCCUPANCY_DETECTED')
	assert.equal(convert('someone'), 'OCCUPANCY_DETECTED')
	assert.equal(convert('away'), 'OCCUPANCY_NOT_DETECTED')
	assert.equal(convert(null), 'OCCUPANCY_NOT_DETECTED')
	assert.equal(platform.sensiboApi.calls.length, 0)
})

test('the occupancy sensor is keyed by location, caches its state and pushes it to HomeKit', async () => {
	const platform = fakePlatform({})
	const stored = []

	platform.storage.setItem = async (key, value) => {
		stored.push([key, value])
	}

	const sensor = new OccupancySensor(deviceAtLocation('me'), platform)

	assert.equal(sensor.id, 'loc1')
	assert.equal(sensor.serial, 'loc1')
	assert.equal(sensor.name, 'Home Occupancy')
	assert.equal(sensor.model, 'skyv2_occupancy')
	assert.equal(sensor.accessory.context.locationId, 'loc1')
	assert.deepEqual(platform.cachedState.occupancy, { loc1: { occupancy: 'OCCUPANCY_DETECTED' } })

	sensor.updateHomeKit()

	assert.equal(sensor.OccupancySensorService.getCharacteristic(OccupancyDetected).value, OccupancyDetected.OCCUPANCY_DETECTED)
	assert.equal(await sensorGet(sensor, 'OccupancyDetected'), OccupancyDetected.OCCUPANCY_DETECTED)
	assert.deepEqual(stored, [['state', platform.cachedState]])
})

test('a refreshed occupancy updates HomeKit without calling the Sensibo API', () => {
	const platform = fakePlatform({})
	const sensor = new OccupancySensor(deviceAtLocation('me'), platform)

	sensor.updateHomeKit()
	sensor.state.update(sensor.Utils.occupancyStateFromDeviceLocation({
		id: 'loc1',
		name: 'Home',
		occupancy: 'away'
	}))
	mock.timers.tick(2000)

	assert.equal(sensor.OccupancySensorService.getCharacteristic(OccupancyDetected).value, OccupancyDetected.OCCUPANCY_NOT_DETECTED)
	assert.equal(platform.cachedState.occupancy.loc1.occupancy, 'OCCUPANCY_NOT_DETECTED')
	assert.equal(platform.sensiboApi.calls.length, 0)
})

test('room sensor state is converted from the sensor measurements', () => {
	const platform = fakePlatform({})
	const sensor = new RoomSensor(motionSensor({}), acDevice({}), platform)

	assert.equal(sensor.name, 'Study Sensor')
	assert.equal(sensor.model, 'motion_sensor')
	assert.equal(sensor.serial, '5678')
	assert.equal(sensor.deviceId, 'pod1')
	assert.deepEqual(platform.cachedState.sensors.sensor1, {
		currentTemperature: 22.34,
		lowBattery: 'BATTERY_LEVEL_NORMAL',
		motionDetected: true,
		relativeHumidity: 45
	})
})

test('room sensor battery is low only at a reported battery voltage of 100 or below', () => {
	const lowBattery = batteryVoltage => {
		return new RoomSensor(motionSensor({ batteryVoltage }), acDevice({}), fakePlatform({})).state.lowBattery
	}

	assert.equal(lowBattery(101), 'BATTERY_LEVEL_NORMAL')
	assert.equal(lowBattery(100), 'BATTERY_LEVEL_LOW')
	// A sensor that reports no battery voltage is not shown as low battery
	assert.equal(lowBattery(undefined), 'BATTERY_LEVEL_NORMAL')
})

test('the room sensor pushes motion, temperature (rounded to 0.1), humidity and battery to every service', async () => {
	const platform = fakePlatform({})
	const sensor = new RoomSensor(motionSensor({ batteryVoltage: 50 }), acDevice({}), platform)

	sensor.updateHomeKit()

	assert.equal(sensor.MotionSensorService.getCharacteristic(MotionDetected).value, true)
	// Suspicious: Utils rounds to 22.3, but HAP's minStep 0.1 handling stores a float artifact (see the Utils TODO about 22.60000000000001)
	assert.equal(sensor.TemperatureSensorService.getCharacteristic(CurrentTemperature).value, 22.30000000000001)
	assert.equal(sensor.HumiditySensorService.getCharacteristic(CurrentRelativeHumidity).value, 45)

	for (const service of [sensor.MotionSensorService, sensor.TemperatureSensorService, sensor.HumiditySensorService]) {
		assert.equal(service.getCharacteristic(StatusLowBattery).value, StatusLowBattery.BATTERY_LEVEL_LOW)
	}

	// The getter returns the raw reading; only updateHomeKit rounds it
	assert.equal(await sensorGet(sensor, 'CurrentTemperature'), 22.34)
	assert.equal(await sensorGet(sensor, 'MotionDetected'), true)
	assert.equal(await sensorGet(sensor, 'StatusLowBattery'), StatusLowBattery.BATTERY_LEVEL_LOW)
	assert.equal(platform.sensiboApi.calls.length, 0)
})

test('room sensor motion clearing is pushed to HomeKit through a state update', () => {
	const platform = fakePlatform({})
	const sensor = new RoomSensor(motionSensor({}), acDevice({}), platform)

	sensor.updateHomeKit()
	sensor.state.update(sensor.Utils.sensorStateFromSensorMeasurements(motionSensor({
		motion: false,
		temperature: -5
	}).measurements))

	assert.equal(sensor.MotionSensorService.getCharacteristic(MotionDetected).value, false)
	assert.equal(sensor.TemperatureSensorService.getCharacteristic(CurrentTemperature).value, -5)
	assert.equal(platform.sensiboApi.calls.length, 0)
})
