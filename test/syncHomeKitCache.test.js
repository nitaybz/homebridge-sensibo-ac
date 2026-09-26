import { test } from 'node:test'
import assert from 'node:assert/strict'
import syncHomeKitCache from '../sensibo/syncHomeKitCache.js'
import {
	acDevice, fakePlatform
} from './helpers.js'

function syncPlatform(config, devices) {
	const platform = fakePlatform({
		activeAccessories: [],
		locations: [],
		devices,
		...config
	})

	platform.unregistered = []
	platform.api.unregisterPlatformAccessories = (_plugin, _platform, accessories) => {
		platform.unregistered.push(...accessories)
	}

	return platform
}

function locatedDevice(id, acState) {
	return {
		...acDevice(acState),
		id,
		location: {
			id: 'loc1',
			name: 'Home',
			occupancy: 'home'
		}
	}
}

function types(platform) {
	return platform.activeAccessories.map(accessory => {
		return accessory.type
	})
}

test('an AC device creates only an AirConditioner by default', () => {
	const platform = syncPlatform({}, [locatedDevice('pod1')])

	syncHomeKitCache(platform)()

	assert.deepEqual(types(platform), ['AirConditioner'])
	assert.equal(platform.cachedAccessories.length, 1)
})

test('enabled extras add HumiditySensor, SyncButton, ClimateReactSwitch and OccupancySensor', () => {
	const platform = syncPlatform({
		externalHumiditySensor: true,
		enableSyncButton: true,
		enableClimateReactSwitch: true,
		enableOccupancySensor: true
	}, [locatedDevice('pod1')])

	syncHomeKitCache(platform)()

	assert.deepEqual(types(platform), ['AirConditioner', 'HumiditySensor', 'SyncButton', 'ClimateReactSwitch', 'OccupancySensor'])
	assert.deepEqual(platform.locations, ['loc1'])
})

test('in-accessory sync button and climate react switch suppress the separate accessories', () => {
	const platform = syncPlatform({
		enableSyncButton: true,
		syncButtonInAccessory: true,
		enableClimateReactSwitch: true,
		climateReactSwitchInAccessory: true
	}, [locatedDevice('pod1')])

	syncHomeKitCache(platform)()

	assert.deepEqual(types(platform), ['AirConditioner'])
})

test('one OccupancySensor per location, even with several devices there', () => {
	const platform = syncPlatform({ enableOccupancySensor: true }, [locatedDevice('pod1'), locatedDevice('pod2')])

	syncHomeKitCache(platform)()

	assert.deepEqual(types(platform), ['AirConditioner', 'OccupancySensor', 'AirConditioner'])
})

test('HomeKit-supported devices are skipped only with ignoreHomeKitDevices, and devices without remoteCapabilities always', () => {
	const homekit = {
		...locatedDevice('pod1'),
		homekitSupported: true
	}
	const noCaps = {
		...locatedDevice('pod2'),
		remoteCapabilities: null
	}
	const ignoring = syncPlatform({ ignoreHomeKitDevices: true }, [homekit, noCaps])
	const keeping = syncPlatform({}, [homekit, noCaps])

	syncHomeKitCache(ignoring)()
	syncHomeKitCache(keeping)()

	assert.deepEqual(types(ignoring), [])
	assert.deepEqual(types(keeping), ['AirConditioner'])
})

test('a second sync does not duplicate accessories', () => {
	const platform = syncPlatform({ enableSyncButton: true }, [locatedDevice('pod1')])
	const sync = syncHomeKitCache(platform)

	sync()
	sync()

	assert.deepEqual(types(platform), ['AirConditioner', 'SyncButton'])
	assert.equal(platform.unregistered.length, 0)
})

test('a removed device has its cached accessories unregistered and dropped', () => {
	const platform = syncPlatform({ externalHumiditySensor: true }, [locatedDevice('pod1'), locatedDevice('pod2')])
	const sync = syncHomeKitCache(platform)

	sync()
	platform.devices = [locatedDevice('pod1')]
	sync()

	assert.deepEqual(platform.unregistered.map(accessory => {
		return [accessory.context.type, accessory.context.deviceId]
	}), [['AirConditioner', 'pod2'], ['HumiditySensor', 'pod2']])
	assert.equal(platform.cachedAccessories.length, 2)
	assert.deepEqual(platform.activeAccessories.map(accessory => {
		return accessory.id
	}), ['pod1', 'pod1'])
})

test('disabling a feature unregisters its cached accessory while the device remains', () => {
	const platform = syncPlatform({ enableSyncButton: true }, [locatedDevice('pod1')])
	const sync = syncHomeKitCache(platform)

	sync()
	platform.enableSyncButton = false
	sync()

	assert.deepEqual(platform.unregistered.map(accessory => {
		return accessory.context.type
	}), ['SyncButton'])
	assert.deepEqual(types(platform), ['AirConditioner'])
})

test('cached accessories without a type are unregistered; unknown types are kept', () => {
	const platform = syncPlatform({}, [])
	const legacy = new platform.api.platformAccessory('Legacy', platform.api.hap.uuid.generate('legacy'))
	const unknown = new platform.api.platformAccessory('Unknown', platform.api.hap.uuid.generate('unknown'))

	unknown.context.type = 'Mystery'
	platform.cachedAccessories.push(legacy, unknown)

	syncHomeKitCache(platform)()

	assert.deepEqual(platform.unregistered, [legacy])
	assert.deepEqual(platform.cachedAccessories, [unknown])
})
