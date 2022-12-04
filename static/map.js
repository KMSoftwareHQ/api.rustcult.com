let cachedMapData;
let mapImageTag;
let cachedDots;

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

    function DrawDots(dots, borderColor, fillColor) {
	if (!dots) {
	    return;
	}
	mapContext.fillStyle = fillColor;
	mapContext.strokeStyle = borderColor;
	mapContext.lineWidth = 2;
	for (const dot of dots) {
	    const threshold = 0.001;
	    if (Math.abs(dot.x) <= threshold && Math.abs(dot.y) <= threshold) {
		continue;
	    }
	    const x = ox + wh * dot.x / mapSize;
	    const y = oy - wh * dot.y / mapSize;
	    mapContext.beginPath();
	    mapContext.arc(x, y, 3, 0, 2 * Math.PI);
	    mapContext.stroke();
	    mapContext.fill();
	}
    }

    DrawDots(map.monuments, '#db4437', 'rgba(234, 153, 153, 0.5)');
    if (cachedDots) {
	DrawDots(cachedDots.enemies, '#FFF000', 'rgba(255, 240, 0, 0.8)');
	DrawDots(cachedDots.allies, '#00FFF0', 'rgba(0, 255, 240, 0.8)');
	DrawDots(cachedDots.team, '#00FF00', 'rgba(182, 215, 168, 0.8)');
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
    cachedDots = jsonResponse.dots;
}

async function PeriodicUpdate() {
    await FetchDots();
    Draw();
    setTimeout(PeriodicUpdate, 1000);
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
    PeriodicUpdate();
}

Main();
