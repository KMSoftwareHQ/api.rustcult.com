let cachedMapData = null;

async function Main() {
    const mapImageTag = document.getElementById('mapimage');
    const response = await fetch('/mapdata');
    const mapData = await response.json();
    cachedMapData = mapData;
    console.log(mapData);
    mapImageTag.src = 'data:image/png;base64, ' + mapData.map.jpgImage;
}

Main();
