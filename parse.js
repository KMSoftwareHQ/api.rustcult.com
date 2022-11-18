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

module.exports = ParseHtml;
