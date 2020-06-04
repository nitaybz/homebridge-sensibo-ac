const fetch = require('node-fetch')
const baseUrl = 'https://home.sensibo.com/api/v2'
var pjson = require('./../package.json');

const integrationName = 'homebridge-sensibo-ac@' + pjson.version
let apiKey, log , debug

const getRequest = (path, queryString) => {
	return new Promise((resolve, reject) => {
		if (debug)
			log('making a request:', `${baseUrl+path}?apiKey=***********&${queryString}&integration=${integrationName}`)

		fetch(`${baseUrl+path}?apiKey=${apiKey}&${queryString}&integration=${integrationName}`)
			.then(res => {
				if (res.status === 403)
					throw Error('UNAUTHORIZED')
				return res.json()
			})
			.then(json => {
				if (json.status && json.status == 'success' && json.result && json.result instanceof Array) {
					if (json.result[0] && json.result[0].location)
						json.result[0].location = { occupancy: json.result[0].location.occupancy}
					if (debug)
						log('GET Response: \n ' + JSON.stringify(json))
					resolve(json.result)
				} else {
					log('ERROR Making a Request!! ------->')
					log(json)
					reject(json)
				}
			}).catch(err => {
				log('ERROR Making a Request!! ------->')
				if (err.stack.includes('UNAUTHORIZED')) {
					log('XXXXXXXXXXXXXXXXXXX  --  ERROR  --  XXXXXXXXXXXXXXXXXXXXXXXX\n')
					log('*********** UNAUTHORIZED ********** - Please Check your API KEY\n')
					log('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\n')
				} else
					log(err)
				reject(err)
			})
	})
}


const postRequest = (path, json) => {
	return new Promise((resolve, reject) => {
		if (debug)
			log('making a request:', `${baseUrl+path}?apiKey=*************&integration=${integrationName}`, '\n', JSON.stringify(json, null, 2))
		
		fetch(`${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`, {
				method: 'post',
				body:    JSON.stringify(json),
				headers: { 'Content-Type': 'application/json' },
			})
			.then(res => res.json())
			.then(json => {
				if (debug)
					log('POST Response: \n ' + JSON.stringify(json))
				resolve(json)
			})
			.catch(err => {
				log('ERROR Making a Request!! ------->')
				log(err)
				reject(err)
			})
	})
}


const putRequest = (path, json) => {
	return new Promise((resolve, reject) => {
		if (debug)
			log('making a request:', `${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`, '\n', JSON.stringify(json, null, 2))
		
		fetch(`${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`, {
				method: 'put',
				body:    JSON.stringify(json),
				headers: { 'Content-Type': 'application/json' },
			})
			.then(res => res.json())
			.then(json => {
				if (debug)
					log('PUT Response: \n ' + JSON.stringify(json))
				resolve(json)
			})
			.catch(err => {
				log('ERROR Making a Request!! ------->')
				log(err)
				reject(err)
			})
	})
}

const patchRequest = (path, json) => {
	return new Promise((resolve, reject) => {
		if (debug)
			log('making a request:', `${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`, '\n', JSON.stringify(json, null, 2))
		
		fetch(`${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`, {
				method: 'patch',
				body:    JSON.stringify(json),
				headers: { 'Content-Type': 'application/json' },
			})
			.then(res => res.json())
			.then(json => {
				if (debug)
					log('PATCH Response: \n ' + JSON.stringify(json))
				resolve(json)
			})
			.catch(err => {
				log('ERROR Making a Request!! ------->')
				log(err)
				reject(err)
			})
	})
}


module.exports = {
	init: (apiKeyInput, logInput, debugInput) => {
		apiKey = apiKeyInput
		log = logInput
		debug = debugInput
	},

	getAllPods: async () => {
		const path = '/users/me/pods'
		const queryString = 'fields=id,acState,measurements,remoteCapabilities,room,temperatureUnit,productModel,location,occupancy,smartMode'
		return await getRequest(path, queryString)
	},

	getDevicesStates: async () => {
		const path = '/users/me/pods'
		const queryString = 'fields=id,acState,measurements,location,occupancy,smartMode'
		// const queryString = 'fields=*'
		return await getRequest(path, queryString)
	},

	setDeviceState: async (deviceId, acState) => {
		const path = `/pods/${deviceId}/acStates`
		const json = {
			'acState': acState
		}
		return await postRequest(path, json)
	},

	syncDeviceState: async (deviceId, value) => {
		const path = `/pods/${deviceId}/acStates/on`
		const json = {
			'newValue': value,
			'reason': 'StateCorrectionByUser'
		}
		return await patchRequest(path, json)
	},

	enableDisableClimateReact: async (deviceId, on) => {
		const path = `/pods/${deviceId}/smartmode`
		const json = {
			'enabled': on
		}
		return await putRequest(path, json)
	},

	setDevicePropertyState: async (deviceId, property, value) => {
		const path = `/pods/${deviceId}/acStates/${property}`
		const json = {
			'newValue': value
		}
		return await patchRequest(path, json)
	}
}