const db = require('./database');

function ProcessFootstep(server_id, t, x, y) {
    console.log(server_id, t, x, y);
}

async function Main() {
    const sql = 'SELECT * FROM player_positions ORDER BY timestamp';
    console.log('Starting query');
    const results = await db.Query(sql);
    console.log('Query finished.');
    for (const row of results) {
	t = row.timestamp.getTime();
	ProcessFootstep(row.server_incrementing_id, t, row.x, row.y);
    }
    db.End();
}

Main();
