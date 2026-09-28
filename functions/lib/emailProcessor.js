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
