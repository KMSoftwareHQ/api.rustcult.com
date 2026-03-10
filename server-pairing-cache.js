const db = require('./database');
const moment = require('moment');

const MYSQL_DATETIME = 'YYYY-MM-DD HH:mm:ss';

class ServerPairing {
    constructor(databaseRow) {
	this.serverHostAndPort = databaseRow.server_host_and_port;
	this.userSteamId = databaseRow.user_steam_id;
	this.token = databaseRow.token;
	this.consecutiveFailureCount = databaseRow.consecutive_failure_count;
	this.nextRetryTime = databaseRow.next_retry_time;
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
	await this.SetNextRetryTime(moment().format(MYSQL_DATETIME));
    }

    async SetConsecutiveFailureCount(consecutiveFailureCount) {
	if (consecutiveFailureCount === this.consecutiveFailureCount) {
	    return;
	}
	this.consecutiveFailureCount = consecutiveFailureCount;
	await db.Query(
	    'UPDATE server_pairings SET consecutive_failure_count = ? WHERE server_host_and_port = ? AND user_steam_id = ?',
	    [this.consecutiveFailureCount, this.serverHostAndPort, this.userSteamId]);
	if (consecutiveFailureCount === 0) {
	    await this.SetNextRetryTime(null);
	}
    }

    async SetNextRetryTime(nextRetryTime) {
	if (nextRetryTime === this.nextRetryTime) {
	    return;
	}
	this.nextRetryTime = nextRetryTime;
	const valueForDb = nextRetryTime == null ? null : moment(nextRetryTime).format(MYSQL_DATETIME);
	await db.Query(
	    'UPDATE server_pairings SET next_retry_time = ? WHERE server_host_and_port = ? AND user_steam_id = ?',
	    [valueForDb, this.serverHostAndPort, this.userSteamId]);
    }

    async IncrementFailureCount() {
	const c = this.consecutiveFailureCount || 0;
	const timeoutSeconds = Math.pow(2, c);
	const currentTime = moment();
	const retryTime = currentTime.add(timeoutSeconds, 'seconds');
	await this.SetConsecutiveFailureCount(c + 1);
	await this.SetNextRetryTime(retryTime.format(MYSQL_DATETIME));
    }

    IsAlive() {
	if (!this.token) {
	    return false;
	}
	if (!this.consecutiveFailureCount || this.consecutiveFailureCount < 14) {
	    return true;
	}
	if (!this.nextRetryTime) {
	    return true;
	}
	if (this.nextRetryTime.includes('NaN')) {
	    return false;
	}
	let t;
	try {
	    t = moment(this.nextRetryTime);
	} catch (e) {
	    console.log(e);
	    console.log('nextRetryTime', this.nextRetryTime);
	}
	const now = moment();
	return now.isAfter(t);
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
}

let pairingsByHostPortAndSteamId = {};

// Must call this to populate the cache from the database.
async function Initialize() {
    const newCache = {};
    const results = await db.Query('SELECT * from server_pairings');
    for (const row of results) {
	const pairing = new ServerPairing(row);
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
    const userSteamId = String(message.playerId);
    console.log(`Creating new server pairing record in the database.`);
    const currentTime = moment();
    const query = (
	'INSERT INTO server_pairings ' +
	'(server_host_and_port, user_steam_id, token, consecutive_failure_count, next_retry_time) ' +
	'VALUES (?, ?, ?, ?, ?)'
    );
    const values = [hostAndPort, userSteamId, message.playerToken, 0, currentTime.format(MYSQL_DATETIME)];
    await db.Query(query, values);
    const results = await db.Query(
	'SELECT * FROM server_pairings where server_host_and_port = ? AND user_steam_id = ?',
	[hostAndPort, userSteamId]);
    if (results.length !== 1) {
	throw 'Got back 2 matching server pairing records after creating a new database record. This should not happen.';
    }
    const row = results[0];
    const pairing = new ServerPairing(row);
    const cacheKey = pairing.serverHostAndPort + ':' + pairing.userSteamId;
    pairingsByHostPortAndSteamId[cacheKey] = pairing;
    return pairing;
}

async function AssociateUserWithServerWithoutToken(serverHostAndPort, userSteamId) {
    if (!userSteamId || !serverHostAndPort) {
	throw 'Cannot create a server pairing without server and user IDs.';
    }
    console.log(`Creating new server pairing record in the database.`);
    const currentTime = moment();
    const query = (
	'INSERT INTO server_pairings ' +
	'(server_host_and_port, user_steam_id, token, consecutive_failure_count, next_retry_time) ' +
	'VALUES (?, ?, NULL, ?, ?)'
    );
    const values = [serverHostAndPort, userSteamId, 0, currentTime.format(MYSQL_DATETIME)];
    await db.Query(query, values);
    const results = await db.Query(
	'SELECT * FROM server_pairings where server_host_and_port = ? AND user_steam_id = ?',
	[serverHostAndPort, userSteamId]);
    if (results.length !== 1) {
	throw 'Got back 2 matching server pairing records after creating a new database record. This should not happen.';
    }
    const row = results[0];
    const pairing = new ServerPairing(row);
    const cacheKey = pairing.serverHostAndPort + ':' + pairing.userSteamId;
    pairingsByHostPortAndSteamId[cacheKey] = pairing;
    return pairing;
}

// Gets a server pairing record from the database cache. If no record with
// the same host, port, and SteamID exists, then one is created.
async function GetPairingRecordFromPairingNotification(message) {
    const steamIdStr = String(message.playerId);
    const cacheKey = message.ip + ':' + message.port + ':' + steamIdStr;
    const cachedPairing = pairingsByHostPortAndSteamId[cacheKey];
    if (cachedPairing) {
	return cachedPairing;
    } else {
	return await CreateNewPairingInDatabase(message);
    }
}

function GetPairingRecordFromHostPortAndSteamId(host, port, steamId) {
    const cacheKey = host + ':' + port + ':' + String(steamId);
    const cachedPairing = pairingsByHostPortAndSteamId[cacheKey];
    if (cachedPairing) {
	return cachedPairing;
    } else {
	return null;
    }
}

async function GetOrCreatePairingRecordFromHostPortAndSteamId(hostAndPort, steamId) {
    const steamIdStr = String(steamId);
    const cacheKey = hostAndPort + ':' + steamIdStr;
    const cachedPairing = pairingsByHostPortAndSteamId[cacheKey];
    if (cachedPairing) {
	return cachedPairing;
    } else {
	return await AssociateUserWithServerWithoutToken(hostAndPort, steamIdStr);
    }
}

// Returns a list of server pairing records that are still alive for a steam ID.
function GetAllPairingsForUser(steamId) {
    const steamIdStr = String(steamId);
	console.log("Pairs for user: ", steamIdStr);
    const matches = [];
    for (const pair of Object.values(pairingsByHostPortAndSteamId)) {
	if (String(pair.userSteamId) === steamIdStr && pair.IsAlive()) {
		console.log("Pair found: ", pair.serverHostAndPort);
	    matches.push(pair);
	}
    }
    return matches;
}

// Returns a list of server pairing records that are still alive for a server.
function GetAllPairingsForServer(hostAndPort) {
    const matches = [];
    for (const pair of Object.values(pairingsByHostPortAndSteamId)) {
	if (pair.serverHostAndPort === hostAndPort && pair.IsAlive()) {
	    matches.push(pair);
	}
    }
    return matches;
}

// Returns a list of all server pairing records.
function GetAllPairings() {
    const matches = [];
    for (const pair of Object.values(pairingsByHostPortAndSteamId)) {
	if (pair.IsAlive()) {
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
    GetAllPairings,
    GetAllPairingsForUser,
    GetAllPairingsForServer,
    GetOrCreatePairingRecordFromHostPortAndSteamId,
    GetPairingRecordFromHostPortAndSteamId,
    GetPairingRecordFromPairingNotification,
    Initialize,
    LogAllKnownPairings,
};
