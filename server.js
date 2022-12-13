// A third-party Rust+ web app that allows multiple teams to see each other on the map.
const cluster = require('./cluster');
const crawl = require('./crawl');
const db = require('./database');
const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const ExpressMysqlSession = require('express-mysql-session');
const ParseHtml = require('./parse');
const passport = require('passport');
const passportSteam = require('passport-steam');
const PushReceiver = require('push-receiver');
const rustplus = require('./rustplus');
const secrets = require('./secrets');
const ServerCache = require('./server-cache');
const ServerPairingCache = require('./server-pairing-cache');
const session = require('express-session');
const UserCache = require('./user-cache');
const uuid = require('uuid');

// This is the express app.
const app = express();

// Turn on support for JSON and url-encoded POST bodies.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Redirect http to https.
app.use((request, response, next) => {
    if (request.secure) {
	next();
    } else {
	return response.redirect("https://" + request.headers.host + request.url);
    }
});

// Required to get data from user for sessions
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});

// Steam login strategy middleware.
passport.use(new passportSteam.Strategy({
    returnURL: 'https://rustgovernment.com/auth/steam/return',
    realm: 'https://rustgovernment.com/',
    apiKey: secrets.steamWebApiKey,
}, (identifier, profile, done) => {
    process.nextTick(() => {
	profile.identifier = identifier;
	return done(null, profile);
    });
}));

// Set up mysql-based session store. The sessions are stored in an RDS database.
const maxSessionAgeMs = 5 * 365.25 * 24 * 60 * 60 * 1000;
const MySQLStore = ExpressMysqlSession(session);
const mysqlSessionStore = new MySQLStore({ expiration: maxSessionAgeMs }, db.GetConnection());
app.use(session({
    cookie: {
	maxAge: maxSessionAgeMs,
    },
    resave: false,
    saveUninitialized: true,
    secret: secrets.sessionSecretString,
    store: mysqlSessionStore,
}));
app.use(passport.initialize());
app.use(passport.session());

// Return the server cache record for a logged-in user's currently selected server.
function GetSelectedServer(req) {
    if (!req.user) {
	return null;
    }
    const steamId = req.user.id;
    const pairs = ServerPairingCache.GetAllPairingsForUser(steamId);
    if (pairs.length === 0) {
	return null;
    }
    // Determine the selected server. If None, then pick an arbitrary server that
    // the user is paired to.
    let hostAndPort = req.session.selectedServer;
    if (!hostAndPort) {
	hostAndPort = pairs[0].serverHostAndPort;
	req.session.selectedServer = hostAndPort;
    }
    const server = ServerCache.GetServerByHostAndPort(hostAndPort);
    return server;
}

// Updates the information in the database and user cache based on
// the latest user info provided in the request. Every time a logged-in
// user loads a page that's a chance to update their user info.
async function UpdateUserRecord(req) {
    const user = await UserCache.GetOrCreateUserFromSteamAuth(req.user);
    if (user) {
	await user.UpdateBasedOnSteamUserRecord(req.user);
    }
}

// Landing page for non-logged=in users.
app.get('/', (req, res) => {
    if (!req.user) {
	return res.sendFile('index.html', { root: 'static' });
    }
    const selected = GetSelectedServer(req);
    if (selected) {
	return res.redirect('/map');
    } else {
	return res.redirect('/servers');
    }
});

// Server selection and pairing page.
app.get('/servers', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    res.sendFile('servers.html', { root: 'static' });
});

// Main map view.
app.get('/map', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    res.sendFile('map.html', { root: 'static' });
});

// Cache keyed by host:port. Values have an expiry timestamp.
// Example value { expiry: 1669671721164, data: '' }
const cachedMapData = {};

app.get('/mapdata', async (req, res) => {
    if (!req.user) {
	return res.json({});
    }
    const selected = GetSelectedServer(req);
    if (!selected) {
	return res.json({});
    }
    const currentTime = new Date().getTime();
    const hostAndPort = selected.hostAndPort;
    if (hostAndPort in cachedMapData) {
	const cached = cachedMapData[hostAndPort];
	if (currentTime < cached.expiry) {
	    return res.json({ map: cached.data });
	}
    }
    const steamId = req.user.id;
    const pair = ServerPairingCache.GetPairingRecordFromHostPortAndSteamId(selected.host, selected.port, steamId);
    if (!pair.token) {
	// TODO: make this work better by caching map data in the DB layer, not in memory.
	if (hostAndPort in cachedMapData) {
	    const cached = cachedMapData[hostAndPort];
	    return res.json({ map: cached.data });
	}
    }
    const request = { getMap: {} };
    let response;
    try {
	response = await rustplus.OneOffRequest(pair, request);
    } catch (error) {
	console.log('Error while retrieving map image from Rust+ API');
	console.log(error);
	return res.json({});
    }
    const map = response.response.map;
    const tenMinutes = 1 * 60 * 1000;
    cachedMapData[hostAndPort] = { expiry: currentTime + tenMinutes, data: map };
    return res.json({ map });
});

app.get('/selectserver', async (req, res) => {
    const host = req.query.host;
    const port = req.query.port;
    if (!req.user || !host || !port) {
	return res.redirect('/');
    }
    const hostAndPort = host + ':' + port;
    req.session.selectedServer = hostAndPort;
    return res.redirect('/map');
});

app.get('/pairedservers', (req, res) => {
    if (!req.user) {
	return res.json({});
    }
    const steamId = req.user.id;
    const pairs = ServerPairingCache.GetAllPairingsForUser(steamId);
    const servers = [];
    for (const pair of pairs) {
	const server = ServerCache.GetServerByHostAndPort(pair.serverHostAndPort);
	servers.push({
	    hostAndPort: server.hostAndPort,
	    host: server.host,
	    port: server.port,
	    name: server.name,
	    description: server.description,
	    logo: server.logo,
	    consecutiveFailureCount: pair.consecutiveFailureCount,
	});
    }
    return res.json({ servers });
});

app.get('/dots', (req, res) => {
    if (!req.user) {
	return res.json({});
    }
    const steamId = req.user.id;
    const selected = GetSelectedServer(req);
    if (!selected) {
	return res.json({});
    }
    const groupBases = groupBasesByServer[selected.hostAndPort] || [];
    const dots = crawl.GetVisibleBasesAndUsers(selected.hostAndPort, steamId, groupBases);
    return res.json(dots);
});

// For debugging purposes this endpoint causes the entire
// cache to be logged to the console.
app.get('/log', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    const user = await UserCache.GetOrCreateUserFromSteamAuth(req.user);
    await user.UpdateBasedOnSteamUserRecord(req.user);
    UserCache.LogAllUsers();
    ServerCache.LogAllKnownServers();
    ServerPairingCache.LogAllKnownPairings();
    res.json({ ok: true });
});

// Serve static files.
app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }));

// Steam login endpoints.
app.get('/auth/steam', passport.authenticate('steam', {failureRedirect: '/'}), (req, res) => {
    res.redirect('/');
});
app.get('/auth/steam/return', passport.authenticate('steam', {failureRedirect: '/'}), (req, res) => {
    res.redirect('/');
});

// Logout endpoint.
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
	if (err) {
	    return next(err);
	} else {
	    res.redirect('/');
	}
    });
});

// Helper function for the server pairing flow.
async function RegisterWithRustPlus(authToken, expoPushToken) {
    const url = 'https://companion-rust.facepunch.com:443/api/push/register';
    const options = {
	AuthToken: authToken,
	DeviceId: 'rustplus.js',
	PushKind: 0,
	PushToken: expoPushToken,
    };
    const response = await fetch(url, {
	method: 'post',
	headers: {
	    'Content-Type': 'application/json',
	},
	body: JSON.stringify(options),
    });
}

// Helper function for the server pairing flow.
async function GetExpoPushToken(fcmCredentials) {
    const url = 'https://exp.host/--/api/v2/push/getExpoPushToken';
    const options = {
	deviceId: uuid.v4(),
	experienceId: '@facepunch/RustCompanion',
	appId: 'com.facepunch.rust.companion',
	deviceToken: fcmCredentials.fcm.token,
	type: 'fcm',
	development: false,
    };
    const response = await fetch(url, {
	method: 'post',
	headers: {
	    'Content-Type': 'application/json',
	},
	body: JSON.stringify(options),
    });
    const responseJson = await response.json();
    if (responseJson && responseJson.data && responseJson.data.expoPushToken) {
	return responseJson.data.expoPushToken;
    } else {
	return null;
    }
}

// Stores a status message for each currently ongoing server pairing request.
const pairingStatusBySteamId = {};

// Listen for a server pairing request, given a Rust+ auth token.
async function HandleServerPairingRequest(steamId, rustPlusAuthToken) {
    // Step 1. Register with Firebase Cloud Messaging (FCM).
    pairingStatusBySteamId[steamId] = { status: 'Registering with FCM' };
    const fcmCredentials = await PushReceiver.register('976529667804');
    if (!fcmCredentials || !fcmCredentials.fcm.token) {
	pairingStatusBySteamId[steamId] = { status: 'Failed to pair. Try again. (Error code 0099)' };
	console.log('ERROR: failed to register with FCM.');
	return;
    }

    // Step 2. Fetch expo push token.
    pairingStatusBySteamId[steamId] = { status: 'Fetching Expo Push Token' };
    let expoPushTokenError = false;
    const expoPushToken = await GetExpoPushToken(fcmCredentials).catch((error) => {
	expoPushTokenError = true;
	pairingStatusBySteamId[steamId] = { status: 'Failed to pair. Try again. (Error code 0089)' };
	console.log('Failed to fetch Expo Push Token');
	console.log(error);
    });
    if (expoPushTokenError) {
	return;
    }

    // Step 3. Register with Rust+ API.
    pairingStatusBySteamId[steamId] = { status: 'Registering with Rust+ Companion API' };
    let registrationError = false;
    const rustPlusRegistration = await RegisterWithRustPlus(rustPlusAuthToken, expoPushToken).catch((error) => {
	registrationError = true;
	pairingStatusBySteamId[steamId] = { status: 'Failed to pair. Try again. (Error code 0079)' };
	console.log('Failed to register with Rust+ Companion API');
	console.log(error);
    });
    if (registrationError) {
	return;
    }

    // Step 4. Listen for the user to press the Pair button in-game.
    pairingStatusBySteamId[steamId] = { status: 'Trying to listen for the Pair button in-game' };
    const fcmClient = await PushReceiver.listen(fcmCredentials, async ({ notification, persistentId }) => {
	const body = JSON.parse(notification.data.body);
	console.log('Received FCM notification:', JSON.stringify(body));
	if (body.playerToken) {
	    pairingStatusBySteamId[steamId] = { success: 'Successfully paired' };
	    const serverRecord = await ServerCache.GetServerRecordFromPairingNotification(body);
	    await serverRecord.UpdateBasedOnServerPairingConfirmationMessage(body);
	    //console.log('Server record from cache:', serverRecord.name);
	    const pairingRecord = await ServerPairingCache.GetPairingRecordFromPairingNotification(body);
	    await pairingRecord.UpdateBasedOnServerPairingConfirmationMessage(body);
	    //console.log('Pairing record from cache:', pairingRecord.token);
	}
    });
    pairingStatusBySteamId[steamId] = { status: 'Press the Pair button in-game' };

    // Step 5. Stop listening for server pairing requests after an hour has passed.
    setTimeout(() => {
	try {
	    delete pairingStatusBySteamId[steamId];
	    fcmClient.destroy();
	} catch (error) {
	    console.log('Error while destroying FCM client:', error);
	}
    }, 3600 * 1000);
}

// Returns the status of a logged-in user's ongoing server pairing request.
// Starts a new server pairing request if none is ongoing and the needed
// token is passed in as input,
app.post('/pair', (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    const steamId = req.user.id;
    // Get the status of this user's in-progress pairing request, if any.
    const status = pairingStatusBySteamId[steamId];
    // Initiate a new server pairing request if the client asks,
    // and there is not one already under way.
    const pairingAlreadyUnderway = status && status.status;
    if (req.body.pageSource && !pairingAlreadyUnderway) {
	// Initiate new pairing request.
	const pageSource = req.body.pageSource;
	const parsed = ParseHtml(pageSource);
	if (parsed.error) {
	    return res.json({ error: parsed.error });
	}
	if (parsed.steamId !== steamId) {
	    return res.json({ error: 'You must pair in-game using the same Steam account' });
	}
	pairingStatusBySteamId[steamId] = { status: 'Initiating server pairing' };
	// Do not await. Respond immediately with the status of the server pairing request.
	// The client will poll for the updated status of their pairing request.
	HandleServerPairingRequest(steamId, parsed.token);
    }
    const response = pairingStatusBySteamId[steamId] || { success: 'Follow the instructions to pair a server' };
    return res.json(response);
});

let playerBasesByServer = {};
let groupBasesByServer = {};

async function UpdatePlayerBases() {
    const query = (
	'SELECT ' +
	'  u.steam_id AS user_steam_id, ' +
	'  u.incrementing_id AS user_incrementing_id, ' +
	'  s.host_and_port AS server_host_and_port, ' +
        '  s.incrementing_id AS server_incrementing_id, ' +
	'  b.x AS x, ' +
	'  b.y AS y, ' +
	'  b.density AS density, ' +
	'  b.main_base AS main_base ' +
	'FROM player_bases b ' +
	'INNER JOIN servers s ON b.server_incrementing_id = s.incrementing_id ' +
        'INNER JOIN users u ON b.user_incrementing_id = u.incrementing_id'
    );
    const playerBases = await db.Query(query);
    const newPlayerBaseCache = {};
    for (const base of playerBases) {
	const serverKey = base.server_host_and_port;
	if (!(serverKey in newPlayerBaseCache)) {
	    newPlayerBaseCache[serverKey] = [];
	}
	newPlayerBaseCache[serverKey].push({
	    userIncrementingId: base.user_incrementing_id,
	    userSteamId: base.user_steam_id,
	    serverIncrementingId: base.server_incrementing_id,
	    serverHostAndPort: base.server_host_and_port,
	    x: base.x,
	    y: base.y,
	    density: base.density,
	    mainBase: base.main_base,
	});
    }
    playerBasesByServer = newPlayerBaseCache;
}

async function UpdateGroupBases() {
    for (const serverKey in playerBasesByServer) {
	const playerBases = playerBasesByServer[serverKey];
	const groupBases = cluster.Cluster(playerBases);
	console.log(`Clustering bases on server ${serverKey} ${playerBases.length} -> ${groupBases.length}`);
	groupBasesByServer[serverKey] = groupBases;
    }
}

async function UpdateBaseCacheFromDatabase() {
    await UpdatePlayerBases();
    await UpdateGroupBases();
    setTimeout(UpdateBaseCacheFromDatabase, 60 * 1000);
}

async function Main() {
    console.log('Initializing caches.');
    await UserCache.Initialize();
    await ServerCache.Initialize();
    await ServerPairingCache.Initialize();
    // Start the https webserver.
    console.log('Starting https.');
    https.createServer(secrets.sslConfig, app).listen(443);
    // Run an http webserver whose only job is to redirect http to https.
    console.log('Starting http.');
    app.listen(80);
    // Start routinely updating the base cache with newly discovered bases.
    setTimeout(UpdateBaseCacheFromDatabase, 10 * 1000);
}

Main();

// Clean up when the process shuts down.
process.on('exit', () => {
    sessionStore.close();
    db.End();
});
