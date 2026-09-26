import {
	afterEach, beforeEach, test
} from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import SensiboApi from '../sensibo/SensiboAPI.js'
import { fakePlatform } from './helpers.js'

const TOKEN_URL = 'https://home.sensibo.com/o/token/'
const originalAdapter = axios.defaults.adapter
const originalHeaders = axios.defaults.headers
const originalParams = axios.defaults.params
let requests
let tokenResponse

function resetAxiosDefaults() {
	axios.defaults.adapter = originalAdapter
	axios.defaults.headers = originalHeaders
	axios.defaults.params = originalParams
}

beforeEach(() => {
	resetAxiosDefaults()
	requests = []
	tokenResponse = {
		access_token: 'fresh-token',
		expires_in: 3600
	}
	axios.defaults.adapter = async config => {
		requests.push(config)

		return {
			data: config.url === TOKEN_URL
				? tokenResponse
				: {
						status: 'success',
						result: []
					},
			status: 200,
			statusText: 'OK',
			headers: {},
			config
		}
	}
})

afterEach(resetAxiosDefaults)

function loginPlatform(storedToken) {
	const saved = []
	const platform = fakePlatform({
		username: 'me@example.com',
		password: 'secret',
		PLUGIN_VERSION: '3.0.2',
		locationsToInclude: [],
		devicesToExclude: [],
		storage: {
			getItem: async key => {
				return key === 'token' ? storedToken : undefined
			},
			setItem: (key, value) => {
				saved.push([key, value])
			}
		}
	})

	return {
		platform,
		saved
	}
}

function authorization(config) {
	return config.headers.Authorization ?? config.headers.get?.('Authorization')
}

test('a stored, unexpired token for the same username is used without calling the token URL', async () => {
	const {
		platform, saved
	} = loginPlatform({
		username: 'me@example.com',
		key: 'stored-token',
		expirationDate: Date.now() + 60000
	})
	const api = await SensiboApi(platform)

	await api.getAllDevices()

	assert.equal(requests.length, 1)
	assert.match(requests[0].url, /^\/users\/me\/pods/)
	assert.equal(authorization(requests[0]), 'Bearer stored-token')
	assert.deepEqual(saved, [])
})

test('with no stored token, one is POSTed for and saved to storage', async () => {
	const {
		platform, saved
	} = loginPlatform(undefined)
	const before = Date.now()

	await SensiboApi(platform)

	assert.equal(requests.length, 1)
	assert.equal(requests[0].method, 'post')
	assert.equal(requests[0].url, TOKEN_URL)
	assert.equal(requests[0].params, null)

	const body = new URLSearchParams(requests[0].data)

	assert.equal(body.get('username'), 'me@example.com')
	assert.equal(body.get('password'), 'secret')
	assert.equal(body.get('grant_type'), 'password')

	assert.equal(saved.length, 1)
	assert.equal(saved[0][0], 'token')
	assert.equal(saved[0][1].username, 'me@example.com')
	assert.equal(saved[0][1].key, 'fresh-token')
	assert.ok(saved[0][1].expirationDate >= before + 3600000)
})

test('the fetched token becomes the Authorization header of later API requests', async () => {
	const { platform } = loginPlatform(undefined)
	const api = await SensiboApi(platform)

	await api.getAllDevices()

	assert.equal(authorization(requests[1]), 'Bearer fresh-token')
	assert.equal(requests[1].params.apiKey, undefined)
})

test('an expired stored token is ignored and a new one fetched', async () => {
	const {
		platform, saved
	} = loginPlatform({
		username: 'me@example.com',
		key: 'old-token',
		expirationDate: Date.now() - 1
	})

	await SensiboApi(platform)

	assert.equal(requests[0].url, TOKEN_URL)
	assert.equal(saved[0][1].key, 'fresh-token')
})

test('a stored token for another username is ignored and a new one fetched', async () => {
	const {
		platform, saved
	} = loginPlatform({
		username: 'someone@else.com',
		key: 'their-token',
		expirationDate: Date.now() + 60000
	})

	await SensiboApi(platform)

	assert.equal(requests[0].url, TOKEN_URL)
	assert.equal(saved[0][1].key, 'fresh-token')
})

test('a token response without access_token leaves requests unauthenticated', async () => {
	const {
		platform, saved
	} = loginPlatform(undefined)

	tokenResponse = { error: 'invalid_grant' }

	// init swallows the failure; the next request retries the login, then rejects
	const api = await SensiboApi(platform)

	await assert.rejects(api.getAllDevices(), { message: 'No valid authentication details found, stopping API request.' })
	assert.deepEqual(saved, [])
	assert.deepEqual(requests.map(config => {
		return config.url
	}), [TOKEN_URL, TOKEN_URL])
})

test('a token request that fails without a response does not hang setup', async () => {
	const {
		platform, saved
	} = loginPlatform(undefined)

	axios.defaults.adapter = async config => {
		requests.push(config)

		throw new Error('getaddrinfo ENOTFOUND home.sensibo.com')
	}

	const api = await SensiboApi(platform)

	await assert.rejects(api.getAllDevices(), { message: 'No valid authentication details found, stopping API request.' })
	assert.deepEqual(saved, [])
})
