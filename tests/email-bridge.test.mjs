import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasMmsMarker,
  stripMmsMarker,
  solapiByteLength,
  truncateSolapi,
} from '../functions/lib/emailBridge.js';
import { onRequestPost } from '../functions/api/inbox.js';

function jsonRequest(payload, secret = 'secret') {
  return new Request('https://example.pages.dev/api/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-email-webhook-secret': secret },
    body: JSON.stringify(payload),
  });
}

const env = {
  EMAIL_WEBHOOK_SECRET: 'secret',
  GEMINI_API_KEY: 'gem-key',
  GEMINI_MODEL: 'gemini-test',
  SOLAPI_API_KEY: 'sol-key',
  SOLAPI_API_SECRET: 'sol-secret',
  SOLAPI_FROM: '01011112222',
  SOLAPI_TO: '01033334444',
};

test('MMS marker is recognized only at the trimmed end', () => {
  assert.equal(hasMmsMarker('사진 만들어줘<mms가능>'), true);
  assert.equal(hasMmsMarker('사진 만들어줘<mms가능>   \n'), true);
  assert.equal(hasMmsMarker('<mms가능> 뒤에 글자'), false);
  assert.equal(stripMmsMarker('사진 만들어줘<mms가능>  '), '사진 만들어줘');
});

test('SMS truncation keeps the three-dot suffix inside the 90-byte budget', () => {
  const out = truncateSolapi('가'.repeat(60), 90);
  assert.ok(solapiByteLength(out) <= 90);
  assert.ok(out.endsWith('...'));
  assert.equal(solapiByteLength('...'), 3);
});

test('inbox rejects the wrong webhook secret', async () => {
  const response = await onRequestPost({ request: jsonRequest({ body: 'hi' }, 'wrong'), env });
  assert.equal(response.status, 401);
});

test('without marker, media is discarded and a long answer is forced into explicit SMS', async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [
        { text: '가'.repeat(60) },
        { inlineData: { mimeType: 'image/jpeg', data: 'AA==' } },
      ] } }] });
    }
    if (String(url).includes('/messages/v4/send-many/detail')) return Response.json({ groupId: 'G1' });
    throw new Error(`unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({ request: jsonRequest({
      messageId: 'm1', to: 'ijunu3343@gmail.com', subject: '질문', body: '길게 설명해줘', attachments: [],
    }), env });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.type, 'SMS');
    assert.ok(result.textBytes <= 90);
    assert.equal(result.attachmentSent, false);
    assert.ok(result.text.endsWith('...'));

    const sent = JSON.parse(calls[1].init.body).messages[0];
    assert.equal(sent.type, 'SMS');
    assert.equal(sent.autoTypeDetect, false);
    assert.equal('imageId' in sent, false);
    assert.ok(solapiByteLength(sent.text) <= 90);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('email attachments are passed to Gemini as inlineData', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      const requestBody = JSON.parse(init.body);
      assert.ok(requestBody.contents[0].parts.some((part) =>
        part.inlineData?.mimeType === 'application/pdf' && part.inlineData?.data === 'JVBERg=='
      ));
      return Response.json({ candidates: [{ content: { parts: [{ text: '파일 확인 완료' }] } }] });
    }
    return Response.json({ groupId: 'G2' });
  };
  try {
    const response = await onRequestPost({ request: jsonRequest({
      messageId: 'm2',
      to: 'ijunu3343@gmail.com',
      subject: 'PDF',
      body: '요약해줘',
      attachments: [{ name: 'a.pdf', mimeType: 'application/pdf', dataBase64: 'JVBERg==', size: 4 }],
    }), env });
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('with marker, text over 90 bytes is LMS instead of truncated SMS', async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [{ text: '가'.repeat(100) }] } }] });
    }
    return Response.json({ groupId: 'G3' });
  };
  try {
    const response = await onRequestPost({ request: jsonRequest({
      messageId: 'm3', to: 'ijunu3343@gmail.com', body: '길게 답해줘<mms가능>', attachments: [],
    }), env });
    const result = await response.json();
    assert.equal(result.type, 'LMS');
    assert.ok(result.textBytes > 90 && result.textBytes <= 2000);
    assert.equal(JSON.parse(calls[1].init.body).messages[0].type, 'LMS');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('with marker and a small JPEG Gemini output, image is uploaded and delivered as MMS', async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return Response.json({ candidates: [{ content: { parts: [
        { text: '이미지입니다.' },
        { inlineData: { mimeType: 'image/jpeg', data: 'AA==' } },
      ] } }] });
    }
    if (String(url).includes('/storage/v1/files')) return Response.json({ fileId: 'FILE123' });
    if (String(url).includes('/messages/v4/send-many/detail')) return Response.json({ groupId: 'G4' });
    throw new Error(`unexpected URL: ${url}`);
  };
  try {
    const response = await onRequestPost({ request: jsonRequest({
      messageId: 'm4', to: 'ijunu3343@gmail.com', body: '그림을 만들어줘<mms가능>', attachments: [],
    }), env: { ...env, GEMINI_MMS_MODEL: 'gemini-image-test' } });
    const result = await response.json();
    assert.equal(result.type, 'MMS');
    assert.equal(result.attachmentSent, true);
    assert.equal(JSON.parse(calls[1].init.body).type, 'MMS');
    const sent = JSON.parse(calls[2].init.body).messages[0];
    assert.equal(sent.type, 'MMS');
    assert.equal(sent.imageId, 'FILE123');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('Apps Script polls target Gmail about every 20 seconds and prevents overlap', () => {
  const source = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.match(source, /ijunu3343@gmail\.com/);
  assert.match(source, /getAttachments\(/);
  assert.match(source, /base64Encode/);
  assert.match(source, /everyMinutes\(1\)/);
  assert.match(source, /POLL_INTERVAL_MS\s*=\s*20000/);
  assert.match(source, /for \(let cycle = 0; cycle < 3; cycle\+\+\)/);
  assert.match(source, /Utilities\.sleep\(waitMs\)/);
  assert.match(source, /LockService\.getScriptLock\(\)/);
  assert.match(source, /tryLock\(1000\)/);
  assert.match(source, /releaseLock\(\)/);
  assert.match(source, /message\.markRead\(\)/);
  assert.match(source, /X-Email-Webhook-Secret/);
});
