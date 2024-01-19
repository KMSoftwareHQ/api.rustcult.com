const db = require('./database');
const moment = require('moment');

class Server {
    constructor(databaseRow) {
	this.incrementingId = databaseRow.incrementing_id;
	this.hostAndPort = databaseRow.host_and_port;
	this.host = databaseRow.host;
	this.port = databaseRow.port;
	this.name = databaseRow.name;
	this.img = databaseRow.img;
	this.logo = databaseRow.logo;
	this.id = databaseRow.id;
	this.url = databaseRow.url;
	this.description = databaseRow.description;
	this.mapImageUpdateTime = databaseRow.map_image_update_time;
	this.mapSize = databaseRow.map_size;
	this.mapJson = databaseRow.get_map_json;
	this.infoJson = databaseRow.get_info_json;
    }

    async SetName(name) {
	if (name === this.name) {
	    return;
	}
	this.name = name;
	await db.Query('UPDATE servers SET name = ? WHERE host_and_port = ?', [this.name, this.hostAndPort]);
    }

    async SetImg(img) {
	if (img === this.img) {
	    return;
	}
	this.img = img;
	await db.Query('UPDATE servers SET img = ? WHERE host_and_port = ?', [this.img, this.hostAndPort]);
    }

    async SetLogo(logo) {
	if (logo === this.logo) {
	    return;
	}
	this.logo = logo;
	await db.Query('UPDATE servers SET logo = ? WHERE host_and_port = ?', [this.logo, this.hostAndPort]);
    }

    async SetId(id) {
	if (id === this.id) {
	    return;
	}
	this.id = id;
	await db.Query('UPDATE servers SET id = ? WHERE host_and_port = ?', [this.id, this.hostAndPort]);
    }

    async SetUrl(url) {
	if (url === this.url) {
	    return;
	}
	this.url = url;
	await db.Query('UPDATE servers SET url = ? WHERE host_and_port = ?', [this.url, this.hostAndPort]);
    }

    async SetDescription(description) {
	if (description === this.description) {
	    return;
	}
	this.description = description;
	await db.Query('UPDATE servers SET description = ? WHERE host_and_port = ?', [this.description, this.hostAndPort]);
    }

    async SetMapImageUpdateTime(mapImageUpdateTime) {
	if (mapImageUpdateTime === this.mapImageUpdateTime) {
	    return;
	}
	this.mapImageUpdateTime = mapImageUpdateTime;
	await db.Query('UPDATE servers SET map_image_update_time = ? WHERE host_and_port = ?', [this.mapImageUpdateTime, this.hostAndPort]);
    }

    async SetMapSize(mapSize) {
	if (mapSize === this.mapSize) {
	    return;
	}
	this.mapSize = mapSize;
	await db.Query('UPDATE servers SET map_size = ? WHERE host_and_port = ?', [this.mapSize, this.hostAndPort]);
    }

    async SetMapJson(mapJson) {
	if (!mapJson) {
	    return;
	}
	if (mapJson === this.mapJson) {
	    return;
	}
	this.mapJson = mapJson;
	await db.Query('UPDATE servers SET get_map_json = ? WHERE host_and_port = ?', [this.mapJson, this.hostAndPort]);
	await this.SetMapImageUpdateTime(moment().format());
    }

    async SetInfoJson(infoJson) {
	if (!infoJson) {
	    return;
	}
	if (infoJson === this.infoJson) {
	    return;
	}
	this.infoJson = infoJson;
	await db.Query('UPDATE servers SET get_info_json = ? WHERE host_and_port = ?', [this.infoJson, this.hostAndPort]);
	await this.SetMapImageUpdateTime(moment().format());
    }

    // Updates the fields in this cached server, and also the database, based on a server pairing confirmation message.
    async UpdateBasedOnServerPairingConfirmationMessage(message) {
	if (!message || !message.ip || !message.port) {
	    // The message does not appear to be a server pairing confirmation. Do nothing.
	    return;
	}
	const hostAndPort = message.ip + ':' + message.port;
	if (hostAndPort !== this.hostAndPort) {
	    throw 'Host and port of server record must match to update the other fields.';
	}
	if (message.name) {
	    await this.SetName(message.name);
	}
	if (message.img) {
	    await this.SetImg(message.img);
	}
	if (message.logo) {
	    await this.SetLogo(message.logo);
	}
	if (message.id) {
	    await this.SetId(message.id);
	}
	if (message.url) {
	    await this.SetUrl(message.url);
	}
	if (message.description) {
	    await this.SetDescription(message.description);
	}
    }
}

let serversByHostAndPort = {};

// Must call this to populate the cache from the database.
async function Initialize() {
    const newCache = {};
    const results = await db.Query('SELECT * from servers');
    for (const row of results) {
	const server = new Server(row);
	newCache[server.hostAndPort] = server;
    }
    serversByHostAndPort = newCache;
}

function GetAllServers() {
    return Object.values(serversByHostAndPort);
}

async function CreateNewServerInDatabase(message) {
    if (!message || !message.ip || !message.port) {
	throw 'Creating new server in the database requires a valid server pairing notification.';
    }
    const hostAndPort = message.ip + ':' + message.port;
    console.log(`Creating new server record in the database with host and port ${hostAndPort}`);
    const query = (
	'INSERT INTO servers ' +
	'(host_and_port, host, port, name, img, logo, id, url, description) ' +
	'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const values = [
	hostAndPort, message.ip, message.port,
	message.name, message.img, message.logo,
	message.id, message.url, message.description
    ];
    await db.Query(query, values);
    const results = await db.Query('SELECT * FROM servers where host_and_port = ?', [hostAndPort]);
    if (results.length !== 1) {
	throw 'Got back 2 matching server records after creating a new database record. This should not happen.';
    }
    const row = results[0];
    const server = new Server(row);
    serversByHostAndPort[hostAndPort] = server;
    return server;
}

// Gets a server record from the database cache. If no server record with
// the same host and port exists, then one is created.
async function GetServerRecordFromPairingNotification(message) {
    const hostAndPort = message.ip + ':' + message.port;
    const cachedServer = serversByHostAndPort[hostAndPort];
    if (cachedServer) {
	return cachedServer;
    } else {
	return await CreateNewServerInDatabase(message);
    }
}

function GetServerByHostAndPort(hostAndPort) {
    return serversByHostAndPort[hostAndPort] || null;
}

// For debugging purposes, log all the servers to the console.
function LogAllKnownServers() {
    const numServers = Object.keys(serversByHostAndPort).length;
    console.log(`All known servers (${numServers})`);
    for (const hostAndPort in serversByHostAndPort) {
	const server = serversByHostAndPort[hostAndPort];
	console.log(hostAndPort, server.name, server.infoJson);
    }
}

module.exports = {
    GetAllServers,
    GetServerByHostAndPort,
    GetServerRecordFromPairingNotification,
    Initialize,
    LogAllKnownServers,
};
