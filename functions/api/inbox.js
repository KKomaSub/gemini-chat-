import { processEmailBridge } from '../lib/emailProcessor.js';

const ALLOWED_SENDER_NUMBER = '01082161403';
const ALLOWED_SENDER_EMAIL = '01082161403@vmms.nate.com';

function extractEmailAddress(value) {
  const raw = String(value || '').trim().toLowerCase();
  const bracketed = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (bracketed) return bracketed[1];
  const plain = raw.match(/([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  return plain ? plain[1].toLowerCase() : '';
}

export function isAllowedSender(value) {
  const email = extractEmailAddress(value);
  if (!email) return false;
  return email === ALLOWED_SENDER_EMAIL || email.includes(ALLOWED_SENDER_NUMBER);
}

export async function onRequestPost({ request, env }) {
  if (!env.EMAIL_WEBHOOK_SECRET || request.headers.get('x-email-webhook-secret') !== env.EMAIL_WEBHOOK_SECRET) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Apps Script always supplies `from`. Keep legacy/manual test requests that omit
  // it compatible, but reject every supplied sender that is not the phone address.
  if (payload?.from && !isAllowedSender(payload.from)) {
    return Response.json({ ok: false, error: 'sender_not_allowed' }, { status: 403 });
  }

  try {
    const result = await processEmailBridge(env, payload);
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, error: String(error?.message || error) }, { status: 502 });
  }
}

export function onRequestGet() {
  return Response.json({ ok: true });
}
