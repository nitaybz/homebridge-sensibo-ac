const AirConditioner = require('./../homekit/AirConditioner')
const AirPurifier = require('./../homekit/AirPurifier')
const AirQualitySensor = require('./../homekit/AirQualitySensor')
const ClimateReactSwitch = require('./../homekit/ClimateReactSwitch')
const HumiditySensor = require('./../homekit/HumiditySensor')
const OccupancySensor = require('./../homekit/OccupancySensor')
const RoomSensor = require('./../homekit/RoomSensor')
const SyncButton = require('./../homekit/SyncButton')

module.exports = (platform) => {
	return () => {
		platform.devices.forEach(device => {
			if (platform.ignoreHomeKitDevices && device.homekitSupported) {
				platform.log.easyDebug(`Ignoring Homekit supported device: ${device.id}`)

				return
			}

			if (!device.remoteCapabilities) {
				platform.log.easyDebug(`Ignoring as no remote capabilities available for device: ${device.id}`)

				return
			}

			// Add AirConditioner
			// TODO: tidy productModel matching
			if (['sky','skyv2','skyplus','air','airq'].includes(device.productModel)
					|| device.productModel.includes('air')
					|| device.productModel.includes('sky')) {
				const airConditionerIsNew = !platform.activeAccessories.find(accessory => {
					return accessory.type === 'AirConditioner' && accessory.id === device.id
				})

				platform.log.easyDebug(`Device: ${device.id}, Model: ${device.productModel}, airConditionerIsNew: ${airConditionerIsNew}`)

				if (airConditionerIsNew) {
					// TODO: what if aircon isn't needed at all (all services disabled)? Do we still push it?
					// What about airConditioner variable for other accessories?
					const airConditioner = new AirConditioner(device, platform)

					platform.activeAccessories.push(airConditioner)

					// Add external Humidity Sensor if enabled
					if (platform.externalHumiditySensor) {
						const humiditySensor = new HumiditySensor(airConditioner, platform)

						platform.activeAccessories.push(humiditySensor)
					}

					// TODO: make if statements single line?
					// Add external Air Quality Sensor if available
					if (['airq'].includes(device.productModel)) {
						// Check that at least one of AirQuality or CarbonDioxide sensor is enabled before creating
						if (!platform.disableAirQuality || !platform.disableCarbonDioxide) {
							// TODO: check for a better way to get measurements
							airConditioner.measurements = device.measurements
							const airQualitySensor = new AirQualitySensor(airConditioner, platform)

							platform.activeAccessories.push(airQualitySensor)
						}
					}

					// Add separate Sync Button if enabled
					if (platform.enableSyncButton && !platform.syncButtonInAccessory) {
						const syncButton = new SyncButton(airConditioner, platform)

						platform.activeAccessories.push(syncButton)
					}

					// Add Climate React Switch if enabled
					if (platform.enableClimateReactSwitch && !platform.climateReactSwitchInAccessory) {
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

				platform.log.easyDebug(`Device: ${device.id}, airPurifierIsNew: ${airPurifierIsNew}`)

				if (airPurifierIsNew) {
					const airPurifier = new AirPurifier(device, platform)

					platform.activeAccessories.push(airPurifier)

					// Check that at least one of AirQuality or CarbonDioxide sensor is enabled before creating
					if (!platform.disableAirQuality || !platform.disableCarbonDioxide) {
						// TODO: why are we using 'device' here? Compare to line 57 where aircon is used with AirQualitySensor
						const airQualitySensor = new AirQualitySensor(device, platform)

						platform.activeAccessories.push(airQualitySensor)
					}
				}
			}

			// Add Sensibo Room Sensors if exists
			if (device.motionSensors && Array.isArray(device.motionSensors)) {
				device.motionSensors.forEach(sensor => {
					const roomSensorIsNew = !platform.activeAccessories.find(accessory => {
						return accessory.type === 'RoomSensor' && accessory.id === sensor.id
					})

					platform.log.easyDebug(`Device: ${device.id}, roomSensorIsNew: ${roomSensorIsNew}`)

					if (roomSensorIsNew) {
						const roomSensor = new RoomSensor(sensor, device, platform)

						platform.activeAccessories.push(roomSensor)
					}
				})
			}

			// Add Occupancy Sensor if enabled
			if (platform.enableOccupancySensor && !platform.locations.includes(device.location.id)) {
				platform.locations.push(device.location.id)
				const occupancySensor = new OccupancySensor(device, platform)

				platform.activeAccessories.push(occupancySensor)
			}
		})

		// find devices to remove
		const accessoriesToRemove = []

		platform.cachedAccessories.forEach(accessory => {
			if (!accessory.context.type) {
				platform.log.easyDebug(`Old cached accessory to be removed, name: ${accessory.name}`)
				accessoriesToRemove.push(accessory)
			}

			const isActive = platform.activeAccessories.find(activeAccessory => {
				return accessory.UUID === activeAccessory.UUID
			})

			if (!isActive) {
				// TODO: should we remove non-active accessories immediately? see also AirQualitySensor below
				platform.log.easyDebug(`Accessory type: ${accessory.context.type}, Name: ${accessory.name}, not in activeAccessories[]`)
			}

			let deviceExists, sensorExists, locationExists

			switch(accessory.context.type) {
				case 'AirConditioner':
				// TODO: tidy productModel matching
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId
								&& device.remoteCapabilities
								&& (['sky','skyv2','skyplus','air','airq'].includes(device.productModel)
									|| device.productModel.includes('air')
									|| device.productModel.includes('sky'))
					})
					if (!deviceExists) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'AirPurifier':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities && device.productModel === 'pure'
					})
					if (!deviceExists) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'AirQualitySensor':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities && ['pure','airq'].includes(device.productModel)
					})
					// TODO: should disabled check be moved out? see also isActive above
					if (!deviceExists || (deviceExists && platform.disableAirQuality && platform.disableCarbonDioxide)) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'RoomSensor':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId
					})
					if (!deviceExists || !Array.isArray(deviceExists.motionSensors)) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
					} else {
						sensorExists = deviceExists.motionSensors.find(sensor => {
							return sensor.id === accessory.context.sensorId
						})
						if (!sensorExists) {
							platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
							accessoriesToRemove.push(accessory)
						}
					}
					break

				case 'HumiditySensor':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities
					})
					if (!deviceExists || !platform.externalHumiditySensor) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'SyncButton':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities
					})

					if (!deviceExists || !platform.enableSyncButton || platform.syncButtonInAccessory) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'ClimateReact':
				case 'ClimateReactSwitch':
					deviceExists = platform.devices.find(device => {
						return device.id === accessory.context.deviceId && device.remoteCapabilities
					})

					if (!deviceExists || !platform.enableClimateReactSwitch || platform.climateReactSwitchInAccessory) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
					}
					break

				case 'OccupancySensor':
					locationExists = platform.devices.find(device => {
						return device.location.id === accessory.context.locationId
					})

					if (!locationExists || !platform.enableOccupancySensor) {
						platform.log.easyDebug(`Cached ${accessory.context.type} accessory to be removed, name: ${accessory.name}`)
						accessoriesToRemove.push(accessory)
						// TODO: check why platform.locations is updated below
						platform.locations = platform.locations.filter(location => {
							return location !== accessory.context.locationId
						})
					}
					break

				default:
					platform.log(`Cached ${accessory.context.type} accessory, name: ${accessory.name}, did not match Switch, not removed`)
			}
		})

		if (accessoriesToRemove.length) {
			platform.log.easyDebug('Unregistering Unnecessary Cached Devices:')
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