const request = require('request')
const baseUrl = 'https://home.sensibo.com/api/v2'
var pjson = require('./../package.json');

const integrationName = 'homebridge-sensibo-ac@' + pjson.version
let apiKey, log , debug

const getRequest = (path, queryString) => {
	return new Promise((resolve, reject) => {
		if (debug)
			log('making a request:', `${baseUrl+path}?apiKey=***********&${queryString}&integration=${integrationName}`)
		request({
			method: 'GET',
			uri: `${baseUrl+path}?apiKey=${apiKey}&${queryString}&integration=${integrationName}`
		}, function (error, response, data) {
			data = JSON.parse(data)
			if (!error && response.statusCode == 200 && data && data.status && data.status == 'success' && data.result && data.result instanceof Array) {
				// if (debug)
					// log(JSON.stringify(data, null, 2))
				resolve(data.result)
			} else {
				log('ERROR Making a Request!! ------->')
				log(JSON.stringify(error, null, 4) || JSON.stringify(data, null, 2) || response)
				reject(error || data || response)
			}
	
		})
	})
}


const postRequest = (path, json) => {
	return new Promise((resolve, reject) => {
		if (debug)
			log('making a request:', `${baseUrl+path}?apiKey=*************&integration=${integrationName}`, '\n', JSON.stringify(json, null, 2))
		request({
			method: 'POST',
			uri: `${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`,
			json: json
		}, function (error, response, data) {
			if (!error && (response.statusCode == 200)) {
				if (debug)
					log(JSON.stringify(json, null, 2))
				resolve(data)
			} else {
				log('ERROR Making a Request!! ------->')
				log(JSON.stringify(error, null, 4) || JSON.stringify(data, null, 2) || response)
				reject(error || data || response)
			}
	
		})
	})
}


const patchRequest = (path, json) => {
	return new Promise((resolve, reject) => {
		if (debug)
			log('making a request:', `${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`, '\n', JSON.stringify(json, null, 2))
		request({
			method: 'PATCH',
			uri: `${baseUrl+path}?apiKey=${apiKey}&integration=${integrationName}`,
			json: json
		}, function (error, response, data) {
			if (!error && (response.statusCode == 200)) {
				if (debug)
					log(JSON.stringify(json, null, 2))
				resolve(data)
			} else {
				log('ERROR Making a Request!! ------->')
				log(JSON.stringify(error, null, 4) || JSON.stringify(data, null, 2) || response)
				reject(error || data || response)
			}
	
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
		const queryString = 'fields=id,acState,measurements,location,occupancy,remoteCapabilities,room,temperatureUnit,productModel,remote'
		return await getRequest(path, queryString)
	},

	getDevicesStates: async () => {
		const path = '/users/me/pods'
		const queryString = 'fields=id,acState,measurements,location,occupancy'
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

	setDevicePropertyState: async (deviceId, property, value) => {
		const path = `/pods/${deviceId}/acStates/${property}`
		const json = {
			'newValue': value
		}
		return await patchRequest(path, json)
	}
}