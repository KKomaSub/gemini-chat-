const NTFY_BASE = 'https://ntfy.sh';
const REG_PREFIX = 'gcb-reg-';
const ACTIVE_SECONDS = 20 * 60;

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value))
  ));
}

async function registrationTopic(env) {
  if (!env.EMAIL_WEBHOOK_SECRET) throw new Error('EMAIL_WEBHOOK_SECRET is missing');
  const digest = await sha256Bytes('companion-register:' + env.EMAIL_WEBHOOK_SECRET);
  return REG_PREFIX + bytesToHex(digest).slice(0, 48);
}

async function deriveSessionKey(env, deviceId, topic) {
  if (!env.EMAIL_WEBHOOK_SECRET) throw new Error('EMAIL_WEBHOOK_SECRET is missing');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.EMAIL_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`companion-session:${deviceId}:${topic}`)
  );
  return new Uint8Array(sig);
}

function validToken(value, min, max) {
  return typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

async function readRegistrationRecords(env, since = '20m') {
  const topic = await registrationTopic(env);
  const url = `${NTFY_BASE}/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`;
  const response = await fetch(url, { headers: { accept: 'application/x-ndjson,application/json' } });
  if (!response.ok) return [];

  const text = await response.text();
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.event !== 'message' || !event?.message) continue;
      const record = JSON.parse(event.message);
      if (record?.kind !== 'companion-register') continue;
      if (!validToken(record.deviceId, 16, 100)) continue;
      if (!validToken(record.topic, 20, 100)) continue;
      rows.push({ ...record, time: Number(event.time || record.registeredAt || 0) });
    } catch {}
  }
  return rows.sort((a, b) => b.time - a.time);
}

async function publishRegistration(env, record) {
  const topic = await registrationTopic(env);
  const response = await fetch(`${NTFY_BASE}/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-title': 'companion-register',
      'x-priority': '1',
    },
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new Error(`ntfy register HTTP ${response.status}`);
}

export async function registerCompanion(env, input = {}) {
  const deviceId = String(input.deviceId || '').trim();
  const topic = String(input.topic || '').trim();

  if (!validToken(deviceId, 16, 100) || !validToken(topic, 20, 100)) {
    throw new Error('invalid companion identity');
  }

  const now = Math.floor(Date.now() / 1000);
  const records = await readRegistrationRecords(env, '20m');
  const active = records.find((item) => now - Number(item.time || 0) <= ACTIVE_SECONDS);

  if (active && active.deviceId !== deviceId) {
    const error = new Error('another companion device is already active');
    error.code = 'companion_already_active';
    throw error;
  }

  const record = {
    kind: 'companion-register',
    deviceId,
    topic,
    registeredAt: now,
    appVersion: String(input.appVersion || '').slice(0, 40),
  };
  await publishRegistration(env, record);

  const sessionKey = await deriveSessionKey(env, deviceId, topic);
  return {
    ok: true,
    deviceId,
    topic,
    sessionKey: bytesToBase64(sessionKey),
    heartbeatSeconds: 300,
  };
}

export async function getActiveCompanion(env) {
  const now = Math.floor(Date.now() / 1000);
  const records = await readRegistrationRecords(env, '20m');
  const active = records.find((item) => now - Number(item.time || 0) <= ACTIVE_SECONDS);
  if (!active) throw new Error('companion_unavailable');
  return active;
}

async function encryptJob(keyBytes, job) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(job));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  return {
    v: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
}

function cleanRecipient(value) {
  return String(value || '').replace(/\D/g, '');
}

export async function dispatchCompanionMedia(env, input = {}) {
  const active = await getActiveCompanion(env);
  const url = String(input.url || '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('invalid media URL');

  const recipient = cleanRecipient(input.to || '01082161403');
  if (!recipient) throw new Error('invalid companion recipient');

  const job = {
    id: crypto.randomUUID(),
    kind: 'media',
    to: recipient,
    url,
    title: String(input.title || '').slice(0, 500),
    mimeType: String(input.mimeType || '').slice(0, 100),
    createdAt: Date.now(),
  };

  const sessionKey = await deriveSessionKey(env, active.deviceId, active.topic);
  const envelope = await encryptJob(sessionKey, job);

  const response = await fetch(`${NTFY_BASE}/${encodeURIComponent(active.topic)}`, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-title': 'media-job',
      'x-priority': '5',
    },
    body: JSON.stringify(envelope),
  });
  if (!response.ok) throw new Error(`ntfy job HTTP ${response.status}`);

  return {
    ok: true,
    queued: true,
    jobId: job.id,
    deviceId: active.deviceId,
  };
}
