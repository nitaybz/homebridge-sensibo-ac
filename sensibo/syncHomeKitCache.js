const AirConditioner = require('./../homekit/AirConditioner')
const AirPurifier = require('./../homekit/AirPurifier')
const RoomSensor = require('./../homekit/RoomSensor')
const HumiditySensor = require('./../homekit/HumiditySensor')
const SyncButton = require('./../homekit/SyncButton')
const ClimateReactSwitch = require('./../homekit/ClimateReactSwitch')
const OccupancySensor = require('./../homekit/OccupancySensor')
const AirQualitySensor = require('./../homekit/AirQualitySensor')

module.exports = (platform) => {
	return () => {
		platform.devices.forEach(device => {

			if (platform.ignoreHomeKitDevices && device.homekitSupported) {
				platform.log.easyDebug(`Ignoring Homekit supported device: ${device.id}`)
				return				
			}

			if (!device.remoteCapabilities) {
				platform.log.easyDebug(`Ignoring as no remote capabilities available device: ${device.id}`)
				return
			}

			// Add AirConditioner
			// TODO clean up productModel if condition
			if (['sky','skyv2','skyplus','air','airq'].includes(device.productModel) || device.productModel.includes('air') || device.productModel.includes('sky')) {
				const airConditionerIsNew = !platform.activeAccessories.find(accessory => accessory.type === 'AirConditioner' && accessory.id === device.id)
				if (airConditionerIsNew) {
					const airConditioner = new AirConditioner(device, platform)
					platform.activeAccessories.push(airConditioner)
	
					// Add external Humidity Sensor if enabled
					if (platform.externalHumiditySensor) {
						const humiditySensor = new HumiditySensor(airConditioner, platform)
						platform.activeAccessories.push(humiditySensor)
					}

					// Add external Air Quality Sensor if enabled and available
					// TODO add externalAirQualitySensor option??
					// e.g. if (['airq'].includes(device.productModel) && platform.externalAirQualitySensor) {
					if (['airq'].includes(device.productModel)) {
						// TODO check for a better way to do this
						airConditioner.measurements = device.measurements
						const airQualitySensor = new AirQualitySensor(airConditioner, platform)
						platform.activeAccessories.push(airQualitySensor)
					}
	
					// Add Sync Button if enabled
					if (platform.enableSyncButton && !platform.syncButtonInAccessory) {
						const syncButton = new SyncButton(airConditioner, platform)
						platform.activeAccessories.push(syncButton)
					}
	
					// Add Climate React Switch if enabled
					if (platform.enableClimateReactSwitch) {
						const climateReactSwitch = new ClimateReactSwitch(airConditioner, platform)
						platform.activeAccessories.push(climateReactSwitch)
					}
				}
			}
			
			// Add AirPurifier
			if (['pure'].includes(device.productModel)) {
				const airPurifierIsNew = !platform.activeAccessories.find(accessory => accessory.type === 'AirPurifier' && accessory.id === device.id)
				if (airPurifierIsNew) {
					const airPurifier = new AirPurifier(device, platform)
					platform.activeAccessories.push(airPurifier)

					const airQualitySensor = new AirQualitySensor(device, platform)
					platform.activeAccessories.push(airQualitySensor)
				}
			}
	
			// Add Sensibo Room Sensors if exists
			if (device.motionSensors && Array.isArray(device.motionSensors)) {
				device.motionSensors.forEach(sensor => {
					const roomSensorIsNew = !platform.activeAccessories.find(accessory => accessory.type === 'RoomSensor' && accessory.id === sensor.id)
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
				accessoriesToRemove.push(accessory)
				platform.log.easyDebug('removing old cached accessory')
			}

			let deviceExists, sensorExists, locationExists
			switch(accessory.context.type) {
			case 'AirConditioner':
				// TODO clean up productModel matching
				deviceExists = platform.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities && (['sky','skyv2','skyplus','air','airq'].includes(device.productModel) || device.productModel.includes('air') || device.productModel.includes('sky') ))
				if (!deviceExists)
					accessoriesToRemove.push(accessory)
				break

			case 'AirPurifier':
				deviceExists = platform.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities && device.productModel === 'pure')
				if (!deviceExists)
					accessoriesToRemove.push(accessory)
				break

			case 'AirQualitySensor':
				deviceExists = platform.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities && ['pure','airq'].includes(device.productModel))
				if (!deviceExists)
					accessoriesToRemove.push(accessory)
				break

			case 'RoomSensor':
				deviceExists = platform.devices.find(device => device.id === accessory.context.deviceId)
				if (!deviceExists || !Array.isArray(deviceExists.motionSensors))
					accessoriesToRemove.push(accessory)
				else {
					sensorExists = deviceExists.motionSensors.find(sensor => sensor.id === accessory.context.sensorId)
					if (!sensorExists)
						accessoriesToRemove.push(accessory)
				}
				break

			case 'HumiditySensor':
				deviceExists = platform.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities)
				if (!deviceExists || !platform.externalHumiditySensor)
					accessoriesToRemove.push(accessory)
				break

			case 'SyncButton':
				deviceExists = platform.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities)
				if (!deviceExists || !platform.enableSyncButton || platform.syncButtonInAccessory)
					accessoriesToRemove.push(accessory)
				break

			case 'ClimateReact':
				deviceExists = platform.devices.find(device => device.id === accessory.context.deviceId && device.remoteCapabilities)
				if (!deviceExists || !platform.enableClimateReactSwitch)
					accessoriesToRemove.push(accessory)
				break

			case 'OccupancySensor':
				locationExists = platform.devices.find(device => device.location.id === accessory.context.locationId)
				if (!locationExists || !platform.enableOccupancySensor) {
					accessoriesToRemove.push(accessory)
					platform.locations = platform.locations.filter(location => location !== accessory.context.locationId)
				}
				break
			}
		})

		if (accessoriesToRemove.length) {
			platform.log.easyDebug('Unregistering Unnecessary Cached Devices:')
			platform.log.easyDebug(accessoriesToRemove)

			// unregistering accessories
			platform.api.unregisterPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, accessoriesToRemove)

			// remove from cachedAccessories
			platform.cachedAccessories = platform.cachedAccessories.filter( cachedAccessory => !accessoriesToRemove.find(accessory => accessory.UUID === cachedAccessory.UUID) )

			// remove from activeAccessories
			platform.activeAccessories = platform.activeAccessories.filter( activeAccessory => !accessoriesToRemove.find(accessory => accessory.UUID === activeAccessory.UUID) )
		}
	}
}