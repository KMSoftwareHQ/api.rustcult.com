const assert = require('assert');
const fs = require('fs');
const ParseHtml = require('./parse');

describe('ParseHtml', function() {
    it('Parses token & steam ID from a realistic response.', () => {
	const buffer = fs.readFileSync('example-login-response.html');
	const html = buffer.toString();
	const p = ParseHtml(html);
	assert(p.steamId === '86561198054245954');
	assert(p.token === 'eyJzdGVhbUlkIjoiNzY1MjExOTgwNTQyNDU5NTUiLCJpc3MiOjE2Njg3MzU3MzUsImV4cCI6MTY2OTk0NTMzNX0=.NaEEKRijVshN3xFJQ1h5NVORvMt9Wg1BkRxJXkG0WHCsccS3lQlhA7bYTsKQASFrqvG2Zc/pQozvs/m3HDVRCQ==');
    });
});
