import {
	afterEach, beforeEach, test
} from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import SensiboApi from '../sensibo/SensiboAPI.js'
import { fakePlatform } from './helpers.js'

let requests
let response
const originalAdapter = axios.defaults.adapter

beforeEach(() => {
	requests = []
	response = {
		status: 'success',
		result: []
	}
	axios.defaults.adapter = async config => {
		requests.push(config)

		return {
			data: response,
			status: 200,
			statusText: 'OK',
			headers: {},
			config
		}
	}
})

afterEach(() => {
	axios.defaults.adapter = originalAdapter
})

function apiPlatform(config) {
	return fakePlatform({
		apiKey: 'key123',
		PLUGIN_VERSION: '3.0.2',
		locationsToInclude: [],
		devicesToExclude: [],
		...config
	})
}

function device(id, roomName, locationName) {
	return {
		id,
		serial: id + '-serial',
		room: { name: roomName },
		location: {
			id: locationName + '-id',
			name: locationName,
			address: ['1 Main St'],
			occupancy: 'home'
		},
		smartMode: null
	}
}

test('requests carry the API key and integration name as query params', async () => {
	const api = await SensiboApi(apiPlatform({}))

	await api.getAllDevices()

	assert.equal(requests[0].baseURL, 'https://home.sensibo.com/api/v2')
	assert.equal(requests[0].params.apiKey, 'key123')
	assert.equal(requests[0].params.integration, 'homebridge-sensibo-ac@3.0.2')
	assert.match(requests[0].url, /^\/users\/me\/pods\?fields=/)
})

test('getAllDevices strips the address and fills in a missing smartMode', async () => {
	const api = await SensiboApi(apiPlatform({}))

	response.result = [device('pod1', 'Study', 'Home')]

	const [result] = await api.getAllDevices()

	assert.deepEqual(result.location, {
		occupancy: 'home',
		name: 'Home',
		id: 'Home-id'
	})
	assert.deepEqual(result.smartMode, { enabled: false })
})

test('getAllDevices applies devicesToExclude (id, serial, room) and locationsToInclude', async () => {
	response.result = [device('a', 'Study', 'Home'), device('b', 'Kitchen', 'Home'), device('c', 'Office', 'Work'), device('d', 'Den', 'Home')]

	const excluded = await (await SensiboApi(apiPlatform({ devicesToExclude: ['a', 'b-serial', 'Den'] }))).getAllDevices()
	const located = await (await SensiboApi(apiPlatform({ locationsToInclude: ['Work'] }))).getAllDevices()

	assert.deepEqual(excluded.map(d => {
		return d.id
	}), ['c'])
	assert.deepEqual(located.map(d => {
		return d.id
	}), ['c'])
})

test('setDeviceACState POSTs the state to the pod', async () => {
	const api = await SensiboApi(apiPlatform({}))

	await api.setDeviceACState('pod1', {
		on: true,
		mode: 'cool'
	})

	assert.equal(requests[0].method, 'post')
	assert.equal(requests[0].url, '/pods/pod1/acStates')
	assert.deepEqual(JSON.parse(requests[0].data), {
		acState: {
			on: true,
			mode: 'cool'
		}
	})
})

test('setDeviceClimateReactState POSTs to smartmode', async () => {
	const api = await SensiboApi(apiPlatform({}))

	await api.setDeviceClimateReactState('pod1', { enabled: true })

	assert.equal(requests[0].method, 'post')
	assert.equal(requests[0].url, '/pods/pod1/smartmode')
	assert.deepEqual(JSON.parse(requests[0].data), { enabled: true })
})

test('syncDeviceState PATCHes on with a state-correction reason', async () => {
	const api = await SensiboApi(apiPlatform({}))

	await api.syncDeviceState('pod1', false)

	assert.equal(requests[0].method, 'patch')
	assert.equal(requests[0].url, '/pods/pod1/acStates/on')
	assert.deepEqual(JSON.parse(requests[0].data), {
		newValue: false,
		reason: 'StateCorrectionByUser'
	})
})

test('a non-success response rejects with the response body', async () => {
	const api = await SensiboApi(apiPlatform({}))

	response = {
		status: 'failure',
		reason: 'bad',
		message: 'nope'
	}

	await assert.rejects(api.setDeviceACState('pod1', {}), {
		reason: 'bad',
		message: 'nope'
	})
})

test('an HTTP error is not retried and rejects with the URL and message', async () => {
	const api = await SensiboApi(apiPlatform({}))

	axios.defaults.adapter = async config => {
		requests.push(config)
		const error = new Error('Request failed with status code 429')

		error.response = {
			data: { reason: 'rate limit' },
			status: 429
		}
		throw error
	}

	await assert.rejects(api.setDeviceACState('pod1', {}), {
		errorURL: 'https://home.sensibo.com/api/v2/pods/pod1/acStates',
		message: 'Request failed with status code 429',
		response: { reason: 'rate limit' }
	})
	assert.equal(requests.length, 1)
})
