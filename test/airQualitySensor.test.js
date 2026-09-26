import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import AirQualitySensor from '../homekit/AirQualitySensor.js'
import {
	fakePlatform, homeKitGet
} from './helpers.js'

const { Characteristic } = hap

/**
 * A Sensibo Air/Elements style device whose measurements include air-quality readings
 * @param   {Object}  measurements  measurements to use
 * @returns {Object}                the device
 */
function airQualityDevice(measurements) {
	return {
		id: 'air1',
		productModel: 'elements',
		serial: '9999',
		temperatureUnit: 'C',
		room: { name: 'Office' },
		measurements
	}
}

/**
 * An AirQualitySensor accessory built from measurements, pushed to HomeKit once like syncHomeKitCache does
 * @param   {Object}  platformConfig  platform settings to override
 * @param   {Object}  measurements    device measurements
 * @returns {{sensor: AirQualitySensor, platform: Object}}
 */
function makeSensor(platformConfig, measurements) {
	const platform = fakePlatform(platformConfig)
	const sensor = new AirQualitySensor(airQualityDevice(measurements), platform)

	sensor.updateHomeKit()

	return {
		sensor,
		platform
	}
}

/** Convert measurements to state through the accessory's own Utils */
function stateFrom(measurements, platformConfig) {
	const { sensor } = makeSensor(platformConfig ?? {}, { co2: 400 })

	return sensor.Utils.airQualityStateFromDeviceMeasurements(measurements)
}

function value(service, characteristic) {
	return service.getCharacteristic(Characteristic[characteristic]).value
}

test('iaq readings map to HomeKit AirQuality in 50-point bands, capped at POOR', () => {
	const qualities = [1, 50, 51, 140, 160, 207, 999].map(iaq => {
		return stateFrom({
			iaq,
			pm25: 1
		}).airQuality
	})

	assert.deepEqual(qualities, [1, 1, 2, 3, 4, 5, 5])
})

test('without iaq, tvoc thresholds set AirQuality and tvoc ppb converts to VOCDensity', () => {
	const results = [100, 300, 600, 1200, 1600].map(tvoc => {
		const state = stateFrom({ tvoc })

		return [state.airQuality, state.VOCDensity]
	})

	assert.deepEqual(results, [[1, 457], [2, 1371], [3, 2742], [4, 5484], [5, 7312]])
	assert.equal(stateFrom({ tvoc: 3000 }).VOCDensity, 10000)
})

test('iaq-only measurements (as from a Pure) still derive AirQuality and reach HomeKit', () => {
	assert.deepEqual(stateFrom({ iaq: 120 }), {
		VOCDensity: 0,
		airQuality: 3
	})

	const { sensor } = makeSensor({}, { iaq: 120 })

	assert.equal(value(sensor.AirQualitySensorService, 'AirQuality'), 3)
})

test('missing or empty measurements produce an empty state', () => {
	assert.deepEqual(stateFrom({}), {})
	assert.deepEqual(stateFrom(null), {})
})

test('co2 at or above carbonDioxideAlertThreshold is detected; pm25 is kept as a decimal and clamped', () => {
	assert.deepEqual(stateFrom({ co2: 1499 }), {
		carbonDioxideLevel: 1499,
		carbonDioxideDetected: 0
	})
	assert.equal(stateFrom({ co2: 1500 }).carbonDioxideDetected, 1)
	assert.equal(stateFrom({ co2: 900 }, { carbonDioxideAlertThreshold: 800 }).carbonDioxideDetected, 1)
	assert.deepEqual(stateFrom({ pm25: 0.098147 }), { PM2_5Density: 0.098147 })
	assert.equal(stateFrom({ pm25: 20000 }).PM2_5Density, 10000)
})

test('iaq plus other readings yields VOCDensity 0 when tvoc is absent', () => {
	assert.deepEqual(stateFrom({
		iaq: 30,
		co2: 600
	}), {
		VOCDensity: 0,
		airQuality: 1,
		carbonDioxideLevel: 600,
		carbonDioxideDetected: 0
	})
})

test('capabilities mark only temperature, humidity, iaq, co2, pm25 and tvoc as HomeKit supported', () => {
	const { sensor } = makeSensor({}, {
		temperature: 22,
		humidity: 40,
		tvoc: 100,
		co2: 500,
		etoh: 0.1,
		rssi: -50
	})

	assert.deepEqual(sensor.capabilities, {
		temperature: { homeKitSupported: true },
		humidity: { homeKitSupported: true },
		tvoc: { homeKitSupported: true },
		co2: { homeKitSupported: true },
		etoh: { homeKitSupported: false },
		rssi: { homeKitSupported: false }
	})
})

test('updateHomeKit pushes air quality, VOC, PM2.5 and CO2 values to their services', () => {
	const { sensor } = makeSensor({}, {
		tvoc: 300,
		pm25: 12.34,
		co2: 1600
	})
	const aq = sensor.AirQualitySensorService
	const co2 = sensor.CarbonDioxideSensorService

	assert.equal(value(aq, 'AirQuality'), 2)
	assert.equal(value(aq, 'VOCDensity'), 1371)
	// updateValue rounds to one decimal because PM2_5Density minStep is 0.1
	assert.equal(value(aq, 'PM2_5Density'), 12.3)
	assert.equal(value(co2, 'CarbonDioxideDetected'), 1)
	assert.equal(value(co2, 'CarbonDioxideLevel'), 1600)
	assert.equal(sensor.TemperatureSensorService, undefined)
})

test('co2-only devices get no AirQuality service; disableCarbonDioxide removes the CO2 service', () => {
	const co2Only = makeSensor({}, { co2: 500 })

	assert.equal(co2Only.sensor.AirQualitySensorService, undefined)
	assert.ok(co2Only.sensor.CarbonDioxideSensorService)

	const disabled = makeSensor({ disableCarbonDioxide: true }, {
		tvoc: 100,
		co2: 500
	})

	assert.equal(disabled.sensor.CarbonDioxideSensorService, undefined)
	assert.equal(disabled.sensor.accessory.getService(hap.Service.CarbonDioxideSensor), undefined)
	assert.ok(disabled.sensor.AirQualitySensorService)
})

test('getters return state values, with AirQuality defaulting to 0 when unknown', async () => {
	const { sensor } = makeSensor({}, { co2: 700 })

	assert.equal(await homeKitGet(sensor, 'AirQuality'), 0)
	assert.equal(await homeKitGet(sensor, 'CarbonDioxideLevel'), 700)
	assert.equal(await homeKitGet(sensor, 'CarbonDioxideDetected'), 0)
	assert.equal(await homeKitGet(sensor, 'VOCDensity'), undefined)
})
