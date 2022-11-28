const db = require('./database');

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

    // Updates the fields in this cached user, and also the database, based on the record of a logged-in Steam user.
    async UpdateBasedOnSteamUserRecord(reqUser) {
	if (reqUser.id !== this.steamId) {
	    throw 'User steam IDs have to match to update a user record.';
	}
	await this.SetSteamName(reqUser.displayName);
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
async function GetUser(reqUser) {
    const steamId = reqUser.id;
    const cachedUser = usersBySteamId[steamId];
    if (cachedUser) {
	return cachedUser;
    } else {
	return await CreateNewDatabaseUser(reqUser);
    }
}

module.exports = {
    GetUser,
    Initialize,
};
