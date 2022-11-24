const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const mysql = require('mysql');
const ExpressMysqlSession = require('express-mysql-session');
const ParseHtml = require('./parse');
const passport = require('passport');
const passportSteam = require('passport-steam');
const PushReceiver = require('push-receiver');
const secrets = require('./secrets');
const session = require('express-session');
const uuid = require('uuid');

// Connect to the database.
const db = mysql.createConnection(secrets.mysql);

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
const mysqlSessionStore = new MySQLStore({ expiration: maxSessionAgeMs }, db);
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

app.get('/', (req, res) => {
    if (req.user) {
	res.redirect('/map');
    } else {
	res.sendFile('index.html', { root: 'static' });
    }
});

app.get('/map', (req, res) => {
    if (req.user) {
	res.sendFile('map.html', { root: 'static' });
    } else {
	res.redirect('/');
    }
});

// Serve static files.
app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }));

app.get('/auth/steam', passport.authenticate('steam', {failureRedirect: '/'}), (req, res) => {
    res.redirect('/');
});

app.get('/auth/steam/return', passport.authenticate('steam', {failureRedirect: '/'}), (req, res) => {
    res.redirect('/');
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
	if (err) {
	    return next(err);
	} else {
	    res.redirect('/');
	}
    });
});

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
    const fcmClient = await PushReceiver.listen(fcmCredentials, ({ notification, persistentId }) => {
	const body = JSON.parse(notification.data.body);
	console.log('Received server pairing notification.');
	console.log(body);
	if (body.playerToken) {
	    pairingStatusBySteamId[steamId] = { success: 'Successfully paired' };
	    // Store token (and entire body) in a persistent storage of some kind.
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

// Start the https webserver.
https.createServer(secrets.sslConfig, app).listen(443);

// Run an http webserver whose only job is to redirect http to https.
app.listen(80);

// Clean up when the process shuts down.
process.on('exit', () => {
    sessionStore.close();
});
