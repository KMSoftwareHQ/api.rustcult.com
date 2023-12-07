// This script renders a map of player movements over long periods of time.
// Its purpose is artistic. The images are intended for looking at to dream
// up different features that could be extracted from the data. The features
// are in turn intended to use to assess the strength of the players'
// relationships amongst each other. It is that web of connections that is
// used for various purposes in the main map app.

const { createCanvas, loadImage } = require('canvas');
const db = require('./database');
const fs = require('fs');
const RandomSeed = require('random-seed');
const ServerCache = require('./server-cache');
const ServerPairingCache = require('./server-pairing-cache');
const UserCache = require('./user-cache');

const sql = (
    `SELECT * FROM player_positions ` +
    `WHERE server_incrementing_id = 19 ` +
    `AND timestamp > '2023-11-02 14:00:00' AND timestamp < '2023-12-07' ` +
    `ORDER BY user_incrementing_id, timestamp`
);

let minX = 999999;
let maxX = -999999;
let minY = 999999;
let maxY = -999999;
const seed = '56';
const rng = RandomSeed(seed);
let players = {};
let colors = [];
const userIds = [];
let canvas, ctx;
const alpha = '0.5';

async function InitializeDatabaseCaches() {
    console.log('Initializing caches.');
    await UserCache.Initialize();
    await ServerCache.Initialize();
    await ServerPairingCache.Initialize();
    console.log('Caches initialized.');
}

async function PopulateEdges(footprints) {
    for (const row of footprints) {
	const x = row.x;
	const y = row.y;
	minX = Math.min(x, minX);
	minY = Math.min(y, minY);
	maxX = Math.max(x, maxX);
	maxY = Math.max(y, maxY);
	players[row.user_incrementing_id] = 1;
    }
    console.log(`Found ${Object.keys(players).length} distinct players.`);
}

function SetStrokeColor(color) {
    const [r, g, b] = color;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
	j = Math.floor(rng.random() * (i + 1));
	x = a[i];
	a[i] = a[j];
	a[j] = x;
    }
    return a;
}

// Can't use Math.sign(x) because Math.sign(0) === 0.
const sgn = x => x < 0 ? -1 : 1;

// Clamps a number to be between 0 and 1.
const clamp = x => Math.min(Math.max(x, 0), 1);

// Calculates the scalar multiplier from the projection
// of one vector onto another. We don't need the
// projected point itself, only the scalar.
function ProjectionScalar(ax, ay, bx, by, b2) {
    return (ax * bx + ay * by) / b2;
}

function DrawLine(x1, y1, x2, y2, color) {
    const [r, g, b] = color;
    SetStrokeColor(color);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

async function Retrace(footprints) {
    let prev;
    for (const row of footprints) {
	const userId = row.user_incrementing_id;
	if (!userIds.includes(userId)) {
	    userIds.push(userId);
	}
	const playerIndex = userIds.indexOf(userId);
	const color = colors[playerIndex];
	SetStrokeColor(color);
	if (!row.x || !row.y) {
	    continue;
	}
	if (Math.abs(row.x) < 0.001 && Math.abs(row.y) < 0.001) {
	    continue;
	}
	if (!prev) {
	    ctx.beginPath();
	    ctx.moveTo(row.x, row.y);
	} else if (prev.user_incrementing_id === userId) {
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
	prev = row;
    }
}

async function Main() {
    console.log('seed', seed);
    await InitializeDatabaseCaches();
    console.log('Querying the database for footprints.');
    const footprints = await db.Query(sql);
    console.log(`${footprints.length} footprints received.`);
    await PopulateEdges(footprints);
    console.log('Detected edges:', minX, minY, maxX, maxY);
    minX = 3310;
    maxX = 3810;
    minY = 2325;
    maxY = 2950;
    const numColors = Object.keys(players).length;
    colors = GenerateRainbowColors(numColors);
    Shuffle(colors);
    //canvas = createCanvas(5160, 4200);  // 20x16 inches at 240 DPI with 3/4 inch border.
    canvas = createCanvas(6120, 7560);  // 24x30 inches at 240 DPI with 3/4 inch border.
    ctx = canvas.getContext('2d');
    const filename = `raid-${seed}.png`;
    console.log('Rendering', filename);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    await Retrace(footprints);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filename, buffer);
    db.End();
    console.log('Done.');
}

Main();
