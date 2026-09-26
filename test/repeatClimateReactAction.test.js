import {
	afterEach, beforeEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import refreshState from '../sensibo/refreshState.js'
import {
	acDevice, callsTo, makeAirConditioner, settle
} from './helpers.js'

const NOW = Date.parse('2026-09-01T12:00:00Z')
const SECOND = 1000

beforeEach(() => {
	mock.timers.enable({
		apis: ['setTimeout', 'Date'],
		now: NOW
	})
})

afterEach(() => {
	mock.timers.reset()
})

/**
 * An AC state change event as Sensibo's events API returns it
 * @param {number} time
 * @param {string} reason 'Trigger' (Climate React) or 'UserAPI'
 * @param {Object} resultingAcState
 */
function acEvent(time, reason, resultingAcState) {
	return {
		eventKind: 1000000,
		timestamp: new Date(time).toISOString(),
		details: {
			reason,
			resultingAcState
		}
	}
}

const climateReactResult = {
	on: true,
	mode: 'cool',
	targetTemperature: 20,
	temperatureUnit: 'C',
	fanLevel: 'high',
	swing: 'stopped',
	horizontalSwing: 'stopped',
	light: 'on'
}

/** A device refresh with Climate React enabled (or not) */
function refreshedDevice(climateReactEnabled) {
	return acDevice({}, {
		location: { id: 'loc1' },
		smartMode: { enabled: climateReactEnabled }
	})
}

function makeAc(config) {
	const made = makeAirConditioner({
		enableRepeatClimateReactAction: true,
		refreshDelay: 5 * SECOND,
		pollingInterval: 0,
		syncHomeKitCache: () => {},
		...config
	}, {})

	made.platform.activeAccessories = [made.ac]

	return made
}

/** Run one polling refresh (sensibo/refreshState.js) against the given devices */
async function refreshOnce(platform, devices) {
	platform.sensiboApi.getAllDevices = async () => {
		return devices
	}

	const done = refreshState(platform)

	mock.timers.tick(platform.refreshDelay)
	await settle()
	// release the post-refresh block without running other timers
	Object.assign(platform, { refreshStateProcessing: false })
	await done
}

/**
 * Two refreshes 90s apart; `events(firstRefreshAt)` is what Sensibo reports on the second one
 * @returns {Promise<{ac: Object, calls: Array}>}
 */
async function refreshTwice(config, events, climateReactEnabled) {
	const {
		ac, platform, calls
	} = makeAc(config)

	await refreshOnce(platform, [refreshedDevice(climateReactEnabled)])

	const firstRefreshAt = ac.lastStateRefresh.getTime()

	platform.sensiboApi.setEvents(events(firstRefreshAt))
	mock.timers.tick(85 * SECOND)
	await refreshOnce(platform, [refreshedDevice(climateReactEnabled)])

	return {
		ac,
		calls
	}
}

/** Run the repeat timers and StateHandler's send timers for `seconds` */
async function runFor(seconds) {
	for (let i = 0; i < seconds * 10; i++) {
		mock.timers.tick(100)
		await settle()
	}
}

test('the first refresh only records the time, it does not look at events', async () => {
	const {
		ac, platform, calls
	} = makeAc({})

	await refreshOnce(platform, [refreshedDevice(true)])

	assert.equal(callsTo(calls, 'getDeviceEvents').length, 0)
	assert.equal(ac.lastStateRefresh.getTime(), NOW + 5 * SECOND)
})

test('re-sends the last Climate React result once by default', async () => {
	const {
		ac, calls
	} = await refreshTwice({}, since => {
		return [acEvent(since + 10 * SECOND, 'Trigger', climateReactResult)]
	}, true)

	await runFor(3)

	const sent = callsTo(calls, 'setDeviceACState')

	assert.equal(sent.length, 1)
	assert.equal(sent[0][1].targetTemperature, 20)
	assert.equal(sent[0][1].fanLevel, 'high')
	assert.equal(ac.state.targetTemperature, 20)
	assert.equal(ac.state.smartMode.enabled, true)
})

test('re-sends commandRepeatCount times, commandRepeatDelaySeconds apart', async () => {
	const { calls } = await refreshTwice({
		commandRepeatCount: 3,
		commandRepeatDelayMilliseconds: 5 * SECOND
	}, since => {
		return [acEvent(since + 10 * SECOND, 'Trigger', climateReactResult)]
	}, true)

	await runFor(4)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 1)
	await runFor(5)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 2)
	await runFor(5)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 3)
})

test('with a 1s repeat delay every repeat is sent, 1s apart, despite the 1s debounce', async () => {
	const { calls } = await refreshTwice({
		commandRepeatCount: 3,
		commandRepeatDelayMilliseconds: SECOND
	}, since => {
		return [acEvent(since + 10 * SECOND, 'Trigger', climateReactResult)]
	}, true)

	await runFor(0.5)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 1)
	await runFor(1)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 2)
	await runFor(1)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 3)
})

test('skips when a newer non-Climate React change exists', async () => {
	const { calls } = await refreshTwice({}, since => {
		return [
			acEvent(since + 10 * SECOND, 'Trigger', climateReactResult),
			acEvent(since + 20 * SECOND, 'UserAPI', {
				...climateReactResult,
				on: false
			})
		]
	}, true)

	await runFor(3)

	assert.equal(callsTo(calls, 'setDeviceACState').length, 0)
})

test('skips a Climate React change younger than 45s, and looks at it again next time', async () => {
	const {
		ac, calls
	} = await refreshTwice({}, since => {
		return [acEvent(since + 60 * SECOND, 'Trigger', climateReactResult)]
	}, true)

	await runFor(3)

	assert.equal(callsTo(calls, 'setDeviceACState').length, 0)
	assert.equal(ac.lastStateRefresh.getTime(), NOW + 5 * SECOND + 60 * SECOND)
})

test('skips when Climate React is disabled', async () => {
	const { calls } = await refreshTwice({}, since => {
		return [acEvent(since + 10 * SECOND, 'Trigger', climateReactResult)]
	}, false)

	await runFor(3)

	assert.equal(callsTo(calls, 'getDeviceEvents').length, 0)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 0)
})

test('skips Climate React changes from before the previous refresh', async () => {
	const { calls } = await refreshTwice({}, since => {
		return [acEvent(since - 10 * SECOND, 'Trigger', climateReactResult)]
	}, true)

	await runFor(3)

	assert.equal(callsTo(calls, 'setDeviceACState').length, 0)
})

test('does nothing without enableRepeatClimateReactAction', async () => {
	const { calls } = await refreshTwice({ enableRepeatClimateReactAction: false }, since => {
		return [acEvent(since + 10 * SECOND, 'Trigger', climateReactResult)]
	}, true)

	await runFor(3)

	assert.equal(callsTo(calls, 'getDeviceEvents').length, 0)
	assert.equal(callsTo(calls, 'setDeviceACState').length, 0)
})

test('a failing events request is logged, not thrown, and the refresh still completes', async () => {
	const {
		ac, platform
	} = makeAc({})
	const warnings = []

	platform.log.warn = message => {
		warnings.push(message)
	}
	await refreshOnce(platform, [refreshedDevice(true)])
	platform.sensiboApi.getDeviceEvents = async () => {
		throw { message: 'Request failed with status code 504' }
	}
	mock.timers.tick(85 * SECOND)
	await refreshOnce(platform, [acDevice({ targetTemperature: 21 }, {
		location: { id: 'loc1' },
		smartMode: { enabled: true }
	})])

	assert.equal(ac.state.targetTemperature, 21)
	assert.ok(warnings.some(message => {
		return /refreshing a device failed: Request failed with status code 504/.test(message)
	}), warnings.join('\n'))
})
