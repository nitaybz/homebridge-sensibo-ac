// eslint-disable-next-line no-unused-vars
const homebridge = require('homebridge')
// eslint-disable-next-line no-unused-vars
const SensiboACPlatform = require('../sensibo/SensiboACPlatform')
const Classes = require('../classes')
const SensiboAccessory = require('./SensiboAccessory')
const unified = require('../sensibo/unified')

class AirConditioner extends SensiboAccessory {

	/**
	 * @param {import('../types').Device} device
	 * @param {SensiboACPlatform} platform
	 */
	constructor(device, platform) {
		const deviceInfo = unified.getDeviceInfo(device)
		const namePrefix = deviceInfo.room.name
		const nameSuffix = 'AC'
		const type = 'AirConditioner'

		super(platform, deviceInfo.id, namePrefix, nameSuffix, type, '')

		/** @type {typeof homebridge.Service} */
		this.Service = platform.api.hap.Service
		/** @type {typeof homebridge.Characteristic} */
		this.Characteristic = platform.api.hap.Characteristic
		/** @type {string} */
		this.CELSIUS_UNIT = platform.CELSIUS_UNIT
		/** @type {string} */
		this.FAHRENHEIT_UNIT = platform.FAHRENHEIT_UNIT

		/** @type {import('../types').Device} */
		this.device = device
		this.appId = deviceInfo.appId
		this.productModel = deviceInfo.productModel
		this.serial = deviceInfo.serial
		this.manufacturer = deviceInfo.manufacturer
		this.room = deviceInfo.room
		this.disableHumidity = platform.disableHumidity
		this.modesToExclude = platform.modesToExclude
		this.temperatureUnit = deviceInfo.temperatureUnit
		this.climateReactSwitchInAccessory = platform.climateReactSwitchInAccessory
		this.usesFahrenheit = this.temperatureUnit === this.FAHRENHEIT_UNIT
		this.temperatureStep = this.temperatureUnit === this.FAHRENHEIT_UNIT ? 0.1 : 1
		this.disableAirConditioner = platform.disableAirConditioner
		this.disableDry = platform.disableDry
		this.disableFan = platform.disableFan
		this.disableHorizontalSwing = platform.disableHorizontalSwing
		this.disableVerticalSwing = platform.disableVerticalSwing
		this.disableLightSwitch = platform.disableLightSwitch
		this.syncButtonInAccessory = platform.syncButtonInAccessory
		this.filterService = deviceInfo.filterService
		/** @type {import('../types').Capabilities} */
		this.capabilities = unified.getCapabilities(device, platform)
		/** @type {import('../types').Measurements} */
		this.measurements = undefined

		/** @type {ProxyHandler<Classes.InternalAcState>} */
		const StateHandler = require('./StateHandler')(this, platform)
		const state = unified.getInternalAcState(device)

		this.cachedState.devices[this.id] = state
		/** @type {Classes.InternalAcState} */
		this.state = new Proxy(state, StateHandler)
		this.StateManager = require('./StateManager')(this, platform)

		/** @type {undefined|homebridge.PlatformAccessory} */
		this.platformAccessory = platform.cachedAccessories.find(cachedAccessory => {
			return cachedAccessory.UUID === this.UUID
		})

		if (!this.platformAccessory) {
			this.log.info(`Creating New ${platform.platformName} ${this.type} Accessory in the ${this.room.name}`)
			this.platformAccessory = new this.api.platformAccessory(this.name, this.UUID)
			this.platformAccessory.context.type = this.type
			this.platformAccessory.context.deviceId = this.id

			platform.cachedAccessories.push(this.platformAccessory)

			// register the accessory
			this.api.registerPlatformAccessories(platform.pluginName, platform.platformName, [this.platformAccessory])
		}

		if (platform.enableHistoryStorage) {
			const fakeGatoHistoryService = require('fakegato-history')(this.api)

			this.loggingService = new fakeGatoHistoryService('weather', this.platformAccessory, {
				storage: 'fs',
				path: platform.persistPath
			})
		}

		this.platformAccessory.context.roomName = this.room.name

		/** @type {undefined|homebridge.Service} */
		let informationService = this.platformAccessory.getService(this.Service.AccessoryInformation)

		if (!informationService) {
			/** @type {homebridge.Service} */
			informationService = this.platformAccessory.addService(this.Service.AccessoryInformation)
		}

		informationService
			.setCharacteristic(this.Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(this.Characteristic.Model, this.productModel)
			.setCharacteristic(this.Characteristic.SerialNumber, this.serial)

		if (!this.disableAirConditioner && (this.capabilities.AUTO || this.capabilities.COOL || this.capabilities.HEAT)) {
			this.addHeaterCoolerService()
		} else {
			if (this.disableAirConditioner) {
				this.easyDebugInfo(`${this.name} - Skipping adding HeaterCooler due to disableAirConditioner: ${this.disableAirConditioner}`)
			}
			this.removeHeaterCoolerService()
		}

		if (!this.disableFan && this.capabilities.FAN && !this.modesToExclude.includes('FAN')) {
			this.addFanService()
		} else {
			this.removeFanService()
		}

		if (!this.disableDry && this.capabilities.DRY && !this.modesToExclude.includes('DRY')) {
			this.addDryService()
		} else {
			this.removeDryService()
		}

		// TODO: should HorizontalSwingSwitch and/or SyncButton be suppressed if HeaterCooler and Fan and Dry services don't exist?

		// TODO: see if HorizontalSwing can be created via a custom characteristic, rather than a separate accessory
		// https://developers.homebridge.io/HAP-NodeJS/classes/Characteristic.html
		if (!this.disableHorizontalSwing && ((this.capabilities.COOL && this.capabilities.COOL.horizontalSwing) || (this.capabilities.HEAT && this.capabilities.HEAT.horizontalSwing))) {
			this.addHorizontalSwingSwitch()
		} else {
			this.removeHorizontalSwingSwitch()
		}

		if (this.syncButtonInAccessory) {
			this.addSyncButtonService()
		} else {
			this.removeSyncButtonService()
		}

		if (this.climateReactSwitchInAccessory) {
			this.addClimateReactService()
		} else {
			this.removeClimateReactService()
		}

		if (((this.capabilities.COOL && this.capabilities.COOL.light) || (this.capabilities.HEAT && this.capabilities.HEAT.light)) && !this.disableLightSwitch) {
			this.addLightSwitch()
		} else {
			this.removeLightSwitch()
		}
	}

	// TODO: move this in to Utils.js
	addCharacteristicToService(ServiceName, CharacteristicName, Props = null, Setter = true) {
		this.easyDebugInfo(`${this.name} - Adding ${CharacteristicName} to ${ServiceName}`)

		const service = this.platformAccessory.getService(this.Service[ServiceName])
		const characteristic = service?.getCharacteristic(this.Characteristic[CharacteristicName])

		if (!service) {
			this.log.info(`ERR: ${this.name} - Service ${ServiceName} doesn't exist on ${this.name}`)

			return
		}

		if (!characteristic) {
			// TODO: I think characteristic will always be true as getCharacteristic always works...
			this.log.info(`ERR: ${this.name} - Characteristic ${CharacteristicName} doesn't exist on ${ServiceName}`)

			return
		}

		if (Props) {
			if (Props.minValue && Props.minValue >= characteristic.props.minValue) {
				// TODO: updateValue via this.Utils.updateValue?
				characteristic.updateValue(Props.minValue)
			}
			characteristic.setProps(Props)
		} else {
			this.easyDebugInfo(`${this.name} - Props not set for ${CharacteristicName}, proceeding with defaults.`)
		}

		characteristic
			.on('get', this.StateManager.get[CharacteristicName])

		if (Setter) {
			characteristic
				.on('set', this.StateManager.set[CharacteristicName])
		}
	}

	addHeaterCoolerService() {
		this.easyDebugInfo(`${this.name} - Adding HeaterCoolerService`)
		this.HeaterCoolerService = this.platformAccessory.getService(this.Service.HeaterCooler)
		if (!this.HeaterCoolerService) {
			this.HeaterCoolerService = this.platformAccessory.addService(this.Service.HeaterCooler, this.name, 'HeaterCooler')
		}

		const CurrentTempProps = {
			minValue: -100,
			maxValue: 100,
			minStep: 0.1
		}

		this.addCharacteristicToService('HeaterCooler', 'CurrentTemperature', CurrentTempProps, false)
		this.addCharacteristicToService('HeaterCooler', 'TemperatureDisplayUnits', null, false)

		if (!this.disableHumidity) {
			// TODO: check this warning... "Humidity isn't a supported Characteristic of HeaterCooler"
			//       Should we create a new custom Characteristic?
			// e.g. const customHumidity = new Characteristic('CustomHumidity', this.api.hap.uuid.generate('CustomHumidity' + this.id))
			this.addCharacteristicToService('HeaterCooler', 'CurrentRelativeHumidity', null, false)
		} else {
			// TODO: WIP trying to find a way to remove the Humidity characteristic immediately
			this.easyDebugInfo(`${this.name} - Removing Humidity characteristic`)
			this.HeaterCoolerService.removeCharacteristic(this.Characteristic.CurrentRelativeHumidity)
		}

		// TODO: change to:
		// this.addCharacteristicToService('HeaterCooler', 'Active', null, true)
		this.HeaterCoolerService.getCharacteristic(this.Characteristic.Active)
			.on('get', this.StateManager.get.ACActive)
			.on('set', this.StateManager.set.ACActive)

		this.addCharacteristicToService('HeaterCooler', 'CurrentHeaterCoolerState', null, false)

		const validModes = []

		for (const mode in this.capabilities) {
			if (this.capabilities[mode].homeKitSupported != true) {
				continue
			}

			if (this.modesToExclude.includes(mode)) {
				continue
			}

			if (validModes.includes(mode)) {
				continue
			}

			validModes.push(this.Characteristic.TargetHeaterCoolerState[mode])

			let modeProps = undefined

			if (this.capabilities[mode].temperatures) {
				if (this.capabilities[mode].temperatures[this.CELSIUS_UNIT]) {
					modeProps = {
						minValue: this.capabilities[mode].temperatures[this.CELSIUS_UNIT].min,
						maxValue: this.capabilities[mode].temperatures[this.CELSIUS_UNIT].max,
						minStep: this.temperatureStep
					}
				} else if (this.capabilities[mode].temperatures[this.FAHRENHEIT_UNIT]) {
					modeProps = {
						minValue: this.Utils.toCelsius(this.capabilities[mode].temperatures[this.FAHRENHEIT_UNIT].min),
						maxValue: this.Utils.toCelsius(this.capabilities[mode].temperatures[this.FAHRENHEIT_UNIT].max),
						minStep: this.temperatureStep
					}
				}
			}

			if (modeProps) {
				if (mode === 'COOL') {
					this.addCharacteristicToService('HeaterCooler', 'CoolingThresholdTemperature', modeProps)
				} else if (mode === 'HEAT') {
					this.addCharacteristicToService('HeaterCooler', 'HeatingThresholdTemperature', modeProps)
				} else if (mode === 'AUTO') {
					if (!this.capabilities.COOL || this.modesToExclude.includes('COOL')) {
						this.addCharacteristicToService('HeaterCooler', 'CoolingThresholdTemperature', modeProps)
					}

					if (!this.capabilities.HEAT || this.modesToExclude.includes('HEAT')) {
						this.addCharacteristicToService('HeaterCooler', 'HeatingThresholdTemperature', modeProps)
					}
				}
			}
		}

		if (validModes.length < 1) {
			this.log.info(`ERR: ${this.name} - TargetHeaterCoolerState validModes is empty (${validModes}), exiting addHeaterCoolerService`)

			return
		}

		// this.easyDebugInfo(`${this.name} - Calculated TargetHeaterCoolerState validValues: ${validModes.forEach(mode => {
		// 	return this.StateManager.characteristicToMode(mode)
		// })}`)
		// TODO: use a helper function to return names for the mode numbers
		this.easyDebugInfo(`${this.name} - Calculated TargetHeaterCoolerState validValues: [${validModes}]`)

		// Below is specific logic to change TargetHeaterCoolerState and prevent warnings when its current value is not
		// in the list of valid modes
		const TargetHeaterCoolerState = this.HeaterCoolerService.getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
		const currentValue = TargetHeaterCoolerState.value

		if (validModes.length > 0 && !validModes.includes(currentValue)) {
			const tempValidModes = [...validModes] // make a shallow copy
			const newMinValue = Math.min(...validModes) // validModes is an array of numbers (enums) that represent modes in HomeKit

			this.easyDebugInfo(`${this.name} - Temporarily including current value ${currentValue} to prevent warning,`
						+ ` then updating value to new minimum of ${newMinValue}`)
			tempValidModes.push(currentValue)

			// TODO: updateValue via this.Utils.updateValue?
			TargetHeaterCoolerState.setProps({ validValues: tempValidModes })
				.updateValue(newMinValue)
		}

		this.addCharacteristicToService('HeaterCooler', 'TargetHeaterCoolerState', { validValues: validModes })

		if (!this.disableVerticalSwing && ((this.capabilities.COOL && this.capabilities.COOL.verticalSwing) || (this.capabilities.HEAT && this.capabilities.HEAT.verticalSwing))) {
			this.HeaterCoolerService.getCharacteristic(this.Characteristic.SwingMode)
				.on('get', this.StateManager.get.ACSwing)
				.on('set', this.StateManager.set.ACSwing)
		} else {
			// TODO: WIP trying to find a way to remove the Vertical Swing (Oscillate) button immediately without needing the user to remove/reset the accessory.
			//       There doesn't seem to be a way to force a 'refresh'.
			//
			// 		 Check if we can do one or more of the following:
			//       1. hide the characteristic from the user? HMCharacteristicPropertyHidden
			//       2. Error the Characteristic?
			//       	  this.HeaterCoolerService.updateCharacteristic(Characteristic.SwingMode, new Error('A placeholder error object'))
			//       3. Remove and re-add the whole service or accessory?
			//       4. Try to see if the characteristic exists? this.HeaterCoolerService.testCharacteristic(Characteristic.SwingMode)
			//       5. Set StatusActive Characteristic - https://github.com/homebridge/HAP-NodeJS/wiki/Presenting-Erroneous-Accessory-State-to-the-User
			this.easyDebugInfo(`${this.name} - Removing Vertical Swing (Oscillate) button`)
			this.HeaterCoolerService.removeCharacteristic(this.Characteristic.SwingMode)
		}

		if ((this.capabilities.COOL && this.capabilities.COOL.fanSpeeds) || (this.capabilities.HEAT && this.capabilities.HEAT.fanSpeeds)) {
			this.HeaterCoolerService.getCharacteristic(this.Characteristic.RotationSpeed)
				.on('get', this.StateManager.get.ACRotationSpeed)
				.on('set', this.StateManager.set.ACRotationSpeed)
		}

		// TODO: check this warning...
		if (this.filterService) {
			// Apple HomeKit limitations mean a warning will be thrown as Filter characteristics doesn't exist under
			// the HeaterCooler service and a separate Filter service doesn't seem to show up in the Home app.
			// Home app also doesn't support Filter reset out of the box... could add a stateless switch?
			this.easyDebugInfo(`${this.name} - Adding Filter characteristics to ${this.name}`)

			this.HeaterCoolerService.getCharacteristic(this.Characteristic.FilterChangeIndication)
				.on('get', this.StateManager.get.FilterChangeIndication)

			this.HeaterCoolerService.getCharacteristic(this.Characteristic.FilterLifeLevel)
				.on('get', this.StateManager.get.FilterLifeLevel)

			this.HeaterCoolerService.getCharacteristic(this.Characteristic.ResetFilterIndication)
				.on('set', this.StateManager.set.ResetFilterIndication)
		}
	}

	removeHeaterCoolerService() {
		const HeaterCoolerService = this.platformAccessory.getService(this.Service.HeaterCooler)

		if (HeaterCoolerService) {
			// remove service
			this.easyDebugInfo(`${this.name} - Removing HeaterCoolerService`)
			this.platformAccessory.removeService(HeaterCoolerService)
		}
	}

	addFanService() {
		this.easyDebugInfo(`${this.name} - Adding FanService`)

		this.FanService = this.platformAccessory.getService(this.Service.Fanv2)
		if (!this.FanService) {
			this.FanService = this.platformAccessory.addService(this.Service.Fanv2, this.room.name + ' Fan', 'Fan')
		}

		this.FanService.getCharacteristic(this.Characteristic.Active)
			.on('get', this.StateManager.get.FanActive)
			.on('set', this.StateManager.set.FanActive)

		if (!this.disableVerticalSwing && this.capabilities.FAN.verticalSwing) {
			this.FanService.getCharacteristic(this.Characteristic.SwingMode)
				.on('get', this.StateManager.get.FanSwing)
				.on('set', this.StateManager.set.FanSwing)
		} else {
			// TODO: WIP trying to find a way to remove the Vertical Swing (Oscillate) button immediately without needing the user to remove/reset the accessory.
			this.easyDebugInfo(`${this.name} - Removing Vertical Swing (Oscillate) button`)
			this.FanService.removeCharacteristic(this.Characteristic.SwingMode)
		}

		if (this.capabilities.FAN.fanSpeeds) {
			this.FanService.getCharacteristic(this.Characteristic.RotationSpeed)
				.on('get', this.StateManager.get.FanRotationSpeed)
				.on('set', this.StateManager.set.FanRotationSpeed)
		}
	}

	removeFanService() {
		const FanService = this.platformAccessory.getService(this.Service.Fanv2)

		if (FanService) {
			// remove service
			this.easyDebugInfo(`${this.name} - Removing FanService`)
			this.platformAccessory.removeService(FanService)
		}
	}

	addDryService() {
		this.easyDebugInfo(`${this.name} - Adding DehumidifierService`)

		this.DryService = this.platformAccessory.getService(this.Service.HumidifierDehumidifier)
		if (!this.DryService) {
			this.DryService = this.platformAccessory.addService(this.Service.HumidifierDehumidifier, this.room.name + ' Dry', 'Dry')
		}

		this.DryService.getCharacteristic(this.Characteristic.Active)
			.on('get', this.StateManager.get.DryActive)
			.on('set', this.StateManager.set.DryActive)

		// CurrentRelativeHumidity is required on HumidifierDehumidifier, so we add regardless of "disableHumidity"
		this.DryService.getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
			.on('get', this.StateManager.get.CurrentRelativeHumidity)

		this.DryService.getCharacteristic(this.Characteristic.CurrentHumidifierDehumidifierState)
			.on('get', this.StateManager.get.CurrentHumidifierDehumidifierState)

		this.DryService.getCharacteristic(this.Characteristic.TargetHumidifierDehumidifierState)
			.setProps({
				minValue: 2,
				maxValue: 2,
				validValues: [this.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER]
			})
			.on('get', this.StateManager.get.TargetHumidifierDehumidifierState)
			.on('set', this.StateManager.set.TargetHumidifierDehumidifierState)

		if (!this.disableVerticalSwing && this.capabilities.DRY.verticalSwing) {
			this.DryService.getCharacteristic(this.Characteristic.SwingMode)
				.on('get', this.StateManager.get.DrySwing)
				.on('set', this.StateManager.set.DrySwing)
		} else {
			// TODO: WIP trying to find a way to remove the Vertical Swing (Oscillate) button immediately without needing the user to remove/reset the accessory.
			this.easyDebugInfo(`${this.name} - Removing Vertical Swing (Oscillate) button`)
			this.DryService.removeCharacteristic(this.Characteristic.SwingMode)
		}

		if (this.capabilities.DRY.fanSpeeds) {
			this.DryService.getCharacteristic(this.Characteristic.RotationSpeed)
				.on('get', this.StateManager.get.DryRotationSpeed)
				.on('set', this.StateManager.set.DryRotationSpeed)
		}
	}

	removeDryService() {
		const DryService = this.platformAccessory.getService(this.Service.HumidifierDehumidifier)

		if (DryService) {
			// remove service
			this.easyDebugInfo(`${this.name} - Removing DehumidifierService`)
			this.platformAccessory.removeService(DryService)
		}
	}

	addHorizontalSwingSwitch() {
		// TODO: review the logging... maybe line below becomes "Add HorizontalSwingSwitch" and
		//       new log line several rows below for Adding if doesn't already exist?
		//       do the same for other "add" functions
		this.easyDebugInfo(`${this.name} - Adding HorizontalSwingSwitchService`)

		this.HorizontalSwingSwitchService = this.platformAccessory.getService(this.room.name + ' Horizontal Swing')
		if (!this.HorizontalSwingSwitchService) {
			this.HorizontalSwingSwitchService = this.platformAccessory.addService(this.Service.Switch, this.room.name + ' Horizontal Swing', 'HorizontalSwingSwitch')
		}

		this.HorizontalSwingSwitchService.getCharacteristic(this.Characteristic.On)
			.on('get', this.StateManager.get.HorizontalSwing)
			.on('set', this.StateManager.set.HorizontalSwing)
	}

	removeHorizontalSwingSwitch() {
		// Below || is required in case of name/type change of HorizontalSwingSwitch Service
		const HorizontalSwingSwitch = this.platformAccessory.getService('HorizontalSwingSwitch') || this.platformAccessory.getService(this.room.name + ' Horizontal Swing')

		if (HorizontalSwingSwitch) {
			// remove service
			this.easyDebugInfo(`${this.name} - Removing HorizontalSwingSwitchService`)
			this.platformAccessory.removeService(HorizontalSwingSwitch)
		}
	}

	addLightSwitch() {
		this.easyDebugInfo(`${this.name} - Adding LightSwitchService`)

		this.LightSwitchService = this.platformAccessory.getService(this.room.name + 'AC Light')
		if (!this.LightSwitchService) {
			this.LightSwitchService = this.platformAccessory.addService(this.Service.Lightbulb, this.room.name + 'AC Light', 'LightSwitch')
		}

		this.LightSwitchService.getCharacteristic(this.Characteristic.On)
			.on('get', this.StateManager.get.LightSwitch)
			.on('set', this.StateManager.set.LightSwitch)
	}

	removeLightSwitch() {
		// Below || is required in case of name/type change of LightSwitch Service
		const LightSwitch = this.platformAccessory.getService('LightSwitch') || this.platformAccessory.getService(this.room.name + 'AC Light')

		if (LightSwitch) {
			// remove service
			this.easyDebugInfo(`${this.name} - Removing LightSwitchService`)
			this.platformAccessory.removeService(LightSwitch)
		}
	}

	addSyncButtonService() {
		this.easyDebugInfo(`${this.name} - Adding SyncButtonSwitchService`)

		this.SyncButtonService = this.platformAccessory.getService(this.room.name + ' Sync')
		if (!this.SyncButtonService) {
			this.SyncButtonService = this.platformAccessory.addService(this.Service.Switch, this.room.name + ' Sync', 'SyncButtonSwitch')
		}

		this.SyncButtonService.getCharacteristic(this.Characteristic.On)
			.on('get', this.StateManager.get.SyncButton)
			// TODO: see if below annoymous function can be moved to StateManager.js
			.on('set', (state, callback) => {
				this.StateManager.set.SyncButton(state, callback)
				setTimeout(() => {
					// TODO: updateValue via this.Utils.updateValue?
					this.SyncButtonService.getCharacteristic(this.Characteristic.On).updateValue(0)
				}, 1000)
			})
	}

	removeSyncButtonService() {
		// Below || is required in case of name/type change of SyncButton Service
		const SyncButtonService = this.platformAccessory.getService('SyncButton') || this.platformAccessory.getService('SyncButtonSwitch') || this.platformAccessory.getService(this.room.name + ' Sync')

		if (SyncButtonService) {
			// remove service
			this.easyDebugInfo(`${this.name} - Removing SyncButtonSwitchService`)
			this.platformAccessory.removeService(SyncButtonService)
		}
	}

	addClimateReactService() {
		this.easyDebugInfo(`${this.room.name} - Adding Climate React Service`)

		this.ClimateReactService = this.platformAccessory.getService(this.room.name + ' Climate React')
		if (!this.ClimateReactService) {
			this.ClimateReactService = this.platformAccessory.addService(this.Service.Switch, this.room.name + ' Climate React' , 'ClimateReact')
		}

		this.ClimateReactService.getCharacteristic(this.Characteristic.On)
			.on('get', this.StateManager.get.ClimateReactSwitch)
			.on('set', this.StateManager.set.ClimateReactSwitch)
	}

	removeClimateReactService() {
		// Below || is required in case of name/type change of ClimateReact Service
		const ClimateReactService = this.platformAccessory.getService('ClimateReact') || this.platformAccessory.getService(this.room.name + ' Climate React')

		if (ClimateReactService) {
			// remove service
			this.easyDebugInfo(`${this.room.name} - Removing Climate React Switch Service`)
			this.platformAccessory.removeService(ClimateReactService)
		}
	}

	updateHomeKit() {
		if (!(this.state instanceof Classes.InternalAcState)) {
			// TODO: log warning
			return
		}

		// log new state with FakeGato
		if (this.loggingService) {
			// TODO: remove humidity if disabled
			this.loggingService.addEntry({
				time: Math.floor((new Date()).getTime()/1000),
				temp: this.state.currentTemperature,
				humidity: this.state.relativeHumidity
			})
		}

		if (this.ClimateReactService) {
			if (!(this.state instanceof Classes.InternalAcState)) {
				// TODO: log warning
				return
			}

			const smartModeEnabledState = this.state?.smartMode?.enabled ?? false

			// update Climate React Service
			this.Utils.updateValue('ClimateReactService', 'On', smartModeEnabledState)
		}

		if (this.HeaterCoolerService) {
			// update measurements
			this.Utils.updateValue('HeaterCoolerService', 'CurrentTemperature', this.state.currentTemperature)

			if (!this.disableHumidity) {
				this.Utils.updateValue('HeaterCoolerService', 'CurrentRelativeHumidity', this.state.relativeHumidity)
			}
		}

		if (this.DryService) {
			this.Utils.updateValue('DryService', 'CurrentRelativeHumidity', this.state.relativeHumidity)
		}

		// if status is OFF, set all services to INACTIVE
		if (!this.state.active) {
			if (this.HeaterCoolerService) {
				this.Utils.updateValue('HeaterCoolerService', 'Active', 0)
				this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', this.Characteristic.CurrentHeaterCoolerState.INACTIVE)
			}

			if (this.DryService) {
				this.Utils.updateValue('DryService', 'Active', 0)
				this.Utils.updateValue('DryService', 'CurrentHumidifierDehumidifierState', 0)
			}

			if (this.FanService) {
				this.Utils.updateValue('FanService', 'Active', 0)
			}

			return
		}

		switch (this.state.mode) {
			case 'COOL':
			case 'HEAT':
			case 'AUTO':
				if (this.HeaterCoolerService) {
					// turn on HeaterCoolerService
					this.Utils.updateValue('HeaterCoolerService', 'Active', 1)

					// update temperatures for HeaterCoolerService
					this.Utils.updateValue('HeaterCoolerService', 'HeatingThresholdTemperature', this.state.targetTemperature)
					this.Utils.updateValue('HeaterCoolerService', 'CoolingThresholdTemperature', this.state.targetTemperature)

					// update vertical swing for HeaterCoolerService
					if (!this.disableVerticalSwing && this.capabilities[this.state.mode].verticalSwing) {
						this.Utils.updateValue('HeaterCoolerService', 'SwingMode', this.Characteristic.SwingMode[this.state.verticalSwing])
					}

					// update horizontal swing for HeaterCoolerService
					if (this.HorizontalSwingSwitchService) {
						this.Utils.updateValue('HorizontalSwingSwitchService', 'On', this.state.horizontalSwing === 'SWING_ENABLED')
					}

					// update light switch for HeaterCoolerService
					if (this.LightSwitchService) {
						const switchValue = this.state?.light ?? false

						this.Utils.updateValue('LightSwitchService', 'On', switchValue)
					}

					// update fanSpeed for HeaterCoolerService
					if (this.capabilities[this.state.mode].fanSpeeds) {
						this.Utils.updateValue('HeaterCoolerService', 'RotationSpeed', this.state.fanSpeed)
					}

					// update filter characteristics for HeaterCoolerService
					if (this.filterService) {
						this.Utils.updateValue('HeaterCoolerService', 'FilterChangeIndication', this.Characteristic.FilterChangeIndication[this.state.filterChange])
						this.Utils.updateValue('HeaterCoolerService', 'FilterLifeLevel', this.state.filterLifeLevel)
					}

					// set proper target and current state of HeaterCoolerService
					if (this.state.mode === 'COOL') {
						this.Utils.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', this.Characteristic.TargetHeaterCoolerState.COOL)
						this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', this.Characteristic.CurrentHeaterCoolerState.COOLING)
					} else if (this.state.mode === 'HEAT') {
						this.Utils.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', this.Characteristic.TargetHeaterCoolerState.HEAT)
						this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState',this.Characteristic.CurrentHeaterCoolerState.HEATING)
					} else if (this.state.mode === 'AUTO') {
						this.Utils.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', this.Characteristic.TargetHeaterCoolerState.AUTO)
						if (this.state.currentTemperature > this.state.targetTemperature) {
							this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', this.Characteristic.CurrentHeaterCoolerState.COOLING)
						} else {
							this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', this.Characteristic.CurrentHeaterCoolerState.HEATING)
						}
					}
				}

				if (this.DryService) {
					// turn off DryService
					this.Utils.updateValue('DryService', 'Active', 0)
					this.Utils.updateValue('DryService', 'CurrentHumidifierDehumidifierState', 0)
				}

				if (this.FanService) {
					// turn off FanService
					this.Utils.updateValue('FanService', 'Active', 0)
				}

				break

			case 'FAN':
				if (this.DryService) {
					// turn off DryService
					this.Utils.updateValue('DryService', 'Active', 0)
					this.Utils.updateValue('DryService', 'CurrentHumidifierDehumidifierState', 0)
				}

				if (this.FanService) {
					// turn on FanService
					this.Utils.updateValue('FanService', 'Active', 1)

					// update swing for FanService
					if (!this.disableVerticalSwing && this.capabilities.FAN.verticalSwing) {
						this.Utils.updateValue('FanService', 'SwingMode', this.Characteristic.SwingMode[this.state.verticalSwing])
					}

					// update fanSpeed for FanService
					if (this.capabilities.FAN.fanSpeeds) {
						this.Utils.updateValue('FanService', 'RotationSpeed', this.state.fanSpeed)
					}
				}

				if (this.HeaterCoolerService) {
					// turn off HeaterCoolerService
					this.Utils.updateValue('HeaterCoolerService', 'Active', 0)
					this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', this.Characteristic.CurrentHeaterCoolerState.INACTIVE)
				}

				break

			case 'DRY':
				if (this.DryService) {
					// turn on DryService
					this.Utils.updateValue('DryService', 'Active', 1)
					this.Utils.updateValue('DryService', 'CurrentHumidifierDehumidifierState', this.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING)

					// update swing for DryService
					if (!this.disableVerticalSwing && this.capabilities.DRY.verticalSwing) {
						this.Utils.updateValue('DryService', 'SwingMode', this.Characteristic.SwingMode[this.state.verticalSwing])
					}

					// update fanSpeed for DryService
					if (this.capabilities.DRY.fanSpeeds) {
						this.Utils.updateValue('DryService', 'RotationSpeed', this.state.fanSpeed)
					}
				}

				if (this.FanService) {
					// turn off FanService
					this.Utils.updateValue('FanService', 'Active', 0)
				}

				if (this.HeaterCoolerService) {
					// turn off HeaterCoolerService
					this.Utils.updateValue('HeaterCoolerService', 'Active', 0)
					this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', this.Characteristic.CurrentHeaterCoolerState.INACTIVE)
				}

				break
		}

		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

}

module.exports = AirConditioner