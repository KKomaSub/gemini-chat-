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
  try { return REDDIT_MEDIA_HOSTS.has(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
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
  const attachmentUrl = findRedditImage(post);
  const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : '';
  const videoUrl = safeUrl(
    post.secure_media?.reddit_video?.fallback_url ||
    post.media?.reddit_video?.fallback_url ||
    ''
  );
  const contentUrl = safeUrl(post.url_overridden_by_dest || post.url || '');
  const hasAttachment = Boolean(
    attachmentUrl || post.is_gallery || post.post_hint === 'image' ||
    post.post_hint === 'hosted:video' || post.post_hint === 'rich:video' ||
    post.secure_media?.reddit_video || post.media?.reddit_video
  );
  return {
    title: String(post.title || '').trim(),
    permalink,
    hasAttachment,
    attachmentUrl,
    mediaUrl: videoUrl || contentUrl || attachmentUrl || permalink,
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
    const attachmentUrl = isRedditMediaUrl(contentHref) ? preferJpegPreview(contentHref) : '';
    const hasAttachment = Boolean(attachmentUrl || /image|video|gallery|media/.test(postType));
    const permalink = permalinkRaw
      ? (permalinkRaw.startsWith('http') ? permalinkRaw : `https://www.reddit.com${permalinkRaw}`)
      : '';
    const mediaUrl = safeUrl(contentHref) || attachmentUrl || permalink;
    out.push({ title: title.trim(), permalink, hasAttachment, attachmentUrl, mediaUrl });
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
  return results.map((r, i) => `${i + 1}번 ${String(r.title || '').trim()} (첨부파일: ${r.hasAttachment ? '있음' : '없음'})`).join('\n');
}

export async function searchReddit(env, query, limit = DEFAULT_LIMIT) {
  const count = Math.max(1, Math.min(100, Number(limit) || DEFAULT_LIMIT));
  let results = [];
  try { results = await searchOAuth(env, query, count); } catch {}
  if (results.length) return results;
  results = await searchHtml(env, query, count);
  return results;
}

export async function fetchRedditJpeg(url) {
  if (!isRedditMediaUrl(url)) throw new Error('Reddit attachment URL is not an approved Reddit media host');
  const response = await fetch(url, { headers: { accept: 'image/jpeg,image/*;q=0.8' } });
  if (!response.ok) throw new Error(`Reddit attachment HTTP ${response.status}`);
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 200 * 1024) throw new Error('Reddit attachment is larger than 200KB');
  if (type !== 'image/jpeg' && type !== 'image/jpg') throw new Error(`Reddit attachment is not JPEG (${type || 'unknown'})`);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return { dataBase64: btoa(binary), mimeType: 'image/jpeg', size: bytes.byteLength };
}
