const AirConditioner = require('./homekit/AirConditioner')
const RoomSensor = require('./homekit/RoomSensor')
const HumiditySensor = require('./homekit/HumiditySensor')
const SyncButton = require('./homekit/SyncButton')
const ClimateReactSwitch = require('./homekit/ClimateReactSwitch')
const OccupancySensor = require('./homekit/OccupancySensor')

module.exports = () => {
	this.devices.forEach(device => {

		if (!device.remoteCapabilities)
			return
    
		// Add AirConditioner
		const airConditionerIsNew = !this.activeAccessories.find(accessory => accessory.type === 'AirConditioner' && accessory.id === device.id)
		if (airConditionerIsNew) {
			const airConditioner = new AirConditioner(device, this)
			this.activeAccessories.push(airConditioner)

			// Add external Humidity Sensor if enabled
			if (this.externalHumiditySensor) {
				const humiditySensor = new HumiditySensor(airConditioner, this)
				this.activeAccessories.push(humiditySensor)
			}

			// Add Sync Button if enabled
			if (this.enableSyncButton) {
				const syncButton = new SyncButton(airConditioner, this)
				this.activeAccessories.push(syncButton)
			}

			// Add Climate React Switch if enabled
			if (this.enableClimateReactSwitch) {
				const climateReactSwitch = new ClimateReactSwitch(airConditioner, this)
				this.activeAccessories.push(climateReactSwitch)
			}
		}

		// Add Sensibo Room Sensors if exists
		if (device.motionSensors && Array.isArray(device.motionSensors)) {
			device.motionSensors.forEach(sensor => {
				const roomSensorIsNew = !this.activeAccessories.find(accessory => accessory.type === 'RoomSensor' && accessory.id === sensor.id)
				if (roomSensorIsNew) {
					const roomSensor = new RoomSensor(sensor, device, this)
					this.activeAccessories.push(roomSensor)
				}
			})
		}

		// Add Occupancy Sensor if enabled
		if (this.enableOccupancySensor && !this.locations.includes(device.location.id)) {
			this.locations.push(device.location.id)
			const occupancySensor = new OccupancySensor(device, this)
			this.activeAccessories.push(occupancySensor)
		}

	})


	// find devices to remove
	const accessoriesToRemove = []
	this.cachedAccessories.forEach(accessory => {
		let deviceExists, sensorExists, locationExists
		switch(accessory.context.type) {
			case 'AirConditioner':
				deviceExists = this.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities)
				if (!deviceExists)
					accessoriesToRemove.push(accessory)
				break

			case 'RoomSensor':
				deviceExists = this.devices.find(device => device.id === accessory.context.deviceId)
				if (!deviceExists || !Array.isArray(deviceExists.motionSensors))
					accessoriesToRemove.push(accessory)
				else {
					sensorExists = deviceExists.motionSensors.find(sensor => sensor.id === accessory.context.sensorId)
					if (!sensorExists)
						accessoriesToRemove.push(accessory)
				}
				break

			case 'HumiditySensor':
				deviceExists = this.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities)
				if (!deviceExists || !this.externalHumiditySensor)
					accessoriesToRemove.push(accessory)
				break

			case 'SyncButton':
				deviceExists = this.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities)
				if (!deviceExists || !this.enableSyncButton)
					accessoriesToRemove.push(accessory)
				break

			case 'ClimateReact':
				deviceExists = this.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities)
				if (!deviceExists || !this.enableClimateReactSwitch)
					accessoriesToRemove.push(accessory)
				break

			case 'OccupancySensor':
				locationExists = this.devices.find(device => device.location.id === accessory.context.locationId)
				if (!locationExists || !this.enableOccupancySensor) {
					accessoriesToRemove.push(accessory)
					this.locations = this.locations.filter(location => location !== accessory.context.locationId)
				}
				break
		}
	})

	if (accessoriesToRemove.length) {
		this.log.easyDebug('Unregistering Unnecessary Cached Devices:')
		this.log.easyDebug(accessoriesToRemove)

		// unregistering accessories
		this.api.unregisterPlatformAccessories(this.PLUGIN_NAME, this.PLATFORM_NAME, accessoriesToRemove)

		// remove from cachedAccessories
		this.cachedAccessories = this.cachedAccessories.filter( cachedAccessory => !accessoriesToRemove.find(accessory => accessory.UUID === cachedAccessory.UUID) )

		// remove from activeAccessories
		this.activeAccessories = this.activeAccessories.filter( activeAccessory => !accessoriesToRemove.find(accessory => accessory.UUID === activeAccessory.UUID) )
	}
}