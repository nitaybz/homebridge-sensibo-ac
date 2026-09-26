import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as hap from 'hap-nodejs'
import registerPlugin from '../index.js'

function fakeLog() {
	const messages = []
	const log = (...args) => {
		messages.push(['log', ...args])
	}

	for (const level of ['info', 'warn', 'error', 'success', 'debug']) {
		log[level] = (...args) => {
			messages.push([level, ...args])
		}
	}
	log.messages = messages

	return log
}

function construct(config) {
	const registered = []
	const listeners = []
	const api = {
		hap,
		registerPlatform: (...args) => {
			registered.push(args)
		},
		on: (event, handler) => {
			listeners.push([event, handler])
		},
		user: {
			persistPath: () => {
				return '/hb/persist'
			}
		}
	}

	registerPlugin(api)

	const [[pluginName, platformName, Platform]] = registered
	const log = fakeLog()
	const platform = new Platform(log, config, api)

	return {
		platform,
		log,
		listeners,
		pluginName,
		platformName
	}
}

function levels(log, level) {
	return log.messages.filter(message => {
		return message[0] === level
	})
}

test('the default export registers the SensiboAC platform', () => {
	const {
		pluginName, platformName
	} = construct({ apiKey: 'k' })

	assert.equal(pluginName, 'homebridge-sensibo-ac')
	assert.equal(platformName, 'SensiboAC')
})

test('defaults when only an apiKey is configured', () => {
	const {
		platform, listeners
	} = construct({ apiKey: 'k' })

	assert.equal(platform.name, 'SensiboAC')
	assert.equal(platform.carbonDioxideAlertThreshold, 1500)
	assert.equal(platform.enableClimateReactSwitch, false)
	assert.equal(platform.climateReactSwitchInAccessory, false)
	assert.equal(platform.externalHumiditySensor, false)
	assert.deepEqual(platform.devicesToExclude, [])
	assert.deepEqual(platform.locationsToInclude, [])
	assert.deepEqual(platform.modesToExclude, [])
	assert.equal(platform.disableAirConditioner, false)
	assert.equal(platform.refreshDelay, 5000)
	assert.equal(platform.pollingInterval, 85000)
	assert.equal(platform.persistPath, '/hb/sensibo-persist')
	assert.deepEqual(listeners.map(([event]) => {
		return event
	}), ['didFinishLaunching'])
})

test('configured values override the defaults', () => {
	const { platform } = construct({
		apiKey: 'k',
		name: 'My AC',
		carbonDioxideAlertThreshold: 900,
		enableClimateReactSwitch: true,
		devicesToExclude: ['pod1']
	})

	assert.equal(platform.name, 'My AC')
	assert.equal(platform.carbonDioxideAlertThreshold, 900)
	assert.equal(platform.enableClimateReactSwitch, true)
	assert.deepEqual(platform.devicesToExclude, ['pod1'])
})

test('modesToExclude is uppercased; excluding AUTO, COOL and HEAT disables the AirConditioner', () => {
	const partial = construct({
		apiKey: 'k',
		modesToExclude: ['cool', 'Heat']
	}).platform
	const all = construct({
		apiKey: 'k',
		modesToExclude: ['auto', 'cool', 'heat', 'dry']
	}).platform

	assert.deepEqual(partial.modesToExclude, ['COOL', 'HEAT'])
	assert.equal(partial.disableAirConditioner, false)
	assert.equal(all.disableAirConditioner, true)
})

test('username and password are accepted instead of an apiKey', () => {
	const {
		platform, log
	} = construct({
		username: 'u',
		password: 'p'
	})

	assert.equal(platform.username, 'u')
	assert.equal(platform.name, 'SensiboAC')
	assert.equal(levels(log, 'error').length, 0)
})

test('missing credentials log an error and stop before the rest of the config is parsed', () => {
	const {
		platform, log, listeners
	} = construct({ username: 'u' })

	assert.match(levels(log, 'error')[0][1], /without username and password or API key/)
	assert.equal(platform.name, undefined)
	assert.equal(platform.modesToExclude, undefined)
	assert.equal(listeners.length, 0)
	// configureAccessory still works, so cached accessories are kept but never synced
	assert.deepEqual(platform.activeAccessories, [])
})

test('disableDry/disableFan are stored but the deprecation warning is deferred to didFinishLaunching', () => {
	const {
		platform, log
	} = construct({
		apiKey: 'k',
		disableDry: true,
		disableFan: true
	})

	assert.equal(platform.disableDry, true)
	assert.equal(platform.disableFan, true)
	assert.equal(levels(log, 'warn').some(message => {
		return /Deprecation warning/.test(message[1])
	}), false)
})

test('configureAccessory collects cached accessories', () => {
	const { platform } = construct({ apiKey: 'k' })
	const accessory = { UUID: 'x' }

	platform.configureAccessory(accessory)

	assert.deepEqual(platform.cachedAccessories, [accessory])
})
