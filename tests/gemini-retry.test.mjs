import test from 'node:test';
import assert from 'node:assert/strict';
import { askGeminiForEmail } from '../functions/lib/geminiEmail.js';

test('503 retries primary model once, then falls back to another stable model', async () => {
  const oldFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (urls.length <= 2) {
      return Response.json({ error: { message: 'This model is currently experiencing high demand.' } }, { status: 503 });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: 'fallback ok' }] } }] });
  };

  try {
    const result = await askGeminiForEmail({
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'primary-model',
      GEMINI_FALLBACK_MODELS: 'fallback-model',
      GEMINI_RETRY_BASE_MS: '0',
    }, { prompt: 'hello' });

    assert.equal(result.text, 'fallback ok');
    assert.equal(urls.length, 3);
    assert.match(urls[0], /primary-model/);
    assert.match(urls[1], /primary-model/);
    assert.match(urls[2], /fallback-model/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
