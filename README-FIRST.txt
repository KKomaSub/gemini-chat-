Gemini Chat - Samsung HTML Viewer ERR_CACHE_MISS 해결판
========================================================

문제 원인
---------
삼성/Android 기본 HTML Viewer는 내부 WebView에서 네트워크 로드를 차단합니다.
그래서 로컬 HTML에서 HTTPS 주소로 POST를 해도 HTML Viewer 자체가 서버를 열려고 하면
net::ERR_CACHE_MISS가 발생할 수 있습니다.

이번 수정 방식
-------------
1) 로컬 Gemini-Chat-HTML-Viewer.html은 JavaScript 없이 GET form만 사용합니다.
2) 첫 질문을 보내면 다음 주소로 GET 이동합니다.
   https://gemini-chat-no-wifi.pages.dev/api/chat?message=...
3) Android HTML Viewer의 링크 내비게이션 처리를 이용해 해당 HTTPS 주소를
   외부 브라우저가 열도록 합니다.
4) 서버가 Gemini API를 호출한 뒤 브라우저에 응답 HTML을 표시합니다.
5) 그 다음 질문부터는 브라우저 안에서 POST form으로 계속 대화합니다.

중요: 서버 파일도 교체해야 함
-----------------------------
기존 /api/chat은 GET 질문을 처리하지 않으므로 ZIP의 functions/api/chat.js를
Cloudflare Pages에 배포해야 합니다. GitHub를 사용할 필요는 없습니다.

기존 Pages 프로젝트 이름:
  gemini-chat-no-wifi
주소:
  https://gemini-chat-no-wifi.pages.dev/

Wrangler로 GitHub 없이 배포
---------------------------
1. 이 ZIP을 PC에서 압축 해제합니다.
2. 명령 프롬프트/터미널에서 압축 해제한 폴더로 이동합니다.
3. Cloudflare 로그인:
     npx wrangler login
4. 현재 프로젝트로 배포:
     npx wrangler pages deploy public --project-name gemini-chat-no-wifi

주의: 위 명령은 반드시 이 폴더의 루트(functions 폴더가 보이는 위치)에서 실행해야
functions/api/chat.js도 같이 배포됩니다.

Cloudflare 환경변수
------------------
Pages 프로젝트의 Settings -> Variables and Secrets에 다음 Secret이 있어야 합니다.
  GEMINI_API_KEY = 본인의 Gemini API Key

선택값:
  GEMINI_MODEL = gemini-3.5-flash-lite
  GEMINI_SYSTEM_PROMPT = 원하는 시스템 프롬프트

휴대폰 사용
----------
배포 후 이 파일만 휴대폰으로 복사:
  Gemini-Chat-HTML-Viewer.html

삼성 HTML Viewer로 열고 질문 -> 보내기.
첫 질문은 외부 브라우저로 넘어가며 Gemini 답변이 표시되어야 합니다.

만약 '어떤 앱으로 열까요?'가 나오면 Chrome/삼성 인터넷 등 실제 브라우저를 선택하세요.
HTML Viewer를 다시 선택하면 네트워크 차단 때문에 같은 문제가 반복됩니다.

기술적 변경점
-------------
- HTML Viewer 초기 폼: POST -> GET 변경
- form action: https://gemini-chat-no-wifi.pages.dev/api/chat 절대주소 유지
- /api/chat GET 처리 추가
- 브라우저에서 이어지는 대화는 POST 유지
- JavaScript/fetch/XHR 없음
- API Key는 서버에만 저장
- 사용자/Gemini 출력 HTML escape 처리
