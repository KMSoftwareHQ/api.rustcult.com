// Parses a token & SteamID out of an HTML web page.
// The page is a response after the user logs in to
// the Rust+ companion login page.

function ParseHtml(html) {
    const genericError = { error: `That's not the right text to paste. Please check the instructions above and try again.` };
    if (html.length < 200) {
	return genericError;
    }
    if (html.length > 5000) {
	return genericError;
    }
    const htmlPosition = html.indexOf(`<html`);
    if (htmlPosition < 0) {
	return genericError;
    }
    const steamIdMarker = String.raw`{\"SteamId\":\"`;
    const steamIdPosition = html.indexOf(steamIdMarker);
    if (steamIdPosition < 0) {
	return genericError;
    }
    const steamIdOnwards = html.substring(steamIdPosition + steamIdMarker.length);
    const steamIdEnd = steamIdOnwards.indexOf(`\\`);
    if (steamIdEnd !== 17) {
	return genericError;
    }
    const steamId = steamIdOnwards.substring(0, steamIdEnd);
    const tokenMarker = String.raw`\"Token\":\"`;
    const tokenPosition = html.indexOf(tokenMarker);
    if (tokenPosition < 0) {
	return genericError;
    }
    const tokenOnwards = html.substring(tokenPosition + tokenMarker.length);
    const tokenEnd = tokenOnwards.indexOf(`\\`);
    if (tokenEnd < 0) {
	return genericError;
    }
    const token = tokenOnwards.substring(0, tokenEnd);
    if (token.length < 50 || token.length > 500) {
	return genericError;
    }
    return { steamId, token };
}

// Parses Rust+ config JSON (e.g. from rustplus.js CLI or manual export).
// Expected: { fcm_credentials: { gcm: { androidId, securityToken }, fcm: { token } }, expo_push_token, rustplus_auth_token }
function ParseRustPlusConfig(str) {
    const genericError = { error: 'Invalid Rust+ config JSON. Need fcm_credentials (gcm.androidId, gcm.securityToken, fcm.token), expo_push_token, rustplus_auth_token.' };
    if (!str || typeof str !== 'string') {
	return genericError;
    }
    const trimmed = str.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
	return genericError;
    }
    let data;
    try {
	data = JSON.parse(trimmed);
    } catch (e) {
	return genericError;
    }
    if (!data || typeof data !== 'object') return genericError;
    const creds = data.fcm_credentials;
    if (!creds || !creds.gcm || creds.gcm.androidId == null || creds.gcm.securityToken == null) {
	return { error: 'Config must include fcm_credentials.gcm.androidId and fcm_credentials.gcm.securityToken.' };
    }
    const fcmToken = creds.fcm && creds.fcm.token;
    if (!fcmToken || typeof fcmToken !== 'string') {
	return { error: 'Config must include fcm_credentials.fcm.token.' };
    }
    const expoPushToken = data.expo_push_token;
    if (!expoPushToken || typeof expoPushToken !== 'string') {
	return { error: 'Config must include expo_push_token.' };
    }
    const token = data.rustplus_auth_token;
    if (!token || typeof token !== 'string') {
	return { error: 'Config must include rustplus_auth_token.' };
    }
    const fcmCredentials = {
	gcm: { androidId: String(creds.gcm.androidId), securityToken: String(creds.gcm.securityToken) },
	fcm: { token: fcmToken },
	persistentIds: creds.persistentIds || [],
    };
    if (creds.keys) fcmCredentials.keys = creds.keys;
    return { token, expoPushToken, fcmCredentials };
}

// Parses Rust+ app /credentials line: key:value pairs.
// e.g. gcm_android_id:123 gcm_security_token:456 steam_id:76561198076743352 token:xxx
function ParseCredentialsLine(line) {
    const genericError = { error: 'Invalid credentials line. Use the format from the Rust+ app (e.g. gcm_android_id:... steam_id:...). If the app shows a token, include token:... or auth_token:...' };
    if (!line || typeof line !== 'string') {
	return genericError;
    }
    let trimmed = line.trim().replace(/^\/?credentials\s+add\s+/i, '').trim();
    if (trimmed.length < 20) {
	return genericError;
    }
    const pairs = {};
    const regex = /(\w+):([^\s]+)/g;
    let m;
    while ((m = regex.exec(trimmed)) !== null) {
	pairs[m[1]] = m[2];
    }
    const steamId = pairs.steam_id || pairs.steamId;
    if (!steamId || steamId.length !== 17) {
	return { error: 'Credentials line must include steam_id (17 digits).' };
    }
    let token = pairs.token || pairs.auth_token;
    if (!token && pairs.gcm_security_token) {
	token = String(pairs.gcm_security_token);
    }
    if (!token || token.length < 10) {
	return { error: 'Credentials line must include token, auth_token, or gcm_security_token.' };
    }
    return { steamId, token };
}

module.exports = ParseHtml;
module.exports.ParseCredentialsLine = ParseCredentialsLine;
module.exports.ParseRustPlusConfig = ParseRustPlusConfig;
