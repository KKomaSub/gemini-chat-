# Gmail → Gemini → SOLAPI 문자 브리지

공신폰에서 `ijunu3343@gmail.com`으로 메일을 보내면 Google Apps Script가 1분 트리거 안에서 0초·20초·40초에 읽지 않은 메일을 확인하고, Cloudflare Pages Function이 Gemini에 질문한 뒤 SOLAPI로 답변 문자를 발송합니다.

## 전송 규칙

- 메일 제목·본문·지원되는 첨부파일을 Gemini에 함께 전달합니다.
- 메일 **본문의 마지막이 정확히 `<mms가능>`**으로 끝나야 장문/이미지 응답을 허용합니다. 뒤 공백/줄바꿈은 허용합니다.
- `<mms가능>`이 없으면 Gemini에 파일/이미지 생성 금지와 짧은 평문 응답을 지시하고, 서버에서 다시 강제 검사합니다.
- 표시가 없는데 Gemini가 이미지/파일을 반환해도 폐기합니다.
- 표시가 없으면 최종 답변은 `...`까지 포함해서 **90byte 이하**가 되도록 자르고, `type: SMS`, `autoTypeDetect: false`로 전송합니다.
- `<mms가능>`이 있으면 90byte 이하는 SMS, 90byte 초과 2,000byte 이하는 LMS입니다.
- `<mms가능>`이 있고 Gemini가 실제 JPEG를 반환하며 200KB 이하이고 SOLAPI Storage 업로드가 성공하면 MMS로 전송합니다.
- 2,000byte를 넘는 답변은 `...`까지 포함해 2,000byte 이하로 자릅니다.
- SOLAPI MMS는 임의 파일 첨부가 아니라 JPG 이미지 첨부 방식이므로 PDF/ZIP 같은 출력 파일은 MMS 첨부로 보내지 않습니다.

## Cloudflare Pages 환경변수 / Secret

필수:

- `GEMINI_API_KEY`
- `SOLAPI_API_KEY`
- `SOLAPI_API_SECRET`
- `SOLAPI_FROM` — SOLAPI에 등록된 발신번호
- `SOLAPI_TO` — 공신폰 수신번호
- `EMAIL_WEBHOOK_SECRET` — 충분히 긴 임의 문자열

선택:

- `GEMINI_MODEL` — 미설정 시 `gemini-3.5-flash-lite`
- `GEMINI_MMS_MODEL` — 이미지 출력을 허용할 Gemini 이미지 모델. 미설정이면 `<mms가능>`이 있어도 텍스트 SMS/LMS만 사용합니다.
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` — Reddit OAuth 앱 자격증명. 설정하면 Reddit 명령이 공식 OAuth 검색을 우선 사용합니다.
- `REDDIT_USER_AGENT` — Reddit API용 User-Agent. 미설정 시 기본값을 사용합니다.

Pages 배포 후 상태 확인:

`GET /api/inbox`

정상 응답:

```json
{"ok":true}
```

## Gmail Apps Script 설정

1. `ijunu3343@gmail.com` 계정으로 Google Apps Script 프로젝트를 만듭니다.
2. 저장소의 `apps-script/Code.gs`를 붙여넣습니다.
3. **프로젝트 설정 → 스크립트 속성**에 `WEBHOOK_SECRET`을 추가하고 Cloudflare의 `EMAIL_WEBHOOK_SECRET`과 같은 값을 입력합니다.
4. 배포 도메인이 다르면 `WEBHOOK_URL`에 `https://도메인/api/inbox`를 입력합니다. 현재 기본값은 `https://gemini-chat-no-wifi.pages.dev/api/inbox`입니다.
5. `setupGeminiSmsBridge()`를 한 번 실행해 Gmail/외부 요청 권한을 승인합니다.
6. 이후 `pollGeminiMail()`이 1분마다 실행되며, 한 번의 실행 안에서 약 0초·20초·40초에 총 3회 확인합니다.

성공한 메일만 읽음 처리합니다. Gemini/SOLAPI/Cloudflare 오류가 발생하면 읽지 않은 상태를 유지해 다음 실행에서 재시도합니다.

## 첨부파일

Apps Script는 일반 첨부파일을 Base64로 전달합니다. 최대 10개, 원본 합계 12MB까지만 전달합니다. 이미지·오디오·비디오·텍스트·PDF/JSON 등 지원 MIME은 Gemini `inlineData`로 전달됩니다. 제한 때문에 생략된 파일은 파일명과 생략 사유를 프롬프트에 포함합니다.


## Reddit 검색 명령

휴대폰 발신 메일의 고정 푸터와 마지막 `<mms가능>` 표시를 제거한 본문으로 명령을 판별합니다. Reddit 명령은 Gemini를 호출하지 않습니다.

- `검색어 r검색결과`: `<mms가능>` 없으면 첫 검색 결과 **제목만** 90byte 이내 SMS로 전송합니다. `<mms가능>` 있으면 각 결과를 `1번 제목 (이미지: 있음/없음)` 형식으로 표시하며, 2,000byte를 넘으면 첫 페이지만 전송합니다.
- `검색어 r검색결과N`: N이 2 이상이면 앞 페이지에서 잘린 다음 구간(최대 2,000byte)만 전송합니다. 자동 연속 전송하지 않습니다.
- `검색어 rN결과`: N번째 결과의 **이미지만** 전송합니다. 이미지가 없으면 `N번 결과에는 이미지가 없습니다.`라고 답합니다.
  - Reddit의 작은 JPEG 미리보기(너비 640→480→320→240→160→96)를 순서대로 시도해 원본 JPG/PNG/WebP 등을 200KB 이하 **JPG로 변환한 결과**를 가져옵니다.
  - Cloudflare 이미지 변환이 지원되는 환경에서는 추가 JPG 리사이즈도 시도합니다.
  - 실제 파일 데이터가 JPEG이고 **200KB 이하인 경우에만** SOLAPI MMS로 전송합니다.
  - 변환에 실패하면 안내 SMS만 전송하며 **동영상·대용량 미디어 링크·보조 발송폰 게이트웨이로 우회하지 않습니다.**

Reddit API 사용 정책에 따라 공개 HTML 검색이 차단될 수 있습니다. 안정적인 검색을 위해서는 Cloudflare에 `REDDIT_CLIENT_ID`와 `REDDIT_CLIENT_SECRET`을 설정하는 것이 좋습니다. 사용자의 삼성 기본 메시지 앱이나 별도 SMS 게이트웨이 앱 설정은 변경하지 않습니다.


## 테스트

```bash
npm test
```

테스트는 `<mms가능>` 판정, 90byte 강제 절단, 첨부 전달, LMS 선택, JPEG MMS 업로드, Webhook 인증, Apps Script 20초 근사 폴링, Reddit 명령 분기, Gemini 우회, 이미지 여부 표시, 200KB 이하 JPEG 재요청/변환, 동영상 전송 차단, Reddit MMS 전송을 검증합니다.
