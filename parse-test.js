const assert = require('assert');
const fs = require('fs');
const ParseHtml = require('./parse');

describe('ParseHtml', function() {
    it('Parses HTML.', () => {
	const html = fs.readFileSync('example-login-response.html');
	const p = ParseHtml(html);
	assert(p === 'abc');
    });
});
