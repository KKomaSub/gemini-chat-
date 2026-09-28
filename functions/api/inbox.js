import { processEmailBridge } from '../lib/emailProcessor.js';

export async function onRequestPost({ request, env }) {
  if (!env.EMAIL_WEBHOOK_SECRET || request.headers.get('x-email-webhook-secret') !== env.EMAIL_WEBHOOK_SECRET) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await processEmailBridge(env, await request.json());
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, error: String(error?.message || error) }, { status: 502 });
  }
}

export function onRequestGet() {
  return Response.json({ ok: true });
}
