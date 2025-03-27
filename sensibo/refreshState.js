export default async function (platform) {
	// TODO: could this be func (promise), .then (if required, e.g. ln 101 forEach), .catch (for error handling), .finally (to call itself)
	return new Promise((resolve, reject) => {
		platform.log.easyDebug('refreshState.js - refreshState() called')
		platform.log.devDebug(`processingState: ${platform.processingState}  setProcessing: ${!platform.setProcessing}`)

		if (platform.processingState || platform.setProcessing) {
			platform.log.easyDebug(`refreshState.js - One of platform.processingState: ${platform.processingState} OR platform.setProcessing: ${platform.setProcessing} is true. Skipping refresh.`)

			// reject the overall promise
			reject(`platform.processingState: ${platform.processingState} OR platform.setProcessing: ${platform.setProcessing} are true, exiting early`)

			return
		}
		platform.processingState = true
		platform.log.devDebug('refreshState.js - clearTimeout to prevent duplicates')
		clearTimeout(platform.pollingTimeout)
		setTimeout(async () => {
			// TODO: make try/catch block separate function?
			try {
				platform.log.easyDebug('refreshState.js - Starting refresh...')

				const allDevices = await platform.sensiboApi.getAllDevices()

				// TODO: Should we null check in case the above getAllDevices returns empty (but no error)?

				platform.log.easyDebug('refreshState.js - API getAllDevices complete')

				// To ensure nothing changed during the 'await' / timeout we recheck the attributes
				if (platform.setProcessing) {
					platform.log.easyDebug('refreshState.js - platform.setProcessing now == true, throwing as outbound API now running')

					platform.processingState = false

					// throwing to the catch below
					// FIXME: TBC maybe this isn't error worthy?
					throw `platform.setProcessing now == true, exiting early`
				}

				// To ensure nothing changed during the 'await' / timeout we recheck the attributes
				if (!platform.processingState) {
					platform.log.warn('refreshState.js - platform.processingState now == false, throwing as this is unexpected')

					// throwing to the catch below
					// FIXME: TBC maybe this isn't error worthy?
					throw `platform.processingState now == false, exiting early`
				}

				platform.log.easyDebug('refreshState.js - updating platform.devices and platform.storage.devices')

				platform.devices = allDevices

				await platform.storage.setItem('devices', allDevices)

				platform.log.easyDebug('refreshState.js - platform.devices and platform.storage.devices update complete')
			} catch (error) {
				platform.log.error('refreshState.js - <<<< ---- Refresh State FAILED! ---- >>>>\nError message:')
				platform.log.warn(error.message || error)

				platform.processingState = false

				// TODO: should we have max retries and/or back-off?
				// failureCount = failureCount++
				// backoffFactor = 2 [2, 4, 8, 16...]  //  3 [3, 9, 27, 81, 243...]
				// newPollingInterval = platform.pollingInterval * (backoffFactor ** failureCount)  // if 2 [170, 340, 680, 1360]
				if (platform.pollingInterval) {
					platform.log(`refreshState.js - Will try again in ${platform.pollingInterval / 1000} seconds...`)

					platform.pollingTimeout = setTimeout(async () => {
						platform.refreshState()
							.catch(error => {
								platform.log.error('refreshState.js - error occurred after requeuing refreshState() following an earlier error\nError content:')
								platform.log.warn(error)
							})
					}, platform.pollingInterval)
				}

				// reject the overall Promise
				reject(error)

				return
			}

			// TODO: reset failure counter (for backoff / max retries)
			// failureCount = 0

			// register new devices / unregister removed devices
			platform.log.easyDebug('refreshState.js - Running syncHomeKitCache')
			platform.syncHomeKitCache()

			platform.log.easyDebug('refreshState.js - starting refresh of individual devices')

			// TODO: make below separate function
			// TODO: refactor below to retrieve accessory.type and run "find" only once
			//       Might be hard as deviceId is potentially reused (e.g. AC and AirQuality for airq units)?
			//       e.g could use .filter (rather than .find), but would then need to forEarch a second time...
			platform.devices.forEach(device => {
				// Air Conditioner
				const airConditioner = platform.activeAccessories.find(accessory => {
					return accessory.type === 'AirConditioner' && accessory.id === device.id
				})

				if (airConditioner) {
					// Update AC state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					platform.log.easyDebug(`Updating AC state for ${device.room?.name} (${device.id})`)
					airConditioner.state.update(airConditioner.Utils.airConditionerStateFromDevice(device))

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
					airPurifier.state.update(airPurifier.Utils.airPurifierStateFromDevice(device))
				}

				// Air Quality Sensor
				const airQualitySensor = platform.activeAccessories.find(accessory => {
					return accessory.type === 'AirQualitySensor' && accessory.id === device.id
				})

				// Update Air Quality state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
				if (airQualitySensor) {
					platform.log.easyDebug(`Updating Air Quality Sensor state for ${device.room?.name} (${device.id})`)
					airQualitySensor.state.update(airQualitySensor.Utils.airQualityStateFromDeviceMeasurements(device.measurements))
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

				// Room Sensors (device.motionSensors) - e.g. in room or not
				if (device.motionSensors && Array.isArray(device.motionSensors)) {
					device.motionSensors.forEach(sensor => {
						const roomSensor = platform.activeAccessories.find(accessory => {
							return accessory.type === 'RoomSensor' && accessory.id === sensor.id
						})

						// Update Room Sensor state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
						if (roomSensor) {
							platform.log.easyDebug(`Updating Room Sensor state for ${device.id}`)
							roomSensor.state.update(roomSensor.Utils.sensorStateFromSensorMeasurements(sensor.measurements))
						}
					})
				}

				// Occupancy Sensor (device.location) - e.g. home or not
				const occupancySensor = platform.activeAccessories.find(accessory => {
					return accessory.type === 'OccupancySensor' && accessory.id === device.location.id
				})
				const handledLocations = []

				// Update Occupancy state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
				if (occupancySensor && !handledLocations.includes(occupancySensor.id)) {
					handledLocations.push(occupancySensor.id)
					platform.log.easyDebug(`Updating Occupancy Sensor state for ${device.id}`)
					occupancySensor.state.update(occupancySensor.Utils.occupancyStateFromDeviceLocation(device.location))
				}
			})

			platform.log.easyDebug(`refreshState.js - Create new timeout, waiting ${platform.pollingInterval / 1000} seconds, then calling refreshState()`)
			// create new timeout to initiate next refresh in 85 seconds
			if (platform.pollingInterval) {
				platform.pollingTimeout = setTimeout(async () => {
					platform.refreshState()
						.catch(error => {
							platform.log.error(`refreshState.js - error occurred within refreshState() after timeout (${platform.pollingInterval / 1000} seconds)\nError content:`)
							platform.log.warn(error)
						})
				}, platform.pollingInterval)
				// NOTE: pollingInterval is 85 seconds, requestedInterval (90 seconds) - refreshDelay (5 seconds)
			}

			// wait 5 more seconds before removing block (platform.processingState) preventing new requests
			// TODO: should this be where we "block" subsequent requests that occur in quick succession?
			// e.g. change refreshDelay from 5 seconds to 30 seconds
			setTimeout(() => {
				platform.processingState = false
				platform.log.devDebug('refreshState.js - Removed block (platform.processingState), new refresh requests allowed')
			}, platform.refreshDelay)
			// NOTE: refreshDelay is 5 seconds
			platform.log.devDebug('refreshState.js - Primary setTimeout completed')

			// resolve the overall Promise
			resolve('refreshState() finished')
		}, platform.refreshDelay)
		// NOTE: refreshDelay is 5 seconds

		return
	}).catch(error => {
		platform.log.debug('refreshState.js (end) re-throwing caught error')

		throw error
	})
}
