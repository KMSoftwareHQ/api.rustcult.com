const RustPlus = require('rustplus-api');

function OneOffRequest(serverPairingRecord, request) {
    const hostAndPort = serverPairingRecord.serverHostAndPort;
    const tokens = hostAndPort.split(':');
    if (tokens.length !== 2) {
	throw 'Invalid server:port string';
    }
    const host = tokens[0];
    const port = parseInt(tokens[1]);
    const steamId = serverPairingRecord.userSteamId;
    const token = serverPairingRecord.token;
    return new Promise((resolve, reject) => {
	const client = new RustPlus(host, port, steamId, token);
	client.on('error', (error) => {
	    reject(error);
	});
	client.on('connected', () => {
	    // Some short delay is needed here to prevent an error with the
	    // websocket not being ready or somesuch. The websocket complains
	    // about its status and waiting a short while seems to sort it out.
	    setTimeout(() => {
		client.sendRequest(request, (response) => {
		    if (client.websocket) {
			client.websocket.terminate();
			client.websocket = null;
		    } else {
			console.log('Websocket not open. This might indicate a problem.');
		    }
		    resolve(response);
		});
	    }, 1);
	});
	// Keep the following line commented even though it seems like it
	// should be necessary. Seems to work fine without it and turning it
	// back on seems to break the connection. Do not know why but commenting
	// it out works.
	//client.connect();
    });
}

module.exports = {
    OneOffRequest,
};
