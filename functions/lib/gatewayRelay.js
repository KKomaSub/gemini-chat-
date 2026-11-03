import { GATEWAY_PUBLIC_KEY_B64 } from './gatewayPublicKey.js';

function bytesToBase64Url(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(message)
  ));
}

export async function deriveGatewaySecrets(env) {
  if (!env.EMAIL_WEBHOOK_SECRET) throw new Error('EMAIL_WEBHOOK_SECRET is missing');
  const topicBytes = await hmac(env.EMAIL_WEBHOOK_SECRET, 'gateway-topic-v1');
  const authKey = await hmac(env.EMAIL_WEBHOOK_SECRET, 'gateway-auth-v1');
  return {
    topic: `gmgw-${hex(topicBytes).slice(0, 48)}`,
    authKey,
  };
}

async function importGatewayPublicKey(publicKeyB64 = GATEWAY_PUBLIC_KEY_B64) {
  if (!publicKeyB64) throw new Error('Gateway APK has not been built yet');
  const der = base64UrlToBytes(publicKeyB64);
  return crypto.subtle.importKey(
    'spki', der,
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
  );
}

export async function encryptGatewayPayload(payload, publicKeyB64 = GATEWAY_PUBLIC_KEY_B64) {
  const publicKey = await importGatewayPublicKey(publicKeyB64);
  const aesRaw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', aesRaw, 'AES-GCM', false, ['encrypt']);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plain);
  const ek = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, aesRaw);
  return {
    v: 1,
    ek: bytesToBase64Url(ek),
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(ct),
  };
}

function canonical(envelope) {
  return `${envelope.v}.${envelope.ek}.${envelope.iv}.${envelope.ct}`;
}

export async function createGatewayBootstrap(env) {
  const { topic, authKey } = await deriveGatewaySecrets(env);
  return encryptGatewayPayload({
    v: 1,
    topic,
    authKey: bytesToBase64Url(authKey),
  });
}

export async function publishGatewayTask(env, task) {
  const { topic, authKey } = await deriveGatewaySecrets(env);
  const payload = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...task,
  };
  const envelope = await encryptGatewayPayload(payload);
  const hmacKey = await crypto.subtle.importKey(
    'raw', authKey,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  envelope.sig = bytesToBase64Url(await crypto.subtle.sign(
    'HMAC', hmacKey, new TextEncoder().encode(canonical(envelope))
  ));

  const response = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic,
      message: JSON.stringify(envelope),
      priority: 5,
      tags: ['gateway'],
    }),
  });
  if (!response.ok) throw new Error(`gateway relay HTTP ${response.status}`);
  return { id: payload.id, topic };
}

export { base64UrlToBytes };
