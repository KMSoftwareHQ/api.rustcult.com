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

// Parses Rust+ app /credentials line: key:value pairs.
// e.g. gcm_android_id:123 gcm_security_token:456 steam_id:76561198076743352 token:xxx
function ParseCredentialsLine(line) {
    const genericError = { error: 'Invalid credentials line. Paste the line from Rust++ credentials (it must include steam_id and token/auth_token).' };
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
    // Rust+ auth token is not the same as gcm_security_token; require token/auth_token here.
    let token = pairs.token || pairs.auth_token;
    if (!token || token.length < 10) {
	return { error: 'Credentials line must include token or auth_token.' };
    }
    return { steamId, token };
}

module.exports = ParseHtml;
module.exports.ParseCredentialsLine = ParseCredentialsLine;
