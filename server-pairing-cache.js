const db = require('./database');
const moment = require('moment');
const rustplus = require('./rustplus');

class ServerPairing {
    constructor(databaseRow) {
	this.serverHostAndPort = databaseRow.server_host_and_port;
	this.userSteamId = databaseRow.user_steam_id;
	this.token = databaseRow.token;
	this.consecutiveFailureCount = databaseRow.consecutive_failure_count;
	this.nextRetryTime = databaseRow.next_retry_time;
	this.rustPlusClient = null;
    }

    async SetToken(token) {
	if (token === this.token) {
	    return;
	}
	this.token = token;
	await db.Query(
	    'UPDATE server_pairings SET token = ? WHERE server_host_and_port = ? AND user_steam_id = ?',
	    [this.token, this.serverHostAndPort, this.userSteamId]);
	// If we get here, it means that the token has changed in value. So then reset the failure count.
	await this.SetConsecutiveFailureCount(0);
	await this.SetNextRetryTime(currentTime.format());
    }

    async SetConsecutiveFailureCount(consecutiveFailureCount) {
	if (consecutiveFailureCount === this.consecutiveFailureCount) {
	    return;
	}
	this.consecutiveFailureCount = consecutiveFailureCount;
	await db.Query(
	    'UPDATE server_pairings SET consecutive_failure_count = ? WHERE server_host_and_port = ? AND user_steam_id = ?',
	    [this.consecutiveFailureCount, this.serverHostAndPort, this.userSteamId]);
    }

    async SetNextRetryTime(nextRetryTime) {
	if (nextRetryTime === this.nextRetryTime) {
	    return;
	}
	this.nextRetryTime = nextRetryTime;
	await db.Query(
	    'UPDATE server_pairings SET next_retry_time = ? WHERE server_host_and_port = ? AND user_steam_id = ?',
	    [this.nextRetryTime, this.serverHostAndPort, this.userSteamId]);
    }

    async IncrementFailureCount() {
	const c = this.consecutiveFailureCount;
	const timeoutSeconds = Math.pow(2, c);
	const currentTime = moment();
	const retryTime = currentTime.add(timeoutSeconds, 'seconds');
	await this.SetConsecutiveFailureCount(c + 1);
	await this.SetNextRetryTime(retryTime.format());
    }

    // Updates the fields in this cached server, and also the database, based on a server pairing confirmation message.
    async UpdateBasedOnServerPairingConfirmationMessage(message) {
	if (!message || !message.ip || !message.port || !message.playerToken || !message.playerId) {
	    // The message does not appear to be a server pairing confirmation. Do nothing.
	    return;
	}
	const hostAndPort = message.ip + ':' + message.port;
	if (hostAndPort !== this.serverHostAndPort) {
	    console.log(hostAndPort, this.serverHostAndPort);
	    throw 'Host and port of server pairing record must match to update the other fields.';
	}
	if (message.playerId !== this.userSteamId) {
	    throw 'Steam ID of server pairing record must match to update the other fields.';
	}
	if (message.playerToken) {
	    // If the token is different than the one already stored, the setter function takes
	    // care of resetting the failure count.
	    await this.SetToken(message.playerToken);
	}
    }

    async ConnectRustPlus() {
	const tokens = this.serverHostAndPort.split(':');
	if (tokens.length !== 2) {
	    throw 'Server pairing with invalid host and port.';
	}
	const host = tokens[0];
	const port = parseInt(tokens[1]);
	this.rustPlusClient = await rustplus.Connect(host, port, this.userSteamId, this.token);
    }
}

let pairingsByHostPortAndSteamId = {};

// Must call this to populate the cache from the database.
async function Initialize() {
    const newCache = {};
    const results = await db.Query('SELECT * from server_pairings');
    for (const row of results) {
	const pairing = new ServerPairing(row);
	await pairing.ConnectRustPlus();
	const cacheKey = pairing.serverHostAndPort + ':' + pairing.userSteamId;
	newCache[cacheKey] = pairing;
    }
    pairingsByHostPortAndSteamId = newCache;
}

async function CreateNewPairingInDatabase(message) {
    if (!message || !message.ip || !message.port || !message.playerToken || !message.playerId) {
	throw 'Creating new server pairing in the database requires a valid server pairing notification.';
    }
    const hostAndPort = message.ip + ':' + message.port;
    console.log(`Creating new server pairing record in the database.`);
    const currentTime = moment();
    const query = (
	'INSERT INTO server_pairings ' +
	'(server_host_and_port, user_steam_id, token, consecutive_failure_count, next_retry_time) ' +
	'VALUES (?, ?, ?, ?, ?)'
    );
    const values = [hostAndPort, message.playerId, message.playerToken, 0, currentTime.format()];
    await db.Query(query, values);
    const results = await db.Query(
	'SELECT * FROM server_pairings where server_host_and_port = ? AND user_steam_id = ?',
	[hostAndPort, message.playerId]);
    if (results.length !== 1) {
	throw 'Got back 2 matching server pairing records after creating a new database record. This should not happen.';
    }
    const row = results[0];
    const pairing = new ServerPairing(row);
    await pairing.ConnectRustPlus();
    const cacheKey = pairing.serverHostAndPort + ':' + pairing.userSteamId;
    pairingsByHostPortAndSteamId[cacheKey] = pairing;
    return pairing;
}

// Gets a server pairing record from the database cache. If no record with
// the same host, port, and SteamID exists, then one is created.
async function GetPairingRecordFromPairingNotification(message) {
    const cacheKey = message.ip + ':' + message.port + ':' + message.playerId;
    const cachedPairing = pairingsByHostPortAndSteamId[cacheKey];
    if (cachedPairing) {
	return cachedPairing;
    } else {
	return await CreateNewPairingInDatabase(message);
    }
}

function GetPairingRecordFromHostPortAndSteamId(host, port, steamId) {
    const cacheKey = host + ':' + port + ':' + steamId;
    const cachedPairing = pairingsByHostPortAndSteamId[cacheKey];
    if (cachedPairing) {
	return cachedPairing;
    } else {
	return null;
    }
}

// Returns a list of server pairing records for a steam ID.
function GetAllPairingsForUser(steamId) {
    const matches = [];
    for (const pair of Object.values(pairingsByHostPortAndSteamId)) {
	if (pair.userSteamId === steamId) {
	    matches.push(pair);
	}
    }
    return matches;
}

// For debugging purposes, log all the server pairing records to the console.
async function LogAllKnownPairings() {
    const numPairings = Object.keys(pairingsByHostPortAndSteamId).length;
    console.log(`All known server pairings (${numPairings})`);
    for (const cacheKey in pairingsByHostPortAndSteamId) {
	const pairing = pairingsByHostPortAndSteamId[cacheKey];
	console.log(cacheKey, pairing.token, pairing.consecutiveFailureCount, pairing.nextRetryTime);
    }
}

module.exports = {
    GetAllPairingsForUser,
    GetPairingRecordFromPairingNotification,
    GetPairingRecordFromHostPortAndSteamId,
    Initialize,
    LogAllKnownPairings,
};
