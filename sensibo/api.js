const axios = require('axios').default
const version = require('./../package.json').version
const integrationName = 'homebridge-sensibo-ac@' + version
const baseURL = 'https://home.sensibo.com/api/v2'
let log

function getToken(username, password, storage) {
	// TODO: check on if the below is required
	// eslint-disable-next-line no-async-promise-executor
	return new Promise(async (resolve, reject) => {
		const token = await storage.getItem('token')

		if (token && token.username && token.username === username && new Date().getTime() < token.expirationDate) {
			log.easyDebug('Found valid token in storage')
			resolve(token.key)

			return
		}

		const tokenURL = 'https://home.sensibo.com/o/token/'
		const data = {
			username: username,
			password: password,
			grant_type: 'password',
			client_id: 'bcrEwCG2mZTvm1vFJOD51DNdJHEaRemMitH1gCWc',
			scope: 'read write'
		}

		axios.post(
			tokenURL,
			data,
			{ headers: { 'content-type': 'application/x-www-form-urlencoded' } })
			.then(async response => {
				if (response.data.access_token) {
					const tokenObj = {
						username: username,
						key: response.data.access_token,
						expirationDate: new Date().getTime() + response.data.expires_in*1000
					}

					log.easyDebug('Token successfully acquired from Sensibo API')
					// log.easyDebug(tokenObj)
					await storage.setItem('token', tokenObj)
					resolve(tokenObj.key)
				} else {
					const error = `Inner Could NOT complete the the token request -> ERROR: "${response.data}"`

					log(error)
					reject(error)
				}
			})
			.catch(err => {
				const errorContent = {}

				errorContent.message = `Could NOT complete the the token request - ERROR: "${err.response.data.error_description || err.response.data.error}"`

				log('getToken:', errorContent.message)

				if (err.response) {
					log.easyDebug('Error response:')
					log.easyDebug(err.response.data)
					errorContent.response = err.response.data
				}

				// log.easyDebug(err)
				reject(errorContent)
			})
	})
}

function fixResponse(results) {
	return results.map(result => {
		// remove user's address to prevent it from appearing in logs
		result.location && (result.location = {
			occupancy: result.location.occupancy,
			name: result.location.name,
			id: result.location.id
		})

		// If climate react was never set up, or not valid for the device, result.smartMode will return
		// a 'null' value which will break other code, so we fix it
		if (result.smartMode === null) {
			result.smartMode = { enabled: false }
		}

		return result
	})
}

async function apiRequest(method, url, data) {
	// TODO: Authorization header (token) expiry isn't checked... could result in API failures
	// Looks like Token expiry might be 15 years?!
	// maybe https://www.thedutchlab.com/en/insights/using-axios-interceptors-for-refreshing-your-api-token
	if (!axios.defaults?.params?.apiKey && !axios.defaults?.headers?.Authorization) {
		log.easyDebug('apiReqest error: No API Token or Authorization Header found')

		try {
			const token = await getToken(this.username, this.password, this.storage)

			axios.defaults.headers = { 'Authorization': 'Bearer ' + token }
		} catch(err) {
			log('apiRequest token error:', err.message || err)
			throw err
		}
	}

	return new Promise((resolve, reject) => {
		log.easyDebug(`Creating ${method.toUpperCase()} request to Sensibo API ->`)
		log.easyDebug(baseURL + url)
		if (data) {
			log.easyDebug(`data: ${JSON.stringify(data, null, 4)}`)
		}

		axios({
			method,
			url,
			data
		})
			.then(response => {
				const json = response.data
				let results

				if (json.status && json.status == 'success') {
					log.easyDebug(`Successful ${method.toUpperCase()} response:`)

					// TODO: The below is only relevant for getAllDevices and getDevicesStates (and should be moved)
					// It prevents address details being logged though (and adds ClimateReact if missing),
					// so the logger would also need to be moved...
					if (json.result && json.result instanceof Array) {
						results = fixResponse(json.result)
					} else {
						results = json
					}

					log.easyDebug(JSON.stringify(results, null, 4))
					resolve(results)
				} else {
					const error = json

					log(`ERROR: ${error.reason} - "${error.message}"`)
					log(json)
					reject(error)
				}
			})
			.catch(err => {
				const errorContent = {}

				errorContent.message = err.message
				log(`ERROR: ${errorContent.message}`)

				if (err.response) {
					log.easyDebug('Error response:')
					log.easyDebug(err.response.data)
					errorContent.response = err.response.data
				}

				// log.easyDebug(err)
				reject(errorContent)
			})
	})
}

module.exports = async function (platform) {
	log = platform.log
	// TODO: check on scope of these
	this.username = platform.username
	this.password = platform.password
	this.storage = platform.storage

	// TODO: can we use getToken instead? I think this only runs during first load...
	if (platform.apiKey) {
		axios.defaults.params = {
			integration: integrationName,
			apiKey: platform.apiKey
		}
	} else {
		try {
			const token = await getToken(platform.username, platform.password, platform.storage)

			axios.defaults.headers = { 'Authorization': 'Bearer ' + token }
			axios.defaults.params = { integration: integrationName }
		} catch (err) {
			log('The plugin was NOT able to find stored token or acquire one from Sensibo API -> it will not be able to set or get the state !!')
		}
	}
	axios.defaults.baseURL = baseURL

	return {

		getAllDevices: async () => {
			const path = '/users/me/pods'
			const queryString = 'fields=id,acState,measurements,location,occupancy,smartMode,motionSensors,filtersCleaning,serial,pureBoostConfig,homekitSupported,remoteCapabilities,room,temperatureUnit,productModel'
			let allDevices

			try {
				allDevices = await apiRequest('get', path + '?' + queryString)
			} catch(err) {
				log('getAllDevices ERR:', err.message)
				throw err
			}

			// TODO: the below will return an exception if above "get" fails... null check?
			return allDevices.filter(device => {
				return (platform.locationsToInclude.length === 0
								|| platform.locationsToInclude.includes(device.location.id)
								|| platform.locationsToInclude.includes(device.location.name))
							&& !platform.devicesToExclude.includes(device.id)
							&& !platform.devicesToExclude.includes(device.serial)
							&& !platform.devicesToExclude.includes(device.room.name)
			})
		},

		//TODO: Not used, retire?
		getDevicesStates: async () => {
			const path = '/users/me/pods'
			const queryString = 'fields=id,acState,measurements,location,occupancy,smartMode,motionSensors,filtersCleaning,serial,pureBoostConfig,homekitSupported'

			return await apiRequest('get', path + '?' + queryString)
		},

		setDeviceClimateReactState: async (deviceId, climateReactState) => {
			const path = `/pods/${deviceId}/smartmode`
			const json = climateReactState

			return await apiRequest('post', path, json)
		},

		setDeviceACState: async (deviceId, acState) => {
			const path = `/pods/${deviceId}/acStates`
			const json = { 'acState': acState }

			return await apiRequest('post', path, json)
		},

		syncDeviceState: async (deviceId, value) => {
			const path = `/pods/${deviceId}/acStates/on`
			const json = {
				'newValue': value,
				'reason': 'StateCorrectionByUser'
			}

			return await apiRequest('patch', path, json)
		},

		//TODO: Not used, retire?
		enableDisableClimateReact: async (deviceId, enabled) => {
			const path = `/pods/${deviceId}/smartmode`
			const json = { 'enabled': enabled }

			return await apiRequest('put', path, json)
		},

		enableDisablePureBoost: async (deviceId, enabled) => {
			const path = `/pods/${deviceId}/pureboost`
			const json = { 'enabled': enabled }

			return await apiRequest('put', path, json)
		},

		//TODO: Not used, retire?
		setDevicePropertyState: async (deviceId, property, value) => {
			const path = `/pods/${deviceId}/acStates/${property}`
			const json = { 'newValue': value }

			return await apiRequest('patch', path, json)
		},

		resetFilterIndicator: async (deviceId) => {
			const path = `/pods/${deviceId}/cleanFiltersNotification`

			return await apiRequest('delete', path)
		}
	}
}