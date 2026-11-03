import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRedditSearchResults,
  parseRedditCommand,
} from '../functions/lib/reddit.js';
import { processEmailBridge } from '../functions/lib/emailProcessor.js';

const env = {
  GEMINI_API_KEY: 'gem-key',
  SOLAPI_API_KEY: 'sol-key',
  SOLAPI_API_SECRET: 'sol-secret',
  SOLAPI_FROM: '01011112222',
  SOLAPI_TO: '01033334444',
};

test('Reddit command parser recognizes list and numbered attachment commands', () => {
  assert.deepEqual(parseRedditCommand('고양이 r검색결과'), {
    kind: 'list',
    query: '고양이',
  });
  assert.deepEqual(parseRedditCommand('고양이 사진 r2결과'), {
    kind: 'attachment',
    query: '고양이 사진',
    index: 2,
  });
  assert.equal(parseRedditCommand('일반 질문'), null);
  assert.equal(parseRedditCommand('r검색결과'), null);
  assert.equal(parseRedditCommand('고양이 r0결과'), null);
});

test('MMS-list formatter numbers every result and reports attachment presence', () => {
  assert.equal(
    formatRedditSearchResults([
      { title: '첫 번째', hasAttachment: true },
      { title: '두 번째', hasAttachment: false },
    ], true),
    '1번 첫 번째 (첨부파일: 있음)\n2번 두 번째 (첨부파일: 없음)'
  );
});

test('r검색결과 bypasses Gemini and non-MMS mode sends only first title', async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, init });

    if (target.startsWith('https://www.reddit.com/search/')) {
      return new Response(
        '<shreddit-post post-title="첫 번째 결과" permalink="/r/test/1"></shreddit-post>' +
        '<shreddit-post post-title="두 번째 결과" permalink="/r/test/2"></shreddit-post>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }

    if (target.includes('api.solapi.com/messages/v4/send-many/detail')) {
      return Response.json({
        groupInfo: { groupId: 'G1', count: { registeredSuccess: 1, registeredFailed: 0 } },
        failedMessageList: [],
        messageList: [{ messageId: 'M1' }],
      });
    }

    throw new Error('unexpected URL: ' + target);
  };

  try {
    const result = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '고양이 r검색결과',
    });

    assert.equal(result.reddit, true);
    assert.equal(result.type, 'SMS');
    assert.equal(result.text, '첫 번째 결과');
    assert.equal(calls.some((call) => call.target.includes('generativelanguage.googleapis.com')), false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('r검색결과 with <mms가능> sends all returned titles with numbering and attachment flags', async () => {
  const sentTexts = [];
  const calls = [];
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push(target);

    if (target.startsWith('https://www.reddit.com/search/')) {
      return new Response(
        '<shreddit-post post-title="첫 번째" post-type="image" content-href="https://i.redd.it/a.jpg"></shreddit-post>' +
        '<shreddit-post post-title="두 번째" post-type="text"></shreddit-post>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }

    if (target.includes('api.solapi.com/messages/v4/send-many/detail')) {
      sentTexts.push(JSON.parse(init.body).messages[0].text);
      return Response.json({
        groupInfo: { groupId: 'G2', count: { registeredSuccess: 1, registeredFailed: 0 } },
        failedMessageList: [],
        messageList: [{ messageId: 'M2' }],
      });
    }

    throw new Error('unexpected URL: ' + target);
  };

  try {
    const result = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '고양이 r검색결과<mms가능>',
    });

    const combined = sentTexts.join('\n');
    assert.match(combined, /1번 첫 번째 \(첨부파일: 있음\)/);
    assert.match(combined, /2번 두 번째 \(첨부파일: 없음\)/);
    assert.equal(result.reddit, true);
    assert.equal(calls.some((url) => url.includes('generativelanguage.googleapis.com')), false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('rN결과 sends the Nth Reddit JPEG attachment as MMS without Gemini', async () => {
  const calls = [];
  let sentMessage;
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push(target);

    if (target.startsWith('https://www.reddit.com/search/')) {
      return new Response(
        '<shreddit-post post-title="첫 번째" post-type="text"></shreddit-post>' +
        '<shreddit-post post-title="둘째 이미지" post-type="image" content-href="https://i.redd.it/b.jpg"></shreddit-post>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }

    if (target === 'https://i.redd.it/b.jpg') {
      return new Response(new Uint8Array([255, 216, 255, 217]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }

    if (target.includes('api.solapi.com/storage/v1/files')) {
      return Response.json({ fileId: 'REDDIT_FILE' });
    }

    if (target.includes('api.solapi.com/messages/v4/send-many/detail')) {
      sentMessage = JSON.parse(init.body).messages[0];
      return Response.json({
        groupInfo: { groupId: 'G3', count: { registeredSuccess: 1, registeredFailed: 0 } },
        failedMessageList: [],
        messageList: [{ messageId: 'M3' }],
      });
    }

    throw new Error('unexpected URL: ' + target);
  };

  try {
    const result = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '고양이 r2결과',
    });

    assert.equal(result.reddit, true);
    assert.equal(result.type, 'MMS');
    assert.equal(result.attachmentSent, true);
    assert.equal(sentMessage.imageId, 'REDDIT_FILE');
    assert.equal(calls.some((url) => url.includes('generativelanguage.googleapis.com')), false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
