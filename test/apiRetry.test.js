// Which failures SensiboAPI.js retries, for which HTTP methods, how many times, how long it waits, and what gets logged
import {
	after, afterEach, before, beforeEach, describe, it, mock
} from 'node:test'
import assert from 'node:assert/strict'
import axios, { AxiosError } from 'axios'
import SensiboApi from '../sensibo/SensiboAPI.js'
import { fakePlatform } from './helpers.js'

const originalAdapter = axios.defaults.adapter

function makePlatform() {
	const logs = {
		info: [],
		warn: [],
		error: [],
		easyDebug: []
	}
	const log = () => {}

	for (const level of ['info', 'warn', 'error', 'easyDebug']) {
		log[level] = (...args) => {
			logs[level].push(args.map(arg => {
				return typeof arg === 'string' ? arg : JSON.stringify(arg)
			}).join(' '))
		}
	}
	log.success = log.debug = log.devDebug = () => {}

	return fakePlatform({
		log,
		logs,
		apiKey: 'test-api-key',
		PLUGIN_VERSION: '3.0.2',
		locationsToInclude: [],
		devicesToExclude: []
	})
}

/**
 * Installs an adapter that answers each request with the next scripted outcome and records the calls.
 * An outcome is { status, data, headers } for an HTTP response, or { networkCode } for a connection failure.
 */
function scriptResponses(outcomes) {
	const calls = []

	axios.defaults.adapter = async config => {
		calls.push({
			method: config.method,
			url: config.url,
			retryCount: config.retryCount
		})
		const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)]

		if (outcome.networkCode) {
			throw new AxiosError('network failure', outcome.networkCode, config, {})
		}

		const response = {
			data: outcome.data ?? {
				status: 'success',
				result: {}
			},
			status: outcome.status,
			statusText: String(outcome.status),
			headers: outcome.headers || {},
			config,
			request: {}
		}

		if (outcome.status >= 200 && outcome.status < 300) {
			return response
		}

		throw new AxiosError(`Request failed with status code ${outcome.status}`, AxiosError.ERR_BAD_RESPONSE, config, {}, response)
	}

	return calls
}

// Backoff waits are real setTimeouts (1s-8s each), so they run on mocked timers. This keeps
// advancing the clock until the request settles.
async function settle(promise) {
	let done = false
	const result = promise.then(value => {
		done = true

		return { value }
	}, error => {
		done = true

		return { error }
	})

	for (let i = 0; i < 100 && !done; i++) {
		await new Promise(resolve => {
			setImmediate(resolve)
		})
		mock.timers.tick(10000)
	}

	return result
}

const fail = status => {
	return { status }
}
const ok = {
	status: 200,
	data: {
		status: 'success',
		result: { ok: true }
	}
}
const podsURL = 'https://home.sensibo.com/api/v2/pods/dev1'

describe('SensiboAPI retries', () => {
	let platform
	let api

	before(() => {
		mock.timers.enable({ apis: ['setTimeout'] })
	})

	after(() => {
		mock.timers.reset()
	})

	beforeEach(async () => {
		platform = makePlatform()
		api = await SensiboApi(platform)
	})

	afterEach(() => {
		axios.defaults.adapter = originalAdapter
	})

	it('retries a 429 on a POST (setDeviceACState) and logs the recovery at info', async () => {
		const calls = scriptResponses([fail(429), ok])
		const {
			value, error
		} = await settle(api.setDeviceACState('dev1', { on: true }))

		assert.equal(error, undefined)
		assert.deepEqual(value, {
			status: 'success',
			result: { ok: true }
		})
		assert.equal(calls.length, 2)
		assert.ok(calls.every(call => {
			return call.method === 'post' && call.url === '/pods/dev1/acStates'
		}))
		assert.deepEqual(platform.logs.info, [`Sensibo API recovered after 1 retry/retries: ${podsURL}/acStates`])
	})

	it('retries a 429 on a PATCH (syncDeviceState) too', async () => {
		const calls = scriptResponses([fail(429), ok])
		const { error } = await settle(api.syncDeviceState('dev1', true))

		assert.equal(error, undefined)
		assert.equal(calls.length, 2)
		assert.equal(calls[0].method, 'patch')
	})

	for (const status of [408, 500, 502, 503, 504]) {
		it(`retries a ${status} on a GET`, async () => {
			const calls = scriptResponses([fail(status), {
				status: 200,
				data: {
					status: 'success',
					result: []
				}
			}])
			const { error } = await settle(api.getAllDevices())

			assert.equal(error, undefined)
			assert.equal(calls.length, 2)
		})

		it(`does NOT retry a ${status} on a POST`, async () => {
			const calls = scriptResponses([fail(status), ok])
			const { error } = await settle(api.setDeviceClimateReactState('dev1', { enabled: true }))

			assert.equal(calls.length, 1)
			assert.equal(error.message, `Request failed with status code ${status}`)
			assert.equal(error.errorURL, `${podsURL}/smartmode`)
			assert.deepEqual(platform.logs.warn, [`Sensibo API temporarily unavailable (Request failed with status code ${status}) after 1 attempt(s), not retried: ${podsURL}/smartmode`])
		})
	}

	it('retries ambiguous statuses on PUT and DELETE (idempotent)', async () => {
		let calls = scriptResponses([fail(503), ok])

		assert.equal((await settle(api.enableDisablePureBoost('dev1', true))).error, undefined)
		assert.equal(calls.length, 2)
		assert.equal(calls[0].method, 'put')

		calls = scriptResponses([fail(503), ok])
		assert.equal((await settle(api.resetFilterIndicator('dev1'))).error, undefined)
		assert.equal(calls.length, 2)
		assert.equal(calls[0].method, 'delete')
	})

	it('does NOT retry an ambiguous status on a PATCH', async () => {
		const calls = scriptResponses([fail(502), ok])
		const { error } = await settle(api.syncDeviceState('dev1', true))

		assert.ok(error)
		assert.equal(calls.length, 1)
	})

	for (const networkCode of ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']) {
		it(`retries ${networkCode} on an idempotent PUT but not on a POST`, async () => {
			let calls = scriptResponses([{ networkCode }, ok])

			assert.equal((await settle(api.enableDisablePureBoost('dev1', true))).error, undefined)
			assert.equal(calls.length, 2)

			calls = scriptResponses([{ networkCode }, ok])
			const { error } = await settle(api.setDeviceACState('dev1', { on: true }))

			assert.ok(error)
			assert.equal(calls.length, 1)
		})
	}

	it('does not retry an unknown network error code or a non-transient status', async () => {
		let calls = scriptResponses([{ networkCode: 'ENOTFOUND' }, ok])

		assert.ok((await settle(api.resetFilterIndicator('dev1'))).error)
		assert.equal(calls.length, 1)

		for (const status of [400, 401, 403, 404]) {
			calls = scriptResponses([fail(status), ok])
			assert.ok((await settle(api.resetFilterIndicator('dev1'))).error)
			assert.equal(calls.length, 1, `status ${status}`)
		}
	})

	it('gives up after 3 retries (4 attempts), rejects, and warns once with the attempt count', async () => {
		const calls = scriptResponses([fail(429)])
		const { error } = await settle(api.setDeviceACState('dev1', { on: true }))

		assert.equal(calls.length, 4)
		assert.deepEqual(calls.map(call => {
			return call.retryCount
		}), [undefined, 1, 2, 3])
		assert.equal(error.message, 'Request failed with status code 429')
		assert.equal(error.errorURL, `${podsURL}/acStates`)
		assert.deepEqual(platform.logs.warn, [`Sensibo API temporarily unavailable (Request failed with status code 429) after 4 attempt(s), retries exhausted: ${podsURL}/acStates`])
		assert.deepEqual(platform.logs.error, [])
		assert.deepEqual(platform.logs.info, [])
	})

	it('logs non-transient failures as errors rather than the temporary warning', async () => {
		scriptResponses([fail(400)])
		await settle(api.resetFilterIndicator('dev1'))

		assert.deepEqual(platform.logs.error, [`SensiboAPI.js apiRequest - Error URL: ${podsURL}/cleanFiltersNotification`])
		assert.ok(!platform.logs.warn.some(line => {
			return line.startsWith('Sensibo API temporarily unavailable')
		}))
	})

	it('reports the retry count in the recovery log after several retries', async () => {
		scriptResponses([fail(503), fail(503), fail(503), ok])
		const { error } = await settle(api.resetFilterIndicator('dev1'))

		assert.equal(error, undefined)
		assert.deepEqual(platform.logs.info, [`Sensibo API recovered after 3 retry/retries: ${podsURL}/cleanFiltersNotification`])
	})

	it('does not log a recovery when the first attempt succeeds', async () => {
		scriptResponses([ok])
		await settle(api.resetFilterIndicator('dev1'))

		assert.deepEqual(platform.logs.info, [])
	})

	it('waits Retry-After seconds when the header is numeric', async () => {
		scriptResponses([{
			status: 429,
			headers: { 'retry-after': '7' }
		}, ok])
		await settle(api.setDeviceACState('dev1', { on: true }))

		assert.ok(platform.logs.easyDebug.includes('Retrying POST /pods/dev1/acStates in 7000ms (attempt 1 of 3) after status code 429'),
			platform.logs.easyDebug.join('\n'))
	})

	it('honors an HTTP-date Retry-After', async () => {
		const retryAt = new Date(Date.now() + 20000).toUTCString()

		scriptResponses([{
			status: 429,
			headers: { 'retry-after': retryAt }
		}, ok])
		await settle(api.setDeviceACState('dev1', { on: true }))

		const line = platform.logs.easyDebug.find(entry => {
			return entry.startsWith('Retrying POST')
		})
		const delay = Number(/in (\d+)ms/.exec(line)[1])

		// second-granularity date, so somewhere in the 19-20s window
		assert.ok(delay > 18000 && delay <= 20000, line)
	})

	it('falls back to jittered exponential backoff (0.5-1s, 1-2s, 2-4s) without Retry-After or with a non-positive one', async () => {
		scriptResponses([{
			status: 429,
			headers: { 'retry-after': '0' }
		}, fail(503), fail(503), fail(503)])
		await settle(api.resetFilterIndicator('dev1'))

		const delays = platform.logs.easyDebug.filter(entry => {
			return entry.startsWith('Retrying DELETE')
		}).map(entry => {
			return Number(/in (\d+)ms/.exec(entry)[1])
		})

		assert.equal(delays.length, 3)
		assert.ok(delays[0] >= 500 && delays[0] <= 1000, String(delays))
		assert.ok(delays[1] >= 1000 && delays[1] <= 2000, String(delays))
		assert.ok(delays[2] >= 2000 && delays[2] <= 4000, String(delays))
	})

	it('describes network failures by their code in the retry debug line', async () => {
		scriptResponses([{ networkCode: 'ECONNRESET' }, ok])
		await settle(api.resetFilterIndicator('dev1'))

		assert.ok(platform.logs.easyDebug.some(entry => {
			return /^Retrying DELETE \/pods\/dev1\/cleanFiltersNotification in \d+ms \(attempt 1 of 3\) after ECONNRESET$/.test(entry)
		}), platform.logs.easyDebug.join('\n'))
	})
})
