const express = require('express');
const https = require('https');
const passport = require('passport');
const passportSteam = require('passport-steam');
const secrets = require('./secrets');
const session = require('express-session');


const app = express();

// Serve static files.
app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }));

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
}, function (identifier, profile, done) {
    process.nextTick(function () {
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
    res.send(req.user);
});

app.get('/auth/steam', passport.authenticate('steam', {failureRedirect: '/'}), function (req, res) {
    res.redirect('/');
});

app.get('/auth/steam/return', passport.authenticate('steam', {failureRedirect: '/'}), function (req, res) {
    res.redirect('/');
});

// Start the https webserver.
https.createServer(secrets.sslConfig, app).listen(443);

// Run an http webserver whose only job is to redirect http to https.
app.listen(80);
