// Matter twin of the HomeKit HumiditySensor accessory.
//
// A Matter thermostat carries no humidity of its own - the RelativeHumidityMeasurement cluster lives on
// a sensor endpoint - so the room humidity reaches Matter through this separate accessory, which is what
// the externalHumiditySensor option already creates for HomeKit.

// Matter reports relative humidity in hundredths of a percent.
const HUNDREDTHS = 100

class MatterHumiditySensor {

	constructor(sensor, platform) {
		this.sensor = sensor
		this.platform = platform
		this.log = platform.log
		this.matter = platform.api.matter
		this.name = sensor.name
		this.registered = false
		this.pushed = null

		this.UUID = this.matter.uuid.generate(sensor.id + '_matter_humidity')
		this.descriptor = this.buildDescriptor()
	}

	buildDescriptor() {
		const sensor = this.sensor
		const deviceType = this.matter.deviceTypes.HumiditySensor

		if (!deviceType) {
			this.log.warn(`Warning: ${this.name} - Matter device type HumiditySensor is not available in this version of Homebridge`)

			return null
		}

		return {
			UUID: this.UUID,
			clusters: { relativeHumidityMeasurement: this.humidityState() },
			context: {
				deviceId: sensor.id,
				type: sensor.type
			},
			deviceType: deviceType,
			displayName: this.name,
			manufacturer: sensor.manufacturer,
			model: sensor.model,
			serialNumber: sensor.serial
		}
	}

	humidityState() {
		const humidity = this.sensor.state.relativeHumidity

		return { measuredValue: typeof humidity === 'number' ? Math.round(humidity * HUNDREDTHS) : null }
	}

	markRegistered() {
		this.registered = true
		this.pushed = { ...this.descriptor.clusters.relativeHumidityMeasurement }
	}

	update() {
		if (!this.registered) {
			return
		}

		const attributes = this.humidityState()

		if (this.pushed && this.pushed.measuredValue === attributes.measuredValue) {
			return
		}

		this.pushed = { ...attributes }

		this.matter.updateAccessoryState(this.UUID, 'relativeHumidityMeasurement', attributes)
			.catch(error => {
				this.log.easyDebug(`${this.name} - Matter - could not update relativeHumidityMeasurement: ${error.message || error}`)
			})
	}

}

export default MatterHumiditySensor
