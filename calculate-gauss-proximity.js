const db = require('./database');

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
	    moving[userId] = {
		x: r * to.x + (1 - r) * from.x,
		y: r * to.y + (1 - r) * from.y,
	    };
	}
    }
    MovingUsersDetected(moving);
}

function Gauss(x) {
    const sqrt2Pi = Math.sqrt(2 * Math.PI);
    return Math.exp(-0.5 * x * x) / sqrt2Pi;
}

let maxMovingUsers = 0;

function MovingUsersDetected(moving) {
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
    for (const i in relationships) {
	for (const j in relationships[i]) {
	    relationships[i][j] *= decayMultiplier;
	}
    }
}

function RelationshipSummary() {
    const sortable = [];
    for (const i in relationships) {
	for (const j in relationships[i]) {
	    const r = relationships[i][j];
	    sortable.push({ i, j, r });
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
    console.log('ALL RELATIONSHIPS');
    for (const i in relationships) {
	for (const j in relationships[i]) {
	    const r = relationships[i][j];
	    console.log(i, j, r);
	}
    }
}

async function Main() {
    const sql = 'SELECT * FROM player_positions ORDER BY timestamp';
    console.log('Starting query');
    const results = await db.Query(sql);
    console.log('Query finished. Got', results.length, 'footsteps');
    let timeCursor;
    let secondsProcessed = 0;
    let maxQueueLength = 0;
    let t;
    for (const row of results) {
	t = row.timestamp.getTime();
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
    const finalT = t;
    while (timeCursor < finalT) {
	ProcessOneSecond(timeCursor);
	secondsProcessed++;
	timeCursor += 1000;
    }
    PopOldFootsteps(timeCursor);
    const finalQueueLength = CountQueue();
    console.log('maxQueueLength', maxQueueLength, 'finalQueueLength', finalQueueLength);
    const daysProcessed = secondsProcessed / 3600 / 24;
    console.log('Processed', secondsProcessed, 'seconds (', daysProcessed, 'days)');
    console.log('maxMovingUsers', maxMovingUsers);
    RelationshipSummary();
    PrintRelationships();
    await db.End();
}

Main();
