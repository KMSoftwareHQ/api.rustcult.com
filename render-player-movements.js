// This script renders a map of player movements over long periods of time.
// Its purpose is artistic. The images are intended for looking at to dream
// up different features that could be extracted from the data. The features
// are in turn intended to use to assess the strength of the players'
// relationships amongst each other. It is that web of connections that is
// used for various purposes in the main map app.

const { createCanvas, loadImage } = require('canvas');
let d3 = import('d3-quadtree');
const db = require('./database');
const fs = require('fs');
const secrets = require('./secrets');
const ServerCache = require('./server-cache');
const ServerPairingCache = require('./server-pairing-cache');
const UserCache = require('./user-cache');

const serverIncrementingId = 3;
const sql = `SELECT * FROM player_positions WHERE server_incrementing_id = ${serverIncrementingId} ORDER BY timestamp`;

let minX = 999999;
let maxX = -999999;
let minY = 999999;
let maxY = -999999;
let players = {};
let colors = [];
const userIds = [];
const colorsByUserIncrementingId = {};
let canvas, ctx;

async function InitializeDatabaseCaches() {
    console.log('Initializing caches.');
    await UserCache.Initialize();
    await ServerCache.Initialize();
    await ServerPairingCache.Initialize();
    console.log('Caches initialized.');
}

async function PopulateEdges() {
    console.log('Querying the database for footprints.');
    const results = await db.Query(sql);
    console.log(`${results.length} footprints received. Determining edges.`);
    for (const row of results) {
	const x = row.x;
	const y = row.y;
	minX = Math.min(x, minX);
	minY = Math.min(y, minY);
	maxX = Math.max(x, maxX);
	maxY = Math.max(y, maxY);
	players[row.user_incrementing_id] = 1;
    }
    minX = Math.floor(minX);
    minY = Math.floor(minY);
    maxX = Math.floor(maxX);
    maxY = Math.floor(maxY);
    console.log('Edges determined:', minX, minY, maxX, maxY);
    console.log(`Found ${Object.keys(players).length} distinct players.`);
}

function DrawLine(x1, y1, x2, y2, color) {
    const [r, g, b] = color;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.1)`;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function InterpolateTwoColors(a, b, ratio) {
    const [ar, ag, ab] = a;
    const [br, bg, bb] = b;
    const r = ratio;
    return [
	Math.floor(r * br + (1 - r) * ar),
	Math.floor(r * bg + (1 - r) * ag),
	Math.floor(r * bb + (1 - r) * ab),
    ];
}

// Start the colors at yellow instead of the customary red.
const rainbowColors = [
    [255, 255, 0],  // Yellow
    [0, 255, 0],    // Green
    [0, 255, 255],  // Cyan
    [0, 0, 255],    // Blue
    [255, 0, 255],  // Violet
    [255, 0, 0],    // Red
    [255, 128, 0],  // Orange
];

// p is a number between [0, 1].
function InterpolateRainbowColor(p) {
    const n = rainbowColors.length;
    const realColorIndex = p * n;
    const colorIndex = Math.floor(realColorIndex);
    const remainder = realColorIndex - colorIndex;
    const nextColorIndex = (colorIndex + 1) % n;
    const color = rainbowColors[colorIndex];
    const nextColor = rainbowColors[nextColorIndex];
    return InterpolateTwoColors(color, nextColor, remainder);
}

// Generates a list of bright colors equally spaced from around the color wheel.
function GenerateRainbowColors(n) {
    const colors = [];
    for (let i = 0; i < n; i++) {
	const p = i / n;
	const c = InterpolateRainbowColor(p);
	colors.push(c);
    }
    return colors;
}

/**
 * Shuffles array in place.
 * @param {Array} a items An array containing the items.
 *
 * Copied from StackOverflow.
 */
function Shuffle(a) {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
	j = Math.floor(Math.random() * (i + 1));
	x = a[i];
	a[i] = a[j];
	a[j] = x;
    }
    return a;
}

async function Retrace() {
    const numColors = Object.keys(players).length;
    colors = GenerateRainbowColors(numColors);
    Shuffle(colors);
    console.log('Querying the database for footprints.');
    const results = await db.Query(sql);
    console.log(`${results.length} footprints received. Rendering now.`);
    const prevRow = {};
    let rowCount = 0;
    for (const row of results) {
	rowCount++;
	if (rowCount % 1000 === 0) {
	    console.log(`${rowCount} of ${results.length}`);
	}
	const userId = row.user_incrementing_id;
	if (!userIds.includes(userId)) {
	    userIds.push(userId);
	}
	const playerIndex = userIds.indexOf(userId);
	colorsByUserIncrementingId[userId] = colors[playerIndex];
	if (!row.x || !row.y) {
	    continue;
	}
	if (Math.abs(row.x) < 0.001 && Math.abs(row.y) < 0.001) {
	    continue;
	}
	const prev = prevRow[userId];
	if (prev) {
	    const dx = row.x - prev.x;
	    const dy = row.y - prev.y;
	    const dist = Math.sqrt(dx * dx + dy * dy);
	    if (dist < 50) {
		DrawLine(
		    prev.x - minX,
		    maxY - prev.y,
		    row.x - minX,
		    maxY - row.y,
		    colors[playerIndex],
		);
	    }
	}
	prevRow[userId] = row;
    }
    console.log('Done rendering.');
}

function CountNeighbors(tree, x, y, r) {
    const rSquared = r * r;
    const xmin = x - r;
    const ymin = y - r;
    const xmax = x + r;
    const ymax = y + r;
    let count = 0;
    tree.visit((node, x1, y1, x2, y2) => {
	if (!node.length) {
	    do {
		let d = node.data;
		if (d[0] >= xmin && d[0] < xmax && d[1] >= ymin && d[1] < ymax) {
		    const dx = x - d[0];
		    const dy = y - d[1];
		    const distanceSquared = dx * dx + dy * dy;
		    if (distanceSquared < rSquared) {
			count++;
		    }
		}
	    } while (node = node.next);
	}
	return x1 >= xmax || y1 >= ymax || x2 < xmin || y2 < ymin;
    });
    return count;
}

function IsCloseToAny(p, neighbors, radius) {
    const r2 = radius * radius;
    for (const n of neighbors) {
	const dx = n[0] - p.x;
	const dy = n[1] - p.y;
	const d2 = dx * dx + dy * dy;
	if (d2 < r2) {
	    return true;
	}
    }
    return false;
}

function FindDensestPointExcludingCircles(points, centers, exclusionRadius) {
    const tree = d3.quadtree();
    for (const p of points) {
	if (!IsCloseToAny(p, centers, exclusionRadius)) {
	    tree.add([p.x, p.y]);
	}
    }
    let maxNeighbors = -1;
    let densestX;
    let densestY;
    const searchRadius = 3;
    for (const p of points) {
	if (IsCloseToAny(p, centers, exclusionRadius)) {
	    continue;
	}
	const neighborCount = CountNeighbors(tree, p.x, p.y, searchRadius);
	if (neighborCount > maxNeighbors) {
	    maxNeighbors = neighborCount;
	    densestX = p.x;
	    densestY = p.y;
	}
    }
    return [densestX, densestY, maxNeighbors];
}

async function FindBases(userIncrementingId) {
    const points = await db.Query(
	'SELECT x, y FROM player_positions ' +
	'WHERE user_incrementing_id = ? AND server_incrementing_id = ?',
	[userIncrementingId, serverIncrementingId],
    );
    const bases = [];
    const n = points.length;
    if (n < 500) {
	// Not enough points to confidently identify bases. Bail.
	return bases;
    }
    while (true) {
	const base = FindDensestPointExcludingCircles(points, bases, 30);
	if (!base) {
	    break;
	}
	const x = base[0];
	if (!x) {
	    break;
	}
	const y = base[1];
	const neighborCount = base[2];
	const density = neighborCount / points.length;
	const percent = (100 * density).toFixed(3);
	if (density < 0.04) {
	    break;
	}
	bases.push(base);
    }
    return bases;
}

function DrawCircle(x, y) {
    ctx.strokeStyle = `rgba(255, 255, 255, 1)`;
    ctx.beginPath();
    const radius = 10;
    ctx.arc(x - minX, maxY - y, radius, 0, 2 * Math.PI);
    ctx.stroke();
}

function DistanceBetweenBases(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function GeometricMedian(bases) {
    const n = bases.length;
    let minDistance;
    let median;
    for (let i = 0; i < n; i++) {
	let totalDistance = 0;
	for (let j = 0; j < n; j++) {
	    totalDistance += DistanceBetweenBases(bases[i], bases[j]);
	}
	if (!minDistance || totalDistance < minDistance) {
	    minDistance = totalDistance;
	    median = bases[i];
	}
    }
    return median;
}

function CombineClusters(a, b) {
    const residents = a.residents.concat(b.residents);
    const playerBases = a.playerBases.concat(b.playerBases);
    const median = GeometricMedian(playerBases);
    return {
	residents,
	playerBases,
	x: median.x,
	y: median.y,
	mainBase: a.mainBase || b.mainBase,
    };
}

function FullLinkageClusterDistance(a, b) {
    let maxDistance = 0;
    for (let i = 0; i < a.playerBases.length; i++) {
	for (let j = 0; j < b.playerBases.length; j++) {
	    const distance = DistanceBetweenBases(a.playerBases[i], b.playerBases[j]);
	    maxDistance = Math.max(distance, maxDistance);
	}
    }
    return maxDistance;
}

function FindClosestClusters(clusters) {
    const n = clusters.length;
    let bestI;
    let bestJ;
    let bestDistance;
    for (let i = 0; i < n; i++) {
	for (let j = i + 1; j < n; j++) {
	    const distance = FullLinkageClusterDistance(clusters[i], clusters[j]);
	    if (!bestDistance || distance < bestDistance) {
		bestDistance = distance;
		bestI = i;
		bestJ = j;
	    }
	}
    }
    return [bestI, bestJ, bestDistance];
}

function Cluster(playerBases) {
    const groupBases = [];
    for (const base of playerBases) {
	groupBases.push({
	    residents: [base.userIncrementingId],
	    playerBases: [base],
	    x: base.x,
	    y: base.y,
	    mainBase: base.mainBase,
	});
    }
    const maxClusterWidth = 27;
    while (true) {
	const [i, j, distance] = FindClosestClusters(groupBases);
	console.log(`Closest clusters ${i} and ${j} with distance ${distance}`);
	if (distance === undefined || distance === null) {
	    break;
	}
	if (distance > maxClusterWidth) {
	    break;
	}
	console.log('Merging');
	const newCluster = CombineClusters(groupBases[i], groupBases[j]);
	groupBases.splice(j, 1);
	groupBases.splice(i, 1);
	groupBases.push(newCluster);
    }
    return groupBases;
}

async function DetectClusterAndDrawBases() {
    console.log('Finding bases.');
    const playerBases = [];
    for (const userIncrementingId in players) {
	const bases = await FindBases(userIncrementingId);
	console.log(`${userIncrementingId} has ${bases.length} bases.`);
	let mainBase = true;
	for (const base of bases) {
	    const [x, y, density] = base;
	    playerBases.push({ userIncrementingId, x, y, density, mainBase });
	    mainBase = false;
	}
    }
    console.log('Clustering bases.');
    const groupBases = Cluster(playerBases);
    console.log('Drawing bases');
    for (const base of groupBases) {
	DrawCircle(base.x, base.y);
	ctx.fillStyle = `rgba(255, 255, 255, 1)`;
	ctx.fillText(`${base.residents.length}`, base.x - minX, maxY - base.y);
    }
}

async function InitializeD3() {
    d3 = await d3;
}

async function Main() {
    await InitializeD3();
    await InitializeDatabaseCaches();
    await PopulateEdges();
    const width = maxX - minX;
    const height = maxY - minY;
    canvas = createCanvas(width, height);
    ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await Retrace(ctx);
    await DetectClusterAndDrawBases(ctx);
    console.log('Outputting image.');
    const out = fs.createWriteStream('movement.png')
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    db.End();
    console.log('Done.');
}

Main();

// Clean up when the process shuts down.
process.on('exit', () => {
    db.End();
});
