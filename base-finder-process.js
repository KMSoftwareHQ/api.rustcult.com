// This script finds individual player base locations.

const db = require('./database');
const findbases = require('./find-bases');
const ServerCache = require('./server-cache');
const ServerPairingCache = require('./server-pairing-cache');
const UserCache = require('./user-cache');

async function InitializeDatabaseCaches() {
    console.log('Initializing caches.');
    await UserCache.Initialize();
    await ServerCache.Initialize();
    await ServerPairingCache.Initialize();
    console.log('Caches initialized.');
}

async function PopulatePlayers() {
    const players = {};
    console.log('Querying the database for player IDs.');
    const results = await db.Query('SELECT DISTINCT user_incrementing_id AS uid FROM player_positions WHERE server_incrementing_id = 1');
    for (const row of results) {
	players[row.uid] = 1;
    }
    console.log(`Found ${Object.keys(players).length} distinct players.`);
    return players;
}

async function FindBases(players) {
    const serverIncrementingId = 1;
    console.log('Finding bases.');
    for (const userIncrementingId in players) {
	await db.Query(
	    'DELETE FROM player_bases WHERE server_incrementing_id = ? AND user_incrementing_id = ?',
	    [serverIncrementingId, userIncrementingId]);
	const bases = await findbases.FindBases(serverIncrementingId, userIncrementingId);
	console.log(`${userIncrementingId} has ${bases.length} bases.`);
	let mainBase = true;
	for (const base of bases) {
	    const [x, y, density] = base;
	    await db.Query(
		'INSERT INTO player_bases ' +
	        '(server_incrementing_id, user_incrementing_id, x, y, density, main_base) ' +
		'VALUES ' +
		'(?,?,?,?,?,?)',
		[serverIncrementingId, userIncrementingId, x, y, density, mainBase],
	    );
	    mainBase = false;
	}
    }
}

async function Main() {
    await InitializeDatabaseCaches();
    const players = await PopulatePlayers();
    await FindBases(players);
    db.End();
    console.log('Done.');
}

Main();

// Clean up when the process shuts down.
process.on('exit', () => {
    db.End();
});
