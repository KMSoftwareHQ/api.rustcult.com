const db = require('./database');
const moment = require('moment');
const rustplus = require('./rustplus');
const ServerCache = require('./server-cache');
const ServerPairingCache = require('./server-pairing-cache');
const UserCache = require('./user-cache');

// Each item in the cache is cached data from crawling a user.
//
// Two keys are used in this cache.
// The first key is the host:port of the server.
// The second key is the steamId of the user.
// That way a user can play on two servers at once
// and the crawler won't mix them up.
//
// Example cache value:
//
// cache['111.222.333.444:28085']['01234567890123456'] = {
//   steamId: '01234567890123456',
//   x: 3.14159,
//   y: 2.718,
//   isOnline: true,
//   spawnTime: 1669862513,
//   isAlive: true,
//   deathTime: 1669862505,
//   team: ['01234567890123456', 01234567890123456, ...],
//   lastUpdateTime: 1669869667514,
// }
const cache = {};

// This function gets called every time a significant user movement is detected.
async function OnUserMovement(before, after, server, user) {
    const query = (
	'REPLACE INTO player_positions ' +
	'(server_incrementing_id, user_incrementing_id, timestamp, x, y) VALUES ' +
	'(?, ?, CURRENT_TIMESTAMP, ?, ?)'
    );
    const values = [
	server.incrementingId,
	user.incrementingId,
	after.x,
	after.y,
    ];
    await db.Query(query, values);
    await user.SetLastMovementTime();
}

function IsNumber(value)
{
    return typeof value === 'number' && isFinite(value);
}

async function DetectUserMovement(before, after, server, user) {
    if (!before || !after || !server || !user) {
	return;
    }
    if (!after.isAlive) {
	return;
    }
    if (!before.x || !before.y || !after.x || !after.y) {
	return;
    }
    if (!IsNumber(before.x) || !IsNumber(before.y) ||
	!IsNumber(after.x) || !IsNumber(after.y)) {
	return;
    }
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const distanceSquared = dx * dx + dy * dy;
    // Detect even tiny movements. We want to filter
    // tiny floating-point rounding errors to prevent
    // logging of spurious movements at the scale of Brownian motion.
    const oneMillion = 1000 * 1000;
    const oneMillionth = 1 / oneMillion;
    const minDetectionDistance = oneMillionth;
    const minDistSquared = minDetectionDistance * minDetectionDistance;
    if (distanceSquared >= minDistSquared) {
	await OnUserMovement(before, after, server, user);
    }
}

// Detect user movement, death, spawn, etc.
async function DetectUserEvents(before, after, server, user) {
    await DetectUserMovement(before, after, server, user);
    if (after && after.isAlive && after.x && after.y) {
	await user.SetLastSeenAlive(server.hostAndPort, after.x, after.y);
    }
}

async function UpdateCache(serverHostAndPort, userSteamId, newCacheRecord) {
    if (!(serverHostAndPort in cache)) {
	cache[serverHostAndPort] = {};
    }
    cache[serverHostAndPort][userSteamId] = newCacheRecord;
}

function GetCache(serverHostAndPort, userSteamId) {
    if (!(serverHostAndPort in cache)) {
	return null;
    }
    if (!(userSteamId in cache[serverHostAndPort])) {
	return null;
    }
    return cache[serverHostAndPort][userSteamId];
}

async function TryToCrawlOnePair(pair) {
    if (!pair || !pair.token) {
	// This user is associated with this server but not paired. Skip crawling.
	return;
    }
    const cacheRecord = GetCache(pair.serverHostAndPort, pair.userSteamId);
    const currentTimeA = new Date().getTime();
    if (cacheRecord) {
	const age = currentTimeA - cacheRecord.lastUpdateTime;
	if (age < 1000) {
	    // There is already a recent cache record. Bail.
	    // Commenting this out for now so that crawling is attempted
	    // regardless of how recently this pair has been crawled.
	    //return;
	}
    }
    if (!pair.IsAlive()) {
	return;
    }
    const priorFailureCount = pair.consecutiveFailureCount;
    const debug = false;
    if (debug) console.log(`Crawling ${pair.serverHostAndPort} ${pair.userSteamId}`);
    const request = { getTeamInfo: {} };
    let response;
    try {
	response = await rustplus.OneOffRequest(pair, request);
    } catch (error) {
	if (debug) console.log('Error during rust+ request:', error);
	await pair.SetConsecutiveFailureCount(priorFailureCount);
	await pair.IncrementFailureCount();
	return;
    }
    if (!response) {
	await pair.SetConsecutiveFailureCount(priorFailureCount);
	await pair.IncrementFailureCount();
	return;
    }
    if (response.response.error) {
	if (debug) console.log(`Error while crawling ${pair.serverHostAndPort} ${pair.userSteamId}`);
	if (debug) console.log(response.response.error);
	await pair.SetConsecutiveFailureCount(priorFailureCount);
	await pair.IncrementFailureCount();
	return;
    }
    const teamInfo = response.response.teamInfo;
    const leaderSteamId = teamInfo.leaderSteamId.toString();
    const members = teamInfo.members;
    const server = ServerCache.GetServerByHostAndPort(pair.serverHostAndPort);
    if (debug) console.log(`Updating ${members.length} users`);
    const teamIds = [];
    for (const member of members) {
	const steamId = member.steamId.toString();
	teamIds.push(steamId);
    }
    const currentTimeB = new Date().getTime();
    for (const member of members) {
	const memberSteamId = member.steamId.toString();
	const newCacheRecord = {
	    steamId: memberSteamId,
	    x: member.x,
	    y: member.y,
	    name: member.name,
	    isOnline: member.isOnline,
	    spawnTime: member.spawnTime,
	    isAlive: member.isAlive,
	    deathTime: member.deathTime,
	    team: teamIds,
	    lastUpdateTime: currentTimeB,
	};
	const oldCacheRecord = GetCache(pair.serverHostAndPort, memberSteamId);
	await UpdateCache(pair.serverHostAndPort, memberSteamId, newCacheRecord);
	const user = await UserCache.GetOrCreateUserBySteamId(memberSteamId);
	await DetectUserEvents(oldCacheRecord, newCacheRecord, server, user);
	// Do nothing with this member pairing record. All this does is check if
	// the team member has a pairing record and create a blank pairing record
	// with no token if one doesn't exist. This lets those non-paired members
	// see the map in the app even though they haven't paired.
	const memberPairing = await ServerPairingCache.GetOrCreatePairingRecordFromHostPortAndSteamId(
	    pair.serverHostAndPort,
	    memberSteamId
	);
    }
}

// Randomize array in-place using Durstenfeld shuffle algorithm.
function ShuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
	var j = Math.floor(Math.random() * (i + 1));
	var temp = array[i];
	array[i] = array[j];
	array[j] = temp;
    }
}

async function TryToCrawlServer(server) {
    const startTime = Date.now();
    const serverPairs = ServerPairingCache.GetAllPairingsForServer(server.hostAndPort);
    if (serverPairs.length > 0) {
	// Shuffle the pairings for this server to stop one from starving all the others
	// by going first in case of an unexpected error.
	ShuffleArray(serverPairs);
	// Determine which pair hasn't been crawled for the longest time.
	let mostStalePair;
	let mostStaleTimestamp;
	for (const pair of serverPairs) {
	    const cacheRecord = GetCache(pair.serverHostAndPort, pair.userSteamId);
	    if (cacheRecord) {
		if (!mostStaleTimestamp || cacheRecord.lastUpdateTime < mostStaleTimestamp) {
		    mostStalePair = pair;
		    mostStaleTimestamp = cacheRecord.lastUpdateTime;
		}
	    } else {
		mostStalePair = pair;
		break;
	    }
	}
	await TryToCrawlOnePair(mostStalePair);
    }
    // Schedule self to run again later.
    const endTime = Date.now();
    const minimumTimeBetweenRequests = 111;
    const earliestTimeForNextRequest = startTime + minimumTimeBetweenRequests;
    const sleepTime = Math.max(1, earliestTimeForNextRequest - endTime);
    setTimeout(() => TryToCrawlServer(server), sleepTime);
}

const serverCrawlersAlreadyStarted = {};

async function StartCrawl() {
    const servers = ServerCache.GetAllServers();
    for (const server of servers) {
	if (server.hostAndPort in serverCrawlersAlreadyStarted) {
	    continue;
	}
	console.log('Starting Rust+ crawler for', server.name, server.hostAndPort);
	serverCrawlersAlreadyStarted[server.hostAndPort] = true;
	await TryToCrawlServer(server);
    }
}

// Wait a few seconds before starting the crawl.
setInterval(StartCrawl, 10 * 1000);

// Helper function that filters bases by owner. Adds the matching
// bases to a given list, and returns the non-matching bases.
function FilterBasesByOwner(groupBases, userSteamId, matches) {
    const nonMatches = [];
    for (const groupBase of groupBases) {
	let match = false;
	for (const playerBase of groupBase.playerBases) {
	    if (playerBase.userSteamId === userSteamId) {
		match = true;
		break;
	    }
	}
	if (match) {
	    matches.push(groupBase);
	} else {
	    nonMatches.push(groupBase);
	}
    }
    return nonMatches;
}

function GetVisibleBasesAndUsers(serverHostAndPort, userSteamId, groupBases) {
    const bases = {};
    const users = {};
    if (!(serverHostAndPort in cache)) {
	return { bases, users };
    }
    const serverCache = cache[serverHostAndPort];
    const self = serverCache[userSteamId];
    if (!self) {
	return { bases, users };
    }
    users.self = [self];
    bases.self = [];
    groupBases = FilterBasesByOwner(groupBases, userSteamId, bases.self);
    const allianceSteamIds = UserCache.GetCultMemberSteamIds();
    let inAlliance = false;
    for (const ally of self.team) {
	if (allianceSteamIds.includes(ally)) {
	    inAlliance = true;
	}
    }
    const visibleIds = [];
    users.team = [];
    bases.team = [];
    for (const teamMemberId of self.team) {
	const teamMate = serverCache[teamMemberId];
	groupBases = FilterBasesByOwner(groupBases, teamMemberId, bases.team);
	if (!teamMate) {
	    continue;
	}
	if (visibleIds.includes(teamMate.steamId)) {
	    continue;
	}
	visibleIds.push(teamMate.steamId);
	users.team.push(teamMate);
    }
    if (users.team.length === 0) {
	delete users.team;
    }
    if (bases.team.length === 0) {
	delete bases.team;
    }
    if (inAlliance) {
	users.allies = [];
	bases.allies = [];
	for (const allyId in serverCache) {
	    const ally = serverCache[allyId];
	    if (allianceSteamIds.includes(ally.steamId)) {
		for (const teamMemberId of ally.team) {
		    const teamMate = serverCache[teamMemberId];
		    groupBases = FilterBasesByOwner(groupBases, teamMemberId, bases.allies);
		    if (!teamMate) {
			continue;
		    }
		    if (visibleIds.includes(teamMate.steamId)) {
			continue;
		    }
		    visibleIds.push(teamMate.steamId);
		    users.allies.push(teamMate);
		}
	    }
	}
	if (users.allies.length === 0) {
	    delete users.allies;
	}
	if (bases.allies.length === 0) {
	    delete bases.allies;
	}
    }
    const userCacheRecord = UserCache.GetUserBySteamId(userSteamId);
    if (userCacheRecord && userCacheRecord.isHighPriest) {
	users.enemies = [];
	bases.enemies = groupBases;
	for (const enemyId in serverCache) {
	    const enemy = serverCache[enemyId];
	    if (!enemy) {
		continue;
	    }
	    if (visibleIds.includes(enemy.steamId)) {
		continue;
	    }
	    visibleIds.push(enemy.steamId);
	    users.enemies.push(enemy);
	}
    }
    return { bases, users };
}

module.exports = {
    GetVisibleBasesAndUsers,
};
