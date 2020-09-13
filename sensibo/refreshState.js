const unified = require('./unified')

module.exports = () => {
	if (!this.processingState) {
		this.processingState = true
		clearTimeout(this.pollingTimeout)
		setTimeout(async () => {

			try {
				this.devices = await this.sensiboApi.getAllDevices()
				await this.storage.setItem('devices', this.devices)
				
			} catch(err) {
				this.log.easyDebug('<<<< ---- Refresh State FAILED! ---- >>>>')
				this.processingState = false
				if (this.pollingInterval) {
					this.log.easyDebug(`Will try again in ${this.pollingInterval/1000} seconds...`)
					this.pollingTimeout = setTimeout(this.refreshState, this.pollingInterval)
				}
				return
			}
			
			const handledLocations = []
			this.devices.forEach(device => {
				const airConditioner = this.activeAccessories.find(accessory => accessory.type === 'AirConditioner' && accessory.id === device.id)

				if (airConditioner) {
					// Update AC state in cache + HomeKit
					airConditioner.state.update(unified.acState(device))

					// Update Humidity Sensor state in HomeKit
					const humiditySensor = this.activeAccessories.find(accessory => accessory.type === 'HumiditySensor' && accessory.id === device.id)
					if (humiditySensor)
						humiditySensor.updateHomeKit()

					// Update Climate React Switch state in HomeKit
					const climateReactSwitch = this.activeAccessories.find(accessory => accessory.type === 'ClimateReact' && accessory.id === device.id)
					if (climateReactSwitch)
						climateReactSwitch.updateHomeKit()
				}

				// Update Room Sensor state in cache + HomeKit
				if (device.motionSensors && Array.isArray(device.motionSensors)) {
					device.motionSensors.forEach(sensor => {
						const roomSensor = this.activeAccessories.find(accessory => accessory.type === 'RoomSensor' && accessory.id === sensor.id)
						if (roomSensor)
							roomSensor.state.update(unified.sensorState(sensor))
					})
				}

				// Update Occupancy state in cache + HomeKit
				const location = this.activeAccessories.find(accessory => accessory.type === 'OccupancySensor' && accessory.id === device.location.id)
				if (location && !handledLocations.includes(location.id)) {
					handledLocations.push(location.id)
					location.state.update(unified.occupancyState(device.location))
				}

			})



			// register new devices / unregister removed devices
			this.syncHomeKitCache()

			// start timeout for next polling
			if (this.pollingInterval)
				this.pollingTimeout = setTimeout(this.refreshState, this.pollingInterval)

			// block new requests for extra 5 seconds
			setTimeout(() => {
				this.processingState = false
			}, 5000)

		}, this.refreshDelay)
	}
}