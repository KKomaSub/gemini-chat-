import { createGatewayBootstrap } from '../lib/gatewayRelay.js';

export async function onRequestGet({ env }) {
  try {
    const envelope = await createGatewayBootstrap(env);
    return Response.json(envelope, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json({ ok: false, error: String(error?.message || error) }, { status: 503 });
  }
}
