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
    const map = cachedMapData.map;
    mapContext.fillStyle = map.background;
    mapContext.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
    const w = mapCanvas.width;
    const h = mapCanvas.height;
    const wh = Math.min(w, h);
    const mw = cachedMapData.map.width;
    const mh = cachedMapData.map.height;
    const oceanMargin = cachedMapData.map.oceanMargin;
    mapContext.drawImage(mapImageTag, oceanMargin, oceanMargin, mw - 2 * oceanMargin, mh - 2 * oceanMargin, (w - wh) / 2, (h - wh) / 2, wh, wh);
    const cx = w / 2;
    const cy = h / 2;
    const ox = cx - wh / 2;
    const oy = cy + wh / 2;
    const mapSize = 4500;
    for (const monument of cachedMapData.map.monuments) {
	const x = ox + wh * monument.x / mapSize;
	const y = oy - wh * monument.y / mapSize;
	console.log(x, y);
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
    console.log(mapData);
    await Sleep(100);
    mapImageTag = document.createElement('img');
    mapImageTag.src = 'data:image/png;base64, ' + mapData.map.jpgImage;
    await Sleep(100);
    OnResize();
}

Main();
