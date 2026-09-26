import {
	afterEach, beforeEach, mock, test
} from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import SyncButton from '../homekit/SyncButton.js'
import {
	homeKitGet, makeAirConditioner
} from './helpers.js'

const { On } = hap.Characteristic

beforeEach(() => {
	mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
	mock.timers.reset()
})

/** Let pending promise callbacks (syncState's await) run */
async function settle() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve()
	}
}

/**
 * A SyncButton accessory for an AC that is on
 * @returns {{ac: Object, button: SyncButton, calls: Array}}
 */
function makeSyncButton() {
	const {
		ac, platform, calls
	} = makeAirConditioner({}, {})

	return {
		ac,
		button: new SyncButton(ac, platform),
		calls
	}
}

test('the sync button derives its identity from the AC and shares its state', () => {
	const {
		ac, button
	} = makeSyncButton()

	assert.equal(button.name, 'Study AC Sync')
	assert.equal(button.model, 'skyv2_sync')
	assert.equal(button.serial, '1234_sync')
	assert.equal(button.UUID, hap.uuid.generate('pod1_sync'))
	assert.equal(button.accessory.context.type, 'SyncButton')
	assert.equal(button.state, ac.state)
})

test('the sync button always reads as off', async () => {
	const { ac } = makeSyncButton()

	assert.equal(await homeKitGet(ac, 'SyncButton'), false)
})

test('pressing the button tells Sensibo the AC is in the opposite state and flips it locally, without an AC command', async () => {
	const {
		ac, button, calls
	} = makeSyncButton()

	await button.SyncButtonService.getCharacteristic(On).handleSetRequest(true)
	await settle()

	assert.deepEqual(calls, [['syncDeviceState', 'pod1', false]])
	assert.equal(ac.state.active, false)

	mock.timers.tick(2000)
	assert.deepEqual(calls, [['syncDeviceState', 'pod1', false]])
})

test('the button switches itself back off one second after being pressed', async () => {
	const { button } = makeSyncButton()
	const characteristic = button.SyncButtonService.getCharacteristic(On)

	await characteristic.handleSetRequest(true)
	await settle()
	assert.equal(characteristic.value, true)

	mock.timers.tick(1000)
	assert.equal(characteristic.value, false)
})

test('turning the button off does not sync', async () => {
	const {
		ac, button, calls
	} = makeSyncButton()

	await button.SyncButtonService.getCharacteristic(On).handleSetRequest(false)
	await settle()
	mock.timers.tick(2000)

	assert.deepEqual(calls, [])
	assert.equal(ac.state.active, true)
})
