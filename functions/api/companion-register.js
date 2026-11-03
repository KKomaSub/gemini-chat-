import { registerCompanion } from '../lib/companionBridge.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const result = await registerCompanion(env, body);
    return Response.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: String(error?.message || error) },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }
}

export function onRequestGet() {
  return Response.json({ ok: true, service: 'companion-register' });
}
