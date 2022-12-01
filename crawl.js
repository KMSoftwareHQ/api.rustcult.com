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
    const inAlliance = false;
    for (const ally of self.team) {
	if (ally in allianceSteamIds) {
	    inAlliance = true;
	}
    }
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
    if (inAlliance) {
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
