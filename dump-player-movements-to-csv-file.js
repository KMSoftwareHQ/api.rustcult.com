const db = require('./database');
const moment = require('moment');

async function Main() {
    const results = await db.Query(
	`SELECT * FROM player_positions ` +
        `WHERE timestamp > '2022-12-01' AND timestamp < '2023-01-05' ` +
	`AND server_incrementing_id = 1 ` +
	`ORDER BY server_incrementing_id, user_incrementing_id, timestamp`
    );
    for (const row of results) {
	const epoch = moment(row.timestamp).valueOf() / 1000;
	const columns = [row.server_incrementing_id, row.user_incrementing_id, epoch, row.x, row.y];
	const csv = columns.join(',');
	console.log(csv);
    }
    db.End();
}

Main();
