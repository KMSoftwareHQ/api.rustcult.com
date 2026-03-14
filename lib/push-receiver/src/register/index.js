const uuidv4 = require('uuid/v4');
const { register: registerGCM } = require('../gcm');
const { registerFCMV2 } = require('../fcm');

module.exports = register;

async function register(config) {
  if (!config || !config.firebase || typeof config.firebase !== 'object') {
    throw new Error('register(config) requires config.firebase with apiKey, appID, projectID');
  }
  const { apiKey, appID, projectID } = config.firebase;
  if (!apiKey || !appID || !projectID) {
    const missing = [];
    if (!apiKey) missing.push('apiKey');
    if (!appID) missing.push('appID');
    if (!projectID) missing.push('projectID');
    throw new Error('config.firebase missing: ' + missing.join(', '));
  }
  const appId = `wp:receiver.push.com#${uuidv4()}`;
  const subscription = await registerGCM(appId, config);
  const result = await registerFCMV2(config, subscription);
  return Object.assign({}, result, { gcm : subscription });
}
