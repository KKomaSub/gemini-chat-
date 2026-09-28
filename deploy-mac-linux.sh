#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
npx wrangler login
npx wrangler pages deploy public --project-name gemini-chat-no-wifi
