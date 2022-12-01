const rustplus = require('./rustplus');
const ServerPairingCache = require('./server-pairing-cache');

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

function UpdateCache(serverHostAndPort, userSteamId, newCacheRecord) {
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
    const response = await rustplus.SendRequest(client, request);
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
	const newCacheRecord = {
	    steamId: member.steamId.toString(),
	    x: member.x,
	    y: member.y,
	    isOnline: member.isOnline,
	    spawnTime: member.spawnTime,
	    isAlive: member.isAlive,
	    deathTime: member.deathTime,
	    team: teamIds,
	    lastUpdateTime: currentTime,
	};
	UpdateCache(pair.serverHostAndPort, pair.userSteamId, newCacheRecord);
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
setTimeout(DoCrawl, 10 * 1000);

// These users have God Mode enabled. They can see all other users' locations
// on the map regardless of team relationships.
const godModeSteamIds = [
    '76561198054245955',  // Jeff
];

// The Alliance consists of anyone in this list, plus anyone in a team with any
// of them. The Alliance can all see each other on the map even if not on the
// same team. Players outside The Alliance can only see their own direct
// team-mates, like on the regular Rust+ map.
const allianceSteamIds = [
    '76561198054245955',  // Jeff
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
    const visibleIds = [userSteamId];
    users.team = [];
    for (const teamMemberId of self.team) {
	const teamMate = serverCache[teamMemberId];
	if (!teamMate) {
	    continue;
	}
	if (teamMate.steamId in visibleIds) {
	    continue;
	}
	visibleIds.push(teamMate.steamId);
	users.team.push(teamMate);
    }
    if (users.team.length === 0) {
	delete users.team;
    }
    users.allies = [];
    for (const allyId in serverCache) {
	const ally = serverCache[allyId];
	if (ally.steamId in allianceSteamIds) {
	    for (const teamMemberId of ally.team) {
		const teamMate = serverCache[teamMemberId];
		if (!teamMate) {
		    continue;
		}
		if (teamMate.steamId in visibleIds) {
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
    if (userSteamId in godModeSteamIds) {
	users.enemies = [];
	for (const enemyId in serverCache) {
	    const enemy = serverCache[enemyId];
	    if (!enemy) {
		continue;
	    }
	    if (enemy.steamId in visibleIds) {
		continue;
	    }
	    visibleIds.push(enemy.steamId);
	    users.allies.push(enemy);
	}
    }
    return users;
}

module.exports = {
    GetVisibleUsers,
};
