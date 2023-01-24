// This script finds individual player base locations.

const db = require('./database');
const findbases = require('./find-bases');
const ServerCache = require('./server-cache');
const ServerPairingCache = require('./server-pairing-cache');
const UserCache = require('./user-cache');

const wipeDate = '2023-01-05';

async function InitializeDatabaseCaches() {
    console.log('Initializing caches.');
    await UserCache.Initialize();
    await ServerCache.Initialize();
    await ServerPairingCache.Initialize();
    console.log('Caches initialized.');
}

async function GetDistinctPairs() {
    console.log('Querying the database for player IDs.');
    const pairs = await db.Query(
	'SELECT DISTINCT server_incrementing_id, user_incrementing_id ' +
	'FROM player_positions ' +
	'WHERE timestamp > ? AND timestamp > CURRENT_TIMESTAMP - INTERVAL 72 HOUR',
	wipeDate);
    console.log(`Found ${Object.keys(pairs).length} distinct server:player pairs.`);
    return pairs;
}

async function FindBases(pairs) {
    console.log('Finding bases.');
    for (const pair of pairs) {
	await db.Query(
	    'DELETE FROM player_bases WHERE server_incrementing_id = ? AND user_incrementing_id = ?',
	    [pair.server_incrementing_id, pair.user_incrementing_id]);
	const bases = await findbases.FindBases(pair.server_incrementing_id, pair.user_incrementing_id);
	console.log(`${pair.user_incrementing_id} has ${bases.length} bases.`);
	let mainBase = true;
	for (const base of bases) {
	    const [x, y, density] = base;
	    await db.Query(
		'INSERT INTO player_bases ' +
	        '(server_incrementing_id, user_incrementing_id, x, y, density, main_base) ' +
		'VALUES ' +
		'(?,?,?,?,?,?)',
		[pair.server_incrementing_id, pair.user_incrementing_id, x, y, density, mainBase],
	    );
	    mainBase = false;
	}
    }
}

async function Main() {
    await InitializeDatabaseCaches();
    const pairs = await GetDistinctPairs();
    await FindBases(pairs);
    db.End();
    console.log('Done.');
}

Main();
