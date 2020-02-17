const sensibo = require('./lib/api')
const storage = require('node-persist')
const Service, Characteristic, Accessory, uuid
var SensiboAccessory



module.exports = function (homebridge) {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic
	Accessory = homebridge.hap.Accessory
	uuid = homebridge.hap.uuid

	SensiboAccessory = require('./lib/accessory')(Accessory, Service, Characteristic, uuid)
	homebridge.registerPlatform('homebridge-sensibo-ac', 'SensiboAC', SensiboACPlatform)
}

function SensiboACPlatform(log, config) {
	// Load Wink Authentication From Config File
    this.name = config['name'] || 'Sensibo AC'
	this.apiKey = config['apiKey']
	this.disableFan = config['disableFan'] || false
	this.disableDry = config['disableDry'] || false
	this.enableOccupancySensor = config['enableOccupancySensor'] || false
	this.enableSyncButton= config['enableSyncButton'] || false
	this.debug = config['debug'] || false
	this.log = log
	this.debug = log.debug
	this.pollingInterval = 90000
	this.processingState = false
	this.cachedAccessories = []

	storage.initSync({
        dir: HomebridgeAPI.user.persistPath()
	})
	
	this.cachedState = storage.getItem('sensibo_state')
	if (!this.cachedState)
		this.cachedState = {pods:{}, location:{}}


	this.refreshState = async () => {
		if (!this.processingState) {
			this.processingState = true
			try {
				if (this.debug)
					this.log('Getting Devices State')
	
				const pods = await sensibo.getDevicesStates()
				if (pods.length) 
					pods.forEach(pod => () => {
						this.cachedState.pods[pod.id].acState =  pod.acState
						this.cachedState.pods[pod.id].measurements =  pod.measurements
						if (!this.cachedState.pods[pod.id].last)
							this.cachedState.pods[pod.id].last = {}
						this.cachedState.pods[pod.id].last[pod.acState.mode] =  pod.acState
	
						if (pod.acState.mode !== 'fan' && pod.acState.mode !== 'dry')
							this.cachedState.pods[pod.id].last.mode = pod.acState.mode
	
						let thisAccessory = this.cachedAccessories.find(accessory => accessory.type === 'ac' && accessory.id === pod.id)
						if (thisAccessory)
							thisAccessory.updateHomeKit(pod.acState, pod.measurements)
					
					})
				
				if (this.enableOccupancySensor) {
					this.cachedState.location = pods[0].location
					let thisAccessory = this.cachedAccessories.find(accessory => accessory.type === 'occupancy')
					if (thisAccessory)
						thisAccessory.updateHomeKit(pods[0].location)
				}
				this.processingState = false
				storage.setItem('sensibo_state', this.cachedState)
				
			} catch(err) {
				this.processingState = false
				this.log('ERROR getting devices status from API!')
				if (this.debug)
					this.log(err)
			}
		}
		
	}

}


SensiboACPlatform.prototype = {
	accessories: async function (callback) {
		this.log('Fetching Sensibo devices...')

		const returnedAccessories = []
		let pods = []

		sensibo.init(this.apiKey, this.log, this.debug)

		setInterval(this.refreshState, this.pollingInterval)

		try {
			await this.refreshState()
			pods = await sensibo.getAllPods()
			storage.setItem('sensibo_pods', pods)
			
		} catch(err) {
			this.log('ERROR getting devices status from API!')
			const cachedPods = storage.getItem('sensibo_pods')
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
					log: this.log,
					debug: this.debug
				}

				cachedAccessories.push(newAccessory)
				const accessory = new SensiboAccessory.AC(newAccessory, this.cachedState.pods[pod.id])
				returnedAccessories.push(accessory)
				this.log(`New Sensibo AC Device Added (Name: ${newAccessory.name}, ID: ${newAccessory.id})`)
			})

			if (this.enableOccupancySensor) {
				const newAccessory = {
					type: 'occupancy',
					name: 'Home Occupancy',
					log: this.log,
					debug: this.debug
				}

				cachedAccessories.push(newAccessory)
				const accessory = new SensiboAccessory.Occupancy(newAccessory, this.cachedState.location)
				returnedAccessories.push(accessory)
				this.log(`New Sensibo Occupancy Sensor (Name: ${newAccessory.name}`)

			}
		} else
			this.log('No Senisbo devices were detected... Not doing anything!')

		callback(returnedAccessories)
	}
}