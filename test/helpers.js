import { createRequire } from 'module'
import * as hap from 'hap-nodejs'
import AirConditioner from '../homekit/AirConditioner.js'

const require = createRequire(import.meta.url)
const { PlatformAccessory } = require('homebridge/lib/platformAccessory')

/**
 * A Sensibo API double that records every call instead of sending it
 * @returns {Object} the fake API, with a `calls` array of [method, ...args]
 */
export function fakeSensiboApi() {
	const calls = []
	const record = method => {
		return async (...args) => {
			calls.push([method, ...args])
		}
	}

	return {
		calls,
		setDeviceACState: record('setDeviceACState'),
		setDeviceClimateReactState: record('setDeviceClimateReactState'),
		syncDeviceState: record('syncDeviceState'),
		enableDisableClimateReact: record('enableDisableClimateReact'),
		enableDisablePureBoost: record('enableDisablePureBoost'),
		resetFilterIndicator: record('resetFilterIndicator')
	}
}

/**
 * A platform with the fields the accessories read, and no Homebridge server behind it
 * @param   {Object}  config  platform settings to override
 * @returns {Object}          the fake platform
 */
export function fakePlatform(config) {
	const log = () => {}

	log.info = log.warn = log.error = log.success = log.debug = log.easyDebug = log.devDebug = () => {}

	return {
		api: {
			hap,
			platformAccessory: PlatformAccessory,
			registerPlatformAccessories: () => {}
		},
		log,
		storage: { setItem: async () => {} },
		cachedAccessories: [],
		cachedState: {
			devices: {},
			sensors: {},
			occupancy: {},
			airQuality: {}
		},
		sensiboApi: fakeSensiboApi(),
		refreshState: async () => {},
		refreshStateProcessing: false,
		setProcessing: false,
		PLATFORM_NAME: 'SensiboAC',
		PLUGIN_NAME: 'homebridge-sensibo-ac',
		MINIMUM_NODE: '22.10.0',
		CELSIUS_UNIT: 'C',
		FAHRENHEIT_UNIT: 'F',
		PM2_5DENSITY_MAX: 10000,
		VOCDENSITY_MAX: 10000,
		carbonDioxideAlertThreshold: 1500,
		allowRepeatedCommands: false,
		climateReactSwitchInAccessory: false,
		disableAirConditioner: false,
		disableDry: false,
		disableFan: false,
		disableHorizontalSwing: false,
		disableHumidity: false,
		disableLightSwitch: false,
		disableVerticalSwing: false,
		enableClimateReactAutoSetup: false,
		enableHistoryStorage: false,
		modesToExclude: [],
		syncButtonInAccessory: false,
		...config
	}
}

const temperatures = {
	C: {
		isNative: true,
		values: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
	}
}

/**
 * A Sensibo AC device as the API returns it, cooling to 24°C at 26.5°C
 * @param   {Object}  acState  acState fields to override
 * @returns {Object}           the device
 */
export function acDevice(acState) {
	return {
		id: 'pod1',
		productModel: 'skyv2',
		serial: '1234',
		temperatureUnit: 'C',
		room: { name: 'Study' },
		acState: {
			on: true,
			mode: 'cool',
			targetTemperature: 24,
			temperatureUnit: 'C',
			fanLevel: 'medium',
			swing: 'stopped',
			horizontalSwing: 'stopped',
			light: 'on',
			...acState
		},
		measurements: {
			temperature: 26.5,
			humidity: 50
		},
		smartMode: { enabled: false },
		remoteCapabilities: {
			modes: {
				cool: {
					temperatures,
					fanLevels: ['low', 'medium', 'high', 'auto'],
					swing: ['stopped', 'rangeFull'],
					horizontalSwing: ['stopped', 'rangeFull'],
					light: ['on', 'off']
				},
				heat: {
					temperatures,
					fanLevels: ['low', 'medium', 'high', 'auto'],
					swing: ['stopped', 'rangeFull'],
					horizontalSwing: ['stopped', 'rangeFull'],
					light: ['on', 'off']
				},
				auto: {
					temperatures,
					fanLevels: ['low', 'medium', 'high', 'auto'],
					swing: ['stopped', 'rangeFull']
				},
				fan: {
					temperatures: {},
					fanLevels: ['low', 'medium', 'high'],
					swing: ['stopped', 'rangeFull']
				},
				dry: {
					temperatures,
					swing: ['stopped', 'rangeFull']
				}
			}
		}
	}
}

/**
 * An AirConditioner accessory built from a device, with the Sensibo API recorded
 * @param   {Object}  platformConfig  platform settings to override
 * @param   {Object}  acState         acState fields to override
 * @returns {{ac: AirConditioner, platform: Object, calls: Array}}
 */
export function makeAirConditioner(platformConfig, acState) {
	const platform = fakePlatform(platformConfig)
	const ac = new AirConditioner(acDevice(acState), platform)

	// Homebridge pushes the state to HomeKit right after creating the accessory (syncHomeKitCache); setters read it back
	ac.updateHomeKit()

	return {
		ac,
		platform,
		calls: platform.sensiboApi.calls
	}
}

/**
 * Invoke a StateManager setter the way HomeKit does
 * @param   {AirConditioner}  ac
 * @param   {string}          characteristic  StateManager.set key
 * @param   {*}               value
 * @returns {Promise<void>}
 */
export function homeKitSet(ac, characteristic, value) {
	return new Promise(resolve => {
		ac.stateManager.set[characteristic](value, resolve)
	})
}

/**
 * Invoke a StateManager getter the way HomeKit does
 * @param   {AirConditioner}  ac
 * @param   {string}          characteristic  StateManager.get key
 * @returns {Promise<*>}
 */
export function homeKitGet(ac, characteristic) {
	return new Promise(resolve => {
		ac.stateManager.get[characteristic]((_error, value) => {
			resolve(value)
		})
	})
}
