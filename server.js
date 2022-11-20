const express = require('express');
const https = require('https');
const ParseHtml = require('./parse');
const passport = require('passport');
const passportSteam = require('passport-steam');
const secrets = require('./secrets');
const session = require('express-session');

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

// Stores a status message for each currently ongoing server pairing request.
const pairingStatusBySteamId = {};

async function HandleServerPairingRequest(steamId, rustPlusAuthToken) {

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
	HandleServerPairingRequest(steamId, parsed.token);
    }
    // Get the status of this user's in-progress pairing request, if any.
    const response = { status: pairingStatusBySteamId[steamId] };
    return res.json(response);
});

// Start the https webserver.
https.createServer(secrets.sslConfig, app).listen(443);

// Run an http webserver whose only job is to redirect http to https.
app.listen(80);
