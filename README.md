# Career Evidence — Google Drive Sync v2.1

## 핵심 흐름

1. 앱에서 원본 기록 작성
2. 저장 시 브라우저 LocalStorage에 즉시 저장
3. Google Drive가 연결되어 있으면 같은 기록을 Markdown 파일로 Drive의 `Career Evidence` 폴더에 저장
4. 전체 JSON 백업(`career-evidence-backup.json`)도 Drive에 갱신
5. ChatGPT는 Drive의 Markdown 원본을 읽고, 원본을 덮어쓰지 않은 채 구조화된 `CAREER_EVIDENCE_AI_REVIEW` 댓글을 작성
6. 앱의 `AI 검토본만 새로고침`을 누르면 댓글을 읽어서 앱의 AI 피드백/수정본 영역에 반영
7. 반영된 AI 검토본은 다시 Markdown 파일에도 기록

이 구조는 **원본은 앱만 수정하고, ChatGPT는 댓글만 작성**하므로 충돌 위험을 낮춥니다.

## Google OAuth 설정 — 최초 1회

이 버전은 정적 브라우저 앱입니다. Google Drive API를 쓰려면 본인 Google Cloud 프로젝트의 **OAuth Web Client ID**가 필요합니다.

1. Google Cloud Console에서 프로젝트 생성 또는 선택
2. `Google Drive API` 활성화
3. OAuth 동의 화면 구성
   - 개인 사용이면 Testing 상태로 두고 본인 Google 계정을 Test user로 추가해도 됨
4. OAuth Client 생성 → Application type: `Web application`
5. Authorized JavaScript origins에 실제 배포 주소 추가
   - 예: `https://career-evidence.vercel.app`
6. 생성된 `...apps.googleusercontent.com` Client ID를 앱의 `동기화` 탭에 입력
7. `Google Drive 연결` 클릭 후 권한 승인

### 중요

- OAuth는 `file://` 로 직접 연 HTML에서 안정적으로 동작하지 않습니다. **HTTPS로 배포**해야 합니다.
- Vercel 같은 정적 호스팅에 이 폴더 전체를 배포하면 됩니다.
- 앱은 `https://www.googleapis.com/auth/drive.file` 권한만 요청합니다. 이는 이 앱이 사용하는 특정 Drive 파일을 만들고 편집하기 위한 제한 범위입니다.
- Access Token은 LocalStorage에 저장하지 않고 현재 페이지 메모리에만 유지합니다. 새로고침 시 이전 연결 설정을 바탕으로 무음 토큰 재요청을 시도합니다. 자동 복구가 불가능하면 `Google Drive 다시 연결`을 누르세요.

## ChatGPT 검토 방법

앱의 `동기화` 탭에서 `ChatGPT 검토 요청문 복사`를 누른 뒤 ChatGPT에 붙여넣습니다. 실제 원문을 복사할 필요는 없습니다.

ChatGPT가 Drive 파일에 아래 마커로 시작하는 댓글을 만들면 앱이 읽을 수 있습니다.

```text
CAREER_EVIDENCE_AI_REVIEW
{...JSON...}
```

## 파일 구조

Drive에는 대략 다음처럼 저장됩니다.

```text
Career Evidence/
├─ 2026-09-06_교환 건 CS 처리.md
├─ 2026-09-XX_다른 기록.md
└─ career-evidence-backup.json
```

## 데이터 안전

회사 기밀, 고객 개인정보, 주문번호, 사번, 내부 시스템 캡처는 저장하지 마세요. 외부 이직 포트폴리오에 재사용할 수 있도록 익명화된 사실과 본인의 행동·결과 중심으로 기록하는 것을 권장합니다.


## v2.1 — 새로고침 후 인증 복구

- 기존 OAuth Client ID 저장 키와 경력 기록 저장 키를 유지했습니다. 기존 화면 구성, 원본/AI 검토 구분, Markdown 업로드와 JSON 백업 방식은 유지합니다.
- 성공적으로 연결하면 공개 Client ID와 자동 재연결 여부(`reconnectEnabled`)를 LocalStorage에 저장합니다. 액세스 토큰은 메모리에만 보관합니다. 비밀번호, Client Secret, refresh token은 저장하지 않습니다.
- 업데이트 후 처음 한 번은 연결 버튼을 눌러야 합니다. 이전 v2에는 연결 여부 저장 값이 없으므로 Client ID만 있다고 자동 인증을 실행하지 않습니다.
- 이후 새로고침 시 Google 인증 라이브러리를 최대 10초 기다리고, GIS OAuth token flow의 `requestAccessToken({prompt:'none'})`을 한 번 시도합니다. 성공하면 새 토큰으로 저장/동기화할 수 있습니다.
- 이는 항상 성공하는 백그라운드 로그인 보장이 아닙니다. GIS 토큰 흐름은 팝업을 사용할 수 있어 브라우저의 팝업 정책, 쿠키 정책, Google 로그인/동의 상태에 따라 실패합니다. 실패하거나 12초 동안 응답이 없으면 기존 버튼이 `Google Drive 다시 연결`로 표시됩니다. 버튼을 직접 누르면 사용자 동작으로 다시 요청합니다.
- 만료 30초 전 또는 Drive의 401 응답 시 토큰을 버리고 재연결 안내를 표시합니다. 실패한 업로드를 자동 반복하지 않습니다. 재연결 후 `Drive 동기화`로 로컬 기록을 업로드하세요.
- 복구 요청 진행 중 저장한 기록은 먼저 로컬에 저장하고, 복구 결과를 기다린 뒤 성공한 경우 Drive에 저장합니다. 복구 시작 전 또는 미연결 상태에 저장한 기록은 나중에 `Drive 동기화`로 올리세요.
- `연결 해제`는 메모리 토큰과 자동 재연결 설정을 해제합니다. Google 전체 로그아웃이나 OAuth 권한 철회는 아니며, 기록 및 Drive 파일은 삭제하지 않습니다.
- 다른 Client ID를 저장하면 현재 토큰과 폴더/전체 백업 식별자를 초기화합니다. 개별 기록의 기존 Drive 파일 ID는 보존합니다. 다른 계정/프로젝트로 바꾸면 해당 파일 권한이 없어 동기화가 실패할 수 있습니다.
- 브라우저 저장소 삭제, 시크릿 모드 종료, 다른 브라우저나 다른 사이트 주소에서는 설정이 이어지지 않습니다. 로컬 기록 보존을 위해 기존 배포 주소에서 업데이트하세요.
- 서비스 워커 캐시는 공개 앱 파일만 대상으로 제한했습니다. OAuth 및 Drive 응답은 캐시하지 않으며 이전 앱 캐시는 업데이트 시 제거됩니다.

## 배포 및 실제 계정 확인

이 폴더의 파일을 기존 HTTPS 배포에 덮어쓰세요. 설치된 앱이 이전 코드를 보여주면 온라인 상태에서 앱을 닫았다가 다시 열고 새로고침하세요. 사이트 데이터 삭제는 로컬 기록을 지우므로 업데이트 방법으로 사용하지 마세요.

1. 동기화 탭에서 저장된 Client ID를 확인하고 Drive를 연결합니다.
2. 테스트 기록을 저장하고 Drive에서 Markdown 원문과 전체 JSON 백업의 내용이 일치하는지 확인합니다.
3. 새로고침 후 `DRIVE ON`으로 복구되는지 확인합니다. 자동 복구가 막히면 `다시 연결` 버튼으로 복구합니다.
4. 같은 기록을 수정·저장하고 Drive 파일이 갱신되는지 확인합니다.
5. `Drive 동기화` 및 `AI 검토본만 새로고침`을 실행합니다.
6. 연결 해제 후 새로고침하면 자동 연결되지 않는지 확인합니다.

## 이번 검증 범위

Node 기반 모의 DOM/GIS/Drive 응답 테스트 통과: 새로고침의 무음 요청, 팝업 실패와 재연결, 연결 해제 후 늦은 응답 무시, 타임아웃, 권한 부족, Client ID 변경, 토큰 만료 및 401, Markdown 생성 업로드, JSON 백업 내용, AI 댓글 조회 경로.

실제 Google 계정 로그인, 실제 Drive 저장 및 브라우저별 팝업 동작은 이 작업에서 검증하지 않았습니다. 위 절차로 배포 후 확인해야 합니다. 서버 배포는 수행하지 않았습니다.

공식 참고:
- https://developers.google.com/identity/oauth2/web/reference/js-reference
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
