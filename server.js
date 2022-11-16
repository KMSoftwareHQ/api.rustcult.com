const express = require('express');
const https = require('https');
const secrets = require('./secrets');

const app = express();

// Serve static files.
app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }));

// Homepage.
app.get('/', (req, res) => {
    res.send('Hello HTTPS!')
});

// Redirect http to https.
app.use((request, response, next) => {
    if (request.secure) {
	next();
    } else {
	return response.redirect("https://" + request.headers.host + request.url);
    }
});

// Start the https webserver.
https.createServer(secrets.sslConfig, app).listen(443);

// Run an http webserver whose only job is to redirect http to https.
app.listen(80);
