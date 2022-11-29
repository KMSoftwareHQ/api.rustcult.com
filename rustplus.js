const RustPlus = require('rustplus-api');

function Connect(host, port, steamId, token) {
    return new Promise((resolve, reject) => {
	const client = new RustPlus(host, port, steamId, token);
	client.on('connected', () => resolve(client));
    });
}

function SendRequest(client, request) {
    return new Promise((resolve, reject) => {
	client.sendRequest(request, resolve);
    });
}

module.exports = {
    Connect,
    SendRequest,
};
