import axios from 'axios'

const baseURL = 'https://home.sensibo.com/api/v2'
let credentials
let log
let storage

async function getAuthKeyFromStorage(username) {
	log.easyDebug('SensiboAPI.js getAuthKeyFromStorage - Checking for token in local storage')

	try {
		const tokenFromStorage = await storage.getItem('token')

		// TODO: what happens if returned token doesn't work? E.g. password change... should token be "checked" for validity?
		// Note: Looks like Token expiry might be 15 years?!
		if (tokenFromStorage) {
			log.easyDebug('SensiboAPI.js getAuthKeyFromStorage - Found a token in local storage')

			if (tokenFromStorage.username && tokenFromStorage.username === username && new Date().getTime() < tokenFromStorage.expirationDate) {
				log.info('SensiboAPI.js getAuthKeyFromStorage - Token is valid, returning...')

				return tokenFromStorage.key
			}

			throw `Retrieved token doesn't match given username (${username}) or is expired (${tokenFromStorage.expirationDate})`
		}
	} catch (error) {
		log.warn('SensiboAPI.js getAuthKeyFromStorage - getItem failed or token retrieved is invalid. Error message:')
		log.warn(error.message || error)
	}

	return
}

function saveTokenToStorage(tokenToSave) {
	log.easyDebug('SensiboAPI.js saveTokenToStorage - Trying to save token in local stoage')

	try {
		storage.setItem('token', tokenToSave)

		log.easyDebug('SensiboAPI.js saveTokenToStorage - Token should be saved')
	} catch (error) {
		log.error('SensiboAPI.js saveTokenToStorage - setItem failed. Error message:')
		log.warn(error.message || error)
		log.info('SensiboAPI.js saveTokenToStorage - Note: Not stopping, but storage issue should be investigated')
	}

	return
}

function getTokenFromAPI(username, password) {
	log.info('SensiboAPI.js getTokenFromAPI - calling Sensibo Auth to get a new token')

	return new Promise((resolve, reject) => {
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
			.then(response => {
				if (response.data.access_token) {
					const tokenObject = {
						username: username,
						key: response.data.access_token,
						expirationDate: new Date().getTime() + response.data.expires_in * 1000
					}

					log.info('SensiboAPI.js getTokenFromAPI - Token successfully acquired from Sensibo API.')
					// log.easyDebug(tokenObject)

					resolve(tokenObject)
				} else {
					// TODO: double check on this errorMessage "shape"
					const errorMessage = `SensiboAPI.js getTokenFromAPI INNER - Could NOT complete token request -> Error message: "${response.data}"`

					log.error(errorMessage)

					reject(errorMessage)
				}
			}).catch(error => {
				const errorContent = {}

				errorContent.message = error.response.data.error_description || error.response.data.error

				log.error('SensiboAPI.js getTokenFromAPI - Could NOT complete token request. Error message:')
				log.warn(errorContent.message)

				if (error.response) {
					log.warn('SensiboAPI.js getTokenFromAPI - error.response.data:')
					log.warn(error.response.data)
					errorContent.response = error.response.data
				}

				// log.warn(error)
				reject(errorContent)
			})
	})
}

async function checkAuth(apiKey, username, password) {
	log.easyDebug('SensiboAPI.js checkAuth - Start')

	if (apiKey) {
		log.success('SensiboAPI.js checkAuth - apiKey found')

		axios.defaults.params.apiKey = apiKey

		return
	} else {
		log.info('SensiboAPI.js checkAuth - No apiKey found, will check for an existing login token.')

		const authKeyFromStoage = await getAuthKeyFromStorage(username)

		if (authKeyFromStoage) {
			log.success('SensiboAPI.js checkAuth - Login token found in local storage')

			if (!axios.defaults?.params?.apiKey && !axios.defaults?.headers?.Authorization) {
				axios.defaults.headers = { Authorization: 'Bearer ' + authKeyFromStoage }
			}

			return
		}

		log.warn('SensiboAPI.js checkAuth - No valid login token found, will try to get a new one using login credentials...')

		await getTokenFromAPI(username, password)
			.then(tokenFromAPI => {
				log.easyDebug(`SensiboAPI.js checkAuth - getTokenFromAPI successful. Expiry: ${tokenFromAPI.expirationDate}`)
				// log.devDebug(tokenFromAPI)

				if (tokenFromAPI && tokenFromAPI.key) {
					if (!axios.defaults?.params?.apiKey && !axios.defaults?.headers?.Authorization) {
						axios.defaults.headers = { Authorization: 'Bearer ' + tokenFromAPI.key }
					}

					saveTokenToStorage(tokenFromAPI)

					log.success(`SensiboAPI.js checkAuth - Token retrieved from API and stored for future use.`)
				} else {
					// This shouldn't ever happen...
					throw { message: 'tokenFromAPI is unexpectedly empty' }
				}
			}).catch(error => {
				log.error('SensiboAPI.js checkAuth - getTokenFromAPI failed, stopping. Error message:')
				log.warn(error.message || error)

				throw error
			})

		log.easyDebug('SensiboAPI.js checkAuth - completed')

		return
	}
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
		log.warn('SensiboAPI.js apiRequest - No API Token or Authorization Header found!')

		// TODO: is this really required? Could potentially use a timeout during init to try again after some time
		// In case the previous attempt failed due to errors other than bad details (e.g. timeout)
		try {
			// apiKey is null here because if it's been changed after startup then Homebridge needs to be restarted
			await checkAuth(null, credentials.username, credentials.password)
		} catch (error) {
			log.warn('SensiboAPI.js apiRequest - checkAuth failed...')
			log.warn(error.message || error)
			log.error('Please check your authKey or username and password details in Homebridge in this plugins config.')
		}

		throw { message: 'No valid authentication details found, stopping API request.' }
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
			}).catch(error => {
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
	credentials = {
		username: platform.username,
		password: platform.password
	}
	log = platform.log
	storage = platform.storage

	const integrationName = platform.PLUGIN_NAME + '@' + platform.PLUGIN_VERSION

	axios.defaults.baseURL = baseURL
	axios.defaults.params = { integration: integrationName }

	// Runs during first load...
	try {
		await checkAuth(platform.apiKey, credentials.username, credentials.password)
	} catch (error) {
		log.warn('SensiboAPI.js init - checkAuth failed...')
		log.warn(error.message || error)
		log.error('Please check your authKey or username and password details in Homebridge in this plugins config.')
	}

	log.easyDebug('SensiboAPI.js init - finished')

	return {

		getAllDevices: async () => {
			const path = '/users/me/pods'
			const queryString = 'fields=id,acState,measurements,location,occupancy,smartMode,motionSensors,filtersCleaning,serial,pureBoostConfig,homekitSupported,remoteCapabilities,room,temperatureUnit,productModel'
			let allDevices

			try {
				allDevices = await apiRequest('get', path + '?' + queryString)
			} catch (error) {
				log.error('SensiboAPI.js getAllDevices - apiRequest failed. Error message:')
				log.warn(error.message || error)

				throw error
			}

			// Note: if an error occurs above the throw will also "return"
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
