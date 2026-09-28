export const MMS_MARKER = '<mms가능>';
export const SMS_LIMIT_BYTES = 90;
export const LONG_LIMIT_BYTES = 2000;
export const MMS_IMAGE_LIMIT_BYTES = 200 * 1024;

const MOBILE_MAIL_FOOTER_RE = /(?:\r?\n+)?={20,}[ \t]*\r?\n본 메일은 휴대폰에서 발신된 발신 전용 메일이므로 회신할 수 없습니다\.[ \t]*\r?\n회신을 원하시면 본 메일 발신자 계정의 이동전화번호로 문자메시지를 보내세요\.[ \t]*\r?\n={20,}[ \t]*(?:\r?\n|[ \t])*$/u;

export function stripMobileMailFooter(text = '') {
  return String(text).replace(MOBILE_MAIL_FOOTER_RE, '').trimEnd();
}

export function hasMmsMarker(text = '') {
  return /<mms가능>\s*$/u.test(String(text));
}

export function stripMmsMarker(text = '') {
  return String(text).replace(/<mms가능>\s*$/u, '').trimEnd();
}

export function sanitizeSolapiText(text = '') {
  let value = String(text).normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF\uFE0E\uFE0F]/g, '');

  // Korean SMS/LMS is EUC-KR based. Four-byte Unicode characters such as
  // color emoji cannot be delivered reliably, so remove them before SOLAPI.
  value = value.replace(/[\u{10000}-\u{10FFFF}]/gu, '');

  return value
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trimEnd())
    .join('\n')
    .trim();
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
  const main = [title, text].filter(Boolean).join('\n\n');
  const skipped = Array.isArray(skippedAttachments) && skippedAttachments.length
    ? `\n\n[첨부 처리 참고]\n${skippedAttachments.map(x => `- ${x.name || '파일'}: ${x.reason || '지원되지 않음'}`).join('\n')}`
    : '';
  return `${main}${skipped}`.trim();
}
