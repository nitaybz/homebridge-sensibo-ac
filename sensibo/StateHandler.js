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
			// check for last update and refresh state if needed
			if (!platform.setProcessing)
				platform.refreshState()

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
			
			if (!platform.allowRepeatedCommands && prop in state && state[prop] === value)
				return

			state[prop] = value
			
			// Send Reset Filter command and update value
			if (prop === 'filterChange') {
				try {
					sensiboApi.resetFilterIndicator(device.id)
				} catch(err) {
					log('Error occurred! -> Could not reset filter indicator')
				}
				return
			} else if (prop === 'filterLifeLevel')
				return

			// Send Reset Filter command and update value
			if (prop === 'smartMode') {
				try {
					sensiboApi.enableDisableClimateReact(device.id, value)
				} catch(err) {
					log('Error occurred! -> Climate React state did not change')
				}
				
				if (!platform.setProcessing)
					platform.refreshState()
				return
			}


			// Send Reset Filter command and update value
			if (prop === 'pureBoost') {
				try {
					sensiboApi.enableDisablePureBoost(device.id, value)
				} catch(err) {
					log('Error occurred! -> Pure Boost state did not change')
				}
				
				if (!platform.setProcessing)
					platform.refreshState()
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
		
				const sensiboNewState = unified.sensiboFormattedState(device, state)
				log.easyDebug(device.name, ' -> Setting New State:')
				log.easyDebug(JSON.stringify(sensiboNewState, null, 2))
				
				try {
					// send state command to Sensibo
					await sensiboApi.setDeviceState(device.id, sensiboNewState)
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