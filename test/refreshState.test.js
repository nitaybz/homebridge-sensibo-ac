import { test } from 'node:test'
import assert from 'node:assert/strict'
import refreshState from '../sensibo/refreshState.js'
import {
	acDevice, makeAirConditioner
} from './helpers.js'

function loopPlatform(getAllDevices) {
	const {
		ac, platform
	} = makeAirConditioner({}, {})

	Object.assign(platform, {
		activeAccessories: [ac],
		devices: [],
		syncHomeKitCache: () => {},
		refreshDelay: 1,
		pollingInterval: 0
	})
	platform.sensiboApi.getAllDevices = getAllDevices

	return {
		ac,
		platform
	}
}

function waitForUnblock(platform) {
	return new Promise(resolve => {
		const check = () => {
			return platform.refreshStateProcessing ? setTimeout(check, 1) : resolve()
		}

		check()
	})
}

test('a refresh fetches all devices and updates each accessory', async () => {
	const {
		ac, platform
	} = loopPlatform(async () => {
		return [acDevice({ targetTemperature: 20 })]
	})

	await refreshState(platform)

	assert.equal(ac.state.targetTemperature, 20)
	assert.equal(platform.devices.length, 1)
})

test('a refresh is skipped while another one is running', async () => {
	const { platform } = loopPlatform(async () => {
		return [acDevice({})]
	})

	platform.refreshStateProcessing = true

	await assert.rejects(refreshState(platform), /refreshStateProcessing: true/)
})

test('a refresh is skipped while a command is being sent', async () => {
	const { platform } = loopPlatform(async () => {
		return [acDevice({})]
	})

	platform.setProcessing = true

	await assert.rejects(refreshState(platform), /setProcessing: true/)
})

test('results are discarded if a command started while fetching', async () => {
	const {
		ac, platform
	} = loopPlatform(async () => {
		platform.setProcessing = true

		return [acDevice({ targetTemperature: 20 })]
	})

	await refreshState(platform)

	assert.equal(ac.state.targetTemperature, 24)
	assert.equal(platform.devices.length, 0)
})

test('an API failure rejects the refresh and releases the block', async () => {
	const { platform } = loopPlatform(async () => {
		throw new Error('network down')
	})

	await assert.rejects(refreshState(platform), /network down/)
	await waitForUnblock(platform)
	assert.equal(platform.refreshStateProcessing, false)
})

test('an empty device list rejects the refresh', async () => {
	const { platform } = loopPlatform(async () => {
		return []
	})

	await assert.rejects(refreshState(platform), /allDevices is not set/)
})
