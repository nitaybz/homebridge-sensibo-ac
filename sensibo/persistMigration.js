import fsCb from 'fs'
import path from 'path'
import crypto from 'crypto'

const fs = fsCb.promises

// node-persist 3.x hashed key filenames with MD5; 4.x switched to SHA-256.
// Without migration the v4 storage silently fails to see any cache file
// written by a prior v3-bundled plugin release. This walks the persist dir
// at startup, finds legacy MD5-named files, verifies the file content
// matches the expected v3 shape, and rewrites the value via the live v4
// storage so it lands under the SHA-256 filename.
//
// We deliberately do NOT skip when v4 already has a file for the same key:
// a brief earlier v4 plugin install would have written a default into that
// SHA-256 file, and a subsequent v3 downgrade would have written the user's
// real data back into the MD5 file. The v3 file is the newer one in that
// path, so we always overwrite. After successful migration the v3 file is
// deleted, so the helper is idempotent on subsequent boots.
export default async function migrateLegacyPersist(persistDir, storage, log) {
	let files

	try {
		files = await fs.readdir(persistDir)
	} catch (err) {
		if (err.code !== 'ENOENT' && log) {
			log(`persistMigration readdir failed: ${err.message}`)
		}

		return
	}

	for (const file of files) {
		if (!/^[a-f0-9]{32}$/.test(file)) {
			continue
		}
		const filePath = path.join(persistDir, file)

		try {
			const raw = await fs.readFile(filePath, 'utf8')
			const datum = JSON.parse(raw)

			if (!datum || typeof datum !== 'object' || typeof datum.key !== 'string' || !('value' in datum)) {
				continue
			}
			const expectedMd5 = crypto.createHash('md5').update(datum.key).digest('hex')

			if (expectedMd5 !== file) {
				continue
			}
			await storage.setItem(datum.key, datum.value)
			log && log(`Migrated legacy cache key "${datum.key}" from node-persist v3 to v4`)
			try {
				await fs.unlink(filePath)
			} catch {
				// ignore
			}
		} catch (err) {
			log && log(`persistMigration failed for ${file}: ${err && err.message ? err.message : err}`)
		}
	}
}
