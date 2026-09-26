import {
	beforeEach, afterEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import AirPurifier from '../homekit/AirPurifier.js'
import {
	fakePlatform, homeKitGet, homeKitSet
} from './helpers.js'

const { Characteristic } = hap

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

/** Let StateHandler's 1s debounce fire and send the state */
function flush() {
	mock.timers.tick(1000)
}

/**
 * A Sensibo Pure device as the API returns it: fan mode, low speed, light on, filter half used
 * @param   {Object}  overrides  top-level device fields to override
 * @returns {Object}             the device
 */
function pureDevice(overrides) {
	return {
		id: 'pure1',
		productModel: 'pure',
		serial: '5678',
		temperatureUnit: 'C',
		room: { name: 'Bedroom' },
		acState: {
			on: true,
			mode: 'fan',
			fanLevel: 'low',
			light: 'on'
		},
		measurements: { pm25: 3 },
		pureBoostConfig: { enabled: false },
		filtersCleaning: {
			shouldCleanFilters: false,
			acOnSecondsSinceLastFiltersClean: 500,
			filtersCleanSecondsThreshold: 1000
		},
		remoteCapabilities: {
			modes: {
				fan: {
					temperatures: {},
					fanLevels: ['low', 'medium', 'high'],
					light: ['on', 'off']
				}
			}
		},
		...overrides
	}
}

/**
 * An AirPurifier accessory built from a Pure device, with the Sensibo API and refreshState recorded
 * @param   {Object}  platformConfig  platform settings to override
 * @param   {Object}  deviceOverrides device fields to override
 * @returns {{pure: AirPurifier, platform: Object, calls: Array, refreshes: Array}}
 */
function makeAirPurifier(platformConfig, deviceOverrides) {
	const refreshes = []
	const platform = fakePlatform({
		refreshState: async () => {
			refreshes.push('refreshState')
		},
		...platformConfig
	})
	const pure = new AirPurifier(pureDevice(deviceOverrides), platform)

	pure.updateHomeKit()
	refreshes.length = 0

	return {
		pure,
		platform,
		calls: platform.sensiboApi.calls,
		refreshes
	}
}

function value(service, characteristic) {
	return service.getCharacteristic(Characteristic[characteristic]).value
}

test('state from a Pure device maps power, mode, fan level, light, boost and filter life', () => {
	const { pure } = makeAirPurifier({}, {})

	assert.deepEqual({ ...pure.cachedState.devices.pure1 }, {
		active: true,
		mode: 'FAN',
		pureBoost: false,
		light: true,
		filterChange: 'FILTER_OK',
		filterLifeLevel: 50,
		horizontalSwing: 'SWING_DISABLED',
		verticalSwing: 'SWING_DISABLED',
		fanSpeed: 33
	})
})

test('state without pureBoostConfig leaves pureBoost undefined, and an overdue filter reads 0% life', () => {
	const { pure } = makeAirPurifier({}, {
		pureBoostConfig: undefined,
		filtersCleaning: {
			shouldCleanFilters: true,
			acOnSecondsSinceLastFiltersClean: 2000,
			filtersCleanSecondsThreshold: 1000
		}
	})

	// FIXME noted in Utils: pureBoost is undefined (not false) when the API omits pureBoostConfig
	assert.equal(pure.state.pureBoost, undefined)
	assert.equal(pure.state.filterChange, 'CHANGE_FILTER')
	assert.equal(pure.state.filterLifeLevel, 0)
})

test('capabilities accept a mode with no temperatures object', () => {
	const platform = fakePlatform({})
	const pure = new AirPurifier(pureDevice({ remoteCapabilities: { modes: { fan: { fanLevels: ['low'] } } } }), platform)

	assert.deepEqual(pure.capabilities, {
		FAN: {
			fanSpeeds: ['low'],
			autoFanSpeed: false
		}
	})
})

test('capabilities for the fan mode keep fan levels and light, and do not mark it HomeKit supported', () => {
	const { pure } = makeAirPurifier({}, {})

	assert.deepEqual(pure.capabilities, {
		FAN: {
			fanSpeeds: ['low', 'medium', 'high'],
			autoFanSpeed: false,
			light: true
		}
	})
})

test('updateHomeKit pushes active, purifying, speed, boost, filter and light values', () => {
	const { pure } = makeAirPurifier({}, {})
	const service = pure.AirPurifierService

	assert.equal(value(service, 'Active'), 1)
	assert.equal(value(service, 'CurrentAirPurifierState'), Characteristic.CurrentAirPurifierState.PURIFYING_AIR)
	assert.equal(value(service, 'RotationSpeed'), 33)
	assert.equal(value(service, 'TargetAirPurifierState'), 0)
	assert.equal(value(service, 'FilterChangeIndication'), Characteristic.FilterChangeIndication.FILTER_OK)
	assert.equal(value(service, 'FilterLifeLevel'), 50)
	assert.equal(value(pure.PureLightSwitchService, 'On'), true)
})

test('an inactive Pure reports INACTIVE and does not push RotationSpeed', () => {
	const { pure } = makeAirPurifier({}, {
		acState: {
			on: false,
			mode: 'fan',
			fanLevel: 'high',
			light: 'off'
		}
	})
	const service = pure.AirPurifierService

	assert.equal(value(service, 'Active'), 0)
	assert.equal(value(service, 'CurrentAirPurifierState'), Characteristic.CurrentAirPurifierState.INACTIVE)
	assert.equal(value(service, 'RotationSpeed'), 0)
})

test('disableLightSwitch skips the light service', () => {
	const { pure } = makeAirPurifier({ disableLightSwitch: true }, {})

	assert.equal(pure.PureLightSwitchService, undefined)
	assert.equal(pure.accessory.getService('Bedroom Pure Light'), undefined)
})

test('setting rotation speed sends the fan-mode AC state after the debounce', async () => {
	const {
		pure, calls
	} = makeAirPurifier({}, {})

	await homeKitSet(pure, 'PureRotationSpeed', 100)
	assert.equal(calls.length, 0)
	flush()

	// Suspicious: the Pure has no targetTemperature/temperatureUnit in state, so undefined keys are sent (dropped by JSON)
	assert.deepEqual(calls, [['setDeviceACState', 'pure1', {
		on: true,
		mode: 'fan',
		targetTemperature: undefined,
		temperatureUnit: undefined,
		fanLevel: 'high',
		light: 'on'
	}]])
})

test('setting rotation speed to 0 turns the Pure off, as does PureActive 0', async () => {
	const first = makeAirPurifier({}, {})

	await homeKitSet(first.pure, 'PureRotationSpeed', 0)
	flush()
	assert.equal(first.calls[0][2].on, false)
	assert.equal(first.calls[0][2].fanLevel, 'low')

	const second = makeAirPurifier({}, {})

	await homeKitSet(second.pure, 'PureActive', 0)
	flush()
	assert.equal(second.calls.length, 1)
	assert.equal(second.calls[0][2].on, false)
})

test('setting the target state toggles Pure Boost immediately and refreshes state', async () => {
	const {
		pure, calls, refreshes
	} = makeAirPurifier({}, {})

	await homeKitSet(pure, 'TargetAirPurifierState', 1)

	assert.deepEqual(calls, [['enableDisablePureBoost', 'pure1', true]])
	assert.ok(refreshes.length > 0)
	assert.equal(await homeKitGet(pure, 'TargetAirPurifierState'), 1)
})

test('resetting the filter calls the API once and stores filterChange as a number', async () => {
	const {
		pure, calls
	} = makeAirPurifier({}, {
		filtersCleaning: {
			shouldCleanFilters: true,
			acOnSecondsSinceLastFiltersClean: 900,
			filtersCleanSecondsThreshold: 1000
		}
	})

	await homeKitSet(pure, 'ResetFilterIndication', 1)
	flush()

	assert.deepEqual(calls, [['resetFilterIndicator', 'pure1']])
	assert.equal(pure.state.filterChange, 0)
	assert.equal(pure.state.filterLifeLevel, 100)

	// Suspicious: filterChange becomes 0 instead of 'FILTER_OK', so the getter maps it to undefined
	assert.equal(await homeKitGet(pure, 'FilterChangeIndication'), undefined)
})
