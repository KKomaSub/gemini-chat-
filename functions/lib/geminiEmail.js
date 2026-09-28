import { isGeminiSupportedMime } from './emailBridge.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const MAX_INPUT_ATTACHMENTS = 10;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function modeInstruction(allowMms) {
  if (!allowMms) {
    return [
      'Reply for delivery as a short SOLAPI SMS.',
      'Return plain text only and do not create or attach images, files, audio, or other binary output.',
      'Aim to stay below 80 delivery bytes. Avoid emoji.',
    ].join(' ');
  }
  return [
    'Reply for delivery as SMS, LMS, or MMS.',
    'Keep text within 2000 delivery bytes.',
    'Only when genuinely useful or explicitly requested, you may return one JPEG image plus text.',
    'Do not return arbitrary non-image file attachments.',
  ].join(' ');
}

function extract(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return { text: '', images: [] };
  const texts = [];
  const images = [];
  for (const part of parts) {
    if (part?.thought) continue;
    if (typeof part?.text === 'string') texts.push(part.text);
    const inline = part?.inlineData;
    if (inline?.data && inline?.mimeType?.startsWith('image/')) images.push(inline);
  }
  return { text: texts.join('').trim(), images };
}

function unique(items) {
  return [...new Set(items.map((x) => String(x || '').trim()).filter(Boolean))];
}

function fallbackModels(env, imageMode) {
  if (imageMode) return unique([env.GEMINI_MMS_MODEL]);
  const configured = String(env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return unique([
    env.GEMINI_MODEL || DEFAULT_MODEL,
    ...(configured.length ? configured : DEFAULT_FALLBACK_MODELS),
  ]);
}

function retryBaseMs(env) {
  const value = Number(env.GEMINI_RETRY_BASE_MS ?? 400);
  return Number.isFinite(value) ? Math.max(0, Math.min(2000, value)) : 400;
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithModel(env, { model, body, retryBase }) {
  let lastMessage = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastMessage = String(error?.message || error || 'network error');
      if (attempt === 0) {
        await sleep(retryBase);
        continue;
      }
      return { ok: false, retryable: true, message: lastMessage };
    }

    let payload = {};
    try { payload = await response.json(); } catch {}
    if (response.ok) return { ok: true, payload };

    lastMessage = payload?.error?.message || `Gemini HTTP ${response.status}`;
    const retryable = RETRYABLE_STATUS.has(response.status);
    if (!retryable) return { ok: false, retryable: false, message: lastMessage };
    if (attempt === 0) await sleep(retryBase);
  }
  return { ok: false, retryable: true, message: lastMessage || 'Gemini request failed' };
}

export async function askGeminiForEmail(env, { prompt, attachments = [], allowMms = false }) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');
  const imageMode = allowMms && Boolean(env.GEMINI_MMS_MODEL);
  const parts = [{ text: prompt }];
  for (const file of attachments.slice(0, MAX_INPUT_ATTACHMENTS)) {
    if (file?.dataBase64 && isGeminiSupportedMime(file?.mimeType)) {
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.dataBase64 } });
    }
  }

  const generationConfig = { temperature: 0.5, maxOutputTokens: allowMms ? 1600 : 300 };
  if (imageMode) generationConfig.responseModalities = ['TEXT', 'IMAGE'];
  const body = {
    systemInstruction: { parts: [{ text: modeInstruction(allowMms) }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
  };

  const models = fallbackModels(env, imageMode);
  const base = retryBaseMs(env);
  let lastMessage = '';
  for (let i = 0; i < models.length; i++) {
    const result = await generateWithModel(env, {
      model: models[i],
      body,
      retryBase: base * (2 ** i),
    });
    if (result.ok) return extract(result.payload);
    lastMessage = result.message;
    if (!result.retryable) throw new Error(lastMessage);
  }
  throw new Error(lastMessage || 'Gemini API unavailable after retries');
}
