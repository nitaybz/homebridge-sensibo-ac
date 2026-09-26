import {
	afterEach, beforeEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import {
	acDevice, makeAirConditioner
} from './helpers.js'

const { CurrentHeaterCoolerState } = hap.Characteristic

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

test('a refresh from Sensibo updates the plugin state', () => {
	const { ac } = makeAirConditioner({}, {})

	ac.state.update(ac.Utils.airConditionerStateFromDevice(acDevice({
		targetTemperature: 20,
		mode: 'heat'
	})))

	assert.equal(ac.state.targetTemperature, 20)
	assert.equal(ac.state.mode, 'HEAT')
})

test('a refresh does not overwrite state while a command is being sent', () => {
	const {
		ac, platform
	} = makeAirConditioner({}, {})

	platform.setProcessing = true
	ac.state.update(ac.Utils.airConditionerStateFromDevice(acDevice({ targetTemperature: 20 })))

	assert.equal(ac.state.targetTemperature, 24)
})

test('a refresh keeps the stored target when Sensibo reports none (FAN mode)', () => {
	const { ac } = makeAirConditioner({}, {})

	ac.state.update(ac.Utils.airConditionerStateFromDevice(acDevice({
		mode: 'fan',
		targetTemperature: undefined
	})))

	assert.equal(ac.state.mode, 'FAN')
	assert.equal(ac.state.targetTemperature, 24)
})

test('sending a command blocks refreshes until 1.5s after the API call', async () => {
	const {
		ac, platform
	} = makeAirConditioner({}, {})

	ac.state.targetTemperature = 22
	assert.equal(platform.setProcessing, true)
	mock.timers.tick(1000)
	await Promise.resolve()
	mock.timers.tick(500)

	assert.equal(platform.setProcessing, false)
})

test('updateHomeKit guesses the AUTO heater-cooler state from the room temperature', () => {
	const currentState = targetTemperature => {
		const { ac } = makeAirConditioner({}, {
			mode: 'auto',
			targetTemperature
		})

		return ac.HeaterCoolerService.getCharacteristic(CurrentHeaterCoolerState).value
	}

	// The room is at 26.5
	assert.equal(currentState(24), CurrentHeaterCoolerState.COOLING)
	assert.equal(currentState(28), CurrentHeaterCoolerState.HEATING)
	assert.equal(currentState(26.5), CurrentHeaterCoolerState.IDLE)
})
