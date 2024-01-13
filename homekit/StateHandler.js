function HKToFanLevel(value, fanLevels) {
	let selected = 'auto'

	if (!fanLevels.includes('auto')) {
		selected = fanLevels[0]
	}

	if (value !== 0) {
		fanLevels = fanLevels.filter(level => {
			return level !== 'auto'
		})
		const totalLevels = fanLevels.length

		for (let i = 0; i < fanLevels.length; i++) {
			if (value <= Math.round(100 * (i + 1) / totalLevels)) {
				selected = fanLevels[i]
				break
			}
		}
	}

	return selected
}

function swingMode(deviceCapabilities, state) {
	const swingModes = {}

	if ('threeDimensionalSwing' in deviceCapabilities) {
		if ((state.horizontalSwing === 'SWING_ENABLED') && (state.verticalSwing === 'SWING_ENABLED')) {
			swingModes.swing = 'both'
		} else if (state.verticalSwing === 'SWING_ENABLED') {
			swingModes.swing =  'rangeFull'
		} else if (state.horizontalSwing === 'SWING_ENABLED') {
			swingModes.swing = 'horizontal'
		} else {
			swingModes.swing = 'stopped'
		}
	} else {
		if ('verticalSwing' in deviceCapabilities) {
			swingModes.swing = state.verticalSwing === 'SWING_ENABLED' ? 'rangeFull' : 'stopped'
		}

		if ('horizontalSwing' in deviceCapabilities) {
			swingModes.horizontalSwing = state.horizontalSwing === 'SWING_ENABLED' ? 'rangeFull' : 'stopped'
		}
	}

	return swingModes
}

function sensiboFormattedACState(device, state) {
	device.log.easyDebug(`${device.name} -> sensiboFormattedACState start: ${JSON.stringify(state, null, 4)}`)

	const acState = {
		on: state.active,
		mode: state.mode.toLowerCase(),
		temperatureUnit: device.temperatureUnit,
		targetTemperature: device.usesFahrenheit ? toFahrenheit(state.targetTemperature) : state.targetTemperature
	}
	const swingModes = swingMode(device.capabilities[state.mode], state)

	Object.assign(acState, swingModes)

	if ('fanSpeeds' in device.capabilities[state.mode]) {
		acState.fanLevel = HKToFanLevel(state.fanSpeed, device.capabilities[state.mode].fanSpeeds)
	}

	if ('light' in device.capabilities[state.mode]) {
		acState.light = state.light ? 'on' : 'off'
	}

	return acState
}

function sensiboFormattedClimateReactState(device, state) {
	device.log.easyDebug(`${device.name} -> sensiboFormattedClimateReactState start: ${JSON.stringify(state, null, 4)}`)

	const smartModeState = state.smartMode
	const climateReactState = {
		enabled: smartModeState.enabled,
		type: smartModeState.type,
		highTemperatureState: {
			on: smartModeState.highTemperatureState.on,
			light: smartModeState.highTemperatureState.light ? 'on' : 'off',
			temperatureUnit: device.temperatureUnit,
			fanLevel: HKToFanLevel(state.fanSpeed, device.capabilities[state.mode].fanSpeeds),
			mode: smartModeState.highTemperatureState.mode.toLowerCase(),
			targetTemperature: smartModeState.highTemperatureState.targetTemperature
		},
		highTemperatureThreshold: smartModeState.highTemperatureThreshold,
		highTemperatureWebhook: null,
		lowTemperatureState: {
			on: smartModeState.lowTemperatureState.on,
			light: smartModeState.lowTemperatureState.light ? 'on' : 'off',
			temperatureUnit: device.temperatureUnit,
			fanLevel: HKToFanLevel(state.fanSpeed, device.capabilities[state.mode].fanSpeeds),
			mode: smartModeState.lowTemperatureState.mode.toLowerCase(),
			targetTemperature: smartModeState.lowTemperatureState.targetTemperature
		},
		lowTemperatureThreshold: smartModeState.lowTemperatureThreshold,
		lowTemperatureWebhook: null
	}
	const swingModes = swingMode(device.capabilities[state.mode], state)

	Object.assign(climateReactState.lowTemperatureState, swingModes)
	Object.assign(climateReactState.highTemperatureState, swingModes)

	return climateReactState
}

function toFahrenheit(value) {
	return Math.round((value * 1.8) + 32)
}

module.exports = (device, platform) => {
	const setTimeoutDelay = 1000
	let setTimer = null
	let preventTurningOff = false
	const sensiboApi = platform.sensiboApi
	const log = platform.log

	return {
		// As StateHandler is invoked as a Proxy the below overwrites/intercepts the default get() commands [traps]
		// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
		get: (target, prop, ...args) => {
			// log.easyDebug(`StateHandler GET Prop: ${prop} for Target: ${JSON.stringify(target, null, 4)}`)
			// log.easyDebug(`StateHandler GET Args: ${JSON.stringify(...args, null, 4)}`)

			// check for last update and refresh state if needed
			if (!platform.setProcessing) {
				platform.refreshState()
			} else {
				// log.easyDebug(`setProcessing is true, skipping refreshState() in GET, Prop: ${prop}`)
			}

			// returns an anonymous *function* to update state (multiple properties)
			if (prop === 'update') {
				// 'state' below is the value passed in when the update() function is called
				// see refreshState.js, e.g. airConditioner.state.update(unified.acState(device))
				return (state) => {
					// log.easyDebug(`StateHandler GET state obj: ${JSON.stringify(state, null, 4)}`)
					if (!platform.setProcessing) {
						Object.keys(state).forEach(key => {
							if (state[key] !== null) {
								target[key] = state[key]
							}
						})
						device.updateHomeKit()
					}
				}
			}

			// return a function to sync ac state
			// TODO: should be moved to be a 'set' below, see also StateManager line 576
			if (prop === 'syncState') {
				return async() => {
					try {
						log.easyDebug(`${device.name} - syncState - syncing`)

						await sensiboApi.syncDeviceState(device.id, !target.active)
						target.active = !target.active
						device.updateHomeKit()
					} catch (err) {
						log(`${device.name} - syncState - ERROR Syncing!`)
					}
				}
			}

			return Reflect.get(target, prop, ...args)
		},

		// As StateHandler is invoked as a Proxy the below overwrites/intercepts the default set() commands [traps]
		// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
		// TODO: update state variable below to target?
		set: (state, prop, value, ...args) => {
			log.easyDebug(`StateHandler SET Property: ${prop}`)
			log.easyDebug(`StateHandler SET New Value: ${JSON.stringify(value, null, 4)}`)
			// log.easyDebug(`StateHandler SET Current State: ${JSON.stringify(state, null, 4)}`)
			// log.easyDebug(`StateHandler value args: ${JSON.stringify(...args)}`)

			if (!platform.allowRepeatedCommands && prop in state && state[prop] === value) {
				if (prop === 'smartMode') {
					// NOTE: Without this, smartMode changes are seen as "duplicate". This happens because
					//       the smartMode object child values are being updated _before_ this setter runs
					//       (on smartMode). So when it compares it looks the same
					if (state.smartMode.running) {
						log.easyDebug(`${device.name} - smartMode update already running, returning without updating`)

						return false
					}

					state.smartMode.running = true
				} else {
					log.easyDebug(`${device.name} - ${prop} already set to ${JSON.stringify(value, null, 4)}, returning without updating`)

					return false
				}
			}

			Reflect.set(state, prop, value, ...args)

			// Send Reset Filter command
			if (prop === 'filterChange') {
				try {
					log.easyDebug(`${device.name} - filterChange - Resetting filter indicator`)

					sensiboApi.resetFilterIndicator(device.id)
				} catch(err) {
					log(`${device.name} - filterChange - Error occurred! -> Could not reset filter indicator`)
				}

				return true
			} else if (prop === 'filterLifeLevel') {
				return true
			}

			// Send Climate React state command and refresh state
			if (prop === 'smartMode') {
				try {
					const sensiboNewClimateReactState = sensiboFormattedClimateReactState(device, state)

					log.easyDebug(`${device.name} - smartMode - before calling API to set new Climate React`)
					// log.easyDebug(JSON.stringify(value, null, 4))

					sensiboApi.setDeviceClimateReactState(device.id, sensiboNewClimateReactState)
				} catch(err) {
					log(`${device.name} - smartMode - Error occurred! -> Climate React state did not change`)
				}

				if (!platform.setProcessing) {
					platform.refreshState()
				} else {
					log.easyDebug(`${device.name} - setProcessing is true, skipping refreshState() after Climate React SET`)
				}

				delete state.smartMode.running

				return true
			}

			// Send Pure Boost state command and refresh state
			if (prop === 'pureBoost') {
				try {
					log.easyDebug(`${device.name} - pureBoost - Setting Pure Boost state to ${value}`)
					sensiboApi.enableDisablePureBoost(device.id, value)
				} catch(err) {
					log(`${device.name} - pureBoost - Error occurred! -> Pure Boost state did not change`)
				}

				if (!platform.setProcessing) {
					platform.refreshState()
				} else {
					log.easyDebug(`${device.name} - setProcessing is true, skipping refreshState() after Pure Boost SET`)
				}

				return true
			}

			platform.setProcessing = true

			// Make sure device is not turning off when setting fanSpeed to 0 (AUTO)
			// FIXME: check on issue / race condition that prevents AC turning off if the previous command was to set fan to 0% (auto)
			if (prop === 'fanSpeed' && value === 0 && device.capabilities[state.mode].autoFanSpeed) {
				preventTurningOff = true
			}

			clearTimeout(setTimer)
			setTimer = setTimeout(async function() {
				// Make sure device is not turning off when setting fanSpeed to 0 (AUTO)
				if (preventTurningOff && state.active === false) {
					log.easyDebug(`${device.name} - Auto fan speed, don't turn off when fanSpeed set to 0%. Prop: ${prop}, Value: ${value}`)
					state.active = true
					preventTurningOff = false
				}

				const sensiboNewACState = sensiboFormattedACState(device, state)

				log.easyDebug(`${device.name} - before calling API to set new state`)
				// log.easyDebug(JSON.stringify(sensiboNewACState, null, 4))

				try {
					// send state command to Sensibo
					await sensiboApi.setDeviceACState(device.id, sensiboNewACState)
				} catch(err) {
					log(`${device.name} - ERROR setting ${prop} to ${value}`)
					setTimeout(() => {
						platform.setProcessing = false
						platform.refreshState()
					}, setTimeoutDelay)

					return true
				}

				setTimeout(() => {
					device.updateHomeKit()
					platform.setProcessing = false
				}, (setTimeoutDelay / 2))
			}, setTimeoutDelay)

			return true
		}
	}
}