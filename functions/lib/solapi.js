import { sanitizePhone } from './emailBridge.js';

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSolapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = toHex(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(date + salt)
  ));
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function requestSolapi(env, path, payload) {
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET) {
    throw new Error('SOLAPI API credentials are missing');
  }
  const authorization = await createSolapiAuthHeader(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET);
  const response = await fetch(`https://api.solapi.com${path}`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.errorMessage || body?.message || `SOLAPI HTTP ${response.status}`);
  return body;
}

function throwIfMessageRegistrationFailed(result) {
  const failed = Array.isArray(result?.failedMessageList) ? result.failedMessageList : [];
  if (failed.length) {
    const item = failed[0] || {};
    const code = item.statusCode || 'registration_failed';
    const message = item.statusMessage || 'message registration failed';
    throw new Error(`SOLAPI ${code}: ${message}`);
  }

  const count = result?.groupInfo?.count;
  if (count && Number(count.registeredFailed || 0) > 0 && Number(count.registeredSuccess || 0) === 0) {
    throw new Error('SOLAPI registration_failed: no message was registered');
  }
}

export async function uploadMmsJpeg(env, dataBase64, name = 'gemini.jpg') {
  const result = await requestSolapi(env, '/storage/v1/files', {
    file: dataBase64,
    type: 'MMS',
    name: String(name).slice(0, 100),
  });
  if (!result.fileId) throw new Error('SOLAPI storage response did not include fileId');
  return result.fileId;
}

export async function sendSolapiMessage(env, { type, text, imageId = '' }) {
  const to = sanitizePhone(env.SOLAPI_TO);
  const from = sanitizePhone(env.SOLAPI_FROM);
  if (!to || !from) throw new Error('SOLAPI_TO or SOLAPI_FROM is missing');
  const message = { to, from, text, type, autoTypeDetect: false };
  if (type === 'MMS' && imageId) message.imageId = imageId;

  const result = await requestSolapi(env, '/messages/v4/send-many/detail', {
    messages: [message],
    strict: false,
    showMessageList: true,
  });
  throwIfMessageRegistrationFailed(result);
  return result;
}
