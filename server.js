// A third-party Rust+ web app that allows multiple teams to see each other on the map.
const cluster = require('./cluster');
const cors = require('cors');
const crawl = require('./crawl');
let d3 = import('d3-quadtree');
const db = require('./database');
const DiscordStrategy = require('passport-discord').Strategy;
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const https = require('https');
const ExpressMysqlSession = require('express-mysql-session');
const moment = require('moment');
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

// Required when running behind a reverse proxy (e.g. Caddy/nginx) so
// request.secure reflects X-Forwarded-Proto and we don't redirect-loop.
app.set('trust proxy', 1);

app.use(cors({
    credentials: true,
    origin: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.disable('x-powered-by');

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
    returnURL: secrets.baseUrl + '/return',
    realm: secrets.baseUrl + '/',
    apiKey: secrets.steamWebApiKey,
}, (identifier, profile, done) => {
    process.nextTick(() => {
	profile.identifier = identifier;
	return done(null, profile);
    });
}));

const discordConfig = {
    clientID: secrets.discordClientId,
    clientSecret: secrets.discordClientSecret,
    callbackURL: secrets.baseUrl + '/discordauthorizecallback',
    scope: ['identify'],
};

function DiscordVerifyFunction(accessToken, refreshToken, profile, cb) {
    console.log('Discord verify function - Discord ID:', profile.id);
    const err = null;
    const user = profile;
    cb(err, user);
};

// Discord authorization middleware for account linking. The main authentication
// provider used by this app is "Login with Steam". After logging in with Steam,
// another button is there to further link a discord account. The goal is to
// link the two accounts.
const discordStrat = new DiscordStrategy(discordConfig, DiscordVerifyFunction);
passport.use(discordStrat);

// Set up mysql-based session store. The sessions are stored in an RDS database.
const maxSessionAgeMs = 5 * 365.25 * 24 * 60 * 60 * 1000;
const MySQLStore = ExpressMysqlSession(session);
const mysqlSessionStore = new MySQLStore(
    { expiration: maxSessionAgeMs, ...secrets.mysql },
    null
);
app.use(session({
    cookie: {
	domain: secrets.cookieDomain,
	httpOnly: true,
	maxAge: maxSessionAgeMs,
	sameSite: 'lax',
	secure: typeof secrets.baseUrl === 'string' && secrets.baseUrl.startsWith('https://'),
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
    // Determine the selected server.
    let hostAndPort = req.session.selectedServer;
    if (!hostAndPort) {
	// If None, then pick an arbitrary server that the user is paired to.
	hostAndPort = pairs[0].serverHostAndPort;
	req.session.selectedServer = hostAndPort;
    }
    const server = ServerCache.GetServerByHostAndPort(hostAndPort);
    if (!server) {
	// No record of any server matching the host and port from the session.
	return null;
    }
    const serverPairs = ServerPairingCache.GetAllPairingsForServer(hostAndPort);
    if (serverPairs.length === 0) {
	// No remaining alive server pairings indicates that the server is
	// dead or down for a prolonger amount of time.
	return null;
    }
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

// Landing page for non-logged-in users.
app.get('/', (req, res) => {
    if (req.user) {
	return res.redirect('/servers');
    } else {
	return res.sendFile('index.html', { root: 'rustcult.com/static' });
    }
});

// Discord account linking page.
app.get('/link', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    // Proceed even if user already linked, allowing to link a different account.
    res.sendFile('link.html', { root: 'rustcult.com/static' });
});

// Server selection and pairing page.
app.get('/servers', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    const steamId = req.user.id;
    if (!steamId) {
	return res.redirect('/');
    }
    const user = UserCache.GetUserBySteamId(steamId);
    if (!user) {
	return res.redirect('/');
    }
    if (!user.discordId || !user.discordUsername) {
	return res.redirect('/link');
    }
    res.sendFile('servers.html', { root: 'rustcult.com/static' });
});

app.get('/me', async (req, res) => {
    if (!req.user) {
	return res.json({ error: 'Not logged in' });
    }
    await UpdateUserRecord(req);
    const steamId = req.user.id;
    if (!steamId) {
	return res.json({ error: 'Invalid steam ID' });
    }
    const u = UserCache.GetUserBySteamId(steamId);
    if (!u) {
	return res.json({ error: 'Unknown user.' });
    }
    res.json({
	discordId: u.discordId,
	discordUsername: u.discordUsername,
	steamId: u.steamId,
	steamName: u.steamName,
    });
});

// Main map view.
app.get('/map', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    const server = GetSelectedServer(req);
    if (!server) {
	return res.redirect('/servers');
    }
    res.sendFile('map.html', { root: 'rustcult.com/static' });
});

app.get('/mapdata', async (req, res) => {
    if (!req.user) {
	return res.json({});
    }
    const selected = GetSelectedServer(req);
    if (!selected) {
	return res.json({});
    }
    let info;
    try {
	info = JSON.parse(selected.infoJson);
    } catch (e) {
    }
    let map;
    try {
	map = JSON.parse(selected.mapJson);
    } catch (e) {
    }
    const updateTime = selected.mapImageUpdateTime;
    if (updateTime) {
	const isRecent = moment(updateTime).add(10, 'minutes').isAfter(moment());
	if (isRecent) {
	    return res.json({ info, map });
	}
    }
    const steamId = req.user.id;
    const pair = ServerPairingCache.GetPairingRecordFromHostPortAndSteamId(selected.host, selected.port, steamId);
    if (!pair.IsAlive()) {
	return res.json({ info, map });
    }
    let response;
    try {
	response = await rustplus.OneOffRequest(pair, {
	    getMap: {}
	});
    } catch (error) {
	console.log('Error while retrieving map image from Rust+ API');
	console.log(error);
	return res.json({ info, map });
    }
    map = response.response.map;
    const mapJson = JSON.stringify(map);
    await selected.SetMapJson(mapJson);
    try {
	response = await rustplus.OneOffRequest(pair, {
	    getInfo: {}
	});
    } catch (error) {
	console.log('Error while retrieving server info from Rust+ API');
	console.log(error);
	return res.json({ info, map });
    }
    info = response.response.info;
    const infoJson = JSON.stringify(info);
    await selected.SetInfoJson(infoJson);
    if (info.mapSize) {
	const mapSize = parseInt(info.mapSize);
	await selected.SetMapSize(mapSize);
    }
    return res.json({ info, map });
});

function SortUsersForOwner(a, b) {
    if (a.isHighPriest && !b.isHighPriest) {
	return -1;
    }
    if (!a.isHighPriest && b.isHighPriest) {
	return 1;
    }
    if (a.isCultMember && !b.isCultMember) {
	return -1;
    }
    if (!a.isCultMember && b.isCultMember) {
	return 1;
    }
    if (a.steamName && !b.steamName) {
	return -1;
    }
    if (!a.steamName && b.steamName) {
	return 1;
    }
    if (a.steamName && b.steamName) {
	const bySteamName = a.steamName.localeCompare(b.steamName);
	if (bySteamName !== 0) {
	    return bySteamName;
	}
    }
    if (a.steamId && !b.steamId) {
	return -1;
    }
    if (!a.steamId && b.steamId) {
	return 1;
    }
    if (a.steamId && b.steamId) {
	const bySteamId = a.steamId.localeCompare(b.steamId);
	if (bySteamId !== 0) {
	    return bySteamId;
	}
    }
    if (a.incrementingId < b.incrementingId) {
	return -1;
    }
    if (a.incrementingId > b.incrementingId) {
	return 1;
    }
    return 0;
}

// The developer uses this page to ordinate the elected Mr. President as a high priest (admin) of the cult.
app.get('/owner', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    const user = await UserCache.GetOrCreateUserFromSteamAuth(req.user);
    if (!user) {
	return res.redirect('/');
    }
    if (!user.isOwner) {
	return res.redirect('/');
    }
    const ownerSteamId = '76561198054245955';
    if (user.steamId !== ownerSteamId) {
	return res.redirect('/');
    }
    const allUsers = UserCache.GetAllUsersAsAShallowCopiedList();
    allUsers.sort(SortUsersForOwner);
    let html = `<html><head><title>Owner Panel</title><link rel="stylesheet" type="text/css" href="backdoor.css" /></head><body>`;
    html += `<ol>`;
    for (const u of allUsers) {
	if (u.isHighPriest) {
	    html += `<li>${u.steamId} ${u.steamName} <a href="/dismisshighpriest?steamid=${u.steamId}">Dismiss</a></li>`;
	} else {
	    html += `<li>${u.steamId} ${u.steamName} <a href="/ordinatehighpriest?steamid=${u.steamId}">Ordinate</a></li>`;
	}
    }
    html += `</ol>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

async function UpdateHighPriestStatus(req, res, newIsHighPriest) {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    const user = await UserCache.GetOrCreateUserFromSteamAuth(req.user);
    if (!user) {
	return res.redirect('/');
    }
    if (!user.isOwner) {
	return res.redirect('/');
    }
    const ownerSteamId = '76561198054245955';
    if (user.steamId !== ownerSteamId) {
	return res.redirect('/');
    }
    const targetSteamId = req.query.steamid;
    if (!targetSteamId) {
	return res.redirect('/');
    }
    if (targetSteamId.length !== 17) {
	return res.redirect('/');
    }
    const target = UserCache.GetUserBySteamId(targetSteamId);
    if (!target) {
	return res.redirect('/');
    }
    await target.SetHighPriest(newIsHighPriest);
    return res.redirect('/owner');
}

app.get('/ordinatehighpriest', async (req, res) => {
    return await UpdateHighPriestStatus(req, res, true);
});

app.get('/dismisshighpriest', async (req, res) => {
    return await UpdateHighPriestStatus(req, res, false);
});

// High Priests of the clan (admins basically) use this secret page to add/remove clan members.
app.get('/backdoor', async (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    const user = await UserCache.GetOrCreateUserFromSteamAuth(req.user);
    if (!user) {
	return res.redirect('/');
    }
    if (!user.isHighPriest) {
	return res.redirect('/');
    }
    const allUsers = UserCache.GetAllUsersAsAShallowCopiedList();
    allUsers.sort(SortUsersForOwner);
    let html = `<html><head><title>Backdoor</title><link rel="stylesheet" type="text/css" href="backdoor.css" /></head><body>`;
    html += `<ol>`;
    for (const u of allUsers) {
	if (u.isCultMember) {
	    html += `<li>${u.steamId} ${u.steamName} <a href="/bancultmember?steamid=${u.steamId}">Ban</a></li>`;
	} else {
	    html += `<li>${u.steamId} ${u.steamName} <a href="/addcultmember?steamid=${u.steamId}">Add</a></li>`;
	}
    }
    html += `</ol></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

async function UpdateCultMemberStatus(req, res, newIsCultMember) {
    if (!req.user) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    const user = await UserCache.GetOrCreateUserFromSteamAuth(req.user);
    if (!user) {
	return res.redirect('/');
    }
    if (!user.isHighPriest) {
	return res.redirect('/');
    }
    const targetSteamId = req.query.steamid;
    if (!targetSteamId) {
	return res.redirect('/');
    }
    if (targetSteamId.length !== 17) {
	return res.redirect('/');
    }
    const target = UserCache.GetUserBySteamId(targetSteamId);
    if (!target) {
	return res.redirect('/');
    }
    await target.SetCultMember(newIsCultMember);
    return res.redirect('/backdoor');
}

app.get('/addcultmember', async (req, res) => {
    return await UpdateCultMemberStatus(req, res, true);
});

app.get('/bancultmember', async (req, res) => {
    return await UpdateCultMemberStatus(req, res, false);
});

app.get('/backdoor.css', async (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile('backdoor.css', { root: __dirname });
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

// Serve static files.
app.use(express.static(__dirname + '/rustcult.com/static', { dotfiles: 'allow' }));

// Steam login endpoints.
app.get('/login', passport.authenticate('steam', { failureRedirect: '/loginfailure' }), (req, res) => {
    console.log('Should not get here');
    //res.redirect('/');
});
app.get('/return', passport.authenticate('steam', { failureRedirect: '/loginfailure' }), (req, res) => {
    console.log('Steam login success');
    res.redirect('/');
});
app.get('/loginfailure', (req, res) => {
    console.log('Steam login failure!');
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

// Discord account linking via OAuth AUTHORIZE.
app.get('/discordauthorize', passport.authorize('discord', { failureRedirect: '/discordauthorizefailure' }));
app.get('/discordauthorizecallback', passport.authorize('discord', { failureRedirect: '/discordauthorizefailure' }), async (req, res) => {
    const discord = req.account;
    if (!discord) {
	return res.redirect('/');
    }
    if (!discord.id) {
	return res.redirect('/');
    }
    const steam = req.user;
    if (!steam) {
	return res.redirect('/');
    }
    if (!steam.id) {
	return res.redirect('/');
    }
    await UpdateUserRecord(req);
    const user = UserCache.GetUserBySteamId(steam.id);
    if (!user) {
	return res.redirect('/');
    }
    await user.SetDiscordId(discord.id);
    await user.SetDiscordUsername(discord.username);
    console.log('Link successful STEAMID', steam.id, 'DISCORDID', discord.id);
    res.redirect('/');
});
app.get('/discordauthorizefailure', (req, res) => {
    console.log('Discord link failure!');
    res.redirect('/link');
});
app.get('/getalldiscordaccounts', (req, res) => {
    if (req.query.token !== secrets.getalldiscordaccountsToken) {
	return res.json([]);
    }
    const accounts = UserCache.GetAllDiscordAccounts();
    const formattedAccounts = [];
    for (const account of accounts) {
	const secondsSinceLastMovement = account.GetSecondsSinceLastMovement();
	const secondsSinceBreadcrumb = account.GetSecondsSinceBreadcrumb();
	const howManyBasesNearby = HowManyBasesNearby(account.lastSeenAliveServer, account.lastSeenAliveX, account.lastSeenAliveY);
	formattedAccounts.push({
	    discordId: account.discordId,
	    steamId: account.steamId,
	    steamName: account.steamName,
	    server: account.lastSeenAliveServer ? account.lastSeenAliveServer : undefined,
	    x: account.lastSeenAliveX ? account.lastSeenAliveX : undefined,
	    y: account.lastSeenAliveY ? account.lastSeenAliveY : undefined,
	    lastSeenAliveTime: account.lastSeenAliveTime ? account.lastSeenAliveTime : undefined,
	    secondsSinceLastMovement: secondsSinceLastMovement < 3600 ? secondsSinceLastMovement : undefined,
	    secondsSinceBreadcrumb: secondsSinceBreadcrumb < 3600 ? secondsSinceBreadcrumb : undefined,
	    howManyBasesNearby: howManyBasesNearby ? howManyBasesNearby : undefined,
	});
    }
    res.json(formattedAccounts);
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
    try {
	if (!secrets.fcmSenderId) {
	    pairingStatusBySteamId[steamId] = { status: 'Failed to pair. Try again. (Error code 0099)' };
	    console.error('[pair] FCM not configured: fcmSenderId missing in secrets.');
	    return;
	}
	// Step 1. Register with Firebase Cloud Messaging (FCM).
	// Note: push-receiver uses FCM endpoint deprecated/removed June 2024; register() often fails (0099).
	pairingStatusBySteamId[steamId] = { status: 'Registering with FCM' };
	const fcmCredentials = await PushReceiver.register(secrets.fcmSenderId);
	if (!fcmCredentials || !fcmCredentials.fcm || !fcmCredentials.fcm.token) {
	    pairingStatusBySteamId[steamId] = { status: 'Failed to pair. Try again. (Error code 0099)' };
	    console.error('[pair] FCM register failed or returned invalid credentials. Google deprecated the FCM endpoint used by push-receiver (June 2024); see https://firebase.google.com/support/faq#fcm-depr-features');
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
	await RegisterWithRustPlus(rustPlusAuthToken, expoPushToken).catch((error) => {
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
	console.log('Trying to listen for the Pair button in-game');
	const fcmClient = await PushReceiver.listen(fcmCredentials, async ({ notification, persistentId }) => {
	    try {
		const body = JSON.parse(notification.data.body);
		if (body.playerToken) {
		    pairingStatusBySteamId[steamId] = { status: 'Rust+ token received' };
		    const serverRecord = await ServerCache.GetServerRecordFromPairingNotification(body);
		    await serverRecord.UpdateBasedOnServerPairingConfirmationMessage(body);
		    const pairingRecord = await ServerPairingCache.GetPairingRecordFromPairingNotification(body);
		    await pairingRecord.UpdateBasedOnServerPairingConfirmationMessage(body);
		    pairingStatusBySteamId[steamId] = { success: 'Successfully paired' };
		}
	    } catch (error) {
		console.error('[pair] FCM notification parse/handle error:', error);
	    }
	});
	pairingStatusBySteamId[steamId] = { status: 'Press the Pair button in-game' };

	setTimeout(() => {
	    try {
		delete pairingStatusBySteamId[steamId];
		fcmClient.destroy();
	    } catch (error) {
		console.log('Error while destroying FCM client:', error);
	    }
	}, 3600 * 1000);
    } catch (err) {
	pairingStatusBySteamId[steamId] = { status: 'Failed to pair. Try again. (Error code 0099)' };
	console.error('[pair]', err && err.message ? err.message : err);
	if (err && err.stack) {
	    console.error(err.stack);
	}
	// 0099 often means FCM registration failed: Google deprecated the push-receiver endpoint (June 2024).
    }
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
    const pageSource = req.body.pageSource;
    const credentialsLine = req.body.credentialsLine;
    if ((pageSource || credentialsLine) && !pairingAlreadyUnderway) {
	let parsed;
	if (credentialsLine) {
	    if (typeof credentialsLine !== 'string') {
		return res.json({ error: 'Invalid credentials line.' });
	    }
	    parsed = ParseHtml.ParseCredentialsLine(credentialsLine);
	} else {
	    if (typeof pageSource !== 'string') {
		return res.json({ error: 'Invalid page source.' });
	    }
	    parsed = ParseHtml(pageSource);
	}
	if (parsed.error) {
	    return res.json({ error: parsed.error });
	}
	if (parsed.steamId !== steamId) {
	    return res.json({ error: 'You must pair using the same Steam account as this site.' });
	}
	pairingStatusBySteamId[steamId] = { status: 'Initiating server pairing' };
	HandleServerPairingRequest(steamId, parsed.token).catch((error) => {
	    pairingStatusBySteamId[steamId] = { status: 'Failed to pair. Try again. (Error code 0099)' };
	    console.error('[pair]', error);
	});
    }
    const response = pairingStatusBySteamId[steamId] || { success: 'Follow the instructions to pair a server' };
    return res.json(response);
});

let playerBasesByServer = {};
let groupBasesByServer = {};
let quadtreeByServer = {};

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
	const tree = d3.quadtree();
	for (const base of groupBases) {
	    tree.add([base.x, base.y]);
	}
	quadtreeByServer[serverKey] = tree;
    }
}

async function UpdateBaseCacheFromDatabase() {
    await UpdatePlayerBases();
    await UpdateGroupBases();
    setTimeout(UpdateBaseCacheFromDatabase, 10 * 60 * 1000);
}

function HowManyBasesNearby(server, x, y) {
    if (!server || !x || !y) {
	return 0;
    }
    if (!(server in quadtreeByServer)) {
	return 0;
    }
    const tree = quadtreeByServer[server];
    const r = 300;
    const xmin = x - r;
    const ymin = y - r;
    const xmax = x + r;
    const ymax = y + r;
    let count = 0;
    tree.visit((node, x1, y1, x2, y2) => {
	if (node.length) {
	    return x1 >= xmax || y1 >= ymax || x2 < xmin || y2 < ymin;
	}
	do {
	    let d = node.data;
	    if (d[0] >= xmin && d[0] < xmax && d[1] >= ymin && d[1] < ymax) {
		const dx = Math.abs(x - d[0]);
		const dy = Math.abs(y - d[1]);
		if (dx < r && dy < r) {
		    count++;
		}
	    }
	} while (node = node.next);
    });
    return count;
}

async function CrawlRandomSteamUser() {
    const user = UserCache.GetRandomUser();
    if (!user) {
	setTimeout(CrawlRandomSteamUser, 9000);
	return;
    }
    const steamId = user.steamId;
    const url = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${secrets.steamWebApiKey}&steamids=${steamId}`;
    let response;
    try {
	response = await fetch(url);
    } catch (error) {
	// Do nothing.
    }
    if (response) {
	let json;
	try {
	    json = await response.json();
	} catch (error) {
	    // Do nothing.
	}
	if (json && json.response && json.response.players) {
	    const players = json.response.players;
	    if (players.length > 0) {
		const p = players[0];
		if (p.steamid === steamId) {
		    const n = p.personaname;
		    if (n && (typeof n === 'string') && n.length > 0) {
			console.log(steamId, n);
			await user.SetSteamName(n);
		    }
		}
	    }
	}
    }
    setTimeout(CrawlRandomSteamUser, 9000);
}

async function Main() {
    // Dunno what kind of magic this is but it stops an error.
    d3 = await d3;
    console.log('Starting server with node version', process.version);
    console.log('Initializing caches.');
    await UserCache.Initialize();
    await ServerCache.Initialize();
    await ServerPairingCache.Initialize();
    // Start the webservers. If running behind a reverse proxy that terminates TLS,
    // the proxy should connect to our HTTP port.
    const canStartHttps = (
	secrets.sslKeyPath &&
	secrets.sslCertPath &&
	fs.existsSync(secrets.sslKeyPath) &&
	fs.existsSync(secrets.sslCertPath) &&
	secrets.httpsPort
    );
    if (canStartHttps) {
	console.log('Starting https.');
	const sslConfig = {
	    key: fs.readFileSync(secrets.sslKeyPath),
	    cert: fs.readFileSync(secrets.sslCertPath),
	};
	https.createServer(sslConfig, app).listen(secrets.httpsPort);
    } else {
	console.log('HTTPS disabled (no cert paths).');
    }
    console.log('Starting http.');
    app.listen(secrets.httpPort);
    // Start routinely updating the base cache with newly discovered bases.
    setTimeout(UpdateBaseCacheFromDatabase, 10 * 1000);
    // Crawl random steam users to update their display names.
    setTimeout(CrawlRandomSteamUser, 10 * 1000);
}

Main();

// Clean up when the process shuts down.
process.on('exit', () => {
    mysqlSessionStore.close();
    db.End();
});
