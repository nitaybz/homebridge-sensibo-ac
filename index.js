const SensiboApi = require('./sensibo/api')
const syncHomeKitCache = require('./sensibo/syncHomeKitCache')
const refreshState = require('./sensibo/refreshState')
const path = require('path')
const storage = require('node-persist')
// const PLUGIN_NAME = 'homebridge-sensibo-ac'
const PLUGIN_NAME = require('./package.json').config.pluginName
// const PLATFORM_NAME = 'SensiboAC'
const PLATFORM_NAME = require('./package.json').config.platformName
// extract the smallest (minimum) major version number of Node that we support from package.json, pulled from engines.node field
const minimumNodeVersionSupported = Math.min(...[...require('./package.json').engines.node.matchAll(/(\d{2})(?:[.\d]+)/g)].map(m => {
	return Number(m[1])
}))
const expiringLTSNodeVersion = 18

class SensiboACPlatform {

	constructor(log, config, api) {
		this.cachedAccessories = []
		this.activeAccessories = []
		this.log = log
		this.api = api
		this.storage = storage
		this.refreshState = refreshState(this)
		this.syncHomeKitCache = syncHomeKitCache(this)
		this.debug = config['debug'] || false
		this.PLUGIN_NAME = PLUGIN_NAME
		this.PLATFORM_NAME = PLATFORM_NAME
		this.minimumNodeVersionSupported = minimumNodeVersionSupported

		this.log(`Starting ${this.PLUGIN_NAME}`)

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

		this.disableAirConditioner = ['AUTO','COOL','HEAT'].every(mode => {
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
		this.processingState = false
		this.setProcessing = false

		// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //

		// define debug method to output debug logs when enabled in the config
		// TODO: add a "dev" mode to the logger?
		// this.log.devDebug?
		this.log.easyDebug = (...content) => {
			if (this.debug) {
				this.log(content.reduce((previous, current) => {
					return previous + ' ' + current
				}))
			} else {
				// I think this bubbles up to "platform" and then logs iff the homebridge debug log is enabled?
				this.log.debug(content.reduce((previous, current) => {
					return previous + ' ' + current
				}))
			}
		}

		this.api.on('didFinishLaunching', async () => {
			await this.storage.init({
				dir: this.persistPath,
				forgiveParseErrors: true
			})

			this.cachedState = await this.storage.getItem('state') || this.emptyState

			if (!this.cachedState.devices) {
				this.cachedState = this.emptyState
			}

			this.sensiboApi = await SensiboApi(this)

			try {
				this.devices = await this.sensiboApi.getAllDevices()

				await this.storage.setItem('devices', this.devices)

				this.log(`Found ${this.devices.length} Sensibo devices, refreshing or adding to Homebridge based on your plugin settings.`)
			} catch (err) {
				this.log.error(`Error: index.js didFinishLaunching - Error message ${err}`)

				this.devices = await this.storage.getItem('devices') || []
			}

			this.syncHomeKitCache()

			if (this.pollingInterval) {
				this.pollingTimeout = setTimeout(this.refreshState, this.pollingInterval)
			}

			this.log.success(`✓ Finished initialisation. ${this.cachedAccessories.length} services running on ${this.devices.length} devices.`)
			this.log.warn('This plugin is maintained by volunteers, please consider a ☆ on GitHub if you find it useful!')

			const [major, minor, patch] = process.versions.node.split('.').map(Number)

			if (major < minimumNodeVersionSupported) {
				this.log.error(`Warning: you are using an old version of Node.js (v${major}.${minor}.${patch}), please update to Node.js v${minimumNodeVersionSupported} at a minimum.`)
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

module.exports = (api) => {
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SensiboACPlatform)
}
