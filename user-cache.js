const db = require('./database');
const moment = require('moment');

const MYSQL_DATETIME = 'YYYY-MM-DD HH:mm:ss';

class User {
    constructor(databaseRow) {
	this.incrementingId = databaseRow.incrementing_id;
	this.steamId = databaseRow.steam_id;
	this.steamName = databaseRow.steam_name;
	this.profileUrl = databaseRow.profile_url;
	this.avatar = databaseRow.avatar;
	this.avatarMedium = databaseRow.avatar_medium;
	this.avatarFull = databaseRow.avatar_full;
	this.accountTimeCreated = databaseRow.account_time_created;
	this.lastMovementTime = databaseRow.last_movement_time;
	this.lastBaseDetectionTime = databaseRow.last_base_detection_time;
	this.isOwner = databaseRow.is_owner;
	this.isHighPriest = databaseRow.is_high_priest;
	this.isCultMember = databaseRow.is_cult_member;
	this.discordId = databaseRow.discord_id;
	this.discordUsername = databaseRow.discord_username;
	this.lastSeenAliveTime = databaseRow.last_seen_alive_time;
	this.lastSeenAliveServer = databaseRow.last_seen_alive_server;
	this.lastSeenAliveX = databaseRow.last_seen_alive_x;
	this.lastSeenAliveY = databaseRow.last_seen_alive_y;
	this.breadcrumbTime = databaseRow.breadcrumb_time;
	this.breadcrumbX = databaseRow.breadcrumb_x;
	this.breadcrumbY = databaseRow.breadcrumb_y;
    }
    
    async SetSteamName(steamName) {
	if (steamName === this.steamName) {
	    return;
	}
	this.steamName = steamName;
	await db.Query('UPDATE users SET steam_name = ? WHERE steam_id = ?', [this.steamName, this.steamId]);
    }

    async SetProfileUrl(profileUrl) {
	if (profileUrl === this.profileUrl) {
	    return;
	}
	this.profileUrl = profileUrl;
	await db.Query('UPDATE users SET profile_url = ? WHERE steam_id = ?', [this.profileUrl, this.steamId]);
    }

    async SetAvatar(avatar) {
	if (avatar === this.avatar) {
	    return;
	}
	this.avatar = avatar;
	await db.Query('UPDATE users SET avatar = ? WHERE steam_id = ?', [this.avatar, this.steamId]);
    }

    async SetAvatarMedium(avatarMedium) {
	if (avatarMedium === this.avatarMedium) {
	    return;
	}
	this.avatarMedium = avatarMedium;
	await db.Query('UPDATE users SET avatar_medium = ? WHERE steam_id = ?', [this.avatarMedium, this.steamId]);
    }

    async SetAvatarFull(avatarFull) {
	if (avatarFull === this.avatarFull) {
	    return;
	}
	this.avatarFull = avatarFull;
	await db.Query('UPDATE users SET avatar_full = ? WHERE steam_id = ?', [this.avatarFull, this.steamId]);
    }

    async SetAccountTimeCreated(accountTimeCreated) {
	if (accountTimeCreated === this.accountTimeCreated) {
	    return;
	}
	this.accountTimeCreated = accountTimeCreated;
	await db.Query('UPDATE users SET account_time_created = ? WHERE steam_id = ?', [this.accountTimeCreated, this.steamId]);
    }

    async SetHighPriest(isHighPriest) {
	if (isHighPriest === this.isHighPriest) {
	    return;
	}
	this.isHighPriest = isHighPriest;
	await db.Query('UPDATE users SET is_high_priest = ? WHERE steam_id = ?', [this.isHighPriest, this.steamId]);
    }

    async SetCultMember(isCultMember) {
	if (isCultMember === this.isCultMember) {
	    return;
	}
	this.isCultMember = isCultMember;
	await db.Query('UPDATE users SET is_cult_member = ? WHERE steam_id = ?', [this.isCultMember, this.steamId]);
    }

    async SetDiscordId(discordId) {
	if (discordId === this.discordId) {
	    return;
	}
	this.discordId = discordId;
	await db.Query('UPDATE users SET discord_id = ? WHERE steam_id = ?', [this.discordId, this.steamId]);
    }

    async SetDiscordUsername(discordUsername) {
	if (discordUsername === this.discordUsername) {
	    return;
	}
	this.discordUsername = discordUsername;
	await db.Query('UPDATE users SET discord_username = ? WHERE steam_id = ?', [this.discordUsername, this.steamId]);
    }

    async SetLastMovementTime() {
	this.lastMovementTime = moment().format();
	const t = moment().format(MYSQL_DATETIME);
	await db.Query('UPDATE users SET last_movement_time = ? WHERE steam_id = ?', [t, this.steamId]);
    }

    async SetLastBaseDetectionTime() {
	this.lastBaseDetectionTime = moment().format();
	const t = moment().format(MYSQL_DATETIME);
	await db.Query('UPDATE users SET last_base_detection_time = ? WHERE steam_id = ?', [t, this.steamId]);
    }

    async SetLastSeenAlive(server, x, y) {
	const t = moment().format();
	const tSql = moment().format(MYSQL_DATETIME);
	const breadcrumbDistance = 10;
	if (!this.breadcrumbTime ||
	    !this.breadcrumbX ||
	    !this.breadcrumbY ||
	    this.lastSeenAliveServer !== server ||
	    Math.abs(x - this.breadcrumbX) > breadcrumbDistance ||
	    Math.abs(y - this.breadcrumbY) > breadcrumbDistance) {
	    this.breadcrumbTime = t;
	    this.breadcrumbX = x;
	    this.breadcrumbY = y;
	}
	this.lastSeenAliveTime = t;
	this.lastSeenAliveServer = server;
	this.lastSeenAliveX = x;
	this.lastSeenAliveY = y;
	const breadcrumbTimeSql = this.breadcrumbTime ? moment(this.breadcrumbTime).unix() : null;
	const sql = ('UPDATE users SET ' +
		     'last_seen_alive_time = ?, ' +
		     'last_seen_alive_server = ?, ' +
		     'last_seen_alive_x = ?, ' +
		     'last_seen_alive_y = ?, ' +
		     'breadcrumb_time = ?, ' +
		     'breadcrumb_x = ?, ' +
		     'breadcrumb_y = ? ' +
		     'WHERE steam_id = ?');
	const values = [tSql, server, x, y, breadcrumbTimeSql, this.breadcrumbX, this.breadcrumbY, this.steamId];
	await db.Query(sql, values);
    }

    GetSecondsSinceBreadcrumb() {
	const currentEpoch = moment().unix();
	if (!this.breadcrumbTime) {
	    return currentEpoch;
	}
	const breadcrumbEpoch = typeof this.breadcrumbTime === 'number'
	    ? this.breadcrumbTime
	    : moment(this.breadcrumbTime).unix();
	return currentEpoch - breadcrumbEpoch;
    }

    GetSecondsSinceLastMovement() {
	const currentEpoch = moment().unix();
	if (!this.lastMovementTime) {
	    return currentEpoch;
	}
	const lastMovementEpoch = moment(this.lastMovementTime).unix();
	return currentEpoch - lastMovementEpoch;
    }

    // Updates the fields in this cached user, and also the database, based on the record of a logged-in Steam user.
    async UpdateBasedOnSteamUserRecord(reqUser) {
	if (reqUser.id !== this.steamId) {
	    throw 'User steam IDs have to match to update a user record.';
	}
	if (reqUser.displayName) {
	    if (!this.steamName) {
		await this.SetSteamName(reqUser.displayName);
	    }
	}
	const json = reqUser._json;
	if (!json) {
	    return;
	}
	if (json.profileurl) {
	    await this.SetProfileUrl(json.profileurl);
	}
	if (json.avatar) {
	    await this.SetAvatar(json.avatar);
	}
	if (json.avatarmedium) {
	    await this.SetAvatarMedium(json.avatarmedium);
	}
	if (json.avatarfull) {
	    await this.SetAvatarFull(json.avatarfull);
	}
	if (json.timecreated) {
	    try {
		const timeCreatedSeconds = parseInt(json.timecreated);
		await this.SetAccountTimeCreated(json.timecreated);
	    } catch (error) {
		// Do nothing I guess. Not a problem at this stage of development.
	    }
	}
    }
}

let usersBySteamId = {};

// Must call this to populate the cache from the database.
async function Initialize() {
    const newCache = {};
    const results = await db.Query('SELECT * from users');
    for (const row of results) {
	const user = new User(row);
	newCache[user.steamId] = user;
    }
    usersBySteamId = newCache;
}

async function CreateNewDatabaseUser(reqUser) {
    const steamId = reqUser.id;
    console.log(`Creating new database user with steamid ${steamId}`);
    await db.Query('INSERT INTO users (steam_id) VALUES (?)', [steamId]);
    const results = await db.Query('SELECT * FROM users where steam_id = ?', [steamId]);
    if (results.length !== 1) {
	throw 'Got back 2 matching users after creating a new database user. This should not happen.';
    }
    const row = results[0];
    const user = new User(row);
    await user.UpdateBasedOnSteamUserRecord(reqUser);
    usersBySteamId[steamId] = user;
    return user;
}

// Gets a user from the database cache. If no user with the same ID exists, then one is created.
async function GetOrCreateUserFromSteamAuth(reqUser) {
    const steamId = reqUser.id;
    const cachedUser = usersBySteamId[steamId];
    if (cachedUser) {
	return cachedUser;
    } else {
	return await CreateNewDatabaseUser(reqUser);
    }
}

// Gets a user from the database cache. If no user with the same ID exists, then one is created.
async function GetOrCreateUserBySteamId(steamId) {
    const cachedUser = usersBySteamId[steamId];
    if (cachedUser) {
	return cachedUser;
    } else {
	const fakeReqUser = { id: steamId };
	return await CreateNewDatabaseUser(fakeReqUser);
    }
}

// Gets a user from the database cache by steam ID. Return null if no such user exists.
function GetUserBySteamId(steamId) {
    return usersBySteamId[steamId] || null;
}

// Gets a random user.
function GetRandomUser() {
    const keys = Object.keys(usersBySteamId);
    const n = keys.length;
    const r = Math.floor(Math.random() * n);
    const k = keys[r];
    return usersBySteamId[k];
}

// For debugging purposes.
function LogAllUsers() {
    const numUsers = Object.keys(usersBySteamId).length;
    console.log(`Logging all users from the cache (${numUsers})`);
    for (const steamId in usersBySteamId) {
	const user = usersBySteamId[steamId];
	console.log(user.steamId, user.steamName);
    }
}

function GetAllUsersAsAShallowCopiedList() {
    const c = [];
    for (const steamId in usersBySteamId) {
	const user = usersBySteamId[steamId];
	c.push(user);
    }
    return c;
}

function GetCultMemberSteamIds() {
    const c = [];
    for (const steamId in usersBySteamId) {
	const user = usersBySteamId[steamId];
	if (user.isCultMember) {
	    c.push(user.steamId);
	}
    }
    return c;
}

function GetAllDiscordAccounts() {
    const c = [];
    for (const steamId in usersBySteamId) {
	const user = usersBySteamId[steamId];
	if (user.discordId) {
	    c.push(user);
	}
    }
    return c;
}

module.exports = {
    GetAllDiscordAccounts,
    GetAllUsersAsAShallowCopiedList,
    GetCultMemberSteamIds,
    GetOrCreateUserBySteamId,
    GetOrCreateUserFromSteamAuth,
    GetRandomUser,
    GetUserBySteamId,
    Initialize,
    LogAllUsers,
};
