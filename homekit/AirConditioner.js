const unified = require('../sensibo/unified')
let Characteristic, Service, CELSIUS_UNIT, FAHRENHEIT_UNIT

class AirConditioner {

	constructor(device, platform) {
		Service = platform.api.hap.Service
		Characteristic = platform.api.hap.Characteristic
		CELSIUS_UNIT = platform.CELSIUS_UNIT
		FAHRENHEIT_UNIT = platform.FAHRENHEIT_UNIT

		this.Utils = require('../sensibo/Utils')(this, platform)

		const deviceInfo = unified.deviceInformation(device)

		this.log = platform.log
		this.api = platform.api
		this.storage = platform.storage
		this.cachedState = platform.cachedState
		this.id = deviceInfo.id
		this.appId = deviceInfo.appId
		this.model = deviceInfo.model
		this.serial = deviceInfo.serial
		this.manufacturer = deviceInfo.manufacturer
		this.roomName = deviceInfo.roomName
		this.name = this.roomName + ' AC'
		this.type = 'AirConditioner'
		this.displayName = this.name
		this.disableHumidity = platform.disableHumidity
		this.modesToExclude = platform.modesToExclude
		this.temperatureUnit = deviceInfo.temperatureUnit
		this.climateReactSwitchInAccessory = platform.climateReactSwitchInAccessory
		this.usesFahrenheit = this.temperatureUnit === FAHRENHEIT_UNIT
		this.temperatureStep = this.temperatureUnit === FAHRENHEIT_UNIT ? 0.1 : 1
		this.disableAirConditioner = platform.disableAirConditioner
		this.disableDry = platform.disableDry
		this.disableFan = platform.disableFan
		this.disableHorizontalSwing = platform.disableHorizontalSwing
		this.disableVerticalSwing = platform.disableVerticalSwing
		this.disableLightSwitch = platform.disableLightSwitch
		this.syncButtonInAccessory = platform.syncButtonInAccessory
		this.filterService = deviceInfo.filterService
		this.capabilities = unified.capabilities(device, platform)

		const StateHandler = require('../sensibo/StateHandler')(this, platform)

		this.state = this.cachedState.devices[this.id] = unified.acState(device)
		this.state = new Proxy(this.state, StateHandler)
		this.stateManager = require('./StateManager')(this, platform)

		this.UUID = this.api.hap.uuid.generate(this.id)
		this.accessory = platform.cachedAccessories.find(accessory => {
			return accessory.UUID === this.UUID
		})

		if (!this.accessory) {
			this.log(`Creating New ${platform.PLATFORM_NAME} ${this.type} Accessory in the ${this.roomName}`)
			this.accessory = new this.api.platformAccessory(this.name, this.UUID)
			this.accessory.context.type = this.type
			this.accessory.context.deviceId = this.id

			platform.cachedAccessories.push(this.accessory)
			// register the accessory
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory])
		}

		if (platform.enableHistoryStorage) {
			const FakeGatoHistoryService = require('fakegato-history')(this.api)

			this.loggingService = new FakeGatoHistoryService('weather', this.accessory, {
				storage: 'fs',
				path: platform.persistPath
			})
		}

		this.accessory.context.roomName = this.roomName

		let informationService = this.accessory.getService(Service.AccessoryInformation)

		if (!informationService) {
			informationService = this.accessory.addService(Service.AccessoryInformation)
		}

		informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)

		if (!this.disableAirConditioner && (this.capabilities.AUTO || this.capabilities.COOL || this.capabilities.HEAT)) {
			this.addHeaterCoolerService()
		} else {
			if (this.disableAirConditioner) {
				this.log.easyDebug(`${this.name} - Skipping adding HeaterCooler due to disableAirConditioner: ${this.disableAirConditioner}`)
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
		this.log.easyDebug(`${this.name} - Adding ${CharacteristicName} to ${ServiceName}`)

		const service = this.accessory.getService(Service[ServiceName])
		const characteristic = service?.getCharacteristic(Characteristic[CharacteristicName])

		if (!service) {
			this.log(`ERR: ${this.name} - Service ${ServiceName} doesn't exist on ${this.name}`)

			return
		}

		if (!characteristic) {
			// TODO: I think characteristic will always be true as getCharacteristic always works...
			this.log(`ERR: ${this.name} - Characteristic ${CharacteristicName} doesn't exist on ${ServiceName}`)

			return
		}

		if (Props) {
			if (Props.minValue && Props.minValue >= characteristic.props.minValue) {
				//TODO: updateValue via this.Utils.updateValue?
				characteristic.updateValue(Props.minValue)
			}
			characteristic.setProps(Props)
		} else {
			this.log.easyDebug(`${this.name} - Props not set for ${CharacteristicName}, proceeding with defaults`)
		}

		characteristic
			.on('get', this.stateManager.get[CharacteristicName])

		if (Setter) {
			characteristic
				.on('set', this.stateManager.set[CharacteristicName])
		}
	}

	addHeaterCoolerService() {
		this.log.easyDebug(`${this.name} - Adding HeaterCoolerService`)
		this.HeaterCoolerService = this.accessory.getService(Service.HeaterCooler)
		if (!this.HeaterCoolerService) {
			this.HeaterCoolerService = this.accessory.addService(Service.HeaterCooler, this.name, 'HeaterCooler')
		}

		const CurrentTempProps = {
			minValue: -100,
			maxValue: 100,
			minStep: 0.1
		}

		this.addCharacteristicToService('HeaterCooler', 'CurrentTemperature', CurrentTempProps, false)
		this.addCharacteristicToService('HeaterCooler', 'TemperatureDisplayUnits', null, false)

		if (!this.disableHumidity) {
			//TODO: check on warning... Humidity isn't a supported Characteristic of HeaterCooler
			// Could we create a new custom Characteristic?
			// const customHumidity = new Characteristic('CustomHumidity', this.api.hap.uuid.generate('CustomHumidity'+this.id))
			this.addCharacteristicToService('HeaterCooler', 'CurrentRelativeHumidity', null, false)
		} else {
			this.log.easyDebug(`${this.name} - Removing Humidity characteristic`)
			this.HeaterCoolerService.removeCharacteristic(Characteristic.CurrentRelativeHumidity)
		}

		this.HeaterCoolerService.getCharacteristic(Characteristic.Active)
			.on('get', this.stateManager.get.ACActive)
			.on('set', this.stateManager.set.ACActive)

		// TODO: get/set above is calling ACActive... expects it to be just Active
		// this.addCharacteristicToService('HeaterCooler', 'Active')

		this.addCharacteristicToService('HeaterCooler', 'CurrentHeaterCoolerState', null, false)

		const validModes = []
		const modeProps = {}

		for (const mode in this.capabilities) {
			if (this.capabilities[mode].homeAppEnabled && !this.modesToExclude.includes(mode) && !validModes.includes(mode)) {
				validModes.push(Characteristic.TargetHeaterCoolerState[mode])

				modeProps[mode] = {
					minValue: this.capabilities[mode].temperatures[CELSIUS_UNIT].min,
					maxValue: this.capabilities[mode].temperatures[CELSIUS_UNIT].max,
					minStep: this.temperatureStep
				}

				// TODO: can we add directly from here and remove more logic below?
				// this.addCharacteristicToService('HeaterCooler', 'CoolingThresholdTemperature', props)
				// this.addCharacteristicToService('HeaterCooler', 'HeatingThresholdTemperature', props)
			}
		}

		if (validModes.length < 1) {
			this.log(`ERR: ${this.name} - TargetHeaterCoolerState validModes is empty (${validModes}), exiting addHeaterCoolerService`)

			return
		}

		// this.log.easyDebug(`${this.name} - Calculated TargetHeaterCoolerState validValues: ${validModes.forEach(mode => {
		// 	return this.stateManager.characteristicToMode(mode)
		// })}`)
		// TODO: use a helper function to return names for the mode numbers
		this.log.easyDebug(`${this.name} - Calculated TargetHeaterCoolerState validValues: ${validModes}`)

		// Below is specific logic to change TargetHeaterCoolerState and prevent warnings when its current value is not
		// in the list of valid modes
		const TargetHeaterCoolerState = this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
		const currentValue = TargetHeaterCoolerState.value

		if (validModes.length > 0 && !validModes.includes(currentValue)) {
			const tempValidModes = [...validModes] // make a shallow copy
			const newMinValue = Math.min(...validModes)

			this.log.easyDebug(`${this.name} - Temporarily including current value ${currentValue} to prevent warning,`
						+ ` then updating value to new minimum of ${newMinValue}`)
			tempValidModes.push(currentValue)
			//TODO: updateValue via this.Utils.updateValue?
			TargetHeaterCoolerState.setProps({ validValues: tempValidModes })
				.updateValue(newMinValue)
		}

		this.addCharacteristicToService('HeaterCooler', 'TargetHeaterCoolerState', { validValues: validModes })

		if (this.capabilities.COOL && !this.modesToExclude.includes('COOL')) {
			this.addCharacteristicToService('HeaterCooler', 'CoolingThresholdTemperature', modeProps.COOL)
		}

		if (this.capabilities.HEAT && !this.modesToExclude.includes('HEAT')) {
			this.addCharacteristicToService('HeaterCooler', 'HeatingThresholdTemperature', modeProps.HEAT)
		}

		if (this.capabilities.AUTO?.temperatures && !this.modesToExclude.includes('AUTO')) {
			if (!this.capabilities.COOL || this.modesToExclude.includes('COOL')) {
				this.addCharacteristicToService('HeaterCooler', 'CoolingThresholdTemperature', modeProps.AUTO)
			}

			if (!this.capabilities.HEAT || this.modesToExclude.includes('HEAT')) {
				this.addCharacteristicToService('HeaterCooler', 'HeatingThresholdTemperature', modeProps.AUTO)
			}
		}

		if (!this.disableVerticalSwing && ((this.capabilities.COOL && this.capabilities.COOL.verticalSwing) || (this.capabilities.HEAT && this.capabilities.HEAT.verticalSwing))) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode)
				.on('get', this.stateManager.get.ACSwing)
				.on('set', this.stateManager.set.ACSwing)
		} else {
			this.log.easyDebug('Removing Vertical Swing (Oscillate) button')
			// TODO: WIP trying to find a way to remove the Oscillate switch immediately, without needing the user to
			// remove / reset the accessory... there doesn't seem to be a way to force a 'refresh'
			// Could we: 1. hide the characteristic from the user? HMCharacteristicPropertyHidden
			// 2. Error the Characteristic?
			// this.HeaterCoolerService.updateCharacteristic(Characteristic.SwingMode, new Error('A placeholder error object'))
			// 3. Remove and re-add the whole service or accessory?
			// 4. Try to see if the characteristic exists? this.HeaterCoolerService.testCharacteristic(Characteristic.SwingMode)
			// 5. Set StatusActive Characteristic - https://github.com/homebridge/HAP-NodeJS/wiki/Presenting-Erroneous-Accessory-State-to-the-User
			this.HeaterCoolerService.removeCharacteristic(Characteristic.SwingMode)
		}

		if ((this.capabilities.COOL && this.capabilities.COOL.fanSpeeds) || (this.capabilities.HEAT && this.capabilities.HEAT.fanSpeeds)) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.stateManager.get.ACRotationSpeed)
				.on('set', this.stateManager.set.ACRotationSpeed)
		}

		//TODO: check on this warning...
		if (this.filterService) {
			// Apple HomeKit limitations mean a warning will be thrown as Filter characteristics doesn't exist under
			// the HeaterCooler service and a separate Filter service doesn't seem to show up in the Home app.
			// Home app also doesn't support Filter reset out of the box... could add a stateless switch?
			this.log.easyDebug(`${this.name} - Adding Filter characteristics to ${this.name}`)

			this.HeaterCoolerService.getCharacteristic(Characteristic.FilterChangeIndication)
				.on('get', this.stateManager.get.FilterChangeIndication)

			this.HeaterCoolerService.getCharacteristic(Characteristic.FilterLifeLevel)
				.on('get', this.stateManager.get.FilterLifeLevel)

			this.HeaterCoolerService.getCharacteristic(Characteristic.ResetFilterIndication)
				.on('set', this.stateManager.set.ResetFilterIndication)
		}
	}

	removeHeaterCoolerService() {
		const HeaterCoolerService = this.accessory.getService(Service.HeaterCooler)

		if (HeaterCoolerService) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing HeaterCoolerService`)
			this.accessory.removeService(HeaterCoolerService)
		}
	}

	addFanService() {
		this.log.easyDebug(`${this.name} - Adding FanService`)

		this.FanService = this.accessory.getService(Service.Fanv2)
		if (!this.FanService) {
			this.FanService = this.accessory.addService(Service.Fanv2, this.roomName + ' Fan', 'Fan')
		}

		this.FanService.getCharacteristic(Characteristic.Active)
			.on('get', this.stateManager.get.FanActive)
			.on('set', this.stateManager.set.FanActive)

		if (!this.disableVerticalSwing && this.capabilities.FAN.verticalSwing) {
			this.FanService.getCharacteristic(Characteristic.SwingMode)
				.on('get', this.stateManager.get.FanSwing)
				.on('set', this.stateManager.set.FanSwing)
		} else {
			this.FanService.removeCharacteristic(Characteristic.SwingMode)
		}

		if (this.capabilities.FAN.fanSpeeds) {
			this.FanService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.stateManager.get.FanRotationSpeed)
				.on('set', this.stateManager.set.FanRotationSpeed)
		}
	}

	removeFanService() {
		const FanService = this.accessory.getService(Service.Fanv2)

		if (FanService) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing FanService`)
			this.accessory.removeService(FanService)
		}
	}

	addDryService() {
		this.log.easyDebug(`${this.name} - Adding DehumidifierService`)

		this.DryService = this.accessory.getService(Service.HumidifierDehumidifier)
		if (!this.DryService) {
			this.DryService = this.accessory.addService(Service.HumidifierDehumidifier, this.roomName + ' Dry', 'Dry')
		}

		this.DryService.getCharacteristic(Characteristic.Active)
			.on('get', this.stateManager.get.DryActive)
			.on('set', this.stateManager.set.DryActive)

		this.DryService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
			.on('get', this.stateManager.get.CurrentRelativeHumidity)

		this.DryService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
			.on('get', this.stateManager.get.CurrentHumidifierDehumidifierState)

		this.DryService.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
			.setProps({
				minValue: 2,
				maxValue: 2,
				validValues: [Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER]
			})
			.on('get', this.stateManager.get.TargetHumidifierDehumidifierState)
			.on('set', this.stateManager.set.TargetHumidifierDehumidifierState)

		if (!this.disableVerticalSwing && this.capabilities.DRY.verticalSwing) {
			this.DryService.getCharacteristic(Characteristic.SwingMode)
				.on('get', this.stateManager.get.DrySwing)
				.on('set', this.stateManager.set.DrySwing)
		} else {
			this.DryService.removeCharacteristic(Characteristic.SwingMode)
		}

		if (this.capabilities.DRY.fanSpeeds) {
			this.DryService.getCharacteristic(Characteristic.RotationSpeed)
				.on('get', this.stateManager.get.DryRotationSpeed)
				.on('set', this.stateManager.set.DryRotationSpeed)
		}
	}

	removeDryService() {
		const DryService = this.accessory.getService(Service.HumidifierDehumidifier)

		if (DryService) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing DehumidifierService`)
			this.accessory.removeService(DryService)
		}
	}

	addHorizontalSwingSwitch() {
		//TODO: review the logging... maybe line below becomes "Add HorizontalSwingSwitch" and new log line 5 rows below for Adding if doesn't already exist?
		//Do the same for other "add" functions
		this.log.easyDebug(`${this.name} - Adding HorizontalSwingSwitchService`)

		this.HorizontalSwingSwitchService = this.accessory.getService(this.roomName + ' Horizontal Swing')
		if (!this.HorizontalSwingSwitchService) {
			this.HorizontalSwingSwitchService = this.accessory.addService(Service.Switch, this.roomName + ' Horizontal Swing', 'HorizontalSwingSwitch')
		}

		this.HorizontalSwingSwitchService.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.HorizontalSwing)
			.on('set', this.stateManager.set.HorizontalSwing)
	}

	removeHorizontalSwingSwitch() {
		const HorizontalSwingSwitch = this.accessory.getService(this.roomName + ' Horizontal Swing')

		if (HorizontalSwingSwitch) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing HorizontalSwingSwitchService`)
			this.accessory.removeService(HorizontalSwingSwitch)
		}
	}

	addLightSwitch() {
		this.log.easyDebug(`${this.name} - Adding LightSwitchService`)

		this.LightSwitchService = this.accessory.getService(this.roomName + ' Light')
		if (!this.LightSwitchService) {
			this.LightSwitchService = this.accessory.addService(Service.Lightbulb, this.roomName + ' Light', 'LightSwitch')
		}

		this.LightSwitchService.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.LightSwitch)
			.on('set', this.stateManager.set.LightSwitch)
	}

	removeLightSwitch() {
		const LightSwitch = this.accessory.getService(this.roomName + ' Light')

		if (LightSwitch) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing LightSwitchService`)
			this.accessory.removeService(LightSwitch)
		}
	}

	addSyncButtonService() {
		this.log.easyDebug(`${this.name} - Adding SyncButtonSwitchService`)

		this.SyncButtonService = this.accessory.getService(this.roomName + ' Sync')
		if (!this.SyncButtonService) {
			this.SyncButtonService = this.accessory.addService(Service.Switch, this.roomName + ' Sync', 'SyncButtonSwitch')
		}

		this.SyncButtonService.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.SyncButton)
			// TODO: see if below annoymous function can be moved to StateManager.js
			.on('set', (state, callback) => {
				this.stateManager.set.SyncButton(state, callback)
				setTimeout(() => {
					//TODO: updateValue via this.Utils.updateValue?
					this.SyncButtonService.getCharacteristic(Characteristic.On).updateValue(0)
				}, 1000)
			})
	}

	removeSyncButtonService() {
		const SyncButtonService = this.accessory.getService(this.roomName + ' Sync')

		if (SyncButtonService) {
			// remove service
			this.log.easyDebug(`${this.name} - Removing SyncButtonSwitchService`)
			this.accessory.removeService(SyncButtonService)
		}
	}

	addClimateReactService() {
		this.log.easyDebug(`${this.roomName} - Adding Climate React Switch Service`)

		this.ClimateReactService = this.accessory.getService(this.roomName + ' Climate React')
		if (!this.ClimateReactService) {
			this.ClimateReactService = this.accessory.addService(Service.Switch, this.roomName + ' Climate React' , 'ClimateReactSwitch')
		}

		this.ClimateReactService.getCharacteristic(Characteristic.On)
			.on('get', this.stateManager.get.ClimateReactSwitch)
			.on('set', this.stateManager.set.ClimateReactSwitch)
	}

	removeClimateReactService() {
		const ClimateReactService = this.accessory.getService(this.roomName + ' Climate React')

		if (ClimateReactService) {
			// remove service
			this.log.easyDebug(`${this.roomName} - Removing Climate React Switch Service`)
			this.accessory.removeService(ClimateReactService)
		}
	}

	updateHomeKit() {
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
			const smartModeEnabledState = this.state?.smartMode?.enabled ?? false

			// update Climate React Service
			this.updateValue('ClimateReactService', 'On', smartModeEnabledState)
		}

		if (this.HeaterCoolerService) {
			// update measurements
			this.Utils.updateValue('HeaterCoolerService', 'CurrentTemperature', this.state.currentTemperature)
			this.Utils.updateValue('HeaterCoolerService', 'CurrentRelativeHumidity', this.state.relativeHumidity)
		}

		// TODO: could this just check this.DryService?
		if (this.capabilities.DRY && !this.disableDry) {
			this.Utils.updateValue('DryService', 'CurrentRelativeHumidity', this.state.relativeHumidity)
		}

		// if status is OFF, set all services to INACTIVE
		if (!this.state.active) {
			if (this.HeaterCoolerService) {
				this.Utils.updateValue('HeaterCoolerService', 'Active', 0)
				this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.INACTIVE)
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
					if (!this.disableVerticalSwing && this.capabilities[this.state.mode].VerticalSwing) {
						this.Utils.updateValue('HeaterCoolerService', 'SwingMode', Characteristic.SwingMode[this.state.verticalSwing])
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
						this.Utils.updateValue('HeaterCoolerService', 'FilterChangeIndication', Characteristic.FilterChangeIndication[this.state.filterChange])
						this.Utils.updateValue('HeaterCoolerService', 'FilterLifeLevel', this.state.filterLifeLevel)
					}

					// set proper target and current state of HeaterCoolerService
					if (this.state.mode === 'COOL') {
						this.Utils.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', Characteristic.TargetHeaterCoolerState.COOL)
						this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.COOLING)
					} else if (this.state.mode === 'HEAT') {
						this.Utils.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', Characteristic.TargetHeaterCoolerState.HEAT)
						this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.HEATING)
					} else if (this.state.mode === 'AUTO') {
						this.Utils.updateValue('HeaterCoolerService', 'TargetHeaterCoolerState', Characteristic.TargetHeaterCoolerState.AUTO)
						if (this.state.currentTemperature > this.state.targetTemperature) {
							this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.COOLING)
						} else {
							this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.HEATING)
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
						this.Utils.updateValue('FanService', 'SwingMode', Characteristic.SwingMode[this.state.verticalSwing])
					}

					// update fanSpeed for FanService
					if (this.capabilities.FAN.fanSpeeds) {
						this.Utils.updateValue('FanService', 'RotationSpeed', this.state.fanSpeed)
					}
				}

				if (this.HeaterCoolerService) {
					// turn off HeaterCoolerService
					this.Utils.updateValue('HeaterCoolerService', 'Active', 0)
					this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.INACTIVE)
				}

				break

			case 'DRY':
				if (this.DryService) {
					// turn on DryService
					this.Utils.updateValue('DryService', 'Active', 1)
					this.Utils.updateValue('DryService', 'CurrentHumidifierDehumidifierState', Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING)

					// update swing for DryService
					if (!this.disableVerticalSwing && this.capabilities.DRY.verticalSwing) {
						this.Utils.updateValue('DryService', 'SwingMode', Characteristic.SwingMode[this.state.verticalSwing])
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
					this.Utils.updateValue('HeaterCoolerService', 'CurrentHeaterCoolerState', Characteristic.CurrentHeaterCoolerState.INACTIVE)
				}

				break
		}

		// cache last state to storage
		this.storage.setItem('state', this.cachedState)
	}

}

module.exports = AirConditioner