import { isGeminiSupportedMime } from './emailBridge.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const MAX_INPUT_ATTACHMENTS = 10;

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

export async function askGeminiForEmail(env, { prompt, attachments = [], allowMms = false }) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');
  const imageMode = allowMms && Boolean(env.GEMINI_MMS_MODEL);
  const model = imageMode ? env.GEMINI_MMS_MODEL : (env.GEMINI_MODEL || DEFAULT_MODEL);
  const parts = [{ text: prompt }];
  for (const file of attachments.slice(0, MAX_INPUT_ATTACHMENTS)) {
    if (file?.dataBase64 && isGeminiSupportedMime(file?.mimeType)) {
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.dataBase64 } });
    }
  }

  const generationConfig = { temperature: 0.5, maxOutputTokens: allowMms ? 1600 : 300 };
  if (imageMode) generationConfig.responseModalities = ['TEXT', 'IMAGE'];

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: modeInstruction(allowMms) }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
    }),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload?.error?.message || `Gemini HTTP ${response.status}`);
  return extract(payload);
}
