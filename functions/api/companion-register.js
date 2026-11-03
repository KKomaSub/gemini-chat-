export function onRequest() { return Response.json({ ok: false, error: 'disabled' }, { status: 410, headers: { 'cache-control': 'no-store' } }); }
