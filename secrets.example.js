// Copy to secrets.js and set values. Do not commit secrets.js.
module.exports = {
    mysql: {
	host: 'localhost',
	user: 'rustcult',
	password: 'CHANGE_ME',
	database: 'rustcult',
    },
    steamWebApiKey: 'CHANGE_ME',
    sessionSecretString: 'CHANGE_ME',
    baseUrl: 'https://thevillage.kmsoftware.net',
    cookieDomain: 'thevillage.kmsoftware.net',
    discordClientId: 'CHANGE_ME',
    discordClientSecret: 'CHANGE_ME',
    getalldiscordaccountsToken: 'CHANGE_ME',
    sslKeyPath: '/etc/letsencrypt/live/thevillage.kmsoftware.net/privkey.pem',
    sslCertPath: '/etc/letsencrypt/live/thevillage.kmsoftware.net/fullchain.pem',
    httpPort: 80,
    httpsPort: 443,
    // FCM v2 (push-receiver-v2). Must match Rust+ companion app.
    // projectID is often 'rust-companion-app'; apiKey/appID from APK (see docs/FIREBASE_CONFIG.md).
    fcm: {
	firebase: {
	    apiKey: 'CHANGE_ME',
	    appID: 'CHANGE_ME',
	    projectID: 'rust-companion-app',
	},
	vapidKey: '',
    },
    // Optional: path to saved FCM credentials JSON (push-receiver-v2 format). If set, pairing uses these instead of registering with GCM (avoids PHONE_REGISTRATION_ERROR).
    // fcmCredentialsPath: '/path/to/push-receiver-v2-credentials.json',
};
