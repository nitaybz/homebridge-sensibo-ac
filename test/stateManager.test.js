import {
	beforeEach, afterEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import AirConditioner from '../homekit/AirConditioner.js'
import {
	acDevice, fakePlatform, homeKitGet, homeKitSet, makeAirConditioner
} from './helpers.js'

const {
	CurrentHeaterCoolerState, TargetHeaterCoolerState, SwingMode
} = hap.Characteristic

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

/** Let StateHandler's 1s debounce fire and send the AC state */
function flush() {
	mock.timers.tick(1000)
}

test('setting a cooling threshold sends the full AC state once, after the debounce', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	assert.equal(calls.length, 0)
	flush()

	assert.deepEqual(calls, [['setDeviceACState', 'pod1', {
		on: true,
		mode: 'cool',
		targetTemperature: 22,
		temperatureUnit: 'C',
		swing: 'stopped',
		horizontalSwing: 'stopped',
		fanLevel: 'medium',
		light: 'on'
	}]])
})

test('changes within the debounce window are merged into one command', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await homeKitSet(ac, 'ACRotationSpeed', 100)
	flush()

	assert.equal(calls.length, 1)
	assert.equal(calls[0][2].targetTemperature, 22)
	assert.equal(calls[0][2].fanLevel, 'high')
})

test('setting a value equal to the current one sends nothing', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	ac.state.targetTemperature = 24
	flush()

	assert.equal(calls.length, 0)
})

test('allowRepeatedCommands sends a value equal to the current one', async () => {
	const {
		ac, calls
	} = makeAirConditioner({ allowRepeatedCommands: true }, {})

	ac.state.targetTemperature = 24
	flush()

	assert.equal(calls.length, 1)
})

test('turning the HeaterCooler off sends on: false', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'ACActive', 0)
	flush()

	assert.equal(calls[0][2].on, false)
})

test('changing vertical swing while off turns the AC on', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, { on: false })

	await homeKitSet(ac, 'ACSwing', SwingMode.SWING_ENABLED)
	flush()

	assert.equal(calls[0][2].on, true)
	assert.equal(calls[0][2].swing, 'rangeFull')
})

test('selecting HEAT sends mode heat and turns the AC on', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, { on: false })

	await homeKitSet(ac, 'TargetHeaterCoolerState', TargetHeaterCoolerState.HEAT)
	flush()

	assert.equal(calls[0][2].mode, 'heat')
	assert.equal(calls[0][2].on, true)
})

test('Climate React is not touched when enableClimateReactAutoSetup is off', async () => {
	const {
		ac, calls
	} = makeAirConditioner({}, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	flush()

	assert.deepEqual(calls.map(call => {
		return call[0]
	}), ['setDeviceACState'])
})

test('Climate React auto setup in COOL: on above target + 1, off below target - 1', async () => {
	const {
		ac, calls
	} = makeAirConditioner({ enableClimateReactAutoSetup: true }, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await Promise.resolve()

	const climateReact = calls.find(call => {
		return call[0] === 'setDeviceClimateReactState'
	})[2]

	assert.equal(climateReact.type, 'temperature')
	assert.equal(climateReact.highTemperatureThreshold, 23)
	assert.equal(climateReact.lowTemperatureThreshold, 21)
	assert.equal(climateReact.highTemperatureState.on, true)
	assert.equal(climateReact.lowTemperatureState.on, false)
	assert.equal(climateReact.highTemperatureState.mode, 'cool')
	assert.equal(climateReact.highTemperatureState.targetTemperature, 22)
	assert.equal(climateReact.highTemperatureState.fanLevel, 'medium')
})

test('Climate React auto setup in HEAT: off above target + 1, on below target - 1', async () => {
	const {
		ac, calls
	} = makeAirConditioner({ enableClimateReactAutoSetup: true }, { mode: 'heat' })

	await homeKitSet(ac, 'HeatingThresholdTemperature', 22)
	await Promise.resolve()

	const climateReact = calls.find(call => {
		return call[0] === 'setDeviceClimateReactState'
	})[2]

	assert.equal(climateReact.highTemperatureState.on, false)
	assert.equal(climateReact.lowTemperatureState.on, true)
	assert.equal(climateReact.lowTemperatureState.mode, 'heat')
})

test('Climate React auto setup sends the target temperature in Fahrenheit on a Fahrenheit device', async () => {
	const device = acDevice({
		targetTemperature: 75,
		temperatureUnit: 'F'
	})

	device.temperatureUnit = 'F'

	for (const mode of Object.values(device.remoteCapabilities.modes)) {
		if (mode.temperatures.C) {
			mode.temperatures = {
				F: {
					isNative: true,
					values: [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86]
				}
			}
		}
	}

	const platform = fakePlatform({ enableClimateReactAutoSetup: true })
	const ac = new AirConditioner(device, platform)

	ac.updateHomeKit()

	// HomeKit always sets Celsius; 24C is 75F
	await homeKitSet(ac, 'CoolingThresholdTemperature', 24)
	await Promise.resolve()

	const climateReact = platform.sensiboApi.calls.find(call => {
		return call[0] === 'setDeviceClimateReactState'
	})[2]

	assert.equal(climateReact.highTemperatureState.temperatureUnit, 'F')
	assert.equal(climateReact.highTemperatureState.targetTemperature, 75)
	assert.equal(climateReact.lowTemperatureState.targetTemperature, 75)
})

test('Climate React auto setup keeps the existing enabled flag', async () => {
	const {
		ac, calls
	} = makeAirConditioner({ enableClimateReactAutoSetup: true }, {})

	await homeKitSet(ac, 'CoolingThresholdTemperature', 22)
	await Promise.resolve()

	const climateReact = calls.find(call => {
		return call[0] === 'setDeviceClimateReactState'
	})[2]

	assert.equal(climateReact.enabled, false)
})

test('CurrentHeaterCoolerState follows the mode, and guesses from temperature in AUTO', async () => {
	const cooling = makeAirConditioner({}, {}).ac
	const off = makeAirConditioner({}, { on: false }).ac
	const autoWarm = makeAirConditioner({}, {
		mode: 'auto',
		targetTemperature: 24
	}).ac
	const autoCool = makeAirConditioner({}, {
		mode: 'auto',
		targetTemperature: 28
	}).ac
	const autoAtTarget = makeAirConditioner({}, {
		mode: 'auto',
		targetTemperature: 26.5
	}).ac

	assert.equal(await homeKitGet(cooling, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.COOLING)
	assert.equal(await homeKitGet(off, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.INACTIVE)
	assert.equal(await homeKitGet(autoWarm, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.COOLING)
	assert.equal(await homeKitGet(autoCool, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.HEATING)
	// At the target the unit is holding temperature, neither heating nor cooling
	assert.equal(await homeKitGet(autoAtTarget, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.IDLE)
})

test('both thresholds read the single Sensibo target temperature', async () => {
	const { ac } = makeAirConditioner({}, {})

	assert.equal(await homeKitGet(ac, 'CoolingThresholdTemperature'), 24)
	assert.equal(await homeKitGet(ac, 'HeatingThresholdTemperature'), 24)
})

test('CurrentHeaterCoolerState is INACTIVE in FAN and DRY', async () => {
	for (const mode of ['fan', 'dry']) {
		const { ac } = makeAirConditioner({}, { mode })

		assert.equal(await homeKitGet(ac, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.INACTIVE)
	}
})

test('a cooling-only unit in AUTO below the target is IDLE, never HEATING', async () => {
	const modes = { ...acDevice({}).remoteCapabilities.modes }

	delete modes.heat

	const { ac } = makeAirConditioner({}, { mode: 'auto' }, {
		measurements: {
			temperature: 20,
			humidity: 50
		},
		remoteCapabilities: { modes }
	})

	assert.equal(await homeKitGet(ac, 'CurrentHeaterCoolerState'), CurrentHeaterCoolerState.IDLE)
	assert.equal(ac.HeaterCoolerService.getCharacteristic(CurrentHeaterCoolerState).value, CurrentHeaterCoolerState.IDLE)
})
