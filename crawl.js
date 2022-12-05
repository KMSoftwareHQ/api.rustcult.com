const db = require('./database');
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
function OnUserMovement(before, after, server, user) {
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
    // Don't bother awaiting the results of the query. Fire and forget.
    // The database is owned by the app owner so there is no issue with
    // rate limits.
    db.Query(query, values);
}

function IsNumber(value)
{
    return typeof value === 'number' && isFinite(value);
}

function DetectUserMovement(before, after, server, user) {
    if (!before || !after || !server || !user) {
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
	OnUserMovement(before, after, server, user);
    }
}

// Detect user movement, death, spawn, etc.
function DetectUserEvents(before, after, server, user) {
    DetectUserMovement(before, after, server, user);
}

async function UpdateCache(serverHostAndPort, userSteamId, newCacheRecord) {
    if (!(serverHostAndPort in cache)) {
	cache[serverHostAndPort] = {};
    }
    const oldCacheRecord = cache[serverHostAndPort][userSteamId];
    const server = ServerCache.GetServerByHostAndPort(serverHostAndPort);
    const user = await UserCache.GetOrCreateUserBySteamId(userSteamId);
    DetectUserEvents(oldCacheRecord, newCacheRecord, server, user);
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
    const cacheRecord = GetCache(pair.serverHostAndPort, pair.userSteamId);
    const currentTime = new Date().getTime();
    if (cacheRecord) {
	const age = currentTime - cacheRecord.lastUpdateTime;
	if (age < 1000) {
	    // There is already a recent cache record. Bail.
	    return;
	}
    }
    console.log(`Crawling ${pair.serverHostAndPort} ${pair.userSteamId}`);
    const client = pair.rustPlusClient;
    const request = { getTeamInfo: {} };
    let response;
    try {
	response = await rustplus.OneOffRequest(pair, request);
    } catch (error) {
	console.log(error);
	return;
    }
    if (!response) {
	return;
    }
    const teamInfo = response.response.teamInfo;
    const leaderSteamId = teamInfo.leaderSteamId.toString();
    const members = teamInfo.members;
    console.log(`Updating ${members.length} users`);
    const teamIds = [];
    for (const member of members) {
	const steamId = member.steamId.toString();
	teamIds.push(steamId);
    }
    for (const member of members) {
	const memberSteamId = member.steamId.toString();
	const newCacheRecord = {
	    steamId: memberSteamId,
	    x: member.x,
	    y: member.y,
	    isOnline: member.isOnline,
	    spawnTime: member.spawnTime,
	    isAlive: member.isAlive,
	    deathTime: member.deathTime,
	    team: teamIds,
	    lastUpdateTime: currentTime,
	};
	await UpdateCache(pair.serverHostAndPort, memberSteamId, newCacheRecord);
    }
}

async function TryToCrawlAllPairs() {
    const pairs = ServerPairingCache.GetAllPairings();
    for (const pair of pairs) {
	await TryToCrawlOnePair(pair);
    }
}

async function DoCrawl() {
    await TryToCrawlAllPairs();
    setTimeout(DoCrawl, 100);
}

// Wait a few seconds before starting the crawl.
setTimeout(DoCrawl, 5 * 1000);

// These users have God Mode enabled. They can see all other users' locations
// on the map regardless of team relationships.
const godModeSteamIds = [
    '76561198054245955',  // Jeff
    '76561198017903507',  // Aperture
    '76561198047845894',  // Scarrab
    '76561199071658174',  // Hank
    '76561197994436536',  // Waldo
    '76561198078781532',  // Palm Tiger
    '76561199115343874',  // Skyline
    '76561198128787551',  // Lopt
    '76561198028541529',  // Brett
    '76561198371618376',  // Egon
    '76561198259220001',  // Nikki
    '76561198095439302',  // Mancrog
    '76561197962102312',  // Kusstom
    '76561198416046093',  // grimmjaune
    '76561199357314454',  // Neff
    '76561198040300329',  // Dannykuun
];

// The Alliance consists of anyone in this list, plus anyone in a team with any
// of them. The Alliance can all see each other on the map even if not on the
// same team. Players outside The Alliance can only see their own direct
// team-mates, like on the regular Rust+ map.
const allianceSteamIds = [
    '76561198054245955',  // Jeff
    '76561198017903507',  // Aperture
    '76561198047845894',  // Scarrab
    '76561199071658174',  // Hank
    '76561198308992151',  // Quackatron
    '76561197994436536',  // Waldo
    '76561198078781532',  // Palm Tiger
    '76561198405489221',  // Reefer
    '76561199115343874',  // Skyline
    '76561198128787551',  // Lopt
    '76561198028541529',  // Brett
    '76561198371618376',  // Egon
    '76561198259220001',  // Nikki
    '76561198095439302',  // Mancrog
    '76561198910546860',  // PN
    '76561199232233394',  // Vanguard
    '76561197962102312',  // Kusstom
    '76561198416046093',  // grimmjaune
    '76561197960940977',  // Hudson
    '76561198085482300',  // Lafter
    '76561199350148648',  // Sage
    '76561199357314454',  // Neff
    '76561198054638760',  // N3xT
    '76561198040300329',  // Dannykuun
    '76561198120835721',  // Natefrog
];

function GetVisibleUsers(serverHostAndPort, userSteamId) {
    const users = {};
    if (!(serverHostAndPort in cache)) {
	return users;
    }
    const serverCache = cache[serverHostAndPort];
    const self = serverCache[userSteamId];
    if (!self) {
	return users;
    }
    users.self = [self];
    let inAlliance = false;
    for (const ally of self.team) {
	if (allianceSteamIds.includes(ally)) {
	    inAlliance = true;
	}
    }
    const visibleIds = [];
    users.team = [];
    for (const teamMemberId of self.team) {
	const teamMate = serverCache[teamMemberId];
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
    if (inAlliance) {
	users.allies = [];
	for (const allyId in serverCache) {
	    const ally = serverCache[allyId];
	    if (allianceSteamIds.includes(ally.steamId)) {
		for (const teamMemberId of ally.team) {
		    const teamMate = serverCache[teamMemberId];
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
    }
    if (godModeSteamIds.includes(userSteamId)) {
	users.enemies = [];
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
    return users;
}

module.exports = {
    GetVisibleUsers,
};
