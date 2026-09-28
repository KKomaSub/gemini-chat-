const TARGET_EMAIL = 'ijunu3343@gmail.com';
const ALLOWED_SENDER_NUMBER = '01082161403';
const ALLOWED_SENDER_EMAIL = '01082161403@vmms.nate.com';
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

function extractEmailAddress_(value) {
  const raw = String(value || '').trim().toLowerCase();
  const bracketed = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (bracketed) return bracketed[1];
  const plain = raw.match(/([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  return plain ? plain[1].toLowerCase() : '';
}

function isAllowedSender_(fromValue) {
  const email = extractEmailAddress_(fromValue);
  if (!email) return false;
  return email === ALLOWED_SENDER_EMAIL || email.includes(ALLOWED_SENDER_NUMBER);
}

function pollGeminiMailOnce_(secret, url) {
  // Gmail 단계부터 휴대폰 발신자 메일만 검색한다. 아래 message.getFrom()
  // 검사는 검색 연산자가 넓게 매칭되더라도 다시 한 번 차단하는 이중 필터다.
  const threads = GmailApp.search(`to:${TARGET_EMAIL} is:unread from:${ALLOWED_SENDER_NUMBER}`, 0, 20);
  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (!message.isUnread()) continue;
      if (!String(message.getTo()).toLowerCase().includes(TARGET_EMAIL)) continue;
      if (!isAllowedSender_(message.getFrom())) continue;

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
