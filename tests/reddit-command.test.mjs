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
    page: 1,
    explicitPage: false,
  });
  assert.deepEqual(parseRedditCommand('고양이 r검색결과2'), {
    kind: 'list',
    query: '고양이',
    page: 2,
    explicitPage: true,
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

test('r검색결과 with <mms가능> sends only the first <=2000-byte page', async () => {
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

    assert.equal(sentTexts.length, 1);
    const combined = sentTexts[0];
    assert.match(combined, /1번 첫 번째 \(첨부파일: 있음\)/);
    assert.match(combined, /2번 두 번째 \(첨부파일: 없음\)/);
    assert.ok(result.textBytes <= 2000);
    assert.equal(result.messageCount, 1);
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


test('r검색결과2 sends the second 2000-byte page instead of auto-sending page 2', async () => {
  const sentTexts = [];
  const oldFetch = globalThis.fetch;

  const posts = Array.from({ length: 45 }, (_, i) =>
    `<shreddit-post post-title="${String(i + 1).padStart(2, '0')} ${'가'.repeat(35)}" post-type="text"></shreddit-post>`
  ).join('');

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);

    if (target.startsWith('https://www.reddit.com/search/')) {
      return new Response(posts, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (target.includes('api.solapi.com/messages/v4/send-many/detail')) {
      sentTexts.push(JSON.parse(init.body).messages[0].text);
      return Response.json({
        groupInfo: { groupId: 'GP', count: { registeredSuccess: 1, registeredFailed: 0 } },
        failedMessageList: [],
        messageList: [{ messageId: 'MP' }],
      });
    }

    throw new Error('unexpected URL: ' + target);
  };

  try {
    const first = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '고양이 r검색결과<mms가능>',
    });
    const second = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '고양이 r검색결과2',
    });

    assert.equal(sentTexts.length, 2);
    assert.ok(first.textBytes <= 2000);
    assert.ok(second.textBytes <= 2000);
    assert.notEqual(sentTexts[0], sentTexts[1]);
    assert.equal(first.page, 1);
    assert.equal(second.page, 2);
    assert.equal(first.hasMore, true);
    assert.equal(second.reddit, true);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('r검색결과 does not automatically send continuation pages over 2000 bytes', async () => {
  let sendCount = 0;
  const oldFetch = globalThis.fetch;
  const posts = Array.from({ length: 60 }, (_, i) =>
    `<shreddit-post post-title="${i + 1} ${'나'.repeat(40)}" post-type="text"></shreddit-post>`
  ).join('');

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith('https://www.reddit.com/search/')) {
      return new Response(posts, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (target.includes('api.solapi.com/messages/v4/send-many/detail')) {
      sendCount += 1;
      return Response.json({
        groupInfo: { groupId: 'ONE', count: { registeredSuccess: 1, registeredFailed: 0 } },
        failedMessageList: [],
        messageList: [{ messageId: 'ONE' }],
      });
    }
    throw new Error('unexpected URL: ' + target);
  };

  try {
    const result = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '고양이 r검색결과<mms가능>',
    });
    assert.equal(sendCount, 1);
    assert.ok(result.textBytes <= 2000);
    assert.equal(result.hasMore, true);
  } finally {
    globalThis.fetch = oldFetch;
  }
});


test('rN결과 sends a Reddit video URL when MMS cannot attach video', async () => {
  let sentMessage;
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);

    if (target.startsWith('https://www.reddit.com/search/')) {
      return new Response(
        '<shreddit-post post-title="동영상 결과" post-type="video" content-href="https://v.redd.it/video123" permalink="/r/test/video"></shreddit-post>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }

    if (target.includes('api.solapi.com/messages/v4/send-many/detail')) {
      sentMessage = JSON.parse(init.body).messages[0];
      return Response.json({
        groupInfo: { groupId: 'GV', count: { registeredSuccess: 1, registeredFailed: 0 } },
        failedMessageList: [],
        messageList: [{ messageId: 'MV' }],
      });
    }

    throw new Error('unexpected URL: ' + target);
  };

  try {
    const result = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '동영상 r1결과',
    });

    assert.equal(result.reddit, true);
    assert.equal(result.mediaLinkSent, true);
    assert.equal(result.attachmentSent, false);
    assert.match(sentMessage.text, /https:\/\/v\.redd\.it\/video123/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('rN결과 falls back to media link when Reddit JPEG is over 200KB', async () => {
  let sentMessage;
  let storageCalls = 0;
  const oldFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);

    if (target.startsWith('https://www.reddit.com/search/')) {
      return new Response(
        '<shreddit-post post-title="대용량 이미지" post-type="image" content-href="https://i.redd.it/large.jpg" permalink="/r/test/large"></shreddit-post>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }

    if (target === 'https://i.redd.it/large.jpg') {
      return new Response(new Uint8Array(201 * 1024), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }

    if (target.includes('api.solapi.com/storage/v1/files')) {
      storageCalls += 1;
      return Response.json({ fileId: 'SHOULD_NOT_UPLOAD' });
    }

    if (target.includes('api.solapi.com/messages/v4/send-many/detail')) {
      sentMessage = JSON.parse(init.body).messages[0];
      return Response.json({
        groupInfo: { groupId: 'GL', count: { registeredSuccess: 1, registeredFailed: 0 } },
        failedMessageList: [],
        messageList: [{ messageId: 'ML' }],
      });
    }

    throw new Error('unexpected URL: ' + target);
  };

  try {
    const result = await processEmailBridge(env, {
      to: 'ijunu3343@gmail.com',
      body: '이미지 r1결과',
    });

    assert.equal(result.mediaLinkSent, true);
    assert.equal(result.attachmentSent, false);
    assert.equal(storageCalls, 0);
    assert.match(sentMessage.text, /https:\/\/i\.redd\.it\/large\.jpg/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
