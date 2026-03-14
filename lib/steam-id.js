// Central Steam ID validity check. Steam64 is 17 digits; IDs can be longer.
const MIN_LENGTH = 17;
const MAX_LENGTH = 24;

function isValidSteamId(value) {
    if (value == null) return false;
    const s = String(value).trim();
    if (s.length < MIN_LENGTH || s.length > MAX_LENGTH) return false;
    return /^\d+$/.test(s);
}

module.exports = { isValidSteamId };
