let log
// Sensibo event kind for an AC state change, and the event reason Climate React uses
const acStateChangedEventKind = 1000000
const climateReactEventReason = 'Trigger'
const minDate = new Date('0001-01-01T00:00:00Z')

/**
 * Some ACs miss an IR command that Climate React sent, while Sensibo believes it arrived. To make such a mismatch less
 * likely to last, re-send the state that the last Climate React action produced, as long as nothing else changed the
 * AC since. It is repeated commandRepeatCount times, commandRepeatDelayMilliseconds apart.
 * @param   {Object}         platform
 * @param   {Object}         airConditioner  the AirConditioner accessory
 * @param   {Object}         device          the device from the Sensibo response
 * @returns {Promise<Date|undefined>}             the new lastStateRefresh for the AC, if it changes
 */
async function repeatClimateReactAction(platform, airConditioner, device) {
	if (!platform.enableRepeatClimateReactAction) {
		return
	}

	if (!(airConditioner.state.smartMode?.enabled ?? false)) {
		log.easyDebug(`Repeat Climate React Action for ${airConditioner.name}: Climate React is disabled, skipping.`)

		return
	}

	const since = airConditioner.lastStateRefresh.getTime()

	// The first refresh only records the time, events from before it are not ours to repeat
	if (since === minDate.getTime()) {
		return new Date()
	}

	const events = await platform.sensiboApi.getDeviceEvents(device.id)
	const acStateChanges = events
		.filter(event => {
			return event.eventKind == acStateChangedEventKind
		})
		.sort((a, b) => {
			return Date.parse(b.timestamp) - Date.parse(a.timestamp)
		})
	const lastClimateReactChange = acStateChanges.find(event => {
		return event.details?.reason == climateReactEventReason && Date.parse(event.timestamp) >= since
	})
	const now = new Date()

	if (!lastClimateReactChange) {
		log.easyDebug(`Repeat Climate React Action for ${airConditioner.name}: no Climate React change since the last refresh, skipping.`)

		return now
	}

	const lastClimateReactChangeTime = Date.parse(lastClimateReactChange.timestamp)
	const newerChanges = acStateChanges.filter(event => {
		return Date.parse(event.timestamp) > lastClimateReactChangeTime
	})

	if (newerChanges.length > 0) {
		log.easyDebug(`Repeat Climate React Action for ${airConditioner.name}: the AC was changed since, skipping.`)

		return now
	}

	// Too recent: the AC may still be acting on it. Look at it again on the next refresh.
	if (now.getTime() - lastClimateReactChangeTime < platform.repeatClimateReactActionMinGapMilliseconds) {
		log.easyDebug(`Repeat Climate React Action for ${airConditioner.name}: the Climate React change is too recent, will look again next refresh.`)

		return new Date(lastClimateReactChangeTime)
	}

	const resultingState = airConditioner.Utils.airConditionerStateFromDevice({
		...device,
		acState: lastClimateReactChange.details.resultingAcState
	})

	log.easyDebug(`Repeat Climate React Action for ${airConditioner.name}: re-sending the last Climate React result ${platform.commandRepeatCount} time(s), ${platform.commandRepeatDelayMilliseconds / 1000}s apart`)

	// WARNING: repeats that are far apart can override a change the user makes in between
	for (let i = 0; i < platform.commandRepeatCount; i++) {
		setTimeout(() => {
			// Setting the special '_' property replaces the whole state and sends it to Sensibo (see StateHandler)
			airConditioner.state._ = resultingState
		}, platform.commandRepeatDelayMilliseconds * i)
	}

	return now
}

function getAllDevicesAndUpdatePlatform(platform) {
	log.easyDebug('refreshState getAllDevicesAndUpdatePlatform - Starting...')

	return new Promise((resolve, reject) => {
		platform.sensiboApi.getAllDevices()
			.catch(error => {
				// TODO: should we have max retries and/or back-off for the API callout?
				// failureCount = failureCount++
				// backoffFactor = 2 [2, 4, 8, 16...]  //  3 [3, 9, 27, 81, 243...]
				// newPollingInterval = platform.pollingInterval * (backoffFactor ** failureCount)  // if 2 [170, 340, 680, 1360]

				// This error is caught again below (and logged), so only debug logging here to reduce log duplicates
				log.easyDebug('refreshState getAllDevices.catch 1 - getAllDevices API call failed, caught error:')
				log.easyDebug(error.message || error)

				// rejecting here still goes in to the .then, throwing goes to the .catch
				// reject(error)
				throw error
			})
			.then(allDevices => {
				if (!allDevices || !allDevices.length) {
					log.easyDebug('refreshState getAllDevices.then - allDevices is not set')

					throw ('allDevices is not set')
				}

				log.easyDebug('refreshState getAllDevices.then - getAllDevices API complete')

				// Recheck flags to ensure nothing changed while waiting for API
				if (platform.setProcessing) {
					log.easyDebug('refreshState getAllDevices.then - platform.setProcessing now == true')
					log.easyDebug('refreshState getAllDevices.then - Outbound API running, stopping refreshState to prevent overwriting device state')

					platform.refreshStateProcessing = false

					// throw 'platform.setProcessing now == true, stopping refreshState to prevent overwriting'

					// rejecting and returning here goes to the caller (doRefresh)
					reject('platform.setProcessing now == true')

					return
				}

				// Recheck flags to ensure nothing changed while waiting for API
				if (!platform.refreshStateProcessing) {
					log.easyDebug('refreshState getAllDevices.then - platform.refreshStateProcessing now == false')
					log.easyDebug('refreshState getAllDevices.then - Multiple refreshStates running? Stopping current refreshState to try and prevent overwriting device state')

					// throw 'platform.refreshStateProcessing now == stopping refreshState to prevent overwriting'

					// rejecting and returning here goes to the caller (doRefresh)
					reject('platform.refreshStateProcessing now == false')

					return
				}

				// TODO: the below could be in their own ".then" (or even their own function/Promise?)
				log.devDebug('refreshState getAllDevices.then - updating platform.devices and platform.storage.devices')

				platform.devices = allDevices

				platform.storage.setItem('devices', allDevices)

				log.easyDebug('refreshState getAllDevices.then - getAllDevices and platform.storage.setItem update complete')

				// TODO: reset failure counter (for backoff / max retries)
				// failureCount = 0

				resolve('getAllDevices.then - getAllDevices and platform.storage.setItem complete')

				return
			}).catch(error => {
				log.easyDebug(`refreshState getAllDevices.catch 2 - Error caught.`)
				log.error('refreshState getAllDevices.catch - allDevices is empty or storage.setItem failed, caught error:')
				log.warn(error.message || error)

				// This reject goes to the .catch within doRefresh below (e.g. where getAllDevicesAndUpdatePlatform is called)
				reject(error)

				return
			})
	})
}

/**
 * The AC's state from a refresh. In broken thermostat mode Sensibo echoes back the extreme temperature the plugin sent,
 * which must not replace the user's target that HomeKit shows: it is left out (update() skips null values), except on
 * a cold start when there is no target yet.
 * @param   {Object}  platform
 * @param   {Object}  airConditioner  the AirConditioner accessory
 * @param   {Object}  device          the device from the Sensibo response
 * @returns {Object}                  the state to update the accessory with
 */
function airConditionerStateFromRefresh(platform, airConditioner, device) {
	const state = airConditioner.Utils.airConditionerStateFromDevice(device)

	if (platform.brokenThermostat && (state.mode === 'COOL' || state.mode === 'HEAT') && airConditioner.state.targetTemperature != null) {
		state.targetTemperature = null
	}

	return state
}

async function refreshAllDevices(platform) {
	log.easyDebug('refreshState refreshAllDevices - Starting...')

	// Per-device work that calls the API, awaited below so one device's failure is logged instead of crashing the bridge
	const pending = []
	// Needs to be here outside the forEach loop so that each location is only stored once
	const occupancySensorHandledLocations = []

	platform.devices.forEach(device => {
		log.easyDebug(`refreshState refreshAllDevices - in forEach ${device.room?.name} (${device.id})`)

		// TODO: should activeAccessories be declared outside the platform.devices.forEach loop and appended (pushed) to?
		const activeAccessories = platform.activeAccessories.filter(accessory => {
			// device.id for ACs, Purifiers etc, device.location.id for occupancy sensor
			return (accessory.id === device.id || accessory.id === device.location.id)
		})

		// TODO: Should this be outside the platform.devices.forEach loop? We'd (probably) lose the device context though
		activeAccessories.forEach(accessory => {
			log.easyDebug(`refreshState refreshAllDevices - Updating state for ${device.room?.name} (${device.id}) - ${accessory.type}`)

			switch (accessory.type) {
				case 'AirConditioner':
					// Update AC state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					accessory.state.update(airConditionerStateFromRefresh(platform, accessory, device))

					// Climate React as auto watches the room drift, but only from refreshes that were applied: update()
					// skips them while a command is being sent
					if (!platform.setProcessing) {
						accessory.autoClimateReact?.onRefresh()
					}
					pending.push(repeatClimateReactAction(platform, accessory, device)
						.then(lastStateRefresh => {
							if (lastStateRefresh) {
								accessory.lastStateRefresh = lastStateRefresh
							}
						}))

					break
				case 'AirPurifier':
					// Update Pure state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					accessory.state.update(accessory.Utils.airPurifierStateFromDevice(device))

					break
				case 'AirQualitySensor':
					// Update Air Quality state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					accessory.state.update(accessory.Utils.airQualityStateFromDeviceMeasurements(device.measurements))

					break
				case 'ClimateReactSwitch':
					accessory.updateHomeKit()

					break
				case 'HumiditySensor':
					accessory.updateHomeKit()

					break
				case 'OccupancySensor':
					// Occupancy Sensor (device.location) - e.g. home or not
					// Update Occupancy state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
					if (accessory && !occupancySensorHandledLocations.includes(accessory.id)) {
						occupancySensorHandledLocations.push(accessory.id)

						accessory.state.update(accessory.Utils.occupancyStateFromDeviceLocation(device.location))
					} else {
						log.easyDebug(`refreshState refreshAllDevices - Duplicate location, skipping ${device.room?.name} (${device.id}) - ${accessory.type}`)
					}

					break
				case 'RoomSensor':
					// Room Sensors (device.motionSensors) - e.g. in room or not
					// Update Room Sensor state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'

					// TODO: See if this can be brought in from below
					// device.sensor should be an array... how would we find the correct item in the array here?
					// device.sensor.find(sensor => sensor.id === accessory.id).measurements
					// accessory.state.update(accessory.Utils.sensorStateFromSensorMeasurements(/* device.sensor[].measurements */)) NOTE

					break
				case 'SyncButton':
					// SyncButton is stateless so no need to update, adding here to show it hasn't been forgotten

					break
				default:
					log.warn(`refreshState refreshAllDevices - Unmatched accessory.type: ${accessory.type}`)
			}
		})

		// Room Sensors (device.motionSensors) - e.g. in room or not
		// TODO: can this be moved in to switch statement above?
		if (device.motionSensors && Array.isArray(device.motionSensors)) {
			device.motionSensors.forEach(sensor => {
				const roomSensor = platform.activeAccessories.find(accessory => {
					return accessory.type === 'RoomSensor' && accessory.id === sensor.id
				})

				// Update Room Sensor state, note: updateHomeKit gets called within StateHandler.js, e.g. GET when prop === 'update'
				if (roomSensor) {
					log.easyDebug(`Updating state for ${device.room?.name} (${device.id}) - RoomSensor`)

					roomSensor.state.update(roomSensor.Utils.sensorStateFromSensorMeasurements(sensor.measurements))
				}
			})
		}
	})

	// NOTE: these must be awaited: an unawaited rejection (e.g. a 504 from getDeviceEvents) becomes an
	//       UnhandledPromiseRejection that crashes the child bridge
	const results = await Promise.allSettled(pending)

	results
		.filter(result => {
			return result.status === 'rejected'
		})
		.forEach(result => {
			log.warn(`refreshState refreshAllDevices - refreshing a device failed: ${result.reason?.message || JSON.stringify(result.reason)}`)
		})
}

function doRefresh(platform) {
	log.easyDebug('refreshState doRefresh - Starting...')

	return getAllDevicesAndUpdatePlatform(platform)
		.then(async outcome => {
			log.devDebug('refreshState doRefresh - getAllDevicesAndUpdatePlatform.then outcome:')
			log.devDebug(outcome)

			log.devDebug('refreshState doRefresh - Running syncHomeKitCache')

			// Register new devices / unregister removed devices
			platform.syncHomeKitCache()

			log.easyDebug('refreshState doRefresh - syncHomeKitCache complete')

			log.devDebug('refreshState doRefresh - Running refreshAllDevices (refresh individual devices)')

			// Iterate through all the devices returned from Sensibo and update state on activeAccessories
			await refreshAllDevices(platform)

			log.easyDebug('refreshState doRefresh - refreshAllDevices complete')

			return 'doRefresh.then - syncHomeKitCache and refreshAllDevices complete'
		}).catch(error => {
			// This also catches rejections from getAllDevicesAndUpdatePlatform
			if (error === 'platform.refreshStateProcessing now == false' || error === 'platform.setProcessing now == true') {
				// Exit early but still queue new refreshState call
				log.easyDebug('refreshState doRefresh catch - skipping syncHomeKitCache and refreshAllDevices due to parallel calls')

				return 'doRefresh.catch - skipped syncHomeKitCache and refreshAllDevices'
			}

			// This error is caught again below (and logged), so only debug logging here to reduce log duplicates
			log.easyDebug('refreshState doRefresh.catch - caught error:')
			log.easyDebug(error.message || error)

			// This "throws" to the doRefresh.catch within timeout below
			// return 'doRefresh.catch error message: ' + (error.message || error)
			throw (error.message || error)
		}).finally(() => {
			// This always runs, even if an error is caught and thrown above in .catch
			log.easyDebug(`refreshState doRefresh getAllDevicesAndUpdatePlatform.finally - Creating new timeout, will wait ${platform.pollingInterval / 1000} seconds and then call refreshState again`)
			// create new timeout to initiate next refresh in 85 seconds
			if (platform.pollingInterval) {
				platform.pollingTimeout = setTimeout(async () => {
					// Has a .catch ✓
					platform.refreshState()
						.catch(error => {
							log.easyDebug(`refreshState doRefresh getAllDevicesAndUpdatePlatform.finally - Error caught.`)
							log.error(`refreshState doRefresh - Error occurred within refreshState after main timeout. Error message:`)
							log.warn(error.message || error)
							log.error(`refreshState doRefresh - Will try again in ${platform.pollingInterval / 1000} seconds.`)
						})
				}, platform.pollingInterval)
				// NOTE: pollingInterval is 85 seconds, requestedInterval (90 seconds) - refreshDelay (5 seconds)
			}
		})
}

export default async function (platform) {
	log = platform.log

	// TODO: more refactoring is probably possible, at the moment still feels like 1 (or 2) too many Promises/logic functions...
	//       e.g. platform.sensiboApi.getAllDevices().catch?(or catch API errors in SensiboAPI.js and not rethrow).then(recheck flags and set allDevices).then(syncHomeKitCache + refreshAllDevices)...
	//       .catch().finally(queue new refreshState)
	return new Promise((resolve, reject) => {
		log.easyDebug('refreshState.js - refreshState() called')

		if (platform.refreshStateProcessing || platform.setProcessing) {
			// Be aware, if this happens on first load then the refreshState loop won't start...
			log.easyDebug(`refreshState.js - One of platform.refreshStateProcessing: ${platform.refreshStateProcessing} OR platform.setProcessing: ${platform.setProcessing} is true. Skipping refresh.`)
			log.easyDebug(`refreshState.js - If this has occurred on first load of the plugin then the refreshState loop won't start (and that's bad).`)

			// reject the overall promise
			reject(`Either platform.refreshStateProcessing: ${platform.refreshStateProcessing} OR platform.setProcessing: ${platform.setProcessing} is true, exiting early`)

			return
		}

		platform.refreshStateProcessing = true

		log.devDebug('refreshState.js - clearTimeout to prevent duplicates')
		clearTimeout(platform.pollingTimeout)

		setTimeout(async () => {
			log.devDebug('refreshState.js - Primary setTimeout starting')

			await doRefresh(platform)
				.catch(error => {
					// This "catches" throws from within doRefresh.catch
					log.easyDebug('refreshState doRefresh - outer catch block, error message:')
					log.easyDebug(error.message || error)

					// reject('refreshState doRefresh - outer catch block rejection')
					reject(error.message || error)
				})

			// wait 5 more seconds before removing block (platform.refreshStateProcessing) preventing new requests
			// TODO: should this be where we "block" subsequent requests that occur in quick succession?
			// e.g. change refreshDelay from 5 seconds to 30 seconds
			setTimeout(() => {
				platform.refreshStateProcessing = false

				log.devDebug('refreshState.js - Removed block (platform.refreshStateProcessing), new refresh requests allowed')
				// NOTE: refreshDelay is 5 seconds
			}, platform.refreshDelay)

			log.devDebug('refreshState.js - Primary setTimeout completed')

			// resolve the overall Promise
			resolve('refreshState completed')

			// NOTE: refreshDelay is 5 seconds
		}, platform.refreshDelay)

		return
	}).catch(error => {
		// "Catches" errors or rejections from within "main" timeout doRefresh above
		// These errors should be caught by the callers of refreshState (and logged), so only debug logging here to reduce log duplicates
		log.easyDebug('refreshState.js final catch - re-throwing caught error')

		// TODO: We could NOT "throw" here, that would eliminate the need for .catch every time refreshState() is called (e.g. in StateHandler.js)...
		// We already have a .then in index.js which checks for allDevices and then errors if not set.
		// It would mean API errors etc would stop bubbling here, but that's probably okay (or maybe they should stop within SensiboAPI.js?)
		throw error
	})
}
