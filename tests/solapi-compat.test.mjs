import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSolapiText } from '../functions/lib/emailBridge.js';
import { sendSolapiMessage } from '../functions/lib/solapi.js';

test('SOLAPI sanitizer preserves normal spaces and ASCII punctuation', () => {
  assert.equal(
    sanitizeSolapiText('만나서 반가워? 네, 좋아요! (테스트) - 확인.'),
    '만나서 반가워? 네, 좋아요! (테스트) - 확인.'
  );
});

test('SOLAPI sanitizer removes emoji/control chars and maps typographic punctuation', () => {
  assert.equal(
    sanitizeSolapiText('좋아요 😊 “테스트”—확인…\u0000'),
    '좋아요 "테스트"-확인...'
  );
});

test('SOLAPI HTTP 200 with failedMessageList is treated as a send failure', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    groupInfo: { count: { registeredFailed: 1, registeredSuccess: 0 } },
    failedMessageList: [{ statusCode: '1029', statusMessage: 'EUC-KR 범위 밖 문자' }],
    messageList: [],
  });

  try {
    await assert.rejects(
      sendSolapiMessage({
        SOLAPI_API_KEY: 'key',
        SOLAPI_API_SECRET: 'secret',
        SOLAPI_FROM: '01011112222',
        SOLAPI_TO: '01033334444',
      }, { type: 'SMS', text: '테스트' }),
      /SOLAPI 1029/
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('SOLAPI request asks for per-message results and keeps normal spacing', async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({
      groupInfo: { count: { registeredFailed: 0, registeredSuccess: 1 } },
      failedMessageList: [],
      messageList: [{ messageId: 'M4VTEST', statusCode: '2000', statusMessage: '정상 접수' }],
    });
  };

  try {
    await sendSolapiMessage({
      SOLAPI_API_KEY: 'key',
      SOLAPI_API_SECRET: 'secret',
      SOLAPI_FROM: '01011112222',
      SOLAPI_TO: '01033334444',
    }, { type: 'SMS', text: '만나서 반가워?' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].messages[0].text, '만나서 반가워?');
    assert.equal(calls[0].showMessageList, true);
    assert.equal(calls[0].strict, false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
