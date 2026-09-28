import test from 'node:test';
import assert from 'node:assert/strict';
import { composePrompt } from '../functions/lib/emailBridge.js';
import { askGeminiForEmail } from '../functions/lib/geminiEmail.js';

test('composePrompt treats email transport as ordinary user text', () => {
  const prompt = composePrompt({ subject: '점심 추천', body: '강남에서 뭐 먹을까?' });
  assert.equal(prompt, '점심 추천\n\n강남에서 뭐 먹을까?');
  assert.doesNotMatch(prompt, /메일 제목|메일 본문|email/i);
});

test('Gemini system instruction tells the model not to focus on email transport', async () => {
  const oldFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: '좋아요.' }] } }] });
  };
  try {
    await askGeminiForEmail(
      { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-test', GEMINI_RETRY_BASE_MS: '0' },
      { prompt: '오늘 뭐 하지?', attachments: [], allowMms: false },
    );
    const instruction = sentBody.systemInstruction.parts[0].text;
    assert.match(instruction, /transport/i);
    assert.match(instruction, /normal user message/i);
    assert.match(instruction, /do not mention email/i);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
