import MatterAirConditioner from './MatterAirConditioner.js'
import MatterHumiditySensor from './MatterHumiditySensor.js'

// Matter twins, keyed by the `type` of the HomeKit accessory each one mirrors. An accessory type with
// no entry here simply isn't published to Matter; its HomeKit side is untouched either way.
const MATTER_TWINS = {
	AirConditioner: MatterAirConditioner,
	HumiditySensor: MatterHumiditySensor
}

/**
 * Publishes the plugin's accessories over Matter, alongside (never instead of) HAP.
 *
 * Homebridge only defines api.matter on a bridge that has Matter switched on, so enabling it there is
 * the real opt-in; the plugin's own enableMatter option exists to turn this half off without disabling
 * Matter for the whole bridge.
 *
 * Registration has to happen on every start, not just the first: Homebridge restores its cached Matter
 * accessories as endpoints carrying stub handlers, and re-registering is what attaches the real ones.
 */
class MatterBridge {

	constructor(platform) {
		this.platform = platform
		this.log = platform.log
		this.api = platform.api

		this.available = typeof this.api.isMatterAvailable === 'function'
			&& this.api.isMatterAvailable()
			&& this.api.isMatterEnabled()
			&& !!this.api.matter

		this.enabled = this.available && platform.enableMatter !== false

		// Descriptors Homebridge restored from its Matter cache, so accessories that no longer exist can
		// be dropped - the Matter equivalent of platform.cachedAccessories.
		this.cached = new Map()
		// Twins handed to the Matter server this run, keyed by UUID.
		this.published = new Map()
		// syncMatterCache() runs on every poll and registration is async, so the work is chained - two
		// refreshes must never register the same UUID twice (Homebridge throws on a duplicate).
		this.queue = Promise.resolve()
		this.announced = false
	}

	/**
	 * Homebridge calls this once per cached Matter accessory at startup.
	 * @param    {Object}  accessory  The restored MatterAccessory descriptor
	 * @returns  {void}
	 */
	configureCached(accessory) {
		this.cached.set(accessory.UUID, accessory)
	}

	/**
	 * Bring the Matter server in line with platform.activeAccessories. Safe (and cheap) to call on every
	 * refresh - it only acts on what actually changed.
	 * @returns  {void}
	 */
	sync() {
		if (!this.enabled) {
			return
		}

		const live = new Map()
		const pending = []

		this.platform.activeAccessories.forEach(accessory => {
			const Twin = MATTER_TWINS[accessory.type]

			if (!Twin) {
				return
			}

			// undefined means "not looked at yet"; null means "looked at, nothing to publish", which
			// stops a twin that opted out from being rebuilt on every poll.
			if (accessory.matter === undefined) {
				const twin = new Twin(accessory, this.platform)

				accessory.matter = twin.descriptor ? twin : null
			}

			if (!accessory.matter) {
				return
			}

			live.set(accessory.matter.UUID, accessory.matter)

			if (!this.published.has(accessory.matter.UUID)) {
				this.published.set(accessory.matter.UUID, accessory.matter)
				pending.push(accessory.matter)
			}
		})

		const stale = this.staleAccessories(live)

		if (!pending.length && !stale.length) {
			return
		}

		this.enqueue(async () => {
			await this.register(pending)
			await this.unregister(stale)

			if (!this.announced) {
				this.announced = true
				this.log.success(`✓ Matter: published ${this.published.size} of ${this.platform.activeAccessories.length} accessories.`)
			}
		})
	}

	/**
	 * @param    {Map}       live  The twins that should currently exist, keyed by UUID
	 * @returns  {Object[]}        Descriptors to unregister
	 */
	staleAccessories(live) {
		const stale = new Map()

		// An empty accessory list means the Sensibo API failed and syncHomeKitCache fell back to an empty
		// device list. Unregistering here would drop the Matter pairing for every endpoint over a network
		// blip, so leave them be and let the next successful refresh decide.
		if (!live.size) {
			return []
		}

		this.cached.forEach((descriptor, uuid) => {
			if (!live.has(uuid)) {
				stale.set(uuid, descriptor)
			}
		})

		this.published.forEach((twin, uuid) => {
			if (!live.has(uuid)) {
				stale.set(uuid, twin.descriptor)
			}
		})

		return [...stale.values()]
	}

	/**
	 * @param    {Object[]}        twins  The twins to hand to the Matter server
	 * @returns  {Promise<void>}
	 */
	async register(twins) {
		// One at a time: registerPlatformAccessories rejects the whole call if any endpoint fails to
		// build, and one malformed accessory should not keep the others off Matter.
		for (const twin of twins) {
			try {
				await this.api.matter.registerPlatformAccessories(this.platform.PLUGIN_NAME, this.platform.PLATFORM_NAME, [twin.descriptor])
				twin.markRegistered()
				this.log.easyDebug(`Matter - published ${twin.name} (${twin.UUID})`)
			} catch (error) {
				// Deliberately left in this.published so it isn't retried every 90 seconds: a failure here
				// is a structural problem with the accessory, not a transient one.
				this.log.error(`Matter - could not publish ${twin.name}. Error message:`)
				this.log.warn(error.message || error)
			}
		}
	}

	/**
	 * @param    {Object[]}        accessories  Descriptors to remove from the Matter server
	 * @returns  {Promise<void>}
	 */
	async unregister(accessories) {
		if (!accessories.length) {
			return
		}

		this.log.warn(`Matter - unregistering ${accessories.length} accessories that no longer exist:`)

		accessories.forEach(accessory => {
			this.log.info(`${accessory.displayName} - ${accessory.context?.type} - ${accessory.context?.deviceId}`)
			this.cached.delete(accessory.UUID)
			this.published.delete(accessory.UUID)
		})

		try {
			await this.api.matter.unregisterPlatformAccessories(this.platform.PLUGIN_NAME, this.platform.PLATFORM_NAME, accessories)
		} catch (error) {
			this.log.error('Matter - could not unregister accessories. Error message:')
			this.log.warn(error.message || error)
		}
	}

	enqueue(task) {
		this.queue = this.queue
			.then(task)
			.catch(error => {
				this.log.error('Matter - error while syncing accessories. Error message:')
				this.log.warn(error.message || error)
			})
	}

}

export default MatterBridge
