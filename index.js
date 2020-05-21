const sensibo = require('./lib/api')
const storage = require('node-persist')
let Service, Characteristic, Accessory, uuid, SensiboAccessory, fakegatoHistoryService



module.exports = function (homebridge) {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	Accessory = homebridge.hap.Accessory
    HomebridgeAPI = homebridge
	uuid = homebridge.hap.uuid
	fakegatoHistoryService = require("fakegato-history")(homebridge)

	SensiboAccessory = require('./lib/accessories')(Accessory, Service, Characteristic, uuid)
	homebridge.registerPlatform('homebridge-sensibo-ac', 'SensiboAC', SensiboACPlatform)
}

function SensiboACPlatform(log, config) {
	// Load Wink Authentication From Config File
    this.name = config['name'] || 'Sensibo AC'
	this.apiKey = config['apiKey']
	this.disableFan = config['disableFan'] || false
	this.disableDry = config['disableDry'] || false
	this.enableOccupancySensor = false // config['enableOccupancySensor']
	this.enableSyncButton= config['enableSyncButton'] || false
    this.disableHistoryStorage = config['disableHistoryStorage'] || false //new
	this.debug = config['debug'] || false
	this.log = log
	this.debug = log.debug
	this.pollingInterval = 90000
	this.processingState = false
	this.refreshTimeout = null
	this.cachedAccessories = []
	this.returnedAccessories = []
	

}


SensiboACPlatform.prototype = {
	accessories: async function (callback) {

		try {
			await storage.init({
				dir: HomebridgeAPI.user.persistPath() + '/../plugin-persist'
			})
			this.cachedState = await storage.getItem('sensibo_state')
		} catch(err) {
			this.log("Failed setting storage dir under 'plugin-persist':")
			this.log(err)
			this.log("Trying again in default persist path...")
			try {
				await storage.init({
					dir: HomebridgeAPI.user.persistPath()
				})
				this.log("Success setting storage dir under default persist path")
			} catch(err) {
				this.log("Failed setting storage dir under default persist path")
				this.log(err)
				this.log("Please contact the plugin creator...")
			}
		}

		if (!this.cachedState)
			this.cachedState = {pods:{}, location:{}}


		this.refreshState = async () => {
			if (!this.processingState) {
				this.processingState = true
				if (this.refreshTimeout)
					clearTimeout(this.refreshTimeout)
				try {
					if (this.debug)
						this.log('Getting Devices State')
		
					const pods = await sensibo.getDevicesStates()

					if (pods.length) 
						pods.forEach(pod => {
							if (!this.cachedState.pods[pod.id])
								this.cachedState.pods[pod.id] = {}

							const isStateChanged = (this.cachedState.pods[pod.id].acState && JSON.stringify(this.cachedState.pods[pod.id].acState) !== JSON.stringify(pod.acState)) || !this.cachedState.pods[pod.id].acState
							const isMeasurementsChanged = (this.cachedState.pods[pod.id].measurements && (this.cachedState.pods[pod.id].measurements.temperature !== pod.measurements.temperature || this.cachedState.pods[pod.id].measurements.humidity !== pod.measurements.humidity)) || !this.cachedState.pods[pod.id].measurements
							let newState = null
							let newMeasurements = null

							if (isStateChanged) {
								this.cachedState.pods[pod.id].acState =  pod.acState

								if (!this.cachedState.pods[pod.id].last)
									this.cachedState.pods[pod.id].last = {}
								this.cachedState.pods[pod.id].last[pod.acState.mode] =  pod.acState
			
								if (pod.acState.mode !== 'fan' && pod.acState.mode !== 'dry')
									this.cachedState.pods[pod.id].last.mode = pod.acState.mode

								newState = pod.acState
							}

							if (isMeasurementsChanged) {
								this.cachedState.pods[pod.id].measurements =  pod.measurements
								newMeasurements =  pod.measurements
							}

							let thisAccessory = this.returnedAccessories.find(accessory => accessory.type === 'ac' && accessory.id === pod.id)
							if (thisAccessory) {
								thisAccessory.updateHomeKit(newState, newMeasurements)
							}
						})
						
					
					// if (this.enableOccupancySensor) {
					// 	this.cachedState.location = pods[0].location
					// 	let thisAccessory = this.returnedAccessories.find(accessory => accessory.type === 'occupancy')
					// 	if (thisAccessory)
					// 		thisAccessory.updateHomeKit(pods[0].location)
					// }
					this.processingState = false
					this.refreshTimeout = setTimeout(this.refreshState, this.pollingInterval)
					await storage.setItem('sensibo_state', this.cachedState)
					
				} catch(err) {
					this.processingState = false
					this.refreshTimeout = setTimeout(this.refreshState, this.pollingInterval)
					this.log('ERROR getting devices status from API!')
					if (this.debug)
						this.log(err)
				}
			}
			
		}
		this.log('Fetching Sensibo devices...')
		let pods = []
		sensibo.init(this.apiKey, this.log, this.debug)

		try {
			await this.refreshState()
			pods = await sensibo.getAllPods()
			await storage.setItem('sensibo_pods', pods)
			
		} catch(err) {
			this.log('ERROR getting devices status from API!')
			const cachedPods = await storage.getItem('sensibo_pods')
			if (cachedPods)
				pods = cachedPods
		}
		if (pods.length) {
			pods.forEach(pod => {
				const newAccessory = {
					type: 'ac',
					id: pod.id,
					model: pod.productModel,
					name: pod.room.name + ' AC',
					temperatureUnit: pod.temperatureUnit,
					capabilities: pod.remoteCapabilities.modes,
					disableFan: this.disableFan,
					disableDry: this.disableDry,
					enableSyncButton: this.enableSyncButton,
					refreshState: this.refreshState,
					disableHistoryStorage: this.disableHistoryStorage,
					log: this.log,
					debug: this.debug
				}

				this.cachedAccessories.push(newAccessory)
				const accessory = new SensiboAccessory.acAccessory(newAccessory, this.cachedState.pods[pod.id])
				this.returnedAccessories.push(accessory)
				this.log(`New Sensibo AC Device Added (Name: ${newAccessory.name}, ID: ${newAccessory.id})`)
			})

			// if (this.enableOccupancySensor) {
			// 	const newAccessory = {
			// 		type: 'occupancy',
			// 		name: 'Home Occupancy',
			// 		log: this.log,
			// 		debug: this.debug
			// 	}

			// 	this.cachedAccessories.push(newAccessory)
			// 	const accessory = new SensiboAccessory.occupancySensor(newAccessory, this.cachedState.location)
			// 	this.returnedAccessories.push(accessory)
			// 	this.log(`New Sensibo Occupancy Sensor (Name: ${newAccessory.name}`)

			// }
		} else
			this.log('No Senisbo devices were detected... Not doing anything!')

		callback(this.returnedAccessories)
	}
}