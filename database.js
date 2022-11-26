const mysql = require('mysql');
const secrets = require('./secrets');

// Connect to the database.
let connection = mysql.createConnection(secrets.mysql);

function GetConnection() {
    return connection;
}

function End() {
    connection.end();
}

module.exports = {
    GetConnection,
};
