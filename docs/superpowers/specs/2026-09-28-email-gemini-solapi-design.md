# Email → Gemini → SOLAPI bridge design

The Cloudflare Pages project receives authenticated JSON from a Gmail Apps Script poller. Email subject/body and supported small attachments are sent to Gemini. The body suffix `<mms가능>` is the only opt-in for long or multimedia output.

Without the suffix, Gemini is instructed to return plain text only and the server enforces the boundary again: all media is discarded and text is truncated to at most 90 SOLAPI bytes, including the trailing `...` when truncation occurs. With the suffix, text may reach 2,000 bytes; text over 90 bytes is LMS, and a JPEG no larger than 200KB returned by an image-capable Gemini model can be uploaded to SOLAPI Storage and delivered as MMS.

Secrets remain in Cloudflare environment variables and Apps Script properties. The Gmail poller marks a message read only after the bridge returns success so temporary failures retry on the next one-minute poll.
