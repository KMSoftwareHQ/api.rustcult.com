let cachedMapData;
let mapImageTag;

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
    const cx = w / 2;
    const cy = h / 2;
    const ox = cx - wh / 2;
    const oy = cy + wh / 2;
    const mapSize = 4500;
    for (const monument of map.monuments) {
	const x = ox + wh * monument.x / mapSize;
	const y = oy - wh * monument.y / mapSize;
	mapContext.fillStyle = '#0000FF';
	mapContext.beginPath();
	mapContext.arc(x, y, 3, 0, 2 * Math.PI);
	mapContext.fill();
    }
}

function OnResize() {
    mapCanvas.width = window.innerWidth;
    mapCanvas.height = window.innerHeight;
    Draw();
}

window.addEventListener('resize', OnResize, false);

async function Main() {
    const response = await fetch('/mapdata');
    const mapData = await response.json();
    cachedMapData = mapData;
    await Sleep(100);
    mapImageTag = document.createElement('img');
    mapImageTag.src = 'data:image/png;base64, ' + mapData.map.jpgImage;
    await Sleep(100);
    OnResize();
}

Main();
