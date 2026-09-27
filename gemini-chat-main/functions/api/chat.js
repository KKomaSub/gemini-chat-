const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_FIELD_LENGTH = 30000;
const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Answer the user directly and clearly. Match the user language unless they ask for another language.';

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
  if (!rawHistory || typeof rawHistory !== 'string') return [];
  if (rawHistory.length > MAX_HISTORY_FIELD_LENGTH) return [];

  try {
    const parsed = JSON.parse(rawHistory);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && (item.role === 'user' || item.role === 'model'))
      .map((item) => ({
        role: item.role,
        text: cleanText(item.text),
      }))
      .filter((item) => item.text)
      .slice(-MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function buildContents(history, latestMessage) {
  const normalized = Array.isArray(history) ? history : [];
  return [
    ...normalized.map((item) => ({
      role: item.role,
      parts: [{ text: item.text }],
    })),
    { role: 'user', parts: [{ text: latestMessage }] },
  ];
}

export function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function serializedHistory(history) {
  return escapeHtml(JSON.stringify(history));
}

function renderMessages(history) {
  if (!history.length) {
    return `
      <section class="empty" aria-label="대화 시작 안내">
        <div class="spark">✦</div>
        <h2>Gemini에게 물어보세요</h2>
        <p>JavaScript 없이 HTML 폼 제출만으로 동작합니다.</p>
      </section>`;
  }

  return history
    .map((item) => {
      const label = item.role === 'user' ? '나' : 'Gemini';
      const klass = item.role === 'user' ? 'message user' : 'message model';
      return `
        <article class="${klass}">
          <div class="message-label">${label}</div>
          <div class="bubble">${escapeHtml(item.text).replaceAll('\n', '<br>')}</div>
        </article>`;
    })
    .join('');
}

export function renderPage({ history = [], error = '', status = 200 } = {}) {
  const safeHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_ITEMS) : [];
  const errorHtml = error
    ? `<div class="error" role="alert"><strong>오류</strong><span>${escapeHtml(error)}</span></div>`
    : '';

  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Gemini Chat · No JavaScript</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: Canvas; color: CanvasText; }
    .app { width: min(820px, 100%); min-height: 100vh; margin: 0 auto; padding: 18px 16px 28px; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 2px 18px; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: -.02em; }
    .logo { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 12px; background: linear-gradient(135deg, #7c4dff, #4f9cff); color: white; font-size: 18px; }
    .new-chat button { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); background: Canvas; color: CanvasText; border-radius: 999px; padding: 9px 13px; font: inherit; cursor: pointer; }
    main { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 14px; }
    .messages { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 18px; }
    .empty { text-align: center; margin: auto 0; padding: 70px 16px; opacity: .78; }
    .empty .spark { font-size: 42px; margin-bottom: 10px; }
    .empty h2 { margin: 0 0 8px; font-size: 24px; }
    .empty p { margin: 0; font-size: 14px; }
    .message { max-width: 88%; }
    .message.user { align-self: flex-end; }
    .message.model { align-self: flex-start; }
    .message-label { font-size: 12px; opacity: .62; margin: 0 8px 5px; }
    .user .message-label { text-align: right; }
    .bubble { padding: 13px 15px; border-radius: 18px; line-height: 1.58; overflow-wrap: anywhere; border: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
    .user .bubble { background: color-mix(in srgb, #4f7cff 19%, Canvas); border-bottom-right-radius: 5px; }
    .model .bubble { background: color-mix(in srgb, CanvasText 6%, Canvas); border-bottom-left-radius: 5px; }
    .error { display: flex; gap: 8px; align-items: flex-start; padding: 12px 14px; margin-bottom: 12px; border: 1px solid #d73a49; border-radius: 14px; background: color-mix(in srgb, #d73a49 10%, Canvas); font-size: 14px; }
    .composer { position: sticky; bottom: 0; padding-top: 10px; background: linear-gradient(transparent, Canvas 22%); }
    .composer-box { display: flex; gap: 10px; align-items: flex-end; padding: 10px; border-radius: 22px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); background: Canvas; box-shadow: 0 8px 30px color-mix(in srgb, CanvasText 8%, transparent); }
    textarea { flex: 1; min-height: 48px; max-height: 170px; resize: vertical; border: 0; outline: 0; padding: 12px 10px; background: transparent; color: CanvasText; font: inherit; line-height: 1.45; }
    .send { border: 0; border-radius: 15px; padding: 12px 16px; background: #4f7cff; color: #fff; font: inherit; font-weight: 750; cursor: pointer; }
    .hint { text-align: center; font-size: 11px; opacity: .58; margin: 8px 0 0; }
    @media (max-width: 560px) { .app { padding: 12px 10px 18px; } .message { max-width: 94%; } .send { padding-inline: 13px; } }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="brand"><div class="logo" aria-hidden="true">✦</div><span>Gemini Chat</span></div>
      <form class="new-chat" action="/" method="get"><button type="submit">새 대화</button></form>
    </header>
    <main>
      <div class="messages">${renderMessages(safeHistory)}</div>
      ${errorHtml}
      <div class="composer">
        <form class="composer-box" action="/api/chat" method="post" accept-charset="utf-8">
          <input type="hidden" name="history" value="${serializedHistory(safeHistory)}">
          <textarea name="message" maxlength="${MAX_MESSAGE_LENGTH}" rows="2" placeholder="메시지를 입력하세요" aria-label="메시지" required></textarea>
          <button class="send" type="submit">보내기</button>
        </form>
        <p class="hint">JavaScript 없음 · 폼 제출 후 서버가 새 HTML을 반환합니다.</p>
      </div>
    </main>
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'",
    },
  });
}

export async function onRequestGet() {
  return renderPage();
}

export async function onRequestPost(context) {
  const { request, env = {} } = context;
  let formData;

  try {
    formData = await request.formData();
  } catch {
    return renderPage({ error: '폼 데이터를 읽지 못했습니다.', status: 400 });
  }

  const message = cleanText(formData.get('message'));
  const history = normalizeHistory(String(formData.get('history') ?? '[]'));

  if (!message) {
    return renderPage({ history, error: '메시지를 입력해 주세요.', status: 400 });
  }

  if (!env.GEMINI_API_KEY) {
    return renderPage({
      history: [...history, { role: 'user', text: message }],
      error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.',
      status: 500,
    });
  }

  const model = cleanText(env.GEMINI_MODEL || DEFAULT_MODEL, 100) || DEFAULT_MODEL;
  const systemPrompt = cleanText(env.GEMINI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT, 4000);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let geminiResponse;
  try {
    geminiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: buildContents(history, message),
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    });
  } catch {
    return renderPage({
      history: [...history, { role: 'user', text: message }],
      error: 'Gemini 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      status: 502,
    });
  }

  let payload = {};
  try {
    payload = await geminiResponse.json();
  } catch {
    payload = {};
  }

  if (!geminiResponse.ok) {
    const apiMessage = cleanText(payload?.error?.message, 500);
    return renderPage({
      history: [...history, { role: 'user', text: message }],
      error: apiMessage || `Gemini API 오류 (${geminiResponse.status})`,
      status: 502,
    });
  }

  const answer = extractGeminiText(payload);
  if (!answer) {
    return renderPage({
      history: [...history, { role: 'user', text: message }],
      error: 'Gemini가 표시할 수 있는 텍스트 응답을 반환하지 않았습니다.',
      status: 502,
    });
  }

  const nextHistory = [
    ...history,
    { role: 'user', text: message },
    { role: 'model', text: answer },
  ].slice(-MAX_HISTORY_ITEMS);

  return renderPage({ history: nextHistory });
}
