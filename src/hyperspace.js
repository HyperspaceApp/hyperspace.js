// hyperspace.js: a lightweight node wrapper for starting, and communicating with
// a Hyperspace daemon (hsd).
import BigNumber from 'bignumber.js'
import fs from 'fs'
import { spawn } from 'child_process'
import Path from 'path'
import request from 'request'
import http from 'http'

const agent = new http.Agent({
	keepAlive: true,
	maxSockets: 20,
})

// sia.js error constants
export const errCouldNotConnect = new Error('could not connect to the Hyperspace daemon')

// Space Cash -> hastings unit conversion functions
// These make conversion between units of Space Cash easy and consistent for developers.
// Never return exponentials from BigNumber.toString, since they confuse the API
BigNumber.config({ EXPONENTIAL_AT: 1e+9 })
BigNumber.config({ DECIMAL_PLACES: 30 })

const hastingsPerSiacoin = new BigNumber('10').toPower(24)
const siacoinsToHastings = (siacoins) => new BigNumber(siacoins).times(hastingsPerSiacoin)
const hastingsToSiacoins = (hastings) => new BigNumber(hastings).dividedBy(hastingsPerSiacoin)

// makeRequest takes an address and opts and returns a valid request.js request
// options object.
export const makeRequest = (address, opts) => {
	let callOptions = opts
	if (typeof opts === 'string') {
		callOptions = { url: opts }
	}
	callOptions.url = 'http://' + address + callOptions.url
	callOptions.json = true
	if (typeof callOptions.timeout === 'undefined') {
		callOptions.timeout = 10000
	}
	callOptions.headers = {
		'User-Agent': 'Sia-Agent',
	}
	callOptions.pool = agent

	return callOptions
}

// Call makes a call to the Sia API at `address`, with the request options defined by `opts`.
// returns a promise which resolves with the response if the request completes successfully
// and rejects with the error if the request fails.
const call = (address, opts) => new Promise((resolve, reject) => {
	const callOptions = makeRequest(address, opts)
	request(callOptions, (err, res, body) => {
		if (!err && (res.statusCode < 200 || res.statusCode > 299)) {
			reject(body)
		} else if (!err) {
			resolve(body)
		} else {
			reject(err)
		}
	})
})

// launch launches a new instance of hsd using the flags defined by `settings`.
// this function can `throw`, callers should catch errors.
// callers should also handle the lifecycle of the spawned process.
const launch = (path, settings) => {
	const defaultSettings = {
		'api-addr': 'localhost:5580',
		'host-addr': ':5582',
		'rpc-addr': ':5581',
		'authenticate-api': false,
		'disable-api-security': false,
	}
	const mergedSettings = Object.assign(defaultSettings, settings)
	const filterFlags = (key) => mergedSettings[key] !== false
	const mapFlags = (key) => '--' + key + '=' + mergedSettings[key]
	const flags = Object.keys(mergedSettings).filter(filterFlags).map(mapFlags)

	const hsdOutput = (() => {
		if (typeof mergedSettings['sia-directory'] !== 'undefined') {
			return fs.createWriteStream(Path.join(mergedSettings['sia-directory'], 'hsd-output.log'))
		}
		return fs.createWriteStream('hsd-output.log')
	})()

	const opts = { }
	if (process.geteuid) {
		opts.uid = process.geteuid()
	}
	const hsdProcess = spawn(path, flags, opts)
	hsdProcess.stdout.pipe(hsdOutput)
	hsdProcess.stderr.pipe(hsdOutput)
	return hsdProcess
}

// isRunning returns true if a successful call can be to /gateway
// using the address provided in `address`.  Note that this call does not check
// whether the hsd process is still running, it only checks if a Sia API is
// reachable.
async function isRunning(address) {
	try {
		await call(address, {
			url: '/gateway',
			timeout: 6e5, // 10 minutes
		})
		return true
	} catch (e) {
		return false
	}
}

// hsdWrapper returns an instance of a Hsd API configured with address.
const hsdWrapper = (address) => {
	const hsdAddress = address
	return {
		call: (options)  => call(hsdAddress, options),
		isRunning: () => isRunning(hsdAddress),
	}
}

// connect connects to a running Hsd at `address` and returns a hsdWrapper object.
async function connect(address) {
	const running = await isRunning(address)
	if (!running) {
		throw errCouldNotConnect
	}
	return hsdWrapper(address)
}

export {
	connect,
	launch,
	isRunning,
	call,
	siacoinsToHastings,
	hastingsToSiacoins,
	agent,
}
