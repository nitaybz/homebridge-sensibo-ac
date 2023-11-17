const unified = require('./unified')

module.exports = (device, platform) => {
	const setTimeoutDelay = 1000
	let setTimer = null
	let preventTurningOff = false
	const sensiboApi = platform.sensiboApi
	const log = platform.log

	return {
		get: (target, prop) => {
			// log.easyDebug(`StateHandler GET ${prop} for ${JSON.stringify(target, null, 0)}`)

			// check for last update and refresh state if needed
			if (!platform.setProcessing) {
				platform.refreshState()
			}

			// return a function to update state (multiple properties)
			if (prop === 'update') {
				return (state) => {
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
			// TODO: should  be moved to be a 'set' below, see also StateManager line 576
			if (prop === 'syncState') {
				return async() => {
					try {
						log.easyDebug(`syncState - syncing ${device.name}`)
						await sensiboApi.syncDeviceState(device.id, !target.active)
						target.active = !target.active
						device.updateHomeKit()
					} catch (err) {
						log(`ERROR Syncing ${device.name}!`)
					}
				}
			}

			return target[prop]
		},

		set: (state, prop, value) => {
			log.easyDebug(`StateHandler SET ${prop} ${value} for ${JSON.stringify(state, null, 0)}`)

			if (!platform.allowRepeatedCommands && prop in state && state[prop] === value) {
				log.easyDebug(`Repeat command while updating ${device.name}, returning`)

				return
			}

			state[prop] = value

			// Send Reset Filter command
			if (prop === 'filterChange') {
				try {
					log.easyDebug(`filterChange - Resetting filter indicator for ${device.name}`)
					sensiboApi.resetFilterIndicator(device.id)
				} catch(err) {
					log('Error occurred! -> Could not reset filter indicator')
				}

				return
			} else if (prop === 'filterLifeLevel') {
				return
			}

			// Send Climate React state command and refresh state
			if (prop === 'smartMode') {
				try {
					log.easyDebug(`${device.name} - Setting Climate React state to ${value}`)
					const sensiboNewClimateReactState = unified.sensiboFormattedClimateReactState(device, state)

					sensiboApi.setDeviceClimateReactState(device.id, sensiboNewClimateReactState)
				} catch(err) {
					log('Error occurred! -> Climate React state did not change')
				}

				if (!platform.setProcessing) {
					platform.refreshState()
				} else {
					log.easyDebug('setProcessing is set to true, skipping state refresh due to Climate React set.')
				}

				return
			}

			// Send Pure Boost state command and refresh state
			if (prop === 'pureBoost') {
				try {
					log.easyDebug(`${device.name} - Setting Pure Boost state to ${value}`)
					sensiboApi.enableDisablePureBoost(device.id, value)
				} catch(err) {
					log('Error occurred! -> Pure Boost state did not change')
				}

				if (!platform.setProcessing) {
					platform.refreshState()
				} else {
					log.easyDebug('setProcessing is set to true, skipping state refresh due to Pure Boost set.')
				}

				return
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

				const sensiboNewACState = unified.sensiboFormattedACState(device, state)

				log.easyDebug(device.name, ' -> Setting New State:')
				log.easyDebug(JSON.stringify(sensiboNewACState, null, 0))

				try {
					// send state command to Sensibo

					if (platform.enableClimateReactAutoSetup) {
						// NOTE: This below will NOT trigger the above setter, which is exactly what we want,
						//       otherwise we could get into an infinite loop.
						//
						//       Essentially, if Climate React Auto Setup is enabled, Climate React will be
						//       configured (and enabled) any time an AC state setting is changed.
						//
						//       That means that even if a user turned Climate React off via the appropriate
						//       switch, the next AC state setting that is changed will re-enable it.

						device.state.smartMode.enabled = true
						const sensiboNewClimateReactState = unified.sensiboFormattedClimateReactState(device, state)

						log.easyDebug(JSON.stringify(sensiboNewClimateReactState, null, 0))
						await sensiboApi.setDeviceClimateReactState(device.id, sensiboNewClimateReactState)
					}

					await sensiboApi.setDeviceACState(device.id, sensiboNewACState)
				} catch(err) {
					log(`${device.name} - ERROR setting ${prop} to ${value}`)
					setTimeout(() => {
						platform.setProcessing = false
						platform.refreshState()
					}, 1000)

					return
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