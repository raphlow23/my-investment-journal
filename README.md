# My Investment Journal

로컬 우선 주식 매매일지 PWA입니다. 매매 기록, 포지션 계산, 투자 논리, 사전 매수 점검, 교체매매 비교, 월간 복기, export, Firebase 사용자별 동기화, Google Drive appDataFolder 암호화 백업을 지원합니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다.

## Firebase 자동 동기화 설정

Firebase Console에서 웹 앱을 만들고 Authentication의 Google 로그인을 켭니다. Firestore Database를 만든 뒤 `firestore.rules` 내용을 보안 규칙에 적용합니다.

Authentication의 Authorized domains에 다음 주소가 포함되어 있어야 합니다.

- 개발: `localhost`
- 배포: `my-investment-journal.vercel.app` 또는 실제 배포 도메인

`.env.example`을 참고해 `.env`에 Firebase 웹 앱 설정을 입력합니다.

```bash
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-firebase-app-id
```

Firestore 저장 경로는 사용자별로 분리됩니다.

- `users/{uid}/accounts`
- `users/{uid}/instruments`
- `users/{uid}/tradeLogs`
- `users/{uid}/positionPlans`
- `users/{uid}/priceSnapshots`
- `users/{uid}/preTradeChecklists`
- `users/{uid}/switchReviews`
- `users/{uid}/monthlyReviews`

로그인하지 않으면 기존처럼 IndexedDB 로컬 모드로 동작합니다. 로그인하면 로컬 데이터 업로드, 클라우드 데이터 가져오기, 병합, 취소 중 하나를 선택할 수 있습니다.

Google 로그인은 `signInWithPopup`을 먼저 실행하고, Whale 브라우저나 팝업 차단 환경에서 막히면 `signInWithRedirect`로 자동 전환합니다. Google Drive appDataFolder 확장을 위해 Firebase Google provider에도 `https://www.googleapis.com/auth/drive.appdata` scope를 포함합니다.

## 빌드

```bash
npm run build
```

생성된 `dist` 폴더를 Vercel 또는 Netlify에 배포할 수 있습니다.

## Google Drive 선택 백업 설정

1. Google Cloud Console에서 OAuth 2.0 Client ID를 생성합니다.
2. 승인된 JavaScript 원본에 로컬/배포 주소를 추가합니다.
   - 로컬: `http://127.0.0.1:5173`
   - 배포: Vercel 또는 Netlify 도메인
3. `.env.example`을 참고해 `.env`를 만들고 값을 입력합니다.

```bash
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

자동 연동은 Firebase가 담당합니다. Google Drive는 선택 백업/복원용입니다. 앱은 Google Drive 전체 권한을 요청하지 않고 `https://www.googleapis.com/auth/drive.appdata` scope만 사용합니다. 사용자의 매매 데이터는 브라우저에서 Web Crypto API로 암호화된 뒤 `encrypted-investment-journal.json` 파일로 appDataFolder에 저장됩니다.

## 현재가 자동 업데이트

MVP에서는 국내 주식, 국내 ETF, 환율은 수동 입력을 기본으로 유지합니다. 미국 주식과 미국 ETF는 Twelve Data를 통해 앱 시작 시, 앱 실행 중 1시간마다, 그리고 대시보드의 `가격 새로고침` 버튼으로 자동 업데이트를 시도합니다.

API Key는 브라우저 코드에 넣지 않습니다. Vercel은 `api/price-quotes.js`, Netlify는 `netlify/functions/price-quotes.js` 서버리스 프록시를 사용합니다. 배포 환경 변수에 Twelve Data 키만 설정하세요.

```bash
TWELVE_DATA_API_KEY=your-twelve-data-api-key
```

프록시는 사용자 매매 데이터나 포트폴리오를 저장하지 않고, 요청받은 미국 종목 심볼에 대한 가격만 반환합니다. 실패한 종목은 마지막 수동/자동 가격을 유지하고 앱에 실패 메시지와 마지막 업데이트 시간이 표시됩니다.

## 데이터 보관 원칙

- 기본 저장소는 브라우저 IndexedDB입니다.
- 증권사 계정, 비밀번호, 인증서, API 키는 입력받지 않습니다.
- 로그인 사용자의 앱 데이터는 Firebase Auth UID별 Firestore 경로에 저장합니다.
- JSON export/import로 사용자가 직접 백업할 수 있습니다.
- 백업 비밀번호는 저장하지 않으며, 잃어버리면 Drive 백업을 복구할 수 없습니다.
- 이 앱은 투자 자동추천 앱이 아니며, 매수·매도 결정을 자동으로 내리지 않습니다.
