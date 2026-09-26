import {
	afterEach, beforeEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import ClimateReactSwitch from '../homekit/ClimateReactSwitch.js'
import {
	homeKitGet, homeKitSet, makeAirConditioner
} from './helpers.js'

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

test('the switch reads Climate React enabled from the AC state', async () => {
	const {
		ac, platform
	} = makeAirConditioner({}, {})
	const crSwitch = new ClimateReactSwitch(ac, platform)

	crSwitch.updateHomeKit()

	assert.equal(await homeKitGet(ac, 'ClimateReactSwitch'), false)
	assert.equal(crSwitch.ClimateReactSwitchService.getCharacteristic(platform.api.hap.Characteristic.On).value, false)
})

test('turning the switch on sends the existing Climate React settings with enabled: true', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	ac.state.smartMode.type = 'temperature'
	ac.state.smartMode.lowTemperatureThreshold = 21
	ac.state.smartMode.lowTemperatureState = {
		on: false,
		mode: 'cool',
		swing: 'stopped'
	}
	await homeKitSet(ac, 'ClimateReactSwitch', true)
	await Promise.resolve()

	assert.equal(calls[0][0], 'setDeviceClimateReactState')
	assert.equal(calls[0][2].enabled, true)
	assert.equal(calls[0][2].lowTemperatureThreshold, 21)
	assert.deepEqual(calls[0][2].lowTemperatureState, {
		on: false,
		mode: 'cool',
		swing: 'stopped'
	})
	assert.equal(calls[0][2].highTemperatureState, null)
})

test('turning the switch does not send an AC command', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'ClimateReactSwitch', true)
	mock.timers.tick(1000)

	assert.deepEqual(calls.map(call => {
		return call[0]
	}), ['setDeviceClimateReactState'])
})
