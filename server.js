const express = require('express');
const fs = require('fs')
const https = require('https')

const app = express();

app.use(express.static(__dirname + '/static', { dotfiles: 'allow' }));

app.get('/', (req, res) => {
    res.send('Hello HTTPS!')
})

const port = 443;
const httpsOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/rustgovernment.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/rustgovernment.com/fullchain.pem'),
};
const server = https.createServer(httpsOptions, app);
server.listen(port, () => {
    console.log(`Webserver listening on port ${port}.`)
});
