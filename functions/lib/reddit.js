const DEFAULT_LIMIT = 100;
const REDDIT_MEDIA_HOSTS = new Set(['i.redd.it', 'preview.redd.it', 'external-preview.redd.it']);

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function safeUrl(value = '') {
  try { return new URL(decodeHtml(value)).toString(); } catch { return ''; }
}

function isRedditMediaUrl(value = '') {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      REDDIT_MEDIA_HOSTS.has(parsed.hostname.toLowerCase());
  } catch { return false; }
}

function isImageUrl(value = '') {
  try {
    const parsed = new URL(value);
    return isRedditMediaUrl(value) &&
      /\.(jpe?g|png|webp|gif)$/i.test(parsed.pathname);
  } catch { return false; }
}

function preferJpegPreview(value = '') {
  const url = safeUrl(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().endsWith('redd.it') && parsed.hostname.toLowerCase().includes('preview')) {
      parsed.searchParams.set('format', 'pjpg');
      parsed.searchParams.delete('auto');
      return parsed.toString();
    }
  } catch {}
  return url;
}

function mediumPreview(image = {}) {
  const resolutions = Array.isArray(image?.resolutions) ? image.resolutions : [];
  const preferred = resolutions
    .filter((item) => Number(item?.width || 0) <= 720)
    .sort((a, b) => Number(b?.width || 0) - Number(a?.width || 0))[0];
  return preferJpegPreview(preferred?.url || image?.source?.url || '');
}

function galleryPreview(meta = {}) {
  const previews = Array.isArray(meta?.p) ? meta.p : [];
  const preferred = previews
    .filter((item) => Number(item?.x || 0) <= 720)
    .sort((a, b) => Number(b?.x || 0) - Number(a?.x || 0))[0];
  return preferJpegPreview(preferred?.u || meta?.s?.u || '');
}

function findRedditImage(post = {}) {
  const candidates = [];
  if (post.is_gallery && post.media_metadata) {
    const ids = Array.isArray(post.gallery_data?.items)
      ? post.gallery_data.items.map((x) => x?.media_id).filter(Boolean)
      : Object.keys(post.media_metadata);
    for (const id of ids) {
      const meta = post.media_metadata[id];
      const preview = galleryPreview(meta);
      if (preview) candidates.push(preview);
    }
  }
  const preview = mediumPreview(post.preview?.images?.[0] || {});
  if (preview) candidates.push(preview);
  if (post.url_overridden_by_dest) candidates.push(post.url_overridden_by_dest);
  if (post.url) candidates.push(post.url);

  for (const raw of candidates) {
    const url = safeUrl(raw);
    if (url && isRedditMediaUrl(url) && !/v\.redd\.it/i.test(url)) return url;
  }
  return '';
}

function normalizeApiPost(post = {}) {
  const video = Boolean(
    post.is_video || post.secure_media?.reddit_video ||
    post.media?.reddit_video ||
    ['hosted:video', 'rich:video'].includes(post.post_hint)
  );
  const original = safeUrl(post.url_overridden_by_dest || post.url || '');
  const attachmentUrl = video ? '' : findRedditImage(post);
  const hasImage = !video && Boolean(
    post.is_gallery || post.post_hint === 'image' ||
    isImageUrl(original)
  );
  return {
    title: String(post.title || '').trim(),
    permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : '',
    hasImage,
    attachmentUrl: hasImage ? attachmentUrl : '',
  };
}

function attr(tag = '', name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = tag.match(new RegExp(`${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeHtml(m?.[1] ?? m?.[2] ?? '');
}

function parseSearchHtml(html = '', limit = DEFAULT_LIMIT) {
  const out = [];
  const tags = String(html).match(/<shreddit-post\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const title = attr(tag, 'post-title') || attr(tag, 'title');
    if (!title) continue;
    const permalinkRaw = attr(tag, 'permalink') || attr(tag, 'href');
    const contentHref = attr(tag, 'content-href');
    const postType = attr(tag, 'post-type').toLowerCase();
    const video = /video/.test(postType) || /v\.redd\.it/i.test(contentHref);
    const hasImage = !video &&
      (/image|gallery/.test(postType) || isImageUrl(contentHref));
    const attachmentUrl = hasImage && isImageUrl(contentHref)
      ? preferJpegPreview(contentHref) : '';
    const permalink = permalinkRaw
      ? (permalinkRaw.startsWith('http') ? permalinkRaw : `https://www.reddit.com${permalinkRaw}`)
      : '';
    out.push({ title: title.trim(), permalink, hasImage, attachmentUrl });
    if (out.length >= limit) break;
  }
  return out;
}

function userAgent(env = {}) {
  return env.REDDIT_USER_AGENT || 'web:gemini-chat-sms-bridge:1.0 (contact: configured-owner)';
}

async function oauthToken(env) {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return '';
  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent(env),
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) return '';
  const data = await response.json().catch(() => ({}));
  return String(data?.access_token || '');
}

async function searchOAuth(env, query, limit) {
  const token = await oauthToken(env);
  if (!token) return [];
  const params = new URLSearchParams({ q: query, sort: 'relevance', t: 'all', type: 'link', limit: String(limit), raw_json: '1' });
  const response = await fetch(`https://oauth.reddit.com/search?${params}`, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': userAgent(env) },
  });
  if (!response.ok) return [];
  const json = await response.json().catch(() => ({}));
  return (json?.data?.children || []).map((x) => normalizeApiPost(x?.data || {})).filter((x) => x.title).slice(0, limit);
}

async function searchHtml(env, query, limit) {
  const params = new URLSearchParams({ q: query, sort: 'relevance', t: 'all', type: 'posts' });
  const response = await fetch(`https://www.reddit.com/search/?${params}`, {
    headers: {
      'user-agent': userAgent(env),
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
    },
  });
  if (!response.ok) throw new Error(`Reddit search HTTP ${response.status}`);
  return parseSearchHtml(await response.text(), limit);
}

export function parseRedditCommand(text = '') {
  const source = String(text).normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  let m = source.match(/^(.+?)\s+r검색결과$/u);
  if (m && m[1].trim()) return { kind: 'list', query: m[1].trim(), page: 1, explicitPage: false };
  m = source.match(/^(.+?)\s+r검색결과([1-9]\d*)$/u);
  if (m && m[1].trim()) return { kind: 'list', query: m[1].trim(), page: Number(m[2]), explicitPage: true };
  m = source.match(/^(.+?)\s+r([1-9]\d*)결과$/u);
  if (m && m[1].trim()) return { kind: 'attachment', query: m[1].trim(), index: Number(m[2]) };
  return null;
}

export function formatRedditSearchResults(results = [], allowMms = false) {
  if (!results.length) return 'Reddit 검색 결과가 없습니다.';
  if (!allowMms) return String(results[0]?.title || '').trim() || 'Reddit 검색 결과가 없습니다.';
  return results.map((r, i) => `${i + 1}번 ${String(r.title || '').trim()} (이미지: ${r.hasImage ? '있음' : '없음'})`).join('\n');
}

export async function searchReddit(env, query, limit = DEFAULT_LIMIT) {
  const count = Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIMIT));
  let results = [];
  try { results = await searchOAuth(env, query, count); } catch {}
  if (results.length) return results;
  results = await searchHtml(env, query, count);
  return results;
}

const MAX_JPEG_BYTES = 200 * 1024;

function jpegCandidateUrls(rawUrl) {
  const original = safeUrl(rawUrl);
  if (!isImageUrl(original)) throw new Error('Unsupported Reddit image URL');

  const url = new URL(original);
  const candidates = [];
  const add = (candidate) => {
    if (isImageUrl(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
  };
  const isPreview = url.hostname !== 'i.redd.it';
  const imageIsJpeg = /\.jpe?g$/i.test(url.pathname);

  if (imageIsJpeg || isPreview) add(original);

  const preview = new URL(original);
  if (preview.hostname === 'i.redd.it') preview.hostname = 'preview.redd.it';
  for (const width of [640, 480, 320, 240, 160, 96]) {
    const variant = new URL(preview);
    variant.searchParams.set('width', String(width));
    variant.searchParams.set('format', 'pjpg');
    variant.searchParams.delete('auto');
    // A signature for a different image transformation would no longer match.
    variant.searchParams.delete('s');
    add(variant.toString());
  }
  add(original);
  return candidates;
}

async function limitedJpegBytes(response) {
  if (!response.ok) return null;
  const type = String(response.headers.get('content-type') || '')
    .split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/jpg'].includes(type)) return null;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_JPEG_BYTES) return null;

  const reader = response.body?.getReader();
  let data;
  if (!reader) {
    data = new Uint8Array(await response.arrayBuffer());
  } else {
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_JPEG_BYTES) return null;
        chunks.push(value);
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    data = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) { data.set(part, offset); offset += part.length; }
  }
  if (data.length < 4 || data.length > MAX_JPEG_BYTES ||
      data[0] !== 0xff || data[1] !== 0xd8 ||
      data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
    return null;
  }
  return data;
}

function toBase64(bytes) {
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

export async function fetchRedditJpeg(rawUrl) {
  const candidates = jpegCandidateUrls(rawUrl);
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'image/jpeg,image/*;q=0.8' },
      });
      const data = await limitedJpegBytes(response);
      if (data) {
        return { dataBase64: toBase64(data), mimeType: 'image/jpeg', size: data.length };
      }
    } catch {
      // Try a smaller Reddit JPEG preview.
    }
  }

  // Cloudflare image transformations provide another JPG resize path where enabled.
  for (const width of [480, 320, 160]) {
    try {
      const response = await fetch(candidates[0], {
        cf: { image: { width, fit: 'scale-down', format: 'jpeg', quality: 65 } },
        headers: { accept: 'image/jpeg' },
      });
      const data = await limitedJpegBytes(response);
      if (data) {
        return { dataBase64: toBase64(data), mimeType: 'image/jpeg', size: data.length };
      }
    } catch {
      // Cloudflare image transformations may not be enabled.
    }
  }
  throw new Error('image_cannot_fit_jpg_200kb');
}
