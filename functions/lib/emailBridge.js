export const MMS_MARKER = '<mms가능>';
export const SMS_LIMIT_BYTES = 90;
export const LONG_LIMIT_BYTES = 2000;
export const MMS_IMAGE_LIMIT_BYTES = 200 * 1024;

export function hasMmsMarker(text = '') {
  return /<mms가능>\s*$/u.test(String(text));
}

export function stripMmsMarker(text = '') {
  return String(text).replace(/<mms가능>\s*$/u, '').trimEnd();
}

// SOLAPI documents SMS/LMS byte limits in EUC-KR terms: ASCII-like
// characters are 1 byte and Korean characters are 2 bytes. To avoid
// accidentally crossing the limit with non-ASCII characters, every
// non-ASCII code point is conservatively counted as 2 bytes.
export function solapiByteLength(text = '') {
  let bytes = 0;
  for (const ch of String(text)) bytes += ch.codePointAt(0) <= 0x7f ? 1 : 2;
  return bytes;
}

export function truncateSolapi(text = '', limit = SMS_LIMIT_BYTES) {
  const source = String(text).trim();
  if (solapiByteLength(source) <= limit) return source;

  const suffix = '...';
  const budget = Math.max(0, limit - solapiByteLength(suffix));
  let out = '';
  let used = 0;
  for (const ch of source) {
    const n = ch.codePointAt(0) <= 0x7f ? 1 : 2;
    if (used + n > budget) break;
    out += ch;
    used += n;
  }
  return out.replace(/\s+$/u, '') + suffix;
}

export function base64ByteLength(data = '') {
  const clean = String(data).replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

export function isGeminiSupportedMime(mime = '') {
  const m = String(mime).toLowerCase();
  if (/^(image|audio|video|text)\//.test(m)) return true;
  return new Set([
    'application/pdf',
    'application/json',
    'application/rtf',
    'application/x-javascript',
    'application/x-typescript',
    'application/x-python-code',
    'application/x-ipynb+json',
  ]).has(m);
}

export function sanitizePhone(value = '') {
  return String(value).replace(/\D/g, '');
}

export function composePrompt({ subject = '', body = '', skippedAttachments = [] } = {}) {
  const title = String(subject).trim();
  const text = String(body).trim();
  const skipped = Array.isArray(skippedAttachments) && skippedAttachments.length
    ? `\n\n[첨부파일 처리 참고]\n${skippedAttachments.map(x => `- ${x.name || '파일'}: ${x.reason || '지원되지 않음'}`).join('\n')}`
    : '';
  return `${title ? `[메일 제목]\n${title}\n\n` : ''}[메일 본문]\n${text}${skipped}`.trim();
}
