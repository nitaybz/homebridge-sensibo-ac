const sensibo = require('./lib/api')
const storage = require('node-persist')
let Service, Characteristic, Accessory, HomebridgeAPI, uuid, SensiboAccessory



module.exports = function (homebridge) {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	Accessory = homebridge.hap.Accessory
    HomebridgeAPI = homebridge
	uuid = homebridge.hap.uuid
	const FakeGatoHistoryService = require("fakegato-history")(homebridge)

	SensiboAccessory = require('./lib/accessories')(Accessory, Service, Characteristic, HomebridgeAPI, uuid, FakeGatoHistoryService)
	homebridge.registerPlatform('homebridge-sensibo-ac', 'SensiboAC', SensiboACPlatform)
}

function SensiboACPlatform(log, config) {
	// Load Wink Authentication From Config File
    this.name = config['name'] || 'Sensibo AC'
	this.apiKey = config['apiKey']
	this.disableFan = config['disableFan'] || false
	this.disableDry = config['disableDry'] || false
	this.enableSyncButton= config['enableSyncButton'] || false
	this.enableOccupancySensor = config['enableOccupancySensor'] || false
	this.enableClimateReactSwitch = config['enableClimateReactSwitch'] || false
    this.enableHistoryStorage = config['enableHistoryStorage'] || false //new
	this.debug = config['debug'] || false
	this.log = log
	this.debug = log.debug
	this.processingState = false
	this.refreshTimeout = null
	this.cachedAccessories = []
	this.returnedAccessories = []

	const requestedInterval = 90000
	this.refreshDelay = 2000
	this.pollingInterval = requestedInterval - this.refreshDelay
	

}


SensiboACPlatform.prototype = {
	accessories: async function (callback) {

		try {
			await storage.init({
				dir: HomebridgeAPI.user.persistPath() + '/../sensibo-persist',
				forgiveParseErrors: true
			})
			this.cachedState = await storage.getItem('sensibo_state')
		} catch(err) {
			this.log("Failed setting storage dir under 'sensibo-persist':")
			this.log(err)
			this.log("Trying again in default persist path...")
			try {
				await storage.init({
					dir: HomebridgeAPI.user.persistPath(),
					forgiveParseErrors: true
				})
				this.log("Success setting storage dir under default persist path")
			} catch(err) {
				this.log("Failed setting storage dir under default persist path")
				this.log(err)
				this.log("Please contact the plugin creator...")
			}
		}

		if (!this.cachedState)
			this.cachedState = {pods:{}, occupied: null}


		this.refreshState = async () => {
			if (!this.processingState) {
				this.processingState = true
				if (this.refreshTimeout)
					clearTimeout(this.refreshTimeout)
				setTimeout(async () => {
					try {
						if (this.debug)
							this.log('Getting Devices State')
			
						const pods = await sensibo.getDevicesStates()

						if (pods.length) {
							pods.forEach(pod => {
								if (!this.cachedState.pods[pod.id])
									this.cachedState.pods[pod.id] = {}

								const climateReactState =  pod.smartMode ? pod.smartMode.enabled : false

								const isStateChanged = (this.cachedState.pods[pod.id].acState && JSON.stringify(this.cachedState.pods[pod.id].acState) !== JSON.stringify(pod.acState)) || !this.cachedState.pods[pod.id].acState
								const isMeasurementsChanged = (this.cachedState.pods[pod.id].measurements && (this.cachedState.pods[pod.id].measurements.temperature !== pod.measurements.temperature || this.cachedState.pods[pod.id].measurements.humidity !== pod.measurements.humidity)) || !this.cachedState.pods[pod.id].measurements
								const isClimateReactChanged = this.enableClimateReactSwitch && (!this.cachedState.pods[pod.id].smartMode || (this.cachedState.pods[pod.id].smartMode.enabled !== climateReactState))
								
								let newState = null
								let newMeasurements = null
								let newClimateReactState = null

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

								if (this.enableClimateReactSwitch && isClimateReactChanged) {
									this.cachedState.pods[pod.id].smartMode = {enabled: climateReactState}
									newClimateReactState = {enabled: climateReactState}
								}


								let thisAccessory = this.returnedAccessories.find(accessory => accessory.type === 'ac' && accessory.id === pod.id)
								if (thisAccessory) {
									thisAccessory.state = this.cachedState.pods[pod.id]
									thisAccessory.updateHomeKit(newState, newMeasurements, newClimateReactState)
								}
							})

							if (this.enableOccupancySensor) {
								const thisOccupancyAccessory = this.returnedAccessories.find(accessory => accessory.type === 'occupancy')

								if (thisOccupancyAccessory) {
									const occupied = (pods[0].location.occupancy === 'me' || pods[0].location.occupancy === 'someone')
									const isOccupancyChanged = thisOccupancyAccessory.occupied !== occupied
									if (isOccupancyChanged) {
										thisOccupancyAccessory.occupied = this.cachedState.occupied = occupied
										thisOccupancyAccessory.updateHomeKit(occupied)
									}
								}


							}
						}
						this.processingState = false
						this.refreshTimeout = setTimeout(this.refreshState, this.pollingInterval)
						try {
							await storage.setItem('sensibo_state', this.cachedState)
						} catch(err) {
							this.log('ERROR setting sensibo status to cache!')
							this.debug(err)
						}
						
					} catch(err) {
						this.processingState = false
						this.refreshTimeout = setTimeout(this.refreshState, this.pollingInterval)
						this.log('ERROR getting devices status from API!')
						if (this.debug)
							this.log(err) 
					}
				}, this.refreshDelay)
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
					state: this.cachedState.pods[pod.id],
					id: pod.id,
					model: pod.productModel,
					name: pod.room.name + ' AC',
					temperatureUnit: pod.temperatureUnit,
					capabilities: pod.remoteCapabilities.modes,
					disableFan: this.disableFan,
					disableDry: this.disableDry,
					enableSyncButton: this.enableSyncButton,
					enableClimateReactSwitch: this.enableClimateReactSwitch,
					refreshState: this.refreshState,
					enableHistoryStorage: this.enableHistoryStorage,
					log: this.log,
					debug: this.debug
				}

				this.cachedAccessories.push(newAccessory)
				const accessory = new SensiboAccessory.acAccessory(newAccessory)
				this.returnedAccessories.push(accessory)
				this.log(`New Sensibo AC Device Added (Name: ${newAccessory.name}, ID: ${newAccessory.id})`)
			})

			if (this.enableOccupancySensor) {
				const newAccessory = {
					type: 'occupancy',
					name: 'Home Occupancy',
					occupied:  this.cachedState.occupied,
					log: this.log,
					debug: this.debug,
					refreshState: this.refreshState
				}

				this.cachedAccessories.push(newAccessory)
				const accessory = new SensiboAccessory.occupancySensor(newAccessory)
				this.returnedAccessories.push(accessory)
				this.log(`New Sensibo Occupancy Sensor (Name: ${newAccessory.name}`)

			}
		} else
			this.log('No Sensibo devices were detected... Not doing anything!')

		callback(this.returnedAccessories)
	}
}