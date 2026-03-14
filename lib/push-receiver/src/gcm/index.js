const path = require('path');
const rp = require('request-promise');
const protobuf = require('protobufjs');
const Long = require('long');
const { waitFor } = require('../utils/timeout');
const fcmKey = require('../fcm/server-key');
const { toBase64 } = require('../utils/base64');

// Hack to fix PHONE_REGISTRATION_ERROR #17 when bundled with webpack
// https://github.com/dcodeIO/protobuf.js#browserify-integration
protobuf.util.Long = Long
protobuf.configure()

const defaultServerKey = toBase64(Buffer.from(fcmKey));

const REGISTER_URL = 'https://android.clients.google.com/c2dm/register3';
const CHECKIN_URL = 'https://android.clients.google.com/checkin';

let root;
let AndroidCheckinResponse;

module.exports = {
  register,
  checkIn,
};

async function register(appId, config) {
  const options = await checkIn();
  const credentials = await doRegister(options, appId, config);
  return credentials;
}

async function checkIn(androidId, securityToken) {
  await loadProtoFile();
  const buffer = getCheckinRequest(androidId, securityToken);
  let body;
  try {
    body = await rp({
      url     : CHECKIN_URL,
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/x-protobuf',
      },
      body     : buffer,
      encoding : null,
    });
  } catch (e) {
    console.warn('[GCM] checkin failed:', e.statusCode || e.code || e.message);
    throw e;
  }
  const message = AndroidCheckinResponse.decode(body);
  const object = AndroidCheckinResponse.toObject(message, {
    longs : String,
    enums : String,
    bytes : String,
  });
  return object;
}

async function doRegister({ androidId, securityToken }, appId, config) {
  const sender = (config && config.senderId) ? String(config.senderId) : defaultServerKey;
  const body = {
    app         : 'org.chromium.linux',
    'X-subtype' : appId,
    device      : androidId,
    sender      : sender,
  };
  const response = await postRegister({ androidId, securityToken, body });
  const token = response.split('=')[1];
  return {
    token,
    androidId,
    securityToken,
    appId,
  };
}

async function postRegister({ androidId, securityToken, body }, retryCount = 0) {
  let response;
  try {
    response = await rp({
      url     : REGISTER_URL,
      method  : 'POST',
      headers : {
        Authorization  : `AidLogin ${androidId}:${securityToken}`,
        'Content-Type' : 'application/x-www-form-urlencoded',
      },
      form : body,
    });
  } catch (e) {
    console.warn('[GCM] register3 failed:', e.statusCode || e.code || e.message);
    throw e;
  }
  if (response.includes('Error')) {
    console.warn(`[GCM] Register response: ${response}`);
    if (retryCount >= 5) {
      throw new Error('GCM register has failed');
    }
    console.warn(`[GCM] Retry... ${retryCount + 1}`);
    await waitFor(1000);
    return postRegister({ androidId, securityToken, body }, retryCount + 1);
  }
  return response;
}

async function loadProtoFile() {
  if (root) {
    return;
  }
  root = await protobuf.load(path.join(__dirname, 'checkin.proto'));
  return root;
}

function getCheckinRequest(androidId, securityToken) {
  const AndroidCheckinRequest = root.lookupType(
    'checkin_proto.AndroidCheckinRequest'
  );
  AndroidCheckinResponse = root.lookupType(
    'checkin_proto.AndroidCheckinResponse'
  );
  const payload = {
    userSerialNumber : 0,
    checkin          : {
      type        : 3,
      chromeBuild : {
        platform      : 2,
        chromeVersion : '63.0.3234.0',
        channel       : 1,
      },
    },
    version       : 3,
    id            : androidId ? Long.fromString(androidId) : undefined,
    securityToken : securityToken
      ? Long.fromString(securityToken, true)
      : undefined,
  };
  const errMsg = AndroidCheckinRequest.verify(payload);
  if (errMsg) throw Error(errMsg);
  const message = AndroidCheckinRequest.create(payload);
  return AndroidCheckinRequest.encode(message).finish();
}
