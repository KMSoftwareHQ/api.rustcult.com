const express = require('express');
const fs = require('fs')
const https = require('https');

const app = express();

// Redirect http to https.
app.use((request, response, next) => {
    if (request.secure) {
	next();
    } else {
	return response.redirect("https://" + request.headers.host + request.url);
    }
});

// Serve static files.
app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }));

app.get('/', (req, res) => {
    res.send('Hello HTTPS!')
});

// Start the https webserver.
const httpsOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/rustgovernment.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/rustgovernment.com/fullchain.pem'),
};
https.createServer(httpsOptions, app).listen(443);

// Run an http webserver whole only job is to redirect http to https.
app.listen(80);
