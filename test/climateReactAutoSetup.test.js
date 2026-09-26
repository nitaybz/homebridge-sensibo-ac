import {
	afterEach, beforeEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import {
	callsTo, homeKitSet, makeAirConditioner, pressMode, settle
} from './helpers.js'

const { TargetHeaterCoolerState } = hap.Characteristic

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

test('COOL: AC turns on above target + 1 and off below target - 1', async () => {
	const { ac } = makeAirConditioner({ enableClimateReactAutoSetup: true }, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)

	const smartMode = ac.state.smartMode

	assert.equal(smartMode.type, 'temperature')
	assert.equal(smartMode.highTemperatureThreshold, 23)
	assert.equal(smartMode.lowTemperatureThreshold, 21)
	assert.equal(smartMode.highTemperatureState.on, true)
	assert.equal(smartMode.lowTemperatureState.on, false)
	assert.equal(smartMode.highTemperatureState.mode, 'cool')
	assert.equal(smartMode.highTemperatureState.targetTemperature, 22)
})

test('HEAT: AC turns off above target + 1 and on below target - 1', async () => {
	const { ac } = makeAirConditioner({ enableClimateReactAutoSetup: true }, {})

	await pressMode(ac, TargetHeaterCoolerState.HEAT)
	await homeKitSet(ac, 'HeatingThresholdTemperature', 20)

	const smartMode = ac.state.smartMode

	assert.equal(smartMode.highTemperatureThreshold, 21)
	assert.equal(smartMode.lowTemperatureThreshold, 19)
	assert.equal(smartMode.highTemperatureState.on, false)
	assert.equal(smartMode.lowTemperatureState.on, true)
	assert.equal(smartMode.lowTemperatureState.mode, 'heat')
})

test('offset shifts both thresholds and the multipliers widen each side independently', async () => {
	const { ac } = makeAirConditioner({
		enableClimateReactAutoSetup: true,
		climateReactAutoSetupOffset: 0.5,
		positiveClimateReactAutoSetupMultiplier: 2,
		negativeClimateReactAutoSetupMultiplier: 3
	}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)

	assert.equal(ac.state.smartMode.highTemperatureThreshold, 24.5)
	assert.equal(ac.state.smartMode.lowTemperatureThreshold, 19.5)
})

test('Fahrenheit units scale each multiplier step by 1.8', async () => {
	const { ac } = makeAirConditioner({ enableClimateReactAutoSetup: true }, {
		temperatureUnit: 'F',
		targetTemperature: 75
	}, { temperatureUnit: 'F' })

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)

	const smartMode = ac.state.smartMode

	assert.ok(Math.abs(smartMode.highTemperatureThreshold - 23.8) < 1e-9)
	assert.ok(Math.abs(smartMode.lowTemperatureThreshold - 20.2) < 1e-9)
	assert.equal(smartMode.highTemperatureState.temperatureUnit, 'F')
	assert.equal(smartMode.highTemperatureState.targetTemperature, 72)
})

test('the existing enabled flag is kept', async () => {
	const { ac } = makeAirConditioner({ enableClimateReactAutoSetup: true }, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)

	assert.equal(ac.state.smartMode.enabled, false)
})

test('Climate React is not touched when enableClimateReactAutoSetup is off', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await settle()

	assert.deepEqual(ac.state.smartMode, { enabled: false })
	assert.equal(callsTo(calls, 'setDeviceClimateReactState').length, 0)
})

test('every Climate React update is sent, with or without allowRepeatedCommands', async () => {
	for (const allowRepeatedCommands of [false, true]) {
		const {
			ac, calls
		} = makeAirConditioner({
			enableClimateReactAutoSetup: true,
			allowRepeatedCommands
		}, {})

		// the second update comes while the first one is still being sent
		await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
		await homeKitSet(ac, 'CoolingThresholdTemperature', 20)
		await settle()

		const sent = callsTo(calls, 'setDeviceClimateReactState')

		assert.deepEqual(sent.map(call => {
			return call[1].highTemperatureThreshold
		}), [23, 21], `allowRepeatedCommands: ${allowRepeatedCommands}`)
		assert.equal(sent[1][1].highTemperatureState.mode, 'cool')
		assert.equal(sent[1][1].highTemperatureState.fanLevel, 'medium')
	}
})

test('the Climate React switch sends the new enabled flag each time it is toggled', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'ClimateReactSwitch', true)
	await homeKitSet(ac, 'ClimateReactSwitch', false)
	await settle()

	assert.deepEqual(callsTo(calls, 'setDeviceClimateReactState').map(call => {
		return call[1].enabled
	}), [true, false])
})
