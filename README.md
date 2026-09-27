# gemini-chat

JavaScript가 차단된 브라우저/HTML 뷰어에서도 사용할 수 있도록 만든 **HTML form + Cloudflare Pages Functions + Gemini API** 채팅입니다.

## 동작 구조

1. `public/index.html`의 `<form method="POST">`가 `/api/chat`으로 메시지를 보냅니다.
2. `functions/api/chat.js`가 `Request.formData()`로 메시지를 읽습니다.
3. 서버에서 Gemini API를 호출합니다. API 키는 브라우저로 내려가지 않습니다.
4. 서버가 대화 내용이 포함된 완성 HTML 문서를 응답합니다.
5. 다음 질문은 hidden `history` 값으로 최근 대화를 다시 서버에 보냅니다. 별도 DB가 필요 없습니다.

클라이언트 JavaScript, `fetch()`, XHR, SPA 라우팅은 사용하지 않습니다.

## Cloudflare Pages 배포

GitHub 저장소를 Cloudflare Pages에 연결하고 다음처럼 설정합니다.

- Production branch: `main`
- Framework preset: `None`
- Build command: 비워 둠
- Build output directory: `public`

그리고 **Settings → Variables and Secrets**에서 아래 Secret을 추가합니다.

- `GEMINI_API_KEY` : Google AI Studio에서 발급한 Gemini API Key

선택 환경변수:

- `GEMINI_MODEL` : 기본값 `gemini-3.5-flash-lite`
- `GEMINI_SYSTEM_PROMPT` : 원하는 시스템 프롬프트

API 키는 반드시 Cloudflare의 **Secret**으로 저장하고 저장소나 HTML에 직접 넣지 마세요.

## 사용

배포된 Pages 주소를 열고 메시지를 입력한 뒤 **보내기**를 누릅니다. 페이지 이동이 허용되는 HTML 뷰어라면 JavaScript가 꺼져 있어도 동작합니다.

`/iframe.html`은 `<form target="resultFrame">` 방식의 실험용 화면입니다. HTML 뷰어가 iframe navigation을 허용하면 서버 응답이 아래 프레임에 표시됩니다.

## 제한 사항

- 이 프로젝트는 **웹 폼 ↔ Gemini** 통신입니다. HTML만으로 휴대폰의 SMS 수신함을 자동 감시하거나 이동통신망 SMS를 자동 발송할 수는 없습니다.
- 로컬 `file://`로 HTML을 직접 열 경우 `/api/chat` 같은 상대 경로는 배포 서버를 가리키지 않습니다. 기본 사용 방식은 Cloudflare Pages에 배포한 URL을 직접 여는 것입니다.
- 대화 기록은 별도 DB에 저장하지 않고 폼의 hidden field로 왕복하며 최근 12개 메시지만 유지합니다.

## 테스트

Node.js 20+ 환경에서:

```bash
npm test
```
