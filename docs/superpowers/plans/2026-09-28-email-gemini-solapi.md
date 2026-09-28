# Email Gemini SOLAPI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Gmail prompts and attachments through Gemini and deliver enforced SMS/LMS/MMS replies with SOLAPI.

**Architecture:** Apps Script polls unread Gmail and POSTs an authenticated JSON envelope to a Cloudflare Pages Function. The Function sends supported attachments to Gemini, applies the `<mms가능>` output policy, then delivers via SOLAPI with explicit message types.

**Tech Stack:** Cloudflare Pages Functions, Gemini REST API, SOLAPI REST API, Google Apps Script, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-28-email-gemini-solapi-design.md`

## Global Constraints
- `<mms가능>` must appear at the trimmed end of the email body.
- No marker: <=90 bytes including `...`, no output attachment, explicit SMS.
- Marker: <=2000 bytes, LMS when >90 bytes, MMS only for valid <=200KB JPEG.
- Secrets are not committed.

## Review Focus
- Mixed Korean/ASCII truncation never exceeds the selected byte limit.
- Gemini media never leaks into no-marker responses.
- Webhook authentication fails closed.
- Unsupported/oversized email attachments do not crash processing.
- MMS image upload failure degrades to text delivery.

---

### Task 1: Policy and SOLAPI helpers
**Files:** `functions/lib/emailBridge.js`, `functions/lib/solapi.js`, `tests/email-bridge.test.mjs`
- [x] Write marker, byte, and truncation tests.
- [x] Implement helpers and HMAC SOLAPI client.
- [x] Verify tests.

### Task 2: Gemini and bridge processor
**Files:** `functions/lib/geminiEmail.js`, `functions/lib/emailProcessor.js`, `functions/api/inbox.js`
- [x] Test authentication, input attachments, SMS enforcement, LMS, and MMS upload.
- [x] Implement Gemini orchestration and explicit delivery type selection.
- [x] Verify tests.

### Task 3: Gmail poller and operations docs
**Files:** `apps-script/Code.gs`, `README-SMS-BRIDGE.md`
- [x] Add one-minute poll setup and success-only mark-read behavior.
- [x] Add attachment envelope limits and Script Properties configuration.
- [x] Verify static configuration and test suite.
