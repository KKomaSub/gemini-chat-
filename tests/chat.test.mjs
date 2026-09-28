import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onRequestGet, onRequestPost, escapeHtml } from '../functions/api/chat.js';

const clientPath = new URL('../Gemini-Chat-HTML-Viewer.html', import.meta.url);

function fakeGemini(answer = '테스트 응답') {
  return async (url, init) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-goog-api-key'], 'test-key');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
}

test('HTML Viewer client uses absolute HTTPS GET form, not POST', () => {
  const html = fs.readFileSync(clientPath, 'utf8');
  assert.match(html, /action="https:\/\/gemini-chat-no-wifi\.pages\.dev\/api\/chat"/);
  assert.match(html, /method="get"/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /fetch\s*\(/i);
});

test('GET with message calls Gemini and renders answer', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fakeGemini('안녕하세요!');
  try {
    const req = new Request('https://gemini-chat-no-wifi.pages.dev/api/chat?message=%EC%95%88%EB%85%95&history=%5B%5D');
    const res = await onRequestGet({ request: req, env: { GEMINI_API_KEY: 'test-key' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /안녕하세요!/);
    assert.match(html, /method="post"/);
  } finally { globalThis.fetch = oldFetch; }
});

test('GET without message only renders chat page and does not call Gemini', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not call'); };
  try {
    const res = await onRequestGet({ request: new Request('https://example.pages.dev/api/chat'), env: {} });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Gemini Chat/);
  } finally { globalThis.fetch = oldFetch; }
});

test('POST still supports continuing the conversation in browser', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fakeGemini('계속 대화 응답');
  try {
    const body = new URLSearchParams({ message: '두 번째 질문', history: JSON.stringify([{ role: 'user', text: '첫 질문' }, { role: 'model', text: '첫 답변' }]) });
    const req = new Request('https://example.pages.dev/api/chat', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const res = await onRequestPost({ request: req, env: { GEMINI_API_KEY: 'test-key' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /계속 대화 응답/);
  } finally { globalThis.fetch = oldFetch; }
});

test('HTML escaping prevents script injection in rendered content', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});
