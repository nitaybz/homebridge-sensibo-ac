import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	acDevice, makeAirConditioner
} from './helpers.js'

test('airConditionerCapabilities maps Sensibo remote modes to HomeKit capabilities', () => {
	const { ac } = makeAirConditioner({}, {})

	assert.deepEqual(ac.capabilities.COOL, {
		homeKitSupported: true,
		temperatures: {
			C: {
				min: 16,
				max: 30
			}
		},
		fanSpeeds: ['low', 'medium', 'high', 'auto'],
		autoFanSpeed: true,
		verticalSwing: true,
		horizontalSwing: true,
		light: true
	})
	assert.equal(ac.capabilities.FAN.homeKitSupported, undefined)
	assert.equal(ac.capabilities.FAN.autoFanSpeed, false)
})

test('airConditionerStateFromDevice converts a Sensibo device to plugin state', () => {
	const { ac } = makeAirConditioner({}, {})
	const state = ac.Utils.airConditionerStateFromDevice(acDevice({ swing: 'rangeFull' }))

	assert.equal(state.active, true)
	assert.equal(state.mode, 'COOL')
	assert.equal(state.targetTemperature, 24)
	assert.equal(state.currentTemperature, 26.5)
	assert.equal(state.light, true)
	assert.equal(state.verticalSwing, 'SWING_ENABLED')
	assert.equal(state.horizontalSwing, 'SWING_DISABLED')
	assert.equal(state.fanSpeed, 67)
})

test('airConditionerStateFromDevice converts a Fahrenheit target to Celsius', () => {
	const { ac } = makeAirConditioner({}, {})
	const state = ac.Utils.airConditionerStateFromDevice(acDevice({
		targetTemperature: 77,
		temperatureUnit: 'F'
	}))

	assert.equal(state.targetTemperature, 25)
})

test('percentToFanLevel maps HomeKit percentages to Sensibo fan levels', () => {
	const { ac } = makeAirConditioner({}, {})
	const levels = ['low', 'medium', 'high', 'auto']

	assert.equal(ac.Utils.percentToFanLevel(0, levels), 'auto')
	assert.equal(ac.Utils.percentToFanLevel(33, levels), 'low')
	assert.equal(ac.Utils.percentToFanLevel(34, levels), 'medium')
	assert.equal(ac.Utils.percentToFanLevel(100, levels), 'high')
	assert.equal(ac.Utils.percentToFanLevel(0, ['low', 'high']), 'low')
})

test('sensiboFormattedSwingModes formats vertical, horizontal and 3D swing', () => {
	const { ac } = makeAirConditioner({}, {})
	const enabled = {
		verticalSwing: 'SWING_ENABLED',
		horizontalSwing: 'SWING_DISABLED'
	}

	assert.deepEqual(ac.Utils.sensiboFormattedSwingModes({
		verticalSwing: true,
		horizontalSwing: true
	}, enabled), {
		swing: 'rangeFull',
		horizontalSwing: 'stopped'
	})
	assert.deepEqual(ac.Utils.sensiboFormattedSwingModes({ threeDimensionalSwing: true }, {
		verticalSwing: 'SWING_ENABLED',
		horizontalSwing: 'SWING_ENABLED'
	}), { swing: 'both' })
})

test('toFahrenheit rounds and toCelsius does not', () => {
	const { ac } = makeAirConditioner({}, {})

	assert.equal(ac.Utils.toFahrenheit(24), 75)
	assert.equal(ac.Utils.toCelsius(77), 25)
})
