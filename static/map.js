let cachedMapData;
let mapImageTag;
let cachedDots;
let cachedDotsTime;
let previousCachedDots;
let previousCachedDotsTime;

const mapCanvas = document.getElementById('mapcanvas');
const mapContext = mapCanvas.getContext('2d');

function Sleep(ms) {
    return new Promise((resolve, reject) => {
	setTimeout(() => {
	    resolve();
	}, ms);
    });
}

function Draw() {
    if (!cachedMapData) {
	console.log('No cached map data. Bailing.');
	return;
    }
    const map = cachedMapData.map;
    mapContext.fillStyle = map.background;
    mapContext.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
    const w = mapCanvas.width;
    const h = mapCanvas.height;
    const wh = Math.min(w, h);
    const mw = map.width;
    const mh = map.height;
    const om = map.oceanMargin;
    mapContext.drawImage(
	mapImageTag,
	om, om, mw - 2 * om, mh - 2 * om,
	(w - wh) / 2, (h - wh) / 2, wh, wh);
    // Center location.
    const cx = w / 2;
    const cy = h / 2;
    // Bottom-left corner of map image. The "origin" for the Rust+ map coords.
    const ox = cx - wh / 2;
    const oy = cy + wh / 2;
    const mapSize = 4500;

    function DrawDots(dots, oldDots, alpha, borderColor, fillColor) {
	if (!dots) {
	    return;
	}
	const beforeAndAfter = {};
	for (const dot of dots) {
	    beforeAndAfter[dot.steamId] = { after: dot };
	}
	if (oldDots) {
	    for (const dot of oldDots) {
		beforeAndAfter[dot.steamId].before = dot;
	    }
	}
	mapContext.fillStyle = fillColor;
	mapContext.strokeStyle = borderColor;
	mapContext.lineWidth = 2;
	const r = alpha;
	for (const steamId in beforeAndAfter) {
	    const dot = beforeAndAfter[steamId].after;
	    const oldDot = beforeAndAfter[steamId].before;
	    const threshold = 0.001;
	    if (Math.abs(dot.x) <= threshold && Math.abs(dot.y) <= threshold) {
		continue;
	    }
	    const x = oldDot ? r * dot.x + (1 - r) * oldDot.x : dot.x;
	    const y = oldDot ? r * dot.y + (1 - r) * oldDot.y : dot.y;
	    const px = ox + wh * x / mapSize;
	    const py = oy - wh * y / mapSize;
	    mapContext.beginPath();
	    mapContext.arc(px, py, 3, 0, 2 * Math.PI);
	    mapContext.stroke();
	    mapContext.fill();
	}
    }

    DrawDots(map.monuments, '#db4437', 'rgba(234, 153, 153, 0.5)');
    if (cachedDots) {
	const currentTime = new Date().getTime();
	const timeFraction = (currentTime - 1000 - previousCachedDotsTime) / (cachedDotsTime - previousCachedDotsTime);
	const alpha = Math.max(0, Math.min(1, timeFraction));
	const prev = previousCachedDots || {};
	DrawDots(cachedDots.enemies, prev.enemies, alpha, '#FFF000', 'rgba(255, 240, 0, 0.8)');
	DrawDots(cachedDots.allies, prev.allies, alpha, '#00FFF0', 'rgba(0, 255, 240, 0.8)');
	DrawDots(cachedDots.team, prev.team, alpha, '#00FF00', 'rgba(182, 215, 168, 0.8)');
    }
}

function OnResize() {
    mapCanvas.width = window.innerWidth;
    mapCanvas.height = window.innerHeight;
    Draw();
}

window.addEventListener('resize', OnResize, false);

async function FetchDots() {
    const response = await fetch('/dots');
    const jsonResponse = await response.json();
    previousCachedDots = cachedDots;
    previousCachedDotsTime = cachedDotsTime;
    cachedDots = jsonResponse.dots;
    cachedDotsTime = new Date().getTime();
}

async function PeriodicUpdateForDotsData() {
    await FetchDots();
    setTimeout(PeriodicUpdateForDotsData, 1000);
}

async function DoFrame() {
    Draw();
    setTimeout(DoFrame, 10);
}

async function Main() {
    const response = await fetch('/mapdata');
    const mapData = await response.json();
    cachedMapData = mapData;
    await Sleep(100);
    mapImageTag = document.createElement('img');
    mapImageTag.src = 'data:image/png;base64, ' + mapData.map.jpgImage;
    await Sleep(100);
    OnResize();
    await PeriodicUpdateForDotsData();
    await DoFrame();
}

Main();
