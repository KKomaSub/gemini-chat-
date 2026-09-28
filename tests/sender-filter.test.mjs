import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/inbox.js';

const env = {
  EMAIL_WEBHOOK_SECRET: 'secret',
  GEMINI_API_KEY: 'gem-key',
  GEMINI_MODEL: 'gemini-test',
  SOLAPI_API_KEY: 'sol-key',
  SOLAPI_API_SECRET: 'sol-secret',
  SOLAPI_FROM: '01011112222',
  SOLAPI_TO: '01033334444',
  GEMINI_RETRY_BASE_MS: '0',
};

function request(from) {
  return new Request('https://example.pages.dev/api/inbox', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-email-webhook-secret': 'secret',
    },
    body: JSON.stringify({
      messageId: 'sender-test',
      from,
      to: 'ijunu3343@gmail.com',
      subject: 'test',
      body: '안녕',
      attachments: [],
    }),
  });
}

test('wrong sender is rejected before Gemini or SOLAPI is called', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('fetch must not be called for a rejected sender');
  };
  try {
    const response = await onRequestPost({ request: request('other@example.com'), env });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.error, 'sender_not_allowed');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('allowed vmms sender reaches Gemini and SOLAPI', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [{ text: '확인' }] } }] });
    }
    if (String(url).includes('api.solapi.com')) {
      return Response.json({ groupId: 'SG1' });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const response = await onRequestPost({
      request: request('휴대폰 <01082161403@vmms.nate.com>'),
      env,
    });
    assert.equal(response.status, 200);
    assert.ok(calls.some((url) => url.includes('generativelanguage.googleapis.com')));
    assert.ok(calls.some((url) => url.includes('api.solapi.com')));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('an email address containing 01082161403 is also allowed', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [{ text: '확인' }] } }] });
    }
    return Response.json({ groupId: 'SG2' });
  };
  try {
    const response = await onRequestPost({
      request: request('sender01082161403@example.com'),
      env,
    });
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
