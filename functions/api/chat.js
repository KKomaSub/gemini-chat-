const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const MAX_MESSAGE_LENGTH = 4000;
const MAX_FIRST_GET_MESSAGE_LENGTH = 1800;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_FIELD_LENGTH = 30000;
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant. Answer directly and clearly. Match the user language unless they ask for another language.';

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cleanText(value, limit = MAX_MESSAGE_LENGTH) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
}

export function normalizeHistory(rawHistory) {
  if (!rawHistory || typeof rawHistory !== 'string' || rawHistory.length > MAX_HISTORY_FIELD_LENGTH) return [];
  try {
    const parsed = JSON.parse(rawHistory);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && (item.role === 'user' || item.role === 'model'))
      .map((item) => ({ role: item.role, text: cleanText(item.text) }))
      .filter((item) => item.text)
      .slice(-MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function buildContents(history, latestMessage) {
  return [
    ...(Array.isArray(history) ? history : []).map((item) => ({ role: item.role, parts: [{ text: item.text }] })),
    { role: 'user', parts: [{ text: latestMessage }] },
  ];
}

export function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim();
}

function serializeHistory(history) {
  return escapeHtml(JSON.stringify(history));
}

function renderMessages(history) {
  if (!history.length) return '<div class="empty">질문을 입력해 주세요.</div>';
  return history.map((item) => {
    const label = item.role === 'user' ? '나' : 'Gemini';
    const cls = item.role === 'user' ? 'user' : 'model';
    return `<section class="message ${cls}"><div class="who">${label}</div><div class="bubble">${escapeHtml(item.text)}</div></section>`;
  }).join('');
}

function renderPage({ history = [], error = '', status = 200 } = {}) {
  const safeHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_ITEMS) : [];
  const errorHtml = error ? `<div class="error">${escapeHtml(error)}</div>` : '';
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Gemini Chat</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:Canvas;color:CanvasText}.app{width:min(820px,100%);min-height:100vh;margin:auto;padding:14px 12px 125px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 2px 16px}.brand{font-size:20px;font-weight:800}.new-chat button{background:transparent;color:CanvasText;border:1px solid #8885}.messages{display:flex;flex-direction:column;gap:16px}.message{max-width:88%}.message.user{align-self:flex-end}.message.model{align-self:flex-start}.who{font-size:12px;opacity:.55;margin:0 7px 5px}.user .who{text-align:right}.bubble{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55;padding:12px 14px;border-radius:18px;background:#8882;border:1px solid #8883}.user .bubble{background:#4f7cff;color:white;border-color:transparent}.empty{text-align:center;opacity:.55;padding:20vh 0}.error{margin:16px 0;padding:12px 14px;border:1px solid #c55;border-radius:14px;white-space:pre-wrap}.composer{position:fixed;left:0;right:0;bottom:0;padding:10px;background:Canvas;border-top:1px solid #8883}.composer-box{width:min(800px,100%);margin:auto;display:flex;gap:8px}.composer-box input[type=text]{flex:1;min-width:0;padding:14px;border:1px solid #8886;border-radius:17px;background:Canvas;color:CanvasText;font:inherit}.composer-box button,header button{border:0;border-radius:13px;padding:0 16px;background:#4f7cff;color:#fff;font:inherit;font-weight:700}.hint{text-align:center;font-size:11px;opacity:.55;margin:6px 0 0}@media(max-width:480px){.message{max-width:94%}.composer{padding:8px}.composer-box button{padding:0 13px}}
</style></head><body><div class="app"><header><div class="brand">✦ Gemini Chat</div><form class="new-chat" action="/" method="get"><button type="submit">새 대화</button></form></header><main><div class="messages">${renderMessages(safeHistory)}</div>${errorHtml}</main></div><div class="composer"><form class="composer-box" action="/api/chat" method="post" accept-charset="utf-8"><input type="hidden" name="history" value="${serializeHistory(safeHistory)}"><input type="text" name="message" maxlength="${MAX_MESSAGE_LENGTH}" placeholder="메시지를 입력하세요" required><button type="submit">보내기</button></form><p class="hint">브라우저에서 이어서 대화합니다 · JavaScript 없음</p></div></body></html>`;
  return new Response(html, { status, headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  }});
}

async function askGemini({ env = {}, message, history }) {
  if (!env.GEMINI_API_KEY) {
    return renderPage({ history: [...history, { role: 'user', text: message }], error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.', status: 500 });
  }

  const model = cleanText(env.GEMINI_MODEL || DEFAULT_MODEL, 100) || DEFAULT_MODEL;
  const systemPrompt = cleanText(env.GEMINI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT, 4000);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let geminiResponse;
  try {
    geminiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: buildContents(history, message),
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    });
  } catch {
    return renderPage({ history: [...history, { role: 'user', text: message }], error: 'Gemini 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', status: 502 });
  }

  let payload = {};
  try { payload = await geminiResponse.json(); } catch { payload = {}; }

  if (!geminiResponse.ok) {
    const apiMessage = cleanText(payload?.error?.message, 500);
    return renderPage({ history: [...history, { role: 'user', text: message }], error: apiMessage || `Gemini API 오류 (${geminiResponse.status})`, status: 502 });
  }

  const answer = extractGeminiText(payload);
  if (!answer) {
    return renderPage({ history: [...history, { role: 'user', text: message }], error: 'Gemini가 표시할 수 있는 텍스트 응답을 반환하지 않았습니다.', status: 502 });
  }

  const nextHistory = [...history, { role: 'user', text: message }, { role: 'model', text: answer }].slice(-MAX_HISTORY_ITEMS);
  return renderPage({ history: nextHistory });
}

export async function onRequestGet(context) {
  const { request, env = {} } = context;
  const url = new URL(request.url);
  const rawMessage = url.searchParams.get('message');
  const rawHistory = url.searchParams.get('history') ?? '[]';

  // /api/chat을 브라우저에서 직접 열었을 때는 빈 채팅 화면만 표시.
  if (rawMessage === null) return renderPage();

  const message = cleanText(rawMessage, MAX_FIRST_GET_MESSAGE_LENGTH);
  const history = normalizeHistory(rawHistory);
  if (!message) return renderPage({ history, error: '메시지를 입력해 주세요.', status: 400 });
  return askGemini({ env, message, history });
}

export async function onRequestPost(context) {
  const { request, env = {} } = context;
  let formData;
  try { formData = await request.formData(); }
  catch { return renderPage({ error: '폼 데이터를 읽지 못했습니다.', status: 400 }); }

  const message = cleanText(formData.get('message'));
  const history = normalizeHistory(String(formData.get('history') ?? '[]'));
  if (!message) return renderPage({ history, error: '메시지를 입력해 주세요.', status: 400 });
  return askGemini({ env, message, history });
}
