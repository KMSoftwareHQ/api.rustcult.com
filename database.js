const mysql = require('mysql');
const secrets = require('./secrets');

// Connect to the database.
let connection = mysql.createConnection(secrets.mysql);
connection.on('error', (err) => {
    console.error('MySQL connection error:', err.message);
});

function GetConnection() {
    return connection;
}

async function Query(sql, values) {
    return new Promise((resolve, reject) => {
	connection.query(sql, values, (err, results) => {
	    if (err) {
		reject(err);
	    } else {
		resolve(results);
	    }
	});
    });
}

function End() {
    connection.end();
}

module.exports = {
    End,
    GetConnection,
    Query,
};
