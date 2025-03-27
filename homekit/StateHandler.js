function sensiboFormattedACState(device, state) {
	device.log.easyDebug(`${device.name} -> sensiboFormattedACState start`)
	// device.log.easyDebug(`${device.name} -> sensiboFormattedACState acState: ${JSON.stringify(acState, null, 4)}`)

	const acState = {
		on: state.active,
		mode: state.mode.toLowerCase(),
		targetTemperature: device.usesFahrenheit ? device.Utils.toFahrenheit(state.targetTemperature) : state.targetTemperature,
		temperatureUnit: device.temperatureUnit
	}
	const swingModes = device.Utils.sensiboFormattedSwingModes(device.capabilities[state.mode], state)

	// be mindful .assign() copies references (not a deep clone): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign#examples
	Object.assign(acState, swingModes)

	if ('fanSpeeds' in device.capabilities[state.mode]) {
		acState.fanLevel = device.Utils.percentToFanLevel(state.fanSpeed, device.capabilities[state.mode].fanSpeeds)
	}

	if ('light' in device.capabilities[state.mode]) {
		acState.light = state.light ? 'on' : 'off'
	}

	// device.log.easyDebug(`${device.name} -> sensiboFormattedACState acState: ${JSON.stringify(acState, null, 4)}`)

	return acState
}

function sensiboFormattedClimateReactState(device, state) {
	device.log.easyDebug(`${device.name} -> sensiboFormattedClimateReactState start`)
	// device.log.easyDebug(`${device.name} -> sensiboFormattedClimateReactState state: ${JSON.stringify(state, null, 4)}`)

	// Note: See Github issue #149, in the Sensibo app you can choose to set high, low or both as triggers
	//       This means lowTemperatureState or highTemperatureState *could* be empty, this caused a silent error which
	//       prevented the ClimateReact state (sensiboFormattedClimateReactState) from being set correctly and prevented
	//       the API call.

	// Note 2: See Github issue #148, previous implementation caused some users ClimateReact property settings to be overwritten
	//         with the current values from HomeKit. As HomeKit doesn't support all values (e.g. fixed swing modes) that Sensibo does
	//         this was unexpectedly, and unwantedly, changing users ClimateReact settings.
	//         We now use the values directly from the pre-existing state.smartMode, including:
	//         fanLevel, light, swing and horizontalSwing

	// FIXME: check if this function is even required anymore, updateClimateReact (currently in StateManager.js) is handling any user
	//        changes (e.g. when autoSetup is enabled). The differences in 'shape' between state.smartMode (this plugins object model)
	//        and device.smartMode (from the API response) have been removed, for example fanSpeed (%) from acState is fanLevel, therefore
	//        this function is now only extracting the existing values from state.smartMode and copying them in to a new object,
	//        climateReactState, and returning it... this could probably be done simply on line 292 with climateReactState = state.smartMode

	const smartModeState = state.smartMode
	const climateReactState = {
		enabled: smartModeState.enabled,
		// Empty high / low settings (state) so they can be set / updated below
		highTemperatureState: null,
		highTemperatureThreshold: smartModeState.highTemperatureThreshold ?? null,
		highTemperatureWebhook: null,
		lowTemperatureState: null,
		lowTemperatureThreshold: smartModeState.lowTemperatureThreshold ?? null,
		lowTemperatureWebhook: null,
		sync_with_ac_power: smartModeState.sync_with_ac_power ?? false,
		type: smartModeState.type
	}

	if (smartModeState.highTemperatureState) {
		climateReactState.highTemperatureState = {
			mode: smartModeState.highTemperatureState.mode,
			on: smartModeState.highTemperatureState.on,
			swing: smartModeState.highTemperatureState.swing
		}

		// Note: fanLevel may not exist if the unit is in DRY mode
		if ('fanLevel' in smartModeState.highTemperatureState) {
			climateReactState.highTemperatureState.fanLevel = smartModeState.highTemperatureState.fanLevel
		}

		// Note: targetTemperature (probably) won't exist if the unit is in FAN mode
		if ('targetTemperature' in smartModeState.highTemperatureState) {
			climateReactState.highTemperatureState.targetTemperature = smartModeState.highTemperatureState.targetTemperature
			climateReactState.highTemperatureState.temperatureUnit = smartModeState.highTemperatureState.temperatureUnit
		}

		if ('horizontalSwing' in smartModeState.highTemperatureState) {
			climateReactState.highTemperatureState.horizontalSwing = smartModeState.highTemperatureState.horizontalSwing
		}

		if ('light' in smartModeState.highTemperatureState) {
			climateReactState.highTemperatureState.light = smartModeState.highTemperatureState.light
		}
	}

	if (smartModeState.lowTemperatureState) {
		climateReactState.lowTemperatureState = {
			mode: smartModeState.lowTemperatureState.mode,
			on: smartModeState.lowTemperatureState.on,
			swing: smartModeState.lowTemperatureState.swing
		}

		// Note: fanLevel may not exist if the unit is in DRY mode
		if ('fanLevel' in smartModeState.lowTemperatureState) {
			climateReactState.lowTemperatureState.fanLevel = smartModeState.lowTemperatureState.fanLevel
		}

		// Note: targetTemperature (probably) won't exist if the unit is in FAN mode
		if ('targetTemperature' in smartModeState.lowTemperatureState) {
			climateReactState.lowTemperatureState.targetTemperature = smartModeState.lowTemperatureState.targetTemperature
			climateReactState.lowTemperatureState.temperatureUnit = smartModeState.lowTemperatureState.temperatureUnit
		}

		if ('horizontalSwing' in smartModeState.lowTemperatureState) {
			climateReactState.lowTemperatureState.horizontalSwing = smartModeState.lowTemperatureState.horizontalSwing
		}

		if ('light' in smartModeState.lowTemperatureState) {
			climateReactState.lowTemperatureState.light = smartModeState.lowTemperatureState.light
		}
	}

	device.log.easyDebug(`${device.name} -> sensiboFormattedClimateReactState end`)
	// device.log.easyDebug(`${device.name} -> sensiboFormattedClimateReactState climateReactState: ${JSON.stringify(climateReactState, null, 4)}`)

	return climateReactState
}

export default (device, platform) => {
	// TODO: setTimeoutDelay should probably be set in index.js
	const setTimeoutDelay = 1000
	let setTimer = null
	let preventTurningOff = false
	const sensiboApi = platform.sensiboApi
	const log = platform.log

	return {
		// As StateHandler is invoked as a Proxy the below overwrites/intercepts the default get() commands [traps]
		// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
		get: (target, prop, ...args) => {
			// log.easyDebug(`StateHandler.js GET Prop: ${prop} for Target: ${JSON.stringify(target, null, 4)}`)

			// Skips if already refreshing (processingState) and/or outbound API running (setProcessing)
			// TODO: maybe also SKIP refreshState when done in the last 30 seconds? Though that could probably be handled within
			//       refreshState() by extending the existing 5 second timeout at the end
			if (!platform.processingState && !platform.setProcessing) {
				// log.easyDebug(`StateHandler.js GET Prop: ${prop} for Target: ${JSON.stringify(target, null, 4)}`)
				platform.refreshState()
					.catch(error => {
						log.error(`${device.name} - StateHandler GET - error occurred in refreshState\nError content:`)
						log.warn(error)
					})
			} else {
				log.devDebug(`${device.name} - StateHandler GET - skipping refreshState() as processingState=${platform.processingState} or setProcessing=${platform.setProcessing} is true`)
				log.devDebug(`${device.name} - StateHandler GET - Prop: ${prop}`)
			}

			// returns an anonymous *function* to update state (multiple properties)
			if (prop === 'update') {
				// 'state' below is the value passed in when the update() function is called
				// see refreshState.js, e.g. airConditioner.state.update(airConditioner.Utils.airConditionerStateFromDevice(device))
				return state => {
					// log.easyDebug(`StateHandler.js GET state obj: ${JSON.stringify(state, null, 4)}`)
					if (!platform.setProcessing) {
						Object.keys(state).forEach(key => {
							// log.easyDebug(`StateHandler.js GET prop = update(), key: ${key}, value: ${state[key]}`)
							if (state[key] !== null) {
								target[key] = state[key]
							}
						})
						device.updateHomeKit()
					} else {
						log.devDebug(`${device.name} - StateHandler GET update - skipping (state) update and updateHomeKit() as setProcessing=${platform.setProcessing} is true`)
					}
				}
			}

			// return a function to sync ac state
			// TODO: should be moved to be a 'set' below, see also StateManager
			if (prop === 'syncState') {
				return async () => {
					try {
						log.easyDebug(`${device.name} - StateHandler syncState - syncing`)

						await sensiboApi.syncDeviceState(device.id, !target.active)
						target.active = !target.active
						device.updateHomeKit()
					} catch (error) {
						log.error(`${device.name} - StateHandler syncState - ERROR Syncing!`)
						log.warn(`${device.name} - Error message: ${error.message}`)
					}
				}
			}

			return Reflect.get(target, prop, ...args)
		},

		// As StateHandler is invoked as a Proxy the below overwrites/intercepts the default set() commands [traps]
		// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
		// TODO: update state variable below to target?
		set: (state, prop, value, ...args) => {
			log.easyDebug(`StateHandler.js SET Property: ${prop}`)
			log.easyDebug(`StateHandler.js SET New Value: ${JSON.stringify(value, null, 4)}`)
			// log.easyDebug(`StateHandler.js SET Current State: ${JSON.stringify(state, null, 4)}`)
			// log.easyDebug(`StateHandler.js value args: ${JSON.stringify(...args)}`)

			if (!platform.allowRepeatedCommands && prop in state && state[prop] === value) {
				if (prop === 'smartMode') {
					// NOTE: Without this, smartMode changes are seen as "duplicate". This happens because
					//       the smartMode object child values are being updated _before_ this setter runs
					//       (on smartMode). So when it compares it looks the same
					if (state.smartMode.updateRunning) {
						log.easyDebug(`${device.name} - StateHandler - state.smartMode.updateRunning = ${state.smartMode.updateRunning}, returning without updating`)

						return false
					}

					state.smartMode.updateRunning = true
				} else {
					log.easyDebug(`${device.name} - StateHandler - ${prop} already set to ${JSON.stringify(value, null, 4)}, returning without updating`)

					return false
				}
			}

			Reflect.set(state, prop, value, ...args)

			// Send Reset Filter command
			if (prop === 'filterChange') {
				try {
					log.easyDebug(`${device.name} - StateHandler filterChange - Resetting filter indicator`)

					sensiboApi.resetFilterIndicator(device.id)
				} catch (error) {
					log.error(`${device.name} - StateHandler filterChange - Error occurred! -> Could not reset filter indicator`)
					log.warn(`${device.name} - Error message: ${error.message}`)
				}

				return true
			} else if (prop === 'filterLifeLevel') {
				return true
			}

			// Send Climate React state command and refresh state
			if (prop === 'smartMode') {
				(async () => {
					try {
						// FIXME: check if sensiboFormattedClimateReactState is still required, could potentially be replaced with:
						//        const sensiboNewClimateReactState = state.smartMode (or similar)??
						const sensiboNewClimateReactState = sensiboFormattedClimateReactState(device, state)

						log.easyDebug(`${device.name} - StateHandler smartMode - before calling API to set new Climate React`)

						await sensiboApi.setDeviceClimateReactState(device.id, sensiboNewClimateReactState)
					} catch (error) {
						log.error(`${device.name} - StateHandler smartMode - Error occurred! -> Climate React state did not change`)
						log.warn(`${device.name} - Error message: ${JSON.stringify(error, null, 4)}`)
					}

					if (!platform.setProcessing) {
						// TODO: do we need to update ALL devices (refreshState) or could we do just device.updateHomeKit
						platform.refreshState()
							.catch(error => {
								log.error('StateHandler smartMode - error occurred in refreshState\nError content:')
								log.warn(error)
							})
					} else {
						log.easyDebug(`${device.name} - StateHandler - setProcessing is true, skipping refreshState() after Climate React SET`)
					}

					log.easyDebug(`${device.name} - StateHandler - smartMode update complete, deleting state.smartMode.updateRunning`)
					delete state.smartMode.updateRunning
				})()

				// TODO: should we "catch" if the API calls fail and prevent it from updating state (e.g. line 200)
				//       and return false instead?
				return true
			}

			// Send Pure Boost state command and refresh state
			if (prop === 'pureBoost') {
				try {
					log.easyDebug(`${device.name} - StateHandler pureBoost - Setting Pure Boost state to ${value}`)
					sensiboApi.enableDisablePureBoost(device.id, value)
				} catch (error) {
					log.error(`${device.name} - StateHandler pureBoost - Error occurred! -> Pure Boost state did not change`)
					log.warn(`${device.name} - Error message: ${error.message}`)
				}

				if (!platform.setProcessing) {
					// TODO: do we need to update ALL devices (refreshState) or could we do just device.updateHomeKit
					platform.refreshState()
						.catch(error => {
							log.error('StateHandler pureBoost - error occurred in refreshState\nError content:')
							log.warn(error)
						})
				} else {
					log.easyDebug(`${device.name} - setProcessing is true, skipping refreshState() after Pure Boost SET`)
				}

				return true
			}

			log.easyDebug(`${device.name} - StateHandler - updating setProcessing to true, Prop: ${prop}`)

			// TODO: check if this should be set earlier
			platform.setProcessing = true

			// Make sure device is not turning off when setting fanSpeed to 0 (AUTO)
			// FIXME: check on issue / race condition that prevents AC turning off if the previous command was to set fan to 0% (auto)
			if (prop === 'fanSpeed' && value === 0 && device.capabilities[state.mode].autoFanSpeed) {
				preventTurningOff = true
			}

			clearTimeout(setTimer)
			// TODO: check if "function () {" below could/should be an arrow function
			setTimer = setTimeout(async function () {
				// Make sure device is not turning off when setting fanSpeed to 0 (AUTO)
				if (preventTurningOff && state.active === false) {
					log.easyDebug(`${device.name} - StateHandler - Auto fan speed, don't turn off when fanSpeed set to 0%. Prop: ${prop}, Value: ${value}`)
					state.active = true
					preventTurningOff = false
				}

				const sensiboNewACState = sensiboFormattedACState(device, state)

				log.easyDebug(`${device.name} - before calling API to set new state`)
				// log.easyDebug(JSON.stringify(sensiboNewACState, null, 4))

				try {
					// send state command to Sensibo
					await sensiboApi.setDeviceACState(device.id, sensiboNewACState)
				} catch (error) {
					log.error(`${device.name} - StateHandler - ERROR setting ${prop} to ${value}`)
					log.warn(`${device.name} - Error message: ${JSON.stringify(error, null, 4)}`)

					setTimeout(() => {
						platform.setProcessing = false
						platform.refreshState()
							.catch(error => {
								log.error('StateHandler setDeviceACState - error occurred in refreshState\nError content:')
								log.warn(error)
							})
					}, setTimeoutDelay)
					// setTimeoutDelay = 1000ms, wait 1 second

					return
				}

				setTimeout(() => {
					platform.setProcessing = false
					device.updateHomeKit()
				}, (setTimeoutDelay / 2))
				// setTimeoutDelay = 1000ms, wait 0.5 second
			}, setTimeoutDelay)
			// setTimeoutDelay = 1000ms, wait 1 second

			return true
		}
	}
}
