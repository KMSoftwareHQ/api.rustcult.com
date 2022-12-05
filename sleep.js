function Sleep(ms) {
    return new Promise((resolve, reject) => {
	setTimeout(() => {
	    resolve();
	}, ms);
    });
}

module.exports = Sleep;
