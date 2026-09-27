import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  normalizeHistory,
  buildContents,
  extractGeminiText,
  onRequestPost,
} from '../functions/api/chat.js';

test('escapeHtml safely escapes HTML special characters', () => {
  assert.equal(
    escapeHtml(`<script>alert("x")</script>&'`),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;'
  );
});

test('normalizeHistory keeps only valid recent user/model messages', () => {
  const history = [
    { role: 'user', text: 'u1' },
    { role: 'model', text: 'm1' },
    { role: 'bad', text: 'ignored' },
    { role: 'user', text: '' },
  ];
  assert.deepEqual(normalizeHistory(JSON.stringify(history)), [
    { role: 'user', text: 'u1' },
    { role: 'model', text: 'm1' },
  ]);
});

test('buildContents appends the latest user message', () => {
  assert.deepEqual(
    buildContents([{ role: 'user', text: 'hello' }], 'again'),
    [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'user', parts: [{ text: 'again' }] },
    ]
  );
});

test('extractGeminiText joins text parts from the first candidate', () => {
  const payload = {
    candidates: [{ content: { parts: [{ text: 'A' }, { text: 'B' }] } }],
  };
  assert.equal(extractGeminiText(payload), 'AB');
});

test('POST returns an HTML error when API key is missing', async () => {
  const request = new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message: '안녕' }),
  });

  const response = await onRequestPost({ request, env: {} });
  const html = await response.text();
  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(html, /GEMINI_API_KEY/);
});

test('POST calls Gemini and renders user and model messages without client JavaScript', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /gemini-3\.5-flash-lite:generateContent/);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(init.body);
    assert.equal(body.contents.at(-1).parts[0].text, '안녕하세요?');
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '안녕하세요! 무엇을 도와드릴까요?' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const request = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message: '안녕하세요?', history: '[]' }),
    });

    const response = await onRequestPost({
      request,
      env: { GEMINI_API_KEY: 'test-key' },
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /안녕하세요\?/);
    assert.match(html, /안녕하세요! 무엇을 도와드릴까요\?/);
    assert.doesNotMatch(html, /<script\b/i);
    assert.match(html, /<form[^>]+method="post"/i);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
