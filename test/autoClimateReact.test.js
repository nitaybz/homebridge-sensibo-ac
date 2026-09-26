import {
	afterEach, beforeEach, describe, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import {
	driftSlope, historicalDriftSlope, nextDirection
} from '../homekit/AutoClimateReact.js'
import {
	callsTo, homeKitGet, homeKitSet, makeAirConditioner, pressMode, settle
} from './helpers.js'

const {
	Active, CurrentHeaterCoolerState, TargetHeaterCoolerState
} = hap.Characteristic
const MINUTE = 60 * 1000
const NOW = Date.parse('2026-09-01T12:00:00Z')

beforeEach(() => {
	mock.timers.enable({
		apis: ['setTimeout', 'Date'],
		now: NOW
	})
})

afterEach(() => {
	mock.timers.reset()
})

/** Let StateHandler's 1s debounce send the command, then its 0.5s timer release setProcessing and update HomeKit */
async function flushCommands() {
	mock.timers.tick(1000)
	await settle()
	mock.timers.tick(500)
	await settle()
}

/**
 * One sample per 90s from `from` to `to` (epoch ms), temperature changing at `perHour` °C/h from `start`
 * @returns {{time: number, value: number}[]}
 */
function samples(from, to, start, perHour) {
	const result = []

	for (let time = from; time <= to; time += 90 * 1000) {
		result.push({
			time,
			value: start + (time - from) / (60 * MINUTE) * perHour
		})
	}

	return result
}

/**
 * An AC state change event as Sensibo's events API returns it
 * @param {number} time
 * @param {boolean} on
 */
function acEvent(time, on) {
	return {
		eventKind: 1000000,
		timestamp: new Date(time).toISOString(),
		details: {
			reason: 'UserAPI',
			resultingAcState: { on }
		}
	}
}

/** @param {{time: number, value: number}[]} list */
function asMeasurements(list) {
	return list.map(sample => {
		return {
			time: new Date(sample.time).toISOString(),
			value: sample.value
		}
	})
}

describe('nextDirection', () => {
	test('with no direction yet, the drift alone decides, beyond 0.4°C/h', () => {
		assert.equal(nextDirection(null, 24, 0.5, 22, 24), 'COOL')
		assert.equal(nextDirection(null, 24, -0.5, 22, 24), 'HEAT')
		assert.equal(nextDirection(null, 24, 0.3, 22, 24), null)
		assert.equal(nextDirection(null, 24, -0.4, 22, 24), null)
	})

	test('an unknown slope keeps the current direction', () => {
		assert.equal(nextDirection('COOL', 10, null, 22, 24), 'COOL')
		assert.equal(nextDirection(null, 10, null, 22, 24), null)
	})

	test('the direction is sticky: COOL at 23 rising stays COOL', () => {
		assert.equal(nextDirection('COOL', 23, 1, 22, 24), 'COOL')
	})

	test('COOL flips to HEAT only when falling AND below heat-to', () => {
		assert.equal(nextDirection('COOL', 23, -1, 22, 24), 'COOL')
		assert.equal(nextDirection('COOL', 21, 0.1, 22, 24), 'COOL')
		assert.equal(nextDirection('COOL', 21, -1, 22, 24), 'HEAT')
	})

	test('HEAT flips to COOL only when rising AND above cool-to', () => {
		assert.equal(nextDirection('HEAT', 23, 1, 22, 24), 'HEAT')
		assert.equal(nextDirection('HEAT', 25, -1, 22, 24), 'HEAT')
		assert.equal(nextDirection('HEAT', 25, 1, 22, 24), 'COOL')
	})
})

describe('driftSlope', () => {
	test('measures the slope in °C per hour', () => {
		const off = NOW - 60 * MINUTE

		assert.ok(Math.abs(driftSlope(samples(off, NOW, 20, 2), off, NOW) - 2) < 1e-9)
	})

	test('needs 5 minutes of settling plus a full 30-minute window', () => {
		const list = samples(NOW - 40 * MINUTE, NOW, 20, 1)

		assert.equal(driftSlope(list, NOW - 34 * MINUTE, NOW), null)
		assert.notEqual(driftSlope(list, NOW - 36 * MINUTE, NOW), null)
	})

	test('only the trailing 30 minutes count', () => {
		const off = NOW - 60 * MINUTE
		const list = [...samples(off, NOW - 31 * MINUTE, 30, -10), ...samples(NOW - 30 * MINUTE, NOW, 20, 1)]

		assert.ok(Math.abs(driftSlope(list, off, NOW) - 1) < 1e-9)
	})

	test('fewer than 3 samples in the window gives null', () => {
		const off = NOW - 60 * MINUTE
		const two = [{
			time: NOW - 10 * MINUTE,
			value: 20
		}, {
			time: NOW,
			value: 21
		}]

		assert.equal(driftSlope(two, off, NOW), null)
	})
})

describe('historicalDriftSlope', () => {
	test('uses the ongoing AC-off period up to now', () => {
		const off = NOW - 60 * MINUTE
		const events = [acEvent(off - 60 * MINUTE, true), acEvent(off, false)]
		const slope = historicalDriftSlope(events, asMeasurements(samples(off - 60 * MINUTE, NOW, 20, 1.5)), NOW)

		assert.ok(Math.abs(slope - 1.5) < 1e-9)
	})

	test('falls back to an earlier, long enough off period when the latest is too short', () => {
		const events = [
			acEvent(NOW - 120 * MINUTE, false),
			acEvent(NOW - 70 * MINUTE, true),
			acEvent(NOW - 10 * MINUTE, false)
		]
		const list = [...samples(NOW - 120 * MINUTE, NOW - 70 * MINUTE, 25, -2), ...samples(NOW - 69 * MINUTE, NOW, 20, 3)]
		const slope = historicalDriftSlope(events, asMeasurements(list), NOW)

		assert.ok(Math.abs(slope + 2) < 1e-9)
	})

	test('null when the AC never sat off long enough', () => {
		const events = [acEvent(NOW - 20 * MINUTE, false)]

		assert.equal(historicalDriftSlope(events, asMeasurements(samples(NOW - 60 * MINUTE, NOW, 20, 1)), NOW), null)
	})

	test('ignores events that are not AC state changes', () => {
		const off = NOW - 60 * MINUTE
		const events = [{
			...acEvent(off, false),
			eventKind: 1032000
		}]

		assert.equal(historicalDriftSlope(events, asMeasurements(samples(off, NOW, 20, 1)), NOW), null)
	})
})

describe('climateReactAsAuto integration', () => {
	/** An AC in Climate React as auto, whose Sensibo history shows the room drifting `perHour` with the AC off */
	function autoAc(perHour, acState) {
		const made = makeAirConditioner({ climateReactAsAuto: true }, acState)
		const off = NOW - 60 * MINUTE

		made.platform.sensiboApi.setEvents([acEvent(off, false)])
		made.platform.sensiboApi.setHistory({ temperature: asMeasurements(samples(off, NOW, 24, perHour)) })

		return made
	}

	test('AUTO is offered even though the AC\'s own auto mode is hidden', () => {
		const { ac } = makeAirConditioner({ climateReactAsAuto: true }, {})
		const validValues = ac.HeaterCoolerService.getCharacteristic(TargetHeaterCoolerState).props.validValues

		assert.deepEqual([...validValues].sort(), [TargetHeaterCoolerState.AUTO, TargetHeaterCoolerState.HEAT, TargetHeaterCoolerState.COOL].sort())
	})

	test('AUTO is not offered without both COOL and HEAT', () => {
		const { ac } = makeAirConditioner({
			climateReactAsAuto: true,
			modesToExclude: ['HEAT']
		}, {})

		assert.deepEqual(ac.HeaterCoolerService.getCharacteristic(TargetHeaterCoolerState).props.validValues, [TargetHeaterCoolerState.COOL])
	})

	test('entering AUTO with no usable history keeps the AC off and Climate React disabled', async () => {
		const {
			ac, calls
		} = autoAc(0, {})

		await pressMode(ac, TargetHeaterCoolerState.AUTO)
		await settle()
		await flushCommands()

		assert.equal(ac.autoClimateReact.state.auto, true)
		assert.equal(ac.autoClimateReact.state.direction, null)
		assert.equal(ac.state.active, false)
		assert.equal(ac.state.smartMode.enabled, false)
		assert.deepEqual(callsTo(calls, 'setDeviceACState').map(call => {
			return call[1].on
		}), [false])
		assert.equal(await homeKitGet(ac, 'TargetHeaterCoolerState'), TargetHeaterCoolerState.AUTO)
	})

	test('AUTO with a rising room picks COOL: Climate React bands around cool-to, AC started when already too warm', async () => {
		const {
			ac, calls
		} = autoAc(1, {})

		await pressMode(ac, TargetHeaterCoolerState.AUTO)
		await settle()
		await flushCommands()

		const smartMode = ac.state.smartMode

		assert.equal(ac.autoClimateReact.state.direction, 'COOL')
		assert.equal(ac.state.mode, 'COOL')
		assert.equal(ac.state.targetTemperature, 24)
		assert.equal(smartMode.enabled, true)
		assert.equal(smartMode.highTemperatureThreshold, 25)
		assert.equal(smartMode.lowTemperatureThreshold, 23)
		assert.equal(smartMode.highTemperatureState.on, true)
		assert.equal(ac.state.active, true)

		for (const call of callsTo(calls, 'setDeviceACState')) {
			assert.notEqual(call[1].mode, 'auto')
		}
	})

	test('AUTO with a falling room picks HEAT around heat-to', async () => {
		const { ac } = autoAc(-1, {})

		await pressMode(ac, TargetHeaterCoolerState.AUTO)
		await settle()
		await flushCommands()

		const smartMode = ac.state.smartMode

		assert.equal(ac.autoClimateReact.state.direction, 'HEAT')
		assert.equal(ac.state.targetTemperature, 22.5)
		assert.equal(smartMode.enabled, true)
		assert.equal(smartMode.highTemperatureThreshold, 23.5)
		assert.equal(smartMode.lowTemperatureThreshold, 21.5)
		assert.equal(smartMode.lowTemperatureState.on, true)
		// the room (26.5) is above the heat band, so the AC is not started
		assert.equal(ac.state.active, false)
	})

	test('cool-to and heat-to keep the minimum gap (band + 0.5) apart', () => {
		const { ac } = makeAirConditioner({ climateReactAsAuto: true }, {})
		const auto = ac.autoClimateReact

		assert.equal(auto.minimumGap, 1.5)
		auto.setCoolTo(22)
		assert.equal(auto.state.heatTo, 20.5)
		auto.setHeatTo(23)
		assert.equal(auto.state.coolTo, 24.5)
		auto.setHeatTo(20)
		assert.equal(auto.state.coolTo, 24.5)
	})

	test('the minimum gap follows the multipliers and offset', () => {
		const { ac } = makeAirConditioner({
			climateReactAsAuto: true,
			positiveClimateReactAutoSetupMultiplier: 2,
			negativeClimateReactAutoSetupMultiplier: 1,
			climateReactAutoSetupOffset: 0.5
		}, {})

		assert.equal(ac.autoClimateReact.minimumGap, 3)
	})

	test('setting thresholds in AUTO moves the setpoints without touching the AC target directly', async () => {
		const { ac } = autoAc(1, {})

		await pressMode(ac, TargetHeaterCoolerState.AUTO)
		await settle()
		await homeKitSet(ac, 'CoolingThresholdTemperature', 23)
		await settle()

		assert.equal(ac.autoClimateReact.state.coolTo, 23)
		assert.equal(ac.autoClimateReact.state.heatTo, 21.5)
		assert.equal(ac.state.targetTemperature, 23)
		assert.equal(await homeKitGet(ac, 'HeatingThresholdTemperature'), 21.5)
	})

	test('manual COOL/HEAT pin the direction and run through Climate React', async () => {
		const { ac } = makeAirConditioner({ climateReactAsAuto: true }, {})

		await pressMode(ac, TargetHeaterCoolerState.HEAT)

		assert.equal(ac.autoClimateReact.state.auto, false)
		assert.equal(ac.autoClimateReact.state.direction, 'HEAT')
		assert.equal(ac.state.mode, 'HEAT')
		assert.equal(ac.state.smartMode.enabled, true)
		assert.equal(ac.state.smartMode.lowTemperatureState.on, true)
	})

	test('FAN and DRY take the AC out of Climate React', async () => {
		for (const [characteristic, mode] of [['FanActive', 'FAN'], ['DryActive', 'DRY']]) {
			const { ac } = makeAirConditioner({ climateReactAsAuto: true }, {})

			await pressMode(ac, TargetHeaterCoolerState.COOL)
			assert.equal(ac.state.smartMode.enabled, true)
			await homeKitSet(ac, characteristic, 1)

			assert.equal(ac.state.mode, mode)
			assert.equal(ac.autoClimateReact.state.active, false)
			assert.equal(ac.state.smartMode.enabled, false)
		}
	})

	test('onRefresh flips COOL to HEAT once the AC-off room keeps falling below heat-to', async () => {
		const {
			ac, platform
		} = makeAirConditioner({ climateReactAsAuto: true }, { on: false })
		const auto = ac.autoClimateReact
		const raw = platform.cachedState.devices.pod1

		Object.assign(auto.state, {
			active: true,
			auto: true,
			direction: 'COOL'
		})

		let temperature = 22.4

		// one refresh every 90s for 34.5 minutes: not enough settled drift yet
		for (let i = 0; i < 24; i++) {
			raw.currentTemperature = temperature
			auto.onRefresh()
			temperature -= 0.05
			mock.timers.tick(90 * 1000)
		}

		assert.equal(auto.state.direction, 'COOL')

		for (let i = 0; i < 2; i++) {
			raw.currentTemperature = temperature
			auto.onRefresh()
			temperature -= 0.05
			mock.timers.tick(90 * 1000)
		}

		assert.equal(auto.state.direction, 'HEAT')
		assert.equal(ac.state.mode, 'HEAT')
		assert.equal(ac.state.targetTemperature, auto.state.heatTo)
	})

	test('onRefresh does nothing while the AC is running', () => {
		const { ac } = makeAirConditioner({ climateReactAsAuto: true }, {})
		const auto = ac.autoClimateReact

		Object.assign(auto.state, {
			active: true,
			auto: true,
			direction: 'COOL'
		})

		for (let i = 0; i < 30; i++) {
			auto.onRefresh()
			mock.timers.tick(90 * 1000)
		}

		assert.equal(auto.offSince, null)
		assert.equal(auto.state.direction, 'COOL')
	})
})

describe('climateReactAsAuto in v3', () => {
	test('IDLE, with the HeaterCooler still on, while Climate React as auto holds the AC off', async () => {
		const { ac } = makeAirConditioner({ climateReactAsAuto: true }, {})

		await pressMode(ac, TargetHeaterCoolerState.AUTO)
		await settle()
		await flushCommands()

		assert.equal(ac.state.active, false)
		assert.equal(await homeKitGet(ac, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.IDLE)
		assert.equal(await homeKitGet(ac, 'ACActive'), 1)
		assert.equal(ac.HeaterCoolerService.getCharacteristic(Active).value, 1)
		assert.equal(ac.HeaterCoolerService.getCharacteristic(CurrentHeaterCoolerState).value, CurrentHeaterCoolerState.IDLE)
	})

	test('horizontal swing does not start an AC that Climate React as auto holds off', async () => {
		const { ac } = makeAirConditioner({ climateReactAsAuto: true }, {})

		await pressMode(ac, TargetHeaterCoolerState.AUTO)
		await settle()
		await flushCommands()
		await homeKitSet(ac, 'HorizontalSwing', true)
		await flushCommands()

		assert.equal(ac.state.horizontalSwing, 'SWING_ENABLED')
		assert.equal(ac.state.active, false)
	})

	test('horizontal swing still switches a plain AC on, as before', async () => {
		const { ac } = makeAirConditioner({}, { on: false })

		await homeKitSet(ac, 'HorizontalSwing', true)

		assert.equal(ac.state.active, true)
	})

	test('the direction and setpoints are saved with the cached state and restored after a restart', async () => {
		const saved = {}
		const storage = {
			setItem: async (key, value) => {
				saved[key] = JSON.parse(JSON.stringify(value))
			}
		}
		const first = makeAirConditioner({
			climateReactAsAuto: true,
			storage
		}, {})

		await pressMode(first.ac, TargetHeaterCoolerState.HEAT)
		first.ac.autoClimateReact.setHeatTo(20)
		await settle()

		assert.equal(saved.state.autoClimateReact.pod1.direction, 'HEAT')

		// a restart reads the cached state back from storage (index.js getItem('state'))
		const second = makeAirConditioner({
			climateReactAsAuto: true,
			cachedState: saved.state
		}, {})

		assert.deepEqual(second.ac.autoClimateReact.state, {
			active: true,
			auto: false,
			direction: 'HEAT',
			coolTo: 24,
			heatTo: 20
		})
	})

	test('a refresh skipped while a command is pending does not feed the drift', async () => {
		const { default: refreshState } = await import('../sensibo/refreshState.js')
		const {
			ac, platform
		} = makeAirConditioner({
			climateReactAsAuto: true,
			syncHomeKitCache: () => {},
			refreshDelay: 5000,
			pollingInterval: 0
		}, { on: false })
		let getAllDevicesCalls = 0

		platform.activeAccessories = [ac]
		platform.sensiboApi.getAllDevices = async () => {
			getAllDevicesCalls++

			return [{
				...(await import('./helpers.js')).acDevice({ on: false }),
				location: { id: 'loc1' }
			}]
		}

		const done = refreshState(platform)

		// a command starts while the devices are being fetched: the results are discarded
		platform.setProcessing = true
		mock.timers.tick(5000)
		await settle()
		await done

		assert.equal(getAllDevicesCalls, 1)
		assert.equal(ac.autoClimateReact.offSince, null)
		assert.deepEqual(ac.autoClimateReact.samples, [])
	})
})
