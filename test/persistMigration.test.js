import {
	afterEach, beforeEach, test
} from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import migrateLegacyPersist from '../sensibo/persistMigration.js'

let dir
let stored
const storage = {
	setItem: async (key, value) => {
		stored[key] = value
	}
}

function md5(key) {
	return crypto.createHash('md5').update(key).digest('hex')
}

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sensibo-persist-'))
	stored = {}
})

afterEach(async () => {
	await fs.rm(dir, {
		recursive: true,
		force: true
	})
})

test('v3 files named by the MD5 of their key are rewritten through v4 storage and deleted', async () => {
	await fs.writeFile(path.join(dir, md5('state')), JSON.stringify({
		key: 'state',
		value: { devices: { a: 1 } }
	}))

	await migrateLegacyPersist(dir, storage, null)

	assert.deepEqual(stored, { state: { devices: { a: 1 } } })
	assert.deepEqual(await fs.readdir(dir), [])
})

test('files whose name does not match the MD5 of their key are left alone', async () => {
	const wrongName = md5('other')

	await fs.writeFile(path.join(dir, wrongName), JSON.stringify({
		key: 'state',
		value: 1
	}))
	await fs.writeFile(path.join(dir, 'not-a-hash'), JSON.stringify({
		key: 'x',
		value: 1
	}))

	await migrateLegacyPersist(dir, storage, null)

	assert.deepEqual(stored, {})
	assert.deepEqual((await fs.readdir(dir)).sort(), [wrongName, 'not-a-hash'].sort())
})

test('an unparseable legacy file is skipped and logged', async () => {
	const logged = []

	await fs.writeFile(path.join(dir, md5('state')), '{not json')

	await migrateLegacyPersist(dir, storage, message => {
		logged.push(message)
	})

	assert.deepEqual(stored, {})
	assert.equal(logged.length, 1)
})

test('a missing persist directory is not an error', async () => {
	await migrateLegacyPersist(path.join(dir, 'missing'), storage, () => {
		assert.fail('should not log ENOENT')
	})
})
