const express = require('express');
const fetch = require('node-fetch');
const https = require('https');
const ParseHtml = require('./parse');
const passport = require('passport');
const passportSteam = require('passport-steam');
const PushReceiver = require('push-receiver');
const secrets = require('./secrets');
const session = require('express-session');
const uuid = require('uuid');

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

// Initiate Strategy
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

app.use(session({
    secret: secrets.sessionSecretString,
    saveUninitialized: true,
    resave: false,
    cookie: {
	maxAge: 5 * 365.25 * 24 * 60 * 60 * 1000,
    },
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
    if (req.user) {
	res.sendFile('app.html', { root: 'static' });
    } else {
	res.sendFile('index.html', { root: 'static' });
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
    console.log('Registered with Rust+', response);
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

async function HandleServerPairingRequest(steamId, rustPlusAuthToken) {
    pairingStatusBySteamId[steamId] = 'Registering with FCM';
    const fcmCredentials = await PushReceiver.register('976529667804');

    pairingStatusBySteamId[steamId] = 'Fetching Expo Push Token';
    const expoPushToken = await GetExpoPushToken(fcmCredentials).catch((error) => {
	pairingStatusBySteamId[steamId] = 'Failed to pair';
	console.log("Failed to fetch Expo Push Token");
	console.log(error);
    });
    if (!expoPushToken) {
	return;
    }

    pairingStatusBySteamId[steamId] = 'Registering with Rust+ Companion API';
    const rustPlusRegistration = await RegisterWithRustPlus(rustPlusAuthToken, expoPushToken).catch((error) => {
	pairingStatusBySteamId[steamId] = 'Failed to register with Rust+ Companion API';
	console.log('Failed to register with Rust+ Companion API');
	console.log(error);
    });

    pairingStatusBySteamId[steamId] = 'Trying to listen for the Pair button in-game';
    const fcmClient = await PushReceiver.listen(fcmCredentials, ({ notification, persistentId }) => {
	delete pairingStatusBySteamId[steamId];
	const body = JSON.parse(notification.data.body);
	console.log(body);
    });
    pairingStatusBySteamId[steamId] = 'Press the Pair button in-game';

    // Listen for incoming messages for an hour, then close the FCM client..
    const oneSecond = 1000;
    const oneMinute = 60 * oneSecond;
    const oneHour = 60 * oneMinute;
    setTimeout(() => {
	try {
	    delete pairingStatusBySteamId[steamId];
	    fcmClient.destroy();
	} catch (error) {
	    console.log('Error while destroying FCM client:', error);
	}
    }, oneHour);
}

app.post('/pair', (req, res) => {
    if (!req.user) {
	return res.redirect('/');
    }
    const steamId = req.user.id;
    if (req.body.pageSource) {
	// Initiate new pairing request.
	const pageSource = req.body.pageSource;
	const parsed = ParseHtml(pageSource);
	if (parsed.error) {
	    return res.json({ error: parsed.error });
	}
	if (parsed.steamId !== steamId) {
	    return res.json({ error: 'You must pair in-game using the same Steam account you are logged in here with' });
	}
	pairingStatusBySteamId[steamId] = 'Initiating server pairing';
	// Do not await. Respond immediately with the status of the server pairing request.
	// The client will poll for the updated status of their pairing request.
	HandleServerPairingRequest(steamId, parsed.token);
    }
    const status = pairingStatusBySteamId[steamId] || 'No pairing request underway';
    // Get the status of this user's in-progress pairing request, if any.
    const response = { status };
    return res.json(response);
});

// Start the https webserver.
https.createServer(secrets.sslConfig, app).listen(443);

// Run an http webserver whose only job is to redirect http to https.
app.listen(80);
