// This script renders a map of player movements over long periods of time.
// Its purpose is artistic. The images are intended for looking at to dream
// up different features that could be extracted from the data. The features
// are in turn intended to use to assess the strength of the players'
// relationships amongst each other. It is that web of connections that is
// used for various purposes in the main map app.

const { createCanvas, loadImage } = require('canvas');
const db = require('./database');
const fs = require('fs');
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
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.01)`;
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
	    if (dist < 30) {
		DrawLine(
		    canvas.width * (prev.x - minX) / (maxX - minX),
		    canvas.height * (maxY - prev.y) / (maxY - minY),
		    canvas.width * (row.x - minX) / (maxX - minX),
		    canvas.height * (maxY - row.y) / (maxY - minY),
		    colors[playerIndex],
		);
	    }
	}
	prevRow[userId] = row;
    }
    console.log('Done rendering.');
}

async function Main() {
    await InitializeDatabaseCaches();
    await PopulateEdges();
    minX = 2175.1975;
    minY = 399.5207;
    maxX = 2450.3975;
    maxY = 623.5207;
    canvas = createCanvas(5160, 4200);
    ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    await Retrace(ctx);
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
