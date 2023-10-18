const SensiboApi = require('./sensibo/api')
const syncHomeKitCache = require('./sensibo/syncHomeKitCache')
const refreshState = require('./sensibo/refreshState')
const path = require('path')
const storage = require('node-persist')
const PLUGIN_NAME = 'homebridge-sensibo-ac'
const PLATFORM_NAME = 'SensiboAC'

module.exports = (api) => {
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SensiboACPlatform)
}

class SensiboACPlatform {
	constructor(log, config, api) {

		this.cachedAccessories = []
		this.activeAccessories = []
		this.log = log
		this.api = api
		this.storage = storage
		this.refreshState = refreshState(this)
		this.syncHomeKitCache = syncHomeKitCache(this)
		this.name = config['name'] || PLATFORM_NAME
		this.disableFan = config['disableFan'] || false
		this.disableDry = config['disableDry'] || false
		this.disableAuto = config['disableAuto'] || false
		this.enableHistoryStorage = config['enableHistoryStorage'] || false
		this.locationsToInclude = config['locationsToInclude'] || []
		this.devicesToExclude = config['devicesToExclude'] || []
		this.debug = config['debug'] || false
		this.PLUGIN_NAME = PLUGIN_NAME
		this.PLATFORM_NAME = PLATFORM_NAME

		// ~~~~~~~~~~~~~~~~~~~~~ Sensibo Specials ~~~~~~~~~~~~~~~~~~~~~ //
		
		this.apiKey = config['apiKey']
		this.username = config['username']
		this.password = config['password']
		
		if (!this.apiKey && !(this.username && this.password)) {
			this.log('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  --  ERROR  --  XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n')
			this.log('Can\'t start homebridge-sensibo-ac plugin without username and password or API key !!\n')
			this.log('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n')
			return
		}

		this.externalHumiditySensor = config['externalHumiditySensor'] || false
		this.enableOccupancySensor = config['enableOccupancySensor'] || false
		this.enableSyncButton = config['enableSyncButton'] || false
		this.syncButtonInAccessory = config['syncButtonInAccessory'] || false
		this.enableClimateReactSwitch = config['enableClimateReactSwitch'] || false
		this.enableClimateReactAutoSetup = config['enableClimateReactAutoSetup'] || false
		this.disableHorizontalSwing = config['disableHorizontalSwing'] || false
		this.disableLightSwitch = config['disableLightSwitch'] || false
		this.allowRepeatedCommands = config['allowRepeatedCommands'] || false
		this.ignoreHomeKitDevices = config['ignoreHomeKitDevices'] || false

		this.persistPath = path.join(this.api.user.persistPath(), '/../sensibo-persist')
		this.emptyState = {devices:{}, sensors:{}, occupancy: {}}
		this.CELSIUS_UNIT = 'C'
		this.FAHRENHEIT_UNIT = 'F'
		const requestedInterval = 90000 // Sensibo interval is hardcoded (requested by the brand)
		this.refreshDelay = 5000
		this.locations = []

		// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //

		this.setProcessing = false
		this.pollingTimeout = null
		this.processingState = false
		this.pollingInterval = requestedInterval - this.refreshDelay

		// define debug method to output debug logs when enabled in the config
		this.log.easyDebug = (...content) => {
			if (this.debug) {
				this.log(content.reduce((previous, current) => {
					return previous + ' ' + current
				}))
			} else
				this.log.debug(content.reduce((previous, current) => {
					return previous + ' ' + current
				}))
		}
		
		this.api.on('didFinishLaunching', async () => {

			await this.storage.init({
				dir: this.persistPath,
				forgiveParseErrors: true
			})


			this.cachedState = await this.storage.getItem('state') || this.emptyState
			if (!this.cachedState.devices)
				this.cachedState = this.emptyState
				
			this.sensiboApi = await SensiboApi(this)

			try {
				this.devices = await this.sensiboApi.getAllDevices()
				await this.storage.setItem('devices', this.devices)
			} catch(err) {
				this.log('ERR:', err)
				this.devices = await this.storage.getItem('devices') || []
			}
			
			this.syncHomeKitCache()

			if (this.pollingInterval)
				this.pollingTimeout = setTimeout(this.refreshState, this.pollingInterval)
			
		})

	}

	configureAccessory(accessory) {
		this.cachedAccessories.push(accessory)
	}

}
