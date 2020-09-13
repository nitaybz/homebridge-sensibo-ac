const unified = require('./unified')

module.exports = (device, platform) => {

	const setTimeoutDelay = 1000
	let setTimer = null
	let preventTurningOff = false
	let setProcessing = false
	const sensiboApi = platform.sensiboApi

	const log = platform.log
	// const state = device.state

	return {
		get: (target, prop) => {
			// check for last update and refresh state if needed
			if (!setProcessing)
				platform.refreshState()

			// return a function to update state (multiple properties)
			if (prop === 'update')
				return (state) => {
					if (!setProcessing) {
						Object.keys(state).forEach(key => { target[key] = state[key] })
						device.updateHomeKit()
					}
				}

			// return a function to update a single state property
			if (prop === 'updateProperty')
				return (updateProp, value) => {
					if (!setProcessing) {
						target[updateProp] = value
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

			state[prop] = value
			
			// Send Reset Filter command and update value
			if (prop === 'filterChange') {
				sensiboApi.resetFilterIndicator(device.id)
				return
			} else if (prop === 'filterLifeLevel')
				return

			// Send Reset Filter command and update value
			if (prop === 'smartMode') {
				sensiboApi.enableDisableClimateReact(device.id, value)
				if (!setProcessing)
					platform.refreshState()
				return
			}
	

			setProcessing = true

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
		
				log(device.name, ' -> Setting New State:')
				log(JSON.stringify(state, null, 2))
				
				setProcessing = false
				try {
					// send state command to Sensibo
					await sensiboApi.setDeviceState(device.id, unified.sensiboFormattedState(device, state))
					device.updateHomeKit()
					setProcessing = false
				} catch(err) {
					log(`ERROR setting ${prop} to ${value}`)
					return
				}
			}, setTimeoutDelay)

			return true;
		}
	}
}