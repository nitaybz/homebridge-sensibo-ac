import {
	afterEach, beforeEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import refreshState from '../sensibo/refreshState.js'
import {
	acDevice, callsTo, homeKitSet, makeAirConditioner, pressMode, settle
} from './helpers.js'

const {
	CoolingThresholdTemperature, TargetHeaterCoolerState
} = hap.Characteristic

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

/** Let StateHandler's 1s debounce send, then release setProcessing */
async function flush() {
	mock.timers.tick(1000)
	await settle()
	mock.timers.tick(500)
	await settle()
}

/** Run one polling refresh against the given device */
async function refreshOnce(ac, platform, device) {
	Object.assign(platform, {
		activeAccessories: [ac],
		syncHomeKitCache: () => {},
		refreshDelay: 5000,
		pollingInterval: 0
	})
	platform.sensiboApi.getAllDevices = async () => {
		return [{
			location: { id: 'loc1' },
			...device
		}]
	}

	const done = refreshState(platform)

	mock.timers.tick(5000)
	await settle()
	await done
}

test('COOL sends the lowest supported temperature instead of the target', async () => {
	const {
		ac, calls
	} = makeAirConditioner({ brokenThermostat: true }, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await flush()

	const sent = callsTo(calls, 'setDeviceACState')

	assert.equal(sent.length, 1)
	assert.equal(sent[0][1].mode, 'cool')
	assert.equal(sent[0][1].targetTemperature, 16)
	assert.equal(ac.state.targetTemperature, 22)
})

test('HEAT sends the highest supported temperature instead of the target', async () => {
	const {
		ac, calls
	} = makeAirConditioner({ brokenThermostat: true }, {})

	await pressMode(ac, TargetHeaterCoolerState.HEAT)
	await homeKitSet(ac, 'HeatingThresholdTemperature', 21)
	await flush()

	const sent = callsTo(calls, 'setDeviceACState')

	assert.equal(sent.at(-1)[1].mode, 'heat')
	assert.equal(sent.at(-1)[1].targetTemperature, 30)
})

test('a Fahrenheit AC gets the forced temperature converted to F', async () => {
	const fahrenheit = {
		isNative: true,
		values: [61, 70, 86]
	}
	const {
		ac, calls
	} = makeAirConditioner({ brokenThermostat: true }, {
		temperatureUnit: 'F',
		targetTemperature: 75
	}, {
		temperatureUnit: 'F',
		remoteCapabilities: {
			modes: {
				cool: { temperatures: { F: fahrenheit } },
				heat: { temperatures: { F: fahrenheit } }
			}
		}
	})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await flush()

	assert.equal(callsTo(calls, 'setDeviceACState')[0][1].targetTemperature, 61)
})

test('without brokenThermostat the target is sent as is', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await flush()

	assert.equal(callsTo(calls, 'setDeviceACState')[0][1].targetTemperature, 22)
})

test('brokenThermostatTemperature: C range, F-only range, and 16/30 fallbacks', () => {
	const { ac } = makeAirConditioner({}, {})
	const withTemperatures = temperatures => {
		ac.capabilities = {
			COOL: { temperatures },
			HEAT: { temperatures }
		}
	}

	withTemperatures({
		C: {
			min: 17,
			max: 31
		}
	})
	assert.equal(ac.Utils.brokenThermostatTemperature('COOL'), 17)
	assert.equal(ac.Utils.brokenThermostatTemperature('HEAT'), 31)
	withTemperatures({
		F: {
			min: 61,
			max: 86
		}
	})
	assert.ok(Math.abs(ac.Utils.brokenThermostatTemperature('COOL') - 16.111) < 0.001)
	assert.equal(ac.Utils.brokenThermostatTemperature('HEAT'), 30)
	ac.capabilities = {}
	assert.equal(ac.Utils.brokenThermostatTemperature('COOL'), 16)
	assert.equal(ac.Utils.brokenThermostatTemperature('HEAT'), 30)
})

test('Climate React states use the forced temperature, thresholds use the user target', async () => {
	const { ac } = makeAirConditioner({
		brokenThermostat: true,
		enableClimateReactAutoSetup: true
	}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)

	const smartMode = ac.state.smartMode

	assert.equal(smartMode.highTemperatureThreshold, 23)
	assert.equal(smartMode.lowTemperatureThreshold, 21)
	assert.equal(smartMode.highTemperatureState.targetTemperature, 16)
	assert.equal(smartMode.lowTemperatureState.targetTemperature, 16)
})

test('a refresh echoing the forced temperature does not overwrite the stored target', async () => {
	const {
		ac, platform
	} = makeAirConditioner({ brokenThermostat: true }, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await flush()
	await refreshOnce(ac, platform, acDevice({ targetTemperature: 16 }))

	assert.equal(ac.state.targetTemperature, 22)
	assert.equal(ac.HeaterCoolerService.getCharacteristic(CoolingThresholdTemperature).value, 22)
})

test('without brokenThermostat a refresh does overwrite the target', async () => {
	const {
		ac, platform
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await flush()
	await refreshOnce(ac, platform, acDevice({ targetTemperature: 16 }))

	assert.equal(ac.state.targetTemperature, 16)
})

test('on a cold start (no stored target) the echoed temperature is accepted', async () => {
	const {
		ac, platform
	} = makeAirConditioner({ brokenThermostat: true }, { targetTemperature: null })

	await refreshOnce(ac, platform, acDevice({ targetTemperature: 16 }))

	assert.equal(ac.state.targetTemperature, 16)
})
