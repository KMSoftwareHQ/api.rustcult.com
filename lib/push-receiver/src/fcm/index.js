const crypto = require('crypto');
const request = require('request-promise');
const { escape } = require('../utils/base64');

const FIREBASE_INSTALLATIONS = 'https://firebaseinstallations.googleapis.com/v1/';
const FCM_REGISTRATION = 'https://fcmregistrations.googleapis.com/v1/';
const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send';

module.exports = { installFCM, registerFCMV2, createKeys };

function generateFirebaseFID() {
  const fid = crypto.randomBytes(17);
  fid[0] = 0b01110000 + (fid[0] % 0b00010000);
  return fid.toString('base64');
}

function createKeys() {
  return new Promise((resolve, reject) => {
    const dh = crypto.createECDH('prime256v1');
    dh.generateKeys();
    crypto.randomBytes(16, (err, buf) => {
      if (err) return reject(err);
      resolve({
        privateKey : escape(dh.getPrivateKey('base64')),
        publicKey  : escape(dh.getPublicKey('base64')),
        authSecret : escape(buf.toString('base64')),
      });
    });
  });
}

async function installFCM(config) {
  const url = `${FIREBASE_INSTALLATIONS}projects/${config.firebase.projectID}/installations`;
  const body = JSON.stringify({
    appId       : config.firebase.appID,
    authVersion : 'FIS_v2',
    fid         : generateFirebaseFID(),
    sdkVersion  : 'w:0.6.4',
  });
  const xFirebaseClient = Buffer.from(
    JSON.stringify({ heartbeats : [], version : 2 })
  ).toString('base64');
  const response = await request({
    url,
    method  : 'POST',
    headers : {
      'x-firebase-client' : xFirebaseClient,
      'x-goog-api-key'    : config.firebase.apiKey,
      'Content-Type'      : 'application/json',
    },
    body,
  });
  return JSON.parse(response);
}

function getInstallationAuthToken(installation) {
  if (installation.authToken && typeof installation.authToken.token === 'string') {
    return installation.authToken.token;
  }
  if (typeof installation.authToken === 'string') return installation.authToken;
  if (typeof installation.token === 'string') return installation.token;
  return null;
}

async function registerFCMV2(config, subscription) {
  const keys = await createKeys();
  const installation = await installFCM(config);
  const authToken = getInstallationAuthToken(installation);
  if (!authToken) {
    throw new Error('FCM installation did not return auth token');
  }
  const url = `${FCM_REGISTRATION}projects/${config.firebase.projectID}/registrations`;
  const body = JSON.stringify({
    web : {
      applicationPubKey : config.vapidKey || '',
      auth               : keys.authSecret
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_'),
      endpoint : `${FCM_ENDPOINT}/${subscription.token}`,
      p256dh   : keys.publicKey
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_'),
    },
  });
  const response = await request({
    url,
    method  : 'POST',
    headers : {
      'x-goog-api-key'                 : config.firebase.apiKey,
      'x-goog-firebase-installations-auth' : authToken,
      'Content-Type'                   : 'application/json',
    },
    body,
  });
  const fcm = JSON.parse(response);
  return {
    keys,
    fcm : Object.assign({ token : subscription.token }, fcm),
  };
}
