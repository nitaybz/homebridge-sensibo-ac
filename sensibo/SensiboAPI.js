import axios from 'axios'

const baseURL = 'https://home.sensibo.com/api/v2'
let log
let username, password, storage

function getToken(username, password, storage) {
	// FIXME: check on if the below is required
	// eslint-disable-next-line no-async-promise-executor
	return new Promise(async (resolve, reject) => {
		// TODO: move getItem etc in to dedicated function, call that from init
		const token = await storage.getItem('token')

		// TODO: what happens if returned token doesn't work? E.g. password change... should token be "checked" for validity?
		// TODO: Looks like Token expiry might be 15 years?!
		if (token && token.username && token.username === username && new Date().getTime() < token.expirationDate) {
			log.easyDebug('SensiboAPI.js getToken - Found valid token in storage')

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
			{
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				// FIXME: this is to overwrite the (default) inclusion of integrationName which appears to break auth calls
				params: null
			})
			.then(async response => {
				if (response.data.access_token) {
					const tokenObj = {
						username: username,
						key: response.data.access_token,
						expirationDate: new Date().getTime() + response.data.expires_in * 1000
					}

					log.easyDebug('SensiboAPI.js getToken - Token successfully acquired from Sensibo API')
					// log.easyDebug(tokenObj)

					await storage.setItem('token', tokenObj)

					resolve(tokenObj.key)
				} else {
					const errorMessage = `SensiboAPI.js getToken INNER - Could NOT complete token request -> Error message: "${response.data}"`

					log.error(errorMessage)

					reject(errorMessage)
				}
			})
			.catch(error => {
				const errorContent = {}

				errorContent.message = `SensiboAPI.js getToken - Could NOT complete token request\nError message: "${error.response.data.error_description || error.response.data.error}"`

				log.error(errorContent.message)

				if (error.response) {
					log.warn('SensiboAPI.js getToken - error.response.data content:')
					log.warn(error.response.data)
					errorContent.response = error.response.data
				}

				// log.warn(error)
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

/**
 * Perform the callout to the Sensibo API using Axious library
 * @param   {string}                 method  GET, POST, PUT, PATCH, DELETE
 * @param   {string}                 path    The URL path for the API call
 * @param   {Object}                 data    The object (in JSON) that will be sent to Sensibo for action
 * @returns {Promise<object|Error>}          API response (in JSON) or an error (object?)
 */
async function apiRequest(method, path, data) {
	// TODO: Authorization header (login token) expiry isn't checked... could result in API failures
	// Though it does look like Token expiry might be 15 years?!
	// maybe https://www.thedutchlab.com/en/insights/using-axios-interceptors-for-refreshing-your-api-token

	// TODO: could add auto-retry for timeouts etc
	if (!axios.defaults?.params?.apiKey && !axios.defaults?.headers?.Authorization) {
		log.warn('SensiboAPI.js apiRequest - No API Token or Authorization Header found, trying to get a new one...')

		try {
			const token = await getToken(username, password, storage)

			// To ensure nothing changed during the 'await' we run the exact same logic check again
			if (!axios.defaults?.params?.apiKey && !axios.defaults?.headers?.Authorization) {
				axios.defaults.headers = { Authorization: 'Bearer ' + token }
			}
		} catch (error) {
			log.error('SensiboAPI.js apiRequest - getToken failed.\nError message:')
			log.warn(error.message || error)

			throw error
		}
	}

	return new Promise((resolve, reject) => {
		log.easyDebug(`SensiboAPI.js apiRequest - Creating ${method.toUpperCase()} request to Sensibo API ->`)
		log.easyDebug(baseURL + path)

		if (data) {
			log.easyDebug(`data: ${JSON.stringify(data, null, 4)}`)
		}

		axios({
			method: method,
			// NOTE: url here is actually PATH (but axios calls it url)
			url: path,
			data: data,
			headers: { 'Accept-Encoding': 'gzip' },
			decompress: true
		})
			.then(response => {
				const json = response.data
				let results

				if (json.status && json.status == 'success') {
					log.easyDebug(`SensiboAPI.js apiRequest - Successful ${method.toUpperCase()} response:`)

					// TODO: The below is only relevant for getAllDevices and getDevicesStates (and should be moved)
					// It prevents address details being logged though (and adds ClimateReact if missing),
					// so the logger would also need to be moved...
					if (json.result && json.result instanceof Array) {
						results = fixResponse(json.result)
					} else {
						results = json
					}

					log.easyDebug(JSON.stringify(results, null, 4))
					// log.easyDebug(JSON.stringify(results, null))

					resolve(results)
				} else {
					const error = json

					log.error(`SensiboAPI.js apiRequest - Non-success message: ${error.reason} - "${error.message}"`)
					log.warn(json)

					reject(error)
				}
			})
			.catch(error => {
				const errorContent = {}

				errorContent.errorURL = baseURL + path
				errorContent.message = error.message

				log.error(`SensiboAPI.js apiRequest - Error URL: ${errorContent.errorURL}`)
				log.warn(`SensiboAPI.js apiRequest - Error message: ${errorContent.message}`)

				if (error.response) {
					errorContent.response = error.response.data
					log.warn(`SensiboAPI.js apiRequest - Error response: ${JSON.stringify(errorContent.response, null, 4)}`)
				}

				// log.warn(error)

				reject(errorContent)
			})
	})
}

export default async function (platform) {
	log = platform.log
	username = platform.username
	password = platform.password
	storage = platform.storage

	const integrationName = platform.PLUGIN_NAME + '@' + platform.PLUGIN_VERSION

	axios.defaults.baseURL = baseURL
	axios.defaults.params = { integration: integrationName }

	// Runs during first load only...
	if (platform.apiKey) {
		axios.defaults.params.apiKey = platform.apiKey
	} else {
		// TODO: move getItem (from getToken) to a dedicated function, then call that new func
		log.error('SensiboAPI.js init - No apiKey found, will try to getToken using login credentials during first API request.')
	}

	return {

		getAllDevices: async () => {
			const path = '/users/me/pods'
			const queryString = 'fields=id,acState,measurements,location,occupancy,smartMode,motionSensors,filtersCleaning,serial,pureBoostConfig,homekitSupported,remoteCapabilities,room,temperatureUnit,productModel'
			let allDevices

			try {
				allDevices = await apiRequest('get', path + '?' + queryString)
			} catch (error) {
				log.error('SensiboAPI.js getAllDevices - apiRequest failed.\nError message:')
				log.warn(error.message)

				throw error
			}

			// Note: if an error occurs above the throw will also "return" void
			// However if getAllDevices provides an empty response (but no error) the below will cause an exception, null check?
			return allDevices.filter(device => {
				return (
					platform.locationsToInclude.length === 0
					|| platform.locationsToInclude.includes(device.location.id)
					|| platform.locationsToInclude.includes(device.location.name)
				)
				&& !platform.devicesToExclude.includes(device.id)
				&& !platform.devicesToExclude.includes(device.serial)
				&& !platform.devicesToExclude.includes(device.room.name)
			})
		},

		// TODO: Not used, retire?
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
			const json = { acState: acState }

			return await apiRequest('post', path, json)
		},

		syncDeviceState: async (deviceId, value) => {
			const path = `/pods/${deviceId}/acStates/on`
			const json = {
				newValue: value,
				reason: 'StateCorrectionByUser'
			}

			return await apiRequest('patch', path, json)
		},

		// TODO: Not used, retire?
		enableDisableClimateReact: async (deviceId, enabled) => {
			const path = `/pods/${deviceId}/smartmode`
			const json = { enabled: enabled }

			return await apiRequest('put', path, json)
		},

		enableDisablePureBoost: async (deviceId, enabled) => {
			const path = `/pods/${deviceId}/pureboost`
			const json = { enabled: enabled }

			return await apiRequest('put', path, json)
		},

		// TODO: Not used, retire?
		setDevicePropertyState: async (deviceId, property, value) => {
			const path = `/pods/${deviceId}/acStates/${property}`
			const json = { newValue: value }

			return await apiRequest('patch', path, json)
		},

		resetFilterIndicator: async deviceId => {
			const path = `/pods/${deviceId}/cleanFiltersNotification`

			return await apiRequest('delete', path)
		}
	}
}
