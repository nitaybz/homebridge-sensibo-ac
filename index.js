import path from 'path'
import refreshState from './sensibo/refreshState.js'
import SensiboApi from './sensibo/SensiboAPI.js'
import storage from 'node-persist'
import syncHomeKitCache from './sensibo/syncHomeKitCache.js'

import pjson from './package.json' with { type: 'json' }
const PLATFORM_NAME = pjson.config.platformName
const PLUGIN_NAME = pjson.config.pluginName
const PLUGIN_VERSION = pjson.version
// extract the smallest (minimum) major version number of Node that we support from package.json, pulled from engines.node field
const MINIMUM_NODE = Math.min(...[...pjson.engines.node.matchAll(/(\d{2})(?:[.\d]+)/g)].map(m => {
	return Number(m[1])
}))
const expiringLTSNodeVersion = 18

class SensiboACPlatform {

	constructor(log, config, api) {
		this.activeAccessories = []
		this.cachedAccessories = []
		this.log = log
		this.api = api
		this.storage = storage

		this.refreshState = async () => {
			return await refreshState(this)
		}
		this.syncHomeKitCache = syncHomeKitCache(this)

		this.debug = config['debug'] || false
		this.devDebug = config['devDebug'] || false
		this.PLATFORM_NAME = PLATFORM_NAME
		this.PLUGIN_NAME = PLUGIN_NAME
		this.PLUGIN_VERSION = PLUGIN_VERSION
		this.MINIMUM_NODE = MINIMUM_NODE

		this.log.info(`Starting ${this.PLUGIN_NAME}`)

		// ~~~~~~~~~~~~~~~~~~~~~ Sensibo Specials ~~~~~~~~~~~~~~~~~~~~~ //

		this.apiKey = config['apiKey']
		this.username = config['username']
		this.password = config['password']

		if (!this.apiKey && !(this.username && this.password)) {
			this.log.warn('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  --  ERROR  --  XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n')
			this.log.error('Can\'t start homebridge-sensibo-ac plugin without username and password or API key!\n')
			this.log.warn('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n')

			// throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

			return
		}

		this.name = config['name'] || PLATFORM_NAME
		this.allowRepeatedCommands = config['allowRepeatedCommands'] || false
		this.carbonDioxideAlertThreshold = config['carbonDioxideAlertThreshold'] || 1500
		this.climateReactSwitchInAccessory = config['climateReactSwitchInAccessory'] || false
		this.devicesToExclude = config['devicesToExclude'] || []
		this.disableAirQuality = config['disableAirQuality'] || false
		this.disableCarbonDioxide = config['disableCarbonDioxide'] || false
		this.disableDry = config['disableDry'] || false
		this.disableFan = config['disableFan'] || false
		this.disableHorizontalSwing = config['disableHorizontalSwing'] || false
		this.disableHumidity = config['disableHumidity'] || false
		this.disableLightSwitch = config['disableLightSwitch'] || false
		this.disableVerticalSwing = config['disableVerticalSwing'] || false
		this.enableClimateReactAutoSetup = config['enableClimateReactAutoSetup'] || false
		this.enableClimateReactSwitch = config['enableClimateReactSwitch'] || false
		this.enableHistoryStorage = config['enableHistoryStorage'] || false
		this.enableOccupancySensor = config['enableOccupancySensor'] || false
		this.enableSyncButton = config['enableSyncButton'] || false
		this.ignoreHomeKitDevices = config['ignoreHomeKitDevices'] || false
		this.syncButtonInAccessory = config['syncButtonInAccessory'] || false
		this.externalHumiditySensor = config['externalHumiditySensor'] || false
		this.locationsToInclude = config['locationsToInclude'] || []

		this.modesToExclude = config['modesToExclude']?.map(mode => {
			return mode.toUpperCase()
		}) || []

		this.disableAirConditioner = ['AUTO', 'COOL', 'HEAT'].every(mode => {
			return this.modesToExclude.indexOf(mode) !== -1
		})

		this.persistPath = path.join(this.api.user.persistPath(), '/../sensibo-persist')

		this.emptyState = {
			airQuality: {},
			devices: {},
			occupancy: {},
			sensors: {}
		}

		this.CELSIUS_UNIT = 'C'
		this.FAHRENHEIT_UNIT = 'F'
		this.PM2_5DENSITY_MAX = 10000
		this.VOCDENSITY_MAX = 10000
		this.locations = []

		// requested interval is hardcoded to 90 seconds (requested by the Sensibo)
		const requestedInterval = 90000

		this.refreshDelay = 5000
		this.pollingInterval = requestedInterval - this.refreshDelay
		this.pollingTimeout = null
		this.refreshStateProcessing = false
		this.setProcessing = false

		// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //

		// Defines a logging method to output debugging info when 'debug' is enabled in the config
		this.log.easyDebug = (...content) => {
			if (this.debug) {
				this.log(content.reduce((previous, current) => {
					return previous + ' ' + current
				}))
			} else {
				// This bubbles up to "platform" level (Homebridge) and then logs when the Homebridge "debug" is enabled
				this.log.debug(content.reduce((previous, current) => {
					return previous + ' ' + current
				}))
			}
		}

		// Defines a logging method to output developer level debugging info when 'devDebug' is enabled in the config
		this.log.devDebug = (...content) => {
			if (this.devDebug) {
				// TODO: once min version is Node 20 and above, move to using the below to colour log messages
				// https://nodejs.org/docs/latest/api/util.html#utilstyletextformat-text-options
				// e.g. this.log(util.styleText(['bgRed', 'bold', 'doubleunderline'], 'devDebug'), content.reduce((previous, current) => {
				this.log('\x1b[44mdevDebug\x1b[0m ' + content.reduce((previous, current) => {
					return previous + ' ' + current
				}))
				// console.trace('tracing')
			}
		}

		this.api.on('didFinishLaunching', async () => {
			this.log.info('Starting initialisation...')
			await this.storage.init({
				dir: this.persistPath,
				forgiveParseErrors: true
			})

			try {
				this.log.easyDebug(`index.js didFinishLaunching - running getItem('state'), SensiboAPI() and refreshState()`)

				this.cachedState = await this.storage.getItem('state') || this.emptyState

				if (!this.cachedState.devices) {
					this.cachedState = this.emptyState
				}

				this.sensiboApi = await SensiboApi(this)

				await this.refreshState()
					.then(result => {
						this.log.easyDebug('index.js refreshState.then - result:')
						this.log.easyDebug(result)

						if (!this.devices || !this.devices.length) {
							log.easyDebug('index.js refreshState.then - this.devices is not set!')

							throw ('this.devices is not set')
						}
					})

				this.log.info(`Found ${this.devices.length} Sensibo devices, restored existing or added new accessories to Homebridge based on your plugin settings.`)
			} catch (error) {
				this.log.error('index.js didFinishLaunching - getItem state or refreshState failed. Error message:')
				this.log.warn(error.message || error)

				this.log.info('Trying to retrieve "devices" from storage instead, otherwise will create an empty list.')

				this.devices = await this.storage.getItem('devices') || []

				this.syncHomeKitCache()
			}

			this.log.success(`✓ Finished initialisation. ${this.activeAccessories.length} of ${this.cachedAccessories.length} services running on ${this.devices.length} devices.`)
			this.log.warn('This plugin is maintained by volunteers, please consider a ☆ on GitHub if you find it useful!')

			const [major, minor, patch] = process.versions.node.split('.').map(Number)

			if (major < MINIMUM_NODE) {
				this.log.error(`Warning: you are using an old version of Node.js (v${major}.${minor}.${patch}), please update to Node.js v${MINIMUM_NODE} at a minimum.`)
			}

			if (major <= expiringLTSNodeVersion) {
				this.log.warn(`Note: Node.js v${expiringLTSNodeVersion} support ends April 30 2025, Homebridge recommend you upgrade to at least Node.js v20. See https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js. From May 2025 Homebridge v2.0 will require at least Node.js v20.`)
			}

			if (this.disableDry || this.disableFan) {
				this.log.warn('Deprecation warning: The disableDry and disableFan options have been deprecated, please use modesToExclude instead. See README.md for more details')
			}
		})
	}

	configureAccessory(accessory) {
		this.cachedAccessories.push(accessory)
	}

}

export default api => {
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SensiboACPlatform)
}
