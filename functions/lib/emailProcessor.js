import {
  LONG_LIMIT_BYTES,
  MMS_IMAGE_LIMIT_BYTES,
  SMS_LIMIT_BYTES,
  base64ByteLength,
  composePrompt,
  hasMmsMarker,
  sanitizeSolapiText,
  solapiByteLength,
  stripMmsMarker,
  stripMobileMailFooter,
  truncateSolapi,
} from './emailBridge.js';
import { askGeminiForEmail } from './geminiEmail.js';
import { sendSolapiMessage, uploadMmsJpeg } from './solapi.js';
import {
  fetchRedditJpeg,
  formatRedditSearchResults,
  parseRedditCommand,
  searchReddit,
} from './reddit.js';


function splitRedditLines(lines, limit = LONG_LIMIT_BYTES) {
  const chunks = [];
  let current = '';

  for (const rawLine of lines) {
    const line = truncateSolapi(sanitizeSolapiText(rawLine), limit);
    const candidate = current ? `${current}\n${line}` : line;

    if (current && solapiByteLength(candidate) > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function sendRedditNotice(env, text) {
  const safeText = truncateSolapi(sanitizeSolapiText(text), SMS_LIMIT_BYTES);
  const delivery = await sendSolapiMessage(env, { type: 'SMS', text: safeText });
  return {
    ok: true,
    reddit: true,
    type: 'SMS',
    text: safeText,
    textBytes: solapiByteLength(safeText),
    attachmentSent: false,
    solapiGroupId: delivery?.groupInfo?.groupId || delivery?.groupId || null,
    solapiMessageId: delivery?.messageList?.[0]?.messageId || null,
  };
}

async function processRedditCommand(env, command, allowMms) {
  const requested = command.kind === 'attachment' ? command.index : (allowMms ? 100 : 1);
  const results = await searchReddit(env, command.query, requested);

  if (command.kind === 'list') {
    if (!allowMms) {
      const firstTitle = formatRedditSearchResults(results, false);
      return sendRedditNotice(env, firstTitle);
    }

    if (!results.length) {
      return sendRedditNotice(env, 'Reddit 검색 결과가 없습니다.');
    }

    const lines = results.map((result, index) =>
      `${index + 1}번 ${String(result.title || '').trim()} (첨부파일: ${result.hasAttachment ? '있음' : '없음'})`
    );
    const chunks = splitRedditLines(lines, LONG_LIMIT_BYTES);
    const deliveries = [];

    for (const chunk of chunks) {
      const bytes = solapiByteLength(chunk);
      const type = bytes <= SMS_LIMIT_BYTES ? 'SMS' : 'LMS';
      deliveries.push(await sendSolapiMessage(env, { type, text: chunk }));
    }

    return {
      ok: true,
      reddit: true,
      command: 'search',
      type: chunks.length === 1 && solapiByteLength(chunks[0]) <= SMS_LIMIT_BYTES ? 'SMS' : 'LMS',
      text: chunks.join('\n'),
      textBytes: chunks.reduce((sum, chunk) => sum + solapiByteLength(chunk), 0),
      messageCount: chunks.length,
      attachmentSent: false,
      solapiGroupId: deliveries[0]?.groupInfo?.groupId || deliveries[0]?.groupId || null,
      solapiMessageId: deliveries[0]?.messageList?.[0]?.messageId || null,
    };
  }

  const selected = results[command.index - 1];

  if (!selected) {
    return sendRedditNotice(env, `${command.index}번 Reddit 검색 결과가 없습니다.`);
  }
  if (!selected.hasAttachment) {
    return sendRedditNotice(env, `${command.index}번 결과에는 첨부파일이 없습니다.`);
  }
  if (!selected.attachmentUrl) {
    return sendRedditNotice(
      env,
      `${command.index}번 첨부파일은 MMS로 직접 전송할 수 없는 형식입니다.`
    );
  }

  try {
    const jpeg = await fetchRedditJpeg(selected.attachmentUrl);
    const imageId = await uploadMmsJpeg(
      env,
      jpeg.dataBase64,
      `reddit-${command.index}.jpg`
    );
    const text = truncateSolapi(
      `${command.index}번 ${sanitizeSolapiText(selected.title)}`,
      LONG_LIMIT_BYTES
    );
    const delivery = await sendSolapiMessage(env, {
      type: 'MMS',
      text,
      imageId,
    });

    return {
      ok: true,
      reddit: true,
      command: 'attachment',
      type: 'MMS',
      text,
      textBytes: solapiByteLength(text),
      attachmentSent: true,
      solapiGroupId: delivery?.groupInfo?.groupId || delivery?.groupId || null,
      solapiMessageId: delivery?.messageList?.[0]?.messageId || null,
    };
  } catch {
    return sendRedditNotice(
      env,
      `${command.index}번 첨부파일은 MMS로 직접 전송할 수 없습니다.`
    );
  }
}

export async function processEmailBridge(env, raw) {
  const data = {
    messageId: String(raw?.messageId || ''),
    to: String(raw?.to || ''),
    subject: String(raw?.subject || ''),
    body: String(raw?.body || ''),
    attachments: Array.isArray(raw?.attachments) ? raw.attachments : [],
    skippedAttachments: Array.isArray(raw?.skippedAttachments) ? raw.skippedAttachments : [],
  };

  const bodyWithoutMobileFooter = stripMobileMailFooter(data.body);

  if (!bodyWithoutMobileFooter.trim() && !data.subject.trim() && data.attachments.length === 0) {
    throw new Error('empty email');
  }
  if (data.to && !data.to.toLowerCase().includes('ijunu3343@gmail.com')) {
    throw new Error('wrong recipient');
  }

  const allowMms = hasMmsMarker(bodyWithoutMobileFooter);
  const cleanBody = allowMms ? stripMmsMarker(bodyWithoutMobileFooter) : bodyWithoutMobileFooter;

  const redditCommand = parseRedditCommand(cleanBody);
  if (redditCommand) {
    return processRedditCommand(env, redditCommand, allowMms);
  }

  const prompt = composePrompt({ subject: data.subject, body: cleanBody, skippedAttachments: data.skippedAttachments });
  const gemini = await askGeminiForEmail(env, { prompt, attachments: data.attachments, allowMms });

  let text = sanitizeSolapiText(gemini.text || '');
  let imageId = '';
  let attachmentSent = false;

  if (!allowMms) {
    if (!text) text = '문자로 보낼 수 있는 형식의 응답을 생성하지 못했습니다.';
    text = truncateSolapi(text, SMS_LIMIT_BYTES);
  } else {
    if (!text) text = gemini.images.length ? '요청하신 이미지입니다.' : '응답을 생성하지 못했습니다.';
    text = truncateSolapi(text, LONG_LIMIT_BYTES);
    const jpeg = gemini.images.find((img) =>
      ['image/jpeg', 'image/jpg'].includes(String(img.mimeType).toLowerCase()) &&
      base64ByteLength(img.data) <= MMS_IMAGE_LIMIT_BYTES
    );
    if (jpeg) {
      try {
        imageId = await uploadMmsJpeg(env, jpeg.data, 'gemini.jpg');
        attachmentSent = true;
      } catch {}
    }
  }

  const textBytes = solapiByteLength(text);
  const type = attachmentSent ? 'MMS' : (!allowMms || textBytes <= SMS_LIMIT_BYTES ? 'SMS' : 'LMS');
  const delivery = await sendSolapiMessage(env, { type, text, imageId });

  return {
    ok: true,
    messageId: data.messageId,
    allowMms,
    type,
    text,
    textBytes,
    attachmentSent,
    solapiGroupId: delivery?.groupInfo?.groupId || delivery?.groupId || null,
    solapiMessageId: delivery?.messageList?.[0]?.messageId || null,
  };
}
