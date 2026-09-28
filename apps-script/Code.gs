const TARGET_EMAIL = 'ijunu3343@gmail.com';
const DEFAULT_WEBHOOK_URL = 'https://gemini-chat-no-wifi.pages.dev/api/inbox';
const MAX_ATTACHMENT_COUNT = 10;
const MAX_TOTAL_ATTACHMENT_BYTES = 12 * 1024 * 1024;

function setupGeminiSmsBridge() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WEBHOOK_SECRET')) {
    throw new Error('Script Properties에 WEBHOOK_SECRET을 설정하세요.');
  }

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'pollGeminiMail')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('pollGeminiMail')
    .timeBased()
    .everyMinutes(1)
    .create();
}

function pollGeminiMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Previous Gmail polling execution is still running; skip this trigger.');
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const secret = props.getProperty('WEBHOOK_SECRET');
    const url = props.getProperty('WEBHOOK_URL') || DEFAULT_WEBHOOK_URL;
    if (!secret) throw new Error('WEBHOOK_SECRET이 없습니다.');

    const POLL_INTERVAL_MS = 20000;
    for (let cycle = 0; cycle < 3; cycle++) {
      const startedAt = Date.now();
      pollGeminiMailOnce_(secret, url);

      if (cycle < 2) {
        const elapsed = Date.now() - startedAt;
        const waitMs = Math.max(0, POLL_INTERVAL_MS - elapsed);
        if (waitMs > 0) Utilities.sleep(waitMs);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function pollGeminiMailOnce_(secret, url) {
  const threads = GmailApp.search(`to:${TARGET_EMAIL} is:unread`, 0, 20);
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (!message.isUnread()) continue;
      if (!String(message.getTo()).toLowerCase().includes(TARGET_EMAIL)) continue;

      try {
        const payload = buildPayload_(message);
        const response = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'X-Email-Webhook-Secret': secret },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });

        const code = response.getResponseCode();
        let parsed = {};
        try { parsed = JSON.parse(response.getContentText()); } catch (_) {}

        if (code >= 200 && code < 300 && parsed.ok === true) {
          message.markRead();
        } else {
          console.error(`Bridge failed: HTTP ${code} ${response.getContentText()}`);
        }
      } catch (error) {
        console.error(`Bridge exception for ${message.getId()}: ${error && error.stack || error}`);
      }
    }
  }
}

function buildPayload_(message) {
  const attachments = [];
  const skippedAttachments = [];
  let totalBytes = 0;

  const files = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });

  for (const file of files.slice(0, MAX_ATTACHMENT_COUNT)) {
    const bytes = file.getBytes();
    const size = bytes.length;
    const name = file.getName() || 'attachment';

    if (totalBytes + size > MAX_TOTAL_ATTACHMENT_BYTES) {
      skippedAttachments.push({ name, reason: '첨부파일 합계 12MB 제한 초과' });
      continue;
    }

    attachments.push({
      name,
      mimeType: file.getContentType() || 'application/octet-stream',
      size,
      dataBase64: Utilities.base64Encode(bytes),
    });
    totalBytes += size;
  }

  if (files.length > MAX_ATTACHMENT_COUNT) {
    for (const file of files.slice(MAX_ATTACHMENT_COUNT)) {
      skippedAttachments.push({
        name: file.getName() || 'attachment',
        reason: '첨부파일 10개 제한 초과',
      });
    }
  }

  return {
    messageId: message.getId(),
    from: message.getFrom(),
    to: message.getTo(),
    subject: message.getSubject(),
    body: message.getPlainBody(),
    attachments,
    skippedAttachments,
  };
}

function testPollNow() {
  pollGeminiMail();
}
