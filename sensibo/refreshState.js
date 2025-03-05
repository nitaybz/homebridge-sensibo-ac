const unified = require('./unified')

module.exports = platform => {
	return () => {
		platform.log.easyDebug('refreshState.js - refreshState called')
		// platform.log.warn(`processingState: ${platform.processingState}  setProcessing: ${!platform.setProcessing}`)
		// TODO: reverse if block, e.g. if (platform.processingState || platform.setProcessing) return
		if (!platform.processingState && !platform.setProcessing) {
			platform.processingState = true
			// platform.log.easyDebug('refreshState.js - clearTimeout to prevent duplicates')
			clearTimeout(platform.pollingTimeout)
			setTimeout(async () => {
				try {
					platform.log.easyDebug('refreshState.js - Starting refresh...')

					const allDevices = await platform.sensiboApi.getAllDevices()

					platform.log.easyDebug('refreshState.js - API getAllDevices complete')

					if (platform.setProcessing) {
						platform.log.easyDebug('refreshState.js - platform.setProcessing now == true, exiting refreshState as outbound API now running')

						platform.processingState = false

						return
					}

					if (!platform.processingState) {
						platform.log.warn('refreshState.js - platform.processingState now == false, exiting refreshState as this is unexpected')

						return
					}

					platform.log.easyDebug('refreshState.js - updating platform.devices and platform.storage.devices')

					platform.devices = allDevices

					await platform.storage.setItem('devices', allDevices)

					platform.log.easyDebug('refreshState.js - platform.devices and platform.storage.devices update complete')
				} catch (err) {
					platform.log.error('refreshState.js - <<<< ---- Refresh State FAILED! ---- >>>>')
					platform.log.warn(`refreshState.js - Error message: ${err.message}`)

					platform.processingState = false

					if (platform.pollingInterval) {
						platform.log(`refreshState.js - Will try again in ${platform.pollingInterval / 1000} seconds...`)

						platform.pollingTimeout = setTimeout(platform.refreshState, platform.pollingInterval)
					}

					return
				}

				const handledLocations = []

				platform.log.easyDebug('refreshState.js - starting refresh of individual devices')

				platform.devices.forEach(device => {
					// Air Conditioner
					const airConditioner = platform.activeAccessories.find(accessory => {
						return accessory.type === 'AirConditioner' && accessory.id === device.id
					})

					if (airConditioner) {
						// Update AC state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
						platform.log.easyDebug(`Updating AC state for ${device.room?.name} (${device.id})`)
						airConditioner.state.update(unified.acStateFromDevice(device))

						// Climate React
						const climateReactSwitch = platform.activeAccessories.find(accessory => {
							return (accessory.type === 'ClimateReactSwitch') && accessory.id === device.id
						})

						// Update Climate React Switch in HomeKit
						if (climateReactSwitch) {
							platform.log.easyDebug(`Updating Climate React Switch in HomeKit for ${device.room?.name} (${device.id})`)
							climateReactSwitch.updateHomeKit()
						}
					}

					// Air Purifier
					const airPurifier = platform.activeAccessories.find(accessory => {
						return accessory.type === 'AirPurifier' && accessory.id === device.id
					})

					// Update Pure state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					if (airPurifier) {
						platform.log.easyDebug(`Updating Pure state for ${device.room?.name} (${device.id})`)
						airPurifier.state.update(unified.acStateFromDevice(device))
					}

					// Air Quality Sensor
					const airQualitySensor = platform.activeAccessories.find(accessory => {
						return accessory.type === 'AirQualitySensor' && accessory.id === device.id
					})

					// Update Air Quality state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					if (airQualitySensor) {
						// FIXME: need a better way to get constants in to the airQualityStateFromDevice function
						// perhaps once it's moved to Utils.js it can have Platform scope?
						const Constants = {
							carbonDioxideAlertThreshold: platform.carbonDioxideAlertThreshold,
							PM2_5DENSITY_MAX: platform.PM2_5DENSITY_MAX,
							VOCDENSITY_MAX: platform.VOCDENSITY_MAX
						}

						platform.log.easyDebug(`Updating Air Quality Sensor state for ${device.room?.name} (${device.id})`)
						airQualitySensor.state.update(unified.airQualityStateFromDevice(device, Constants))
					}

					// Humidity Sensor
					const humiditySensor = platform.activeAccessories.find(accessory => {
						return accessory.type === 'HumiditySensor' && accessory.id === device.id
					})

					// Update Humidity Sensor in HomeKit
					if (humiditySensor) {
						platform.log.easyDebug(`Updating Humidity Sensor in HomeKit for ${device.id}`)
						humiditySensor.updateHomeKit()
					}

					// Room Sensors
					if (device.motionSensors && Array.isArray(device.motionSensors)) {
						device.motionSensors.forEach(sensor => {
							const roomSensor = platform.activeAccessories.find(accessory => {
								return accessory.type === 'RoomSensor' && accessory.id === sensor.id
							})

							// Update Room Sensor state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
							if (roomSensor) {
								platform.log.easyDebug(`Updating Room Sensor state for ${device.id}`)
								roomSensor.state.update(unified.sensorState(sensor))
							}
						})
					}

					// Occupancy Sensor
					const location = platform.activeAccessories.find(accessory => {
						return accessory.type === 'OccupancySensor' && accessory.id === device.location.id
					})

					// Update Occupancy state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					if (location && !handledLocations.includes(location.id)) {
						handledLocations.push(location.id)
						platform.log.easyDebug(`Updating Occupancy Sensor state for ${device.id}`)
						location.state.update(unified.occupancyState(device.location))
					}
				})

				// register new devices / unregister removed devices
				platform.log.easyDebug('refreshState.js - Running syncHomeKitCache')
				platform.syncHomeKitCache()

				platform.log.easyDebug(`refreshState.js - Create new timeout wait ${platform.pollingInterval / 1000} seconds, then call refreshState`)
				// create new timeout to initiate next refresh in 85 seconds
				if (platform.pollingInterval) {
					platform.pollingTimeout = setTimeout(platform.refreshState, platform.pollingInterval)
					// NOTE: pollingInterval is 85 seconds, requestedInterval (90 seconds) - refreshDelay (5 seconds)
				}

				// wait 5 more seconds before removing block (platform.processingState) preventing new requests
				setTimeout(() => {
					platform.processingState = false
					// platform.log.warn('refreshState.js - Block (platform.processingState) removed, new requests allowed')
				}, platform.refreshDelay)
				// NOTE: refreshDelay is 5 seconds
				// platform.log.warn('refreshState.js - Primary setTimeout code completed')
			}, platform.refreshDelay)
			// NOTE: refreshDelay is 5 seconds
		}
	}
}
