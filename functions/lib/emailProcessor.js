import {
  LONG_LIMIT_BYTES,
  MMS_IMAGE_LIMIT_BYTES,
  SMS_LIMIT_BYTES,
  base64ByteLength,
  composePrompt,
  hasMmsMarker,
  solapiByteLength,
  stripMmsMarker,
  truncateSolapi,
} from './emailBridge.js';
import { askGeminiForEmail } from './geminiEmail.js';
import { sendSolapiMessage, uploadMmsJpeg } from './solapi.js';

export async function processEmailBridge(env, raw) {
  const data = {
    messageId: String(raw?.messageId || ''),
    to: String(raw?.to || ''),
    subject: String(raw?.subject || ''),
    body: String(raw?.body || ''),
    attachments: Array.isArray(raw?.attachments) ? raw.attachments : [],
    skippedAttachments: Array.isArray(raw?.skippedAttachments) ? raw.skippedAttachments : [],
  };

  if (!data.body.trim() && !data.subject.trim() && data.attachments.length === 0) {
    throw new Error('empty email');
  }
  if (data.to && !data.to.toLowerCase().includes('ijunu3343@gmail.com')) {
    throw new Error('wrong recipient');
  }

  const allowMms = hasMmsMarker(data.body);
  const cleanBody = allowMms ? stripMmsMarker(data.body) : data.body;
  const prompt = composePrompt({ subject: data.subject, body: cleanBody, skippedAttachments: data.skippedAttachments });
  const gemini = await askGeminiForEmail(env, { prompt, attachments: data.attachments, allowMms });

  let text = gemini.text || '';
  let imageId = '';
  let attachmentSent = false;

  if (!allowMms) {
    if (!text) text = '파일/이미지 응답은 <mms가능> 없이 전송할 수 없습니다.';
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
    solapiGroupId: delivery?.groupId || null,
  };
}
