const unified = require('./unified')

module.exports = (device, platform) => {

	const setTimeoutDelay = 1000
	let setTimer = null
	let preventTurningOff = false
	const sensiboApi = platform.sensiboApi

	const log = platform.log
	// const state = device.state

	return {
		get: (target, prop) => {

			// log.easyDebug(`StateHandler GET ${prop} for ${JSON.stringify(target, null, 2)}`)

			// check for last update and refresh state if needed
			if (!platform.setProcessing) {
				platform.refreshState()
			} else {
				log.easyDebug('setProcessing is set to true, skip refreshing state.')
			}

			// return a function to update state (multiple properties)
			if (prop === 'update')
				return (state) => {
					if (!platform.setProcessing) {
						Object.keys(state).forEach(key => { 
							if (state[key] !== null)
								target[key] = state[key] 
						})
						device.updateHomeKit()
					}
				}

			// return a function to sync ac state
			if (prop === 'syncState')
				return async() => {
					try {
						await sensiboApi.syncDeviceState(device.id, !target.active)
						target.active = !target.active
						device.updateHomeKit()

					} catch (err) {
						log(`ERROR Syncing ${device.name}!`)
					}
				}


			return target[prop]
		},
	
		set: (state, prop, value) => {
			
			log.easyDebug(`StateHandler SET ${prop} ${value} for ${JSON.stringify(state, null, 2)}`)
			
			if (!platform.allowRepeatedCommands && prop in state && state[prop] === value)
				return

			state[prop] = value
			
			// Send Reset filter indicator command and refresh state
			if (prop === 'filterChange') {
				try {
					log(`Resetting filter indiactor for ${device.name}`)
					sensiboApi.resetFilterIndicator(device.id)
				} catch(err) {
					log('Error occurred! -> Could not reset filter indicator')
				}
				return
			} else if (prop === 'filterLifeLevel')
				return

			// Send Climate React state command and refresh state
			if (prop === 'smartMode') {
				try {
					log(`Setting Climate React state for ${device.name} to ${value}`)
					sensiboApi.enableDisableClimateReact(device.id, value)
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
					log(`Setting Pure Boost state for ${device.name} to ${value}`)
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
			if (prop === 'fanSpeed' && value === 0 && device.capabilities[state.mode].autoFanSpeed)
				preventTurningOff = true
				
			
			clearTimeout(setTimer)
			setTimer = setTimeout(async function() {
				// Make sure device is not turning off when setting fanSpeed to 0 (AUTO)
				if (preventTurningOff && state.active === false) {
					state.active = true
					preventTurningOff = false
				}
		
				const sensiboNewACState = unified.sensiboFormattedACState(device, state)
				const sensiboNewClimateReactState = unified.sensiboFormattedClimageReactState(device, state)

				log.easyDebug(device.name, ' -> Setting New State:')
				log.easyDebug(JSON.stringify(sensiboNewACState, null, 2))
				
				if (platform.enableClimateReactAutoSetup) {
					log.easyDebug(JSON.stringify(sensiboNewClimateReactState, null, 2))
				}
				
				try {
					// send state command to Sensibo
					
					if (platform.enableClimateReactAutoSetup) {
						await sensiboApi.setDeviceClimateReactState(device.id, sensiboNewClimateReactState)
					}

					await sensiboApi.setDeviceACState(device.id, sensiboNewACState)
				} catch(err) {
					log(`ERROR setting ${prop} to ${value}`)
					setTimeout(() => {
						platform.setProcessing = false
						platform.refreshState()
					}, 1000)
					return
				}
				setTimeout(() => {
					device.updateHomeKit()
					platform.setProcessing = false
				}, 500)

			}, setTimeoutDelay)

			return true
		}
	}
}