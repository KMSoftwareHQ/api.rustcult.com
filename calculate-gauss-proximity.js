const db = require('./database');
const moment = require('moment');

const sessionTimeout = 60 * 1000;
let footstepQueueByServerAndUserId = {};

function QueueFootstep(serverId, userId, t, x, y) {
    if (!(serverId in footstepQueueByServerAndUserId)) {
	footstepQueueByServerAndUserId[serverId] = {};
    }
    if (!(userId in footstepQueueByServerAndUserId[serverId])) {
	footstepQueueByServerAndUserId[serverId][userId] = [];
    }
    const footstep = { serverId, userId, t, x, y };
    footstepQueueByServerAndUserId[serverId][userId].push(footstep);
}

function PopOldFootsteps(t) {
    const newQueue = {};
    for (const serverId in footstepQueueByServerAndUserId) {
	const server = {};
	for (const userId in footstepQueueByServerAndUserId[serverId]) {
	    let mostRecentFootstep;
	    const futureFootsteps = [];
	    for (const footstep of footstepQueueByServerAndUserId[serverId][userId]) {
		if (footstep.t < t && footstep.t >= t - sessionTimeout) {
		    mostRecentFootstep = footstep;
		} else if (footstep.t >= t) {
		    futureFootsteps.push(footstep);
		}
	    }
	    const newFootsteps = [];
	    if (mostRecentFootstep) {
		newFootsteps.push(mostRecentFootstep);
	    }
	    for (const footstep of futureFootsteps) {
		newFootsteps.push(footstep);
	    }
	    if (newFootsteps.length > 0) {
		server[userId] = newFootsteps;
	    }
	}
	if (Object.keys(server).length > 0) {
	    newQueue[serverId] = server;
	}
    }
    footstepQueueByServerAndUserId = newQueue;
}

function CountQueue() {
    let count = 0;
    for (const serverId in footstepQueueByServerAndUserId) {
	for (const userId in footstepQueueByServerAndUserId[serverId]) {
	    count += footstepQueueByServerAndUserId[serverId][userId].length;
	}
    }
    return count;
}

function ProcessOneSecond(t) {
    for (const serverId in footstepQueueByServerAndUserId) {
	ProcessOneSecondOnOneServer(t, serverId);
    }
    DecayRelationshipsOncePerDay(t);
}

function ProcessOneSecondOnOneServer(t, serverId) {
    const mostRecentFootstepByUser = {};
    const nextFootstepByUser = {};
    const footstepsByUser = footstepQueueByServerAndUserId[serverId];
    for (const userId in footstepsByUser) {
	const footsteps = footstepsByUser[userId];
	for (const footstep of footsteps) {
	    if (footstep.t < t && footstep.t >= t - sessionTimeout) {
		mostRecentFootstepByUser[userId] = footstep;
	    } else if (footstep.t >= t && footstep.t < t + sessionTimeout) {
		nextFootstepByUser[userId] = footstep;
		break;
	    }
	}
    }
    const minMovement = 0.0001;
    const minMovementSq = minMovement * minMovement;
    const maxMovement = 100;
    const maxMovementSq = maxMovement * maxMovement;
    const moving = {};
    for (const userId in mostRecentFootstepByUser) {
	const from = mostRecentFootstepByUser[userId];
	if (!(userId in nextFootstepByUser)) {
	    continue;
	}
	const to = nextFootstepByUser[userId];
	const dt = to.t - from.t;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const d2 = dx * dx + dy * dy;
	if (d2 > minMovementSq && d2 < maxMovementSq && dt < sessionTimeout) {
	    const r = (t - from.t) / dt;
	    const interpolatedX = r * to.x + (1 - r) * from.x;
	    const interpolatedY = r * to.y + (1 - r) * from.y;
	    OneMovingUserDetected(userId, interpolatedX, interpolatedY, t, footstepsByUser[userId]);
	    moving[userId] = {
		x: interpolatedX,
		y: interpolatedY,
	    };
	}
    }
    MovingUsersDetected(moving, t);
}

// Update individual movement points.
function OneMovingUserDetected(userId, x, y, t, footsteps) {
    const macro = DetectMacroMovement(x, y, footsteps);
    if (macro) {
	GiveActivityPointToUser(userId);
    }
}

// This movement threshold is intended to make individual movement points difficult
// to AFK farm. Points are only given when the player is out and about the map making
// macroscopic movements. No points are given for players inside a small contained
// volume such as their home base, even if they are making small movements. Crucially,
// this limitation does not apply to the relationship points that are used for
// calculating the social structure. A bunch of players nearby each other trying to
// cheat the system (in vain) by using shake-bots is proof that those players have
// a strong relationship, is it not? In practice, most such close duos and trios will
// already be adjacent to each other in the social structure. So the use of shake-bots
// is not expected to affect either the structure or the individual rank points. This
// threshold is necessary since without it, the points would be easily farmable and the
// first person to figure it out would shoot to the top of the structure, embarassing the
// whole system.
function DetectMacroMovement(x, y, footsteps) {
    const minDisplacementToGetMovementPoints = 10;
    const sq = minDisplacementToGetMovementPoints * minDisplacementToGetMovementPoints;
    for (const footstep of footsteps) {
	const dx = footstep.x - x;
	const dy = footstep.y - y;
	const d2 = (dx * dx) + (dy * dy);
	if (d2 > sq) {
	    // The player ventured further than 10m from their present location.
	    // That is a macro movement.
	    return true;
	}
    }
    // The player does not venture further than 10m from the spot they are currently standing.
    // This is not macro movement.
    return false;
}

function Gauss(x) {
    const sqrt2Pi = Math.sqrt(2 * Math.PI);
    return Math.exp(-0.5 * x * x) / sqrt2Pi;
}

let maxMovingUsers = 0;

function MovingUsersDetected(moving, t) {
    const users = Object.keys(moving);
    users.sort();
    const n = users.length;
    maxMovingUsers = Math.max(n, maxMovingUsers);
    const gaussFilterRadius = 10;
    for (let i = 0; i < n; i++) {
	const ui = users[i];
	const a = moving[ui];
	for (let j = i + 1; j < n; j++) {
	    const uj = users[j];
	    const b = moving[uj];
	    const dx = b.x - a.x;
	    const dy = b.y - a.y;
	    const d2 = dx * dx + dy * dy;
	    const d = Math.sqrt(d2);
	    const g = Gauss(d / gaussFilterRadius);
	    AddToRelationship(ui, uj, g);
	}
    }
}

const individualActivityPoints = {};

function GiveActivityPointToUser(userId) {
    const p = individualActivityPoints[userId] || 0;
    individualActivityPoints[userId] = p + 1;
}

const relationships = {};

function AddToRelationship(i, j, amount) {
    if (!(i in relationships)) {
	relationships[i] = {};
    }
    if (!(j in relationships[i])) {
	relationships[i][j] = 0;
    }
    relationships[i][j] += amount;
}

let lastDecayTime;
const decayHalfLifeInDays = 90;
const decayMultiplier = Math.pow(0.5, 1 / decayHalfLifeInDays);

function DecayRelationshipsOncePerDay(t) {
    if (lastDecayTime && t - lastDecayTime < 86400 * 1000) {
	return;
    }
    lastDecayTime = t;
    for (const i in individualActivityPoints) {
	individualActivityPoints[i] *= decayMultiplier;
    }
    for (const i in relationships) {
	for (const j in relationships[i]) {
	    relationships[i][j] *= decayMultiplier;
	}
    }
}

const userIncrementingIdToSteamId = {};

async function PopulateSteamIds() {
    const sql = 'SELECT incrementing_id, steam_id FROM users';
    const results = await db.Query(sql);
    for (const row of results) {
	const iid = row.incrementing_id;
	const steamId = row.steam_id;
	userIncrementingIdToSteamId[iid] = steamId;
    }
}

function IndividualActivityPointsSummary() {
    const sortable = [];
    for (const i in individualActivityPoints) {
	sortable.push({
	    i: userIncrementingIdToSteamId[i],
	    p: individualActivityPoints[i],
	});
    }
    sortable.sort((a, b) => {
	if (a.p < b.p) {
	    return 1;
	}
	if (a.p > b.p) {
	    return -1;
	}
	return 0;
    });
    const n = sortable.length;
    console.log(n, 'players');
    console.log('TOP 10');
    for (const a of sortable.slice(0, 10)) {
	console.log(a);
    }
    console.log('BOTTOM 10');
    for (const a of sortable.slice(n - 10, n)) {
	console.log(a);
    }
}

function PrintAllIndividualActivityPoints() {
    const sortable = [];
    for (const i in individualActivityPoints) {
	sortable.push({
	    i: userIncrementingIdToSteamId[i],
	    p: individualActivityPoints[i],
	});
    }
    sortable.sort((a, b) => {
	if (a.p < b.p) {
	    return 1;
	}
	if (a.p > b.p) {
	    return -1;
	}
	return 0;
    });
    const n = sortable.length;
    console.log('All individual activity points:');
    for (const a of sortable) {
	console.log(a.i.toString() + ',' + a.p.toString());
    }
}

function RelationshipSummary() {
    const sortable = [];
    for (const i in relationships) {
	for (const j in relationships[i]) {
	    sortable.push({
		i: userIncrementingIdToSteamId[i],
		j: userIncrementingIdToSteamId[j],
		r: relationships[i][j],
	    });
	}
    }
    sortable.sort((a, b) => {
	if (a.r < b.r) {
	    return 1;
	}
	if (a.r > b.r) {
	    return -1;
	}
	return 0;
    });
    const n = sortable.length;
    console.log(n, 'relationships');
    console.log('TOP 10');
    for (const a of sortable.slice(0, 10)) {
	console.log(a);
    }
    console.log('BOTTOM 10');
    for (const a of sortable.slice(n - 10, n)) {
	console.log(a);
    }
}

function PrintRelationships() {
    const sortable = [];
    for (const i in relationships) {
	for (const j in relationships[i]) {
	    sortable.push({
		i: userIncrementingIdToSteamId[i],
		j: userIncrementingIdToSteamId[j],
		r: relationships[i][j],
	    });
	}
    }
    sortable.sort((a, b) => {
	if (a.r < b.r) {
	    return 1;
	}
	if (a.r > b.r) {
	    return -1;
	}
	return 0;
    });
    const n = sortable.length;
    console.log(n, 'All relationships');
    for (const a of sortable) {
	if (a.r > 0.1) {
	    console.log(a.i + ',' + a.j + ',' + a.r.toString());
	}
    }
}

async function Main() {
    //const startDate = moment('2022-11-01');
    const startDate = moment('2024-03-20');
    const endDate = moment().add(1, 'days');
    console.log('Backfill script will process the following date range in 1 day intervals');
    console.log('startDate', startDate);
    console.log('endDate', endDate);
    let currentlyProcessingDate = moment(startDate);
    let timeCursor;
    let secondsProcessed = 0;
    let maxQueueLength = 0;
    while (currentlyProcessingDate.isBefore(endDate)) {
	const windowStart = currentlyProcessingDate.format('YYYY-MM-DD');
	currentlyProcessingDate.add(1, 'days');
	const windowEnd = currentlyProcessingDate.format('YYYY-MM-DD');
	const sql = `SELECT * FROM player_positions WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp`;
	const values = [windowStart, windowEnd];
	const results = await db.Query(sql, values);
	const n = results.length;
	console.log('Processing', windowStart, 'to', windowEnd, '(', n, 'footprints', ')');
	for (const row of results) {
	    const t = row.timestamp.getTime();
	    if (!timeCursor) {
		timeCursor = t;
	    }
	    QueueFootstep(row.server_incrementing_id, row.user_incrementing_id, t, row.x, row.y);
	    while (timeCursor < t - sessionTimeout) {
		ProcessOneSecond(timeCursor);
		secondsProcessed++;
		timeCursor += 1000;
	    }
	    const queueLength = CountQueue();
	    maxQueueLength = Math.max(queueLength, maxQueueLength);
	    PopOldFootsteps(timeCursor);
	}
    }
    const finalQueueLength = CountQueue();
    console.log('maxQueueLength', maxQueueLength, 'finalQueueLength', finalQueueLength);
    const daysProcessed = secondsProcessed / 3600 / 24;
    console.log('Processed', secondsProcessed, 'seconds (', daysProcessed, 'days)');
    console.log('maxMovingUsers', maxMovingUsers);
    await PopulateSteamIds();
    IndividualActivityPointsSummary();
    RelationshipSummary();
    PrintAllIndividualActivityPoints();
    PrintRelationships();
    await db.End();
}

Main();
