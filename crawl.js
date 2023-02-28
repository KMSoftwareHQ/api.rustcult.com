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
    if (after.name) {
	await user.SetSteamName(after.name);
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
	    return;
	}
    }
    if (!pair.IsAlive()) {
	return;
    }
    const priorFailureCount = pair.consecutiveFailureCount;
    console.log(`Crawling ${pair.serverHostAndPort} ${pair.userSteamId}`);
    const request = { getTeamInfo: {} };
    let response;
    try {
	response = await rustplus.OneOffRequest(pair, request);
    } catch (error) {
	console.log(error);
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
	console.log(`Error while crawling ${pair.serverHostAndPort} ${pair.userSteamId}`);
	console.log(response.response.error);
	await pair.SetConsecutiveFailureCount(priorFailureCount);
	await pair.IncrementFailureCount();
	return;
    }
    const teamInfo = response.response.teamInfo;
    const leaderSteamId = teamInfo.leaderSteamId.toString();
    const members = teamInfo.members;
    const server = ServerCache.GetServerByHostAndPort(pair.serverHostAndPort);
    console.log(`Updating ${members.length} users`);
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

async function TryToCrawlAllPairs() {
    const pairs = ServerPairingCache.GetAllPairings();
    for (const pair of pairs) {
	await TryToCrawlOnePair(pair);
    }
}

async function DoCrawl() {
    await TryToCrawlAllPairs();
    setTimeout(DoCrawl, 1);
}

// Wait a few seconds before starting the crawl.
setTimeout(DoCrawl, 5 * 1000);

// These users have God Mode enabled. They can see all other users' locations
// on the map regardless of team relationships.
const godModeSteamIds = [
    '76561198054245955',  // Jeff
    '76561198017903507',  // Aperture
    '76561198047845894',  // Scarrab
    //'76561199071658174',  // Hank
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
    '76561197992641069',  // nex
    //'76561199075315038',  // DPP
    //'76561199159176734',  // V3rySp3d
    '76561198378667958',  // Baka / SuperB
    '76561197983483070',  // Zorn
    '76561198438796495',  // Ollie
    '76561198124379883',  // Communist Destroyer
    '76561198117333493',  // Hail
    '76561197976258075',  // Honeybadger
    '76561198124379883',  // c0mm
    //'76561199153007787',  // MeQuista
    '76561197966257268',  // Beary Berry
    '76561198252695480',  // Hotel Guy Lennard
    '76561198965812685',  // Bear
    '76561199380632758',  // scientist.exe
    '76561198259220001',  // Nikx
    '76561198047881975',  // Dragon
    '76561198079834936',  // Mayonnaise / Adam
    '76561197967579894',  // bambam
    '76561197987100446',  // Biff Blazer
];

// The Alliance consists of anyone in this list, plus anyone in a team with any
// of them. The Alliance can all see each other on the map even if not on the
// same team. Players outside The Alliance can only see their own direct
// team-mates, like on the regular Rust+ map.
const allianceSteamIds = [
    '76561198054245955',  // Jeff
    '76561198017903507',  // Aperture
    '76561198047845894',  // Scarrab
    //'76561199071658174',  // Hank
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
    '76561197992641069',  // nex
    //'76561198842114001',  // Chinese letter name
    '76561199032914697',  // Michael
    //'76561199075315038',  // DPP
    //'76561199159176734',  // V3rySp3d
    '76561198378667958',  // Baka / SuperB
    '76561197983483070',  // Zorn
    '76561198438796495',  // Ollie
    '76561198117333493',  // Hail
    '76561197976258075',  // Honeybadger
    '76561198124379883',  // c0mm
    '76561199140667447',  // Yugomi
    '76561199090848212',  // wack
    '76561198218943129',  // kcool
    //'76561199153007787',  // MeQuista
    '76561197966257268',  // Beary Berry
    '76561198028478859',  // AnthonyD4X
    '76561198383187757',  // Assassin6761
    '76561198965812685',  // Bear
    '76561198970919655',  // GeoSlaps
    '76561199143152687',  // HS.Swearings
    '76561198252695480',  // Hotel Guy Lennard
    '76561197987100446',  // Biff Blazer
    '76561198187905074',  // Ooda Loop
    '76561198079834936',  // Mayonnaise / Adam
    '76561198372402716',  // darling
    '76561198400099971',  // magoo
    '76561198047881975',  // Dragon
    '76561198054245955',  // yoma / yone
    '76561198842114001',  // SomeRandomGuy / Some Random Guy
    '76561198035413727',  // Rusty Spork
    '76561198855976834',  // renee
    '76561199380632758',  // scientist.exe
    '76561198259220001',  // Nikx
    '76561198148164604',  // God Usopp
    //'76561198238364636',  // noodlefriedrice
    '76561199229590224',  // william007
    '76561198282998778',  // spartanswords
    '76561198169129975',  // cableguy
    '76561197967579894',  // bambam
    '76561198026842496',  // LouHollywood
    '76561198009624687',  // Grizart
    //'76561199075315038',  // DustinRS
    '76561198067255998',  // Dex
    '76561198146464699',  // Friend of c0mm
    '76561197988803815',  // Another friend of c0mm
    '76561198097008998',  // Friend of c0mm
    '76561198035823422',  // Friend of c0mm
];

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
    if (godModeSteamIds.includes(userSteamId)) {
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
