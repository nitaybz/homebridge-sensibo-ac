import AirConditioner from './../homekit/AirConditioner.js'
import AirPurifier from './../homekit/AirPurifier.js'
import AirQualitySensor from './../homekit/AirQualitySensor.js'
import ClimateReactSwitch from './../homekit/ClimateReactSwitch.js'
import HumiditySensor from './../homekit/HumiditySensor.js'
import OccupancySensor from './../homekit/OccupancySensor.js'
import RoomSensor from './../homekit/RoomSensor.js'
import SyncButton from './../homekit/SyncButton.js'

export default platform => {
	return () => {
		platform.log.easyDebug('syncHomeKitCache.js - start')

		platform.devices.forEach(device => {
			if (platform.ignoreHomeKitDevices && device.homekitSupported) {
				platform.log.easyDebug(`syncHomeKitCache.js - Ignoring Homekit supported device: ${device.id}`)

				return
			}

			if (!device.remoteCapabilities) {
				platform.log.easyDebug(`syncHomeKitCache.js - Ignoring as no remote capabilities available for device: ${device.id}`)

				return
			}

			// Add AirConditioner
			// TODO: tidy productModel matching - use capabilities instead?
			if (['sky', 'skyv2', 'skyplus', 'air', 'airq'].includes(device.productModel)
				|| device.productModel.includes('air')
				|| device.productModel.includes('sky')) {
				const airConditionerIsNew = !platform.activeAccessories.find(accessory => {
					return accessory.type === 'AirConditioner' && accessory.id === device.id
				})

				platform.log.easyDebug(`syncHomeKitCache.js - Device: ${device.id}, Model: ${device.productModel}, airConditionerIsNew: ${airConditionerIsNew}`)

				if (airConditionerIsNew) {
					platform.log.success(`syncHomeKitCache.js - Found AirConditioner accessory (${device.id})`)

					// TODO: what if aircon isn't needed at all (all services disabled)? Do we still push it?
					// What about airConditioner variable for other accessories like humiditySensor?

					const airConditioner = new AirConditioner(device, platform)

					platform.activeAccessories.push(airConditioner)

					// Add external Humidity Sensor if enabled
					if (platform.externalHumiditySensor) {
						platform.log.info(`syncHomeKitCache.js - Found HumiditySensor`)

						const humiditySensor = new HumiditySensor(airConditioner, platform)

						platform.activeAccessories.push(humiditySensor)
					}

					// Add separate Sync Button if enabled
					if (platform.enableSyncButton && !platform.syncButtonInAccessory) {
						platform.log.info(`syncHomeKitCache.js - Found SyncButton`)

						const syncButton = new SyncButton(airConditioner, platform)

						platform.activeAccessories.push(syncButton)
					}

					// Add Climate React Switch if enabled
					if (platform.enableClimateReactSwitch && !platform.climateReactSwitchInAccessory) {
						platform.log.info(`syncHomeKitCache.js - Found ClimateReactSwitch`)

						const climateReactSwitch = new ClimateReactSwitch(airConditioner, platform)

						platform.activeAccessories.push(climateReactSwitch)
					}
				}
			}

			// Add AirPurifier
			if (['pure'].includes(device.productModel)) {
				const airPurifierIsNew = !platform.activeAccessories.find(accessory => {
					return accessory.type === 'AirPurifier' && accessory.id === device.id
				})

				platform.log.easyDebug(`syncHomeKitCache.js - Device: ${device.id}, airPurifierIsNew: ${airPurifierIsNew}`)

				if (airPurifierIsNew) {
					platform.log.success(`syncHomeKitCache.js - Found AirPurifier accessory (${device.id})`)

					const airPurifier = new AirPurifier(device, platform)

					platform.activeAccessories.push(airPurifier)
				}
			}

			// Add AirQualitySensor
			if (['pure', 'airq', 'elements'].includes(device.productModel)) {
				const airQualityIsNew = !platform.activeAccessories.find(accessory => {
					return accessory.type === 'AirQualitySensor' && accessory.id === device.id
				})

				platform.log.easyDebug(`syncHomeKitCache.js - Device: ${device.id}, Model: ${device.productModel}, airQualityIsNew: ${airQualityIsNew}`)

				if (airQualityIsNew) {
					// Check that at least one of AirQuality or CarbonDioxide sensor is enabled before creating
					if (platform.disableAirQuality && platform.disableCarbonDioxide) {
						// This logs every time syncHomeKitCache runs if AirQuality and CarbonDioxide are disabled!
						platform.log.easyDebug(`syncHomeKitCache.js - Skipped AirQualitySensor as both AirQuality and CarbonDioxide are disabled.`)
					} else {
						platform.log.success(`syncHomeKitCache.js - Found AirQualitySensor accessory (${device.id})`)

						const airQualitySensor = new AirQualitySensor(device, platform)

						platform.activeAccessories.push(airQualitySensor)
					}
				}
			}

			// Add Sensibo Room Sensors if exists
			if (device.motionSensors && Array.isArray(device.motionSensors)) {
				device.motionSensors.forEach(motionSensor => {
					const roomSensorIsNew = !platform.activeAccessories.find(accessory => {
						return accessory.type === 'RoomSensor' && accessory.id === motionSensor.id
					})

					platform.log.easyDebug(`syncHomeKitCache.js - Device: ${device.id}, roomSensorIsNew: ${roomSensorIsNew}`)

					if (roomSensorIsNew) {
						platform.log.success(`syncHomeKitCache.js - Found RoomSensor accessory (${device.id})`)

						const roomSensor = new RoomSensor(motionSensor, device, platform)

						platform.activeAccessories.push(roomSensor)
					}
				})
			}

			// Add Occupancy Sensor if enabled
			if (platform.enableOccupancySensor && !platform.locations.includes(device.location.id)) {
				platform.locations.push(device.location.id)
				platform.log.success(`syncHomeKitCache.js - Found OccupancySensor accessory (${device.id})`)

				const occupancySensor = new OccupancySensor(device, platform)

				platform.activeAccessories.push(occupancySensor)
			}
		})

		platform.log.easyDebug('syncHomeKitCache.js - checking for devices to remove')

		// find devices to remove
		const accessoriesToRemove = []

		platform.cachedAccessories.forEach(accessory => {
			if (!accessory.context.type) {
				platform.log.info(`Old cached accessory to be removed, name: ${accessory.displayName}`)
				accessoriesToRemove.push(accessory)
			}

			const isActive = platform.activeAccessories.find(activeAccessory => {
				return accessory.UUID === activeAccessory.UUID
			})

			if (!isActive) {
				// TODO: should we remove non-active accessories immediately? see also AirQualitySensor below
				platform.log.easyDebug(`Accessory type: ${accessory.context.type}, Name: ${accessory.displayName}, not in activeAccessories[]`)
			}

			let deviceExists, sensorExists, locationExists

			// TODO: this switch statement feels longer and more complicated than necessary...
			//       some cases (e.g. AirConditioner and AirPurifier) could be combined or moved to the default at the bottom
			switch (accessory.context.type) {
				case 'AirConditioner':
				// TODO: tidy productModel matching (use capabilities?)
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId
							&& device.remoteCapabilities
							&& (['sky', 'skyv2', 'skyplus', 'air', 'airq'].includes(device.productModel)
								|| device.productModel.includes('air')
								|| device.productModel.includes('sky'))
					})
					if (!deviceExists) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'AirPurifier':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities && device.productModel === 'pure'
					})
					if (!deviceExists) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'AirQualitySensor':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities && ['pure', 'airq', 'elements'].includes(device.productModel)
					})
					// TODO: should disabled check be moved out? see also isActive above
					if (!deviceExists || (deviceExists && platform.disableAirQuality && platform.disableCarbonDioxide)) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'RoomSensor':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId
					})
					if (!deviceExists || !Array.isArray(deviceExists.motionSensors)) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
					} else {
						sensorExists = deviceExists.motionSensors.find(sensor => {
							return sensor.id === accessory.context.sensorId
						})
						if (!sensorExists) {
							platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
							accessoriesToRemove.push(accessory)
						}
					}
					break

				case 'HumiditySensor':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities
					})
					if (!deviceExists || !platform.externalHumiditySensor) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'SyncButton':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities
					})

					if (!deviceExists || !platform.enableSyncButton || platform.syncButtonInAccessory) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'ClimateReact':
				case 'ClimateReactSwitch':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities
					})

					if (!deviceExists || !platform.enableClimateReactSwitch || platform.climateReactSwitchInAccessory) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'OccupancySensor':
					locationExists = platform.devices.find(device => {
						return device.location.id === accessory.context.locationId
					})

					if (!locationExists || !platform.enableOccupancySensor) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.displayName}`)
						accessoriesToRemove.push(accessory)
						// TODO: check why platform.locations is updated below
						platform.locations = platform.locations.filter(location => {
							return location !== accessory.context.locationId
						})
					}
					break

				default:
					platform.log.warn(`Cached ${accessory.context.type} accessory, name: ${accessory.displayName}, did not match switch statement, not removed`)
			}
		})

		if (accessoriesToRemove.length) {
			platform.log.warn(`syncHomeKitCache.js - Unregistering ${accessoriesToRemove.length} unnecessary cached accessories:`)

			accessoriesToRemove.forEach(accessory => {
				platform.log.info(`${accessory.displayName} (${accessory.context.roomName}) - ${accessory.context.type} - ${accessory.context.deviceId}`)
			})

			platform.log.easyDebug(accessoriesToRemove)

			// unregistering accessories
			platform.api.unregisterPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, accessoriesToRemove)

			// remove from cachedAccessories
			platform.cachedAccessories = platform.cachedAccessories.filter(cachedAccessory => {
				return !accessoriesToRemove.find(accessory => {
					return accessory.UUID === cachedAccessory.UUID
				})
			})

			// remove from activeAccessories
			platform.activeAccessories = platform.activeAccessories.filter(activeAccessory => {
				return !accessoriesToRemove.find(accessory => {
					return accessory.UUID === activeAccessory.UUID
				})
			})
		}
	}
}
