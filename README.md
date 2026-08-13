# 덤불속 (In a Grove)

아쿠타가와 류노스케의 「덤불 속」을 소재로 한 눈치/추리 보드게임 웹 멀티플레이어 버전.
Node.js + Socket.IO 백엔드, 순수 HTML/CSS/JS 프론트엔드. 회원가입 없이 방 코드로 입장하며, 2~5인
+ 봇 채우기를 지원합니다.

## 로컬 실행

```bash
npm install
npm start
```

`http://localhost:3000` 에서 여러 브라우저 탭/기기로 접속해 플레이합니다.

## 배포 (Render)

이 저장소에는 [Render](https://render.com) 배포용 `render.yaml`이 포함되어 있습니다.

1. Render 대시보드에서 **New → Blueprint**를 선택합니다.
2. 이 GitHub 저장소를 연결합니다.
3. Render가 `render.yaml`을 읽어 Node 웹 서비스를 자동으로 생성합니다 (무료 플랜).
4. 배포가 끝나면 발급된 URL로 접속해 플레이할 수 있습니다.

Socket.IO로 실시간 통신하는 게임이라 정적 호스팅(Netlify, GitHub Pages 등)만으로는 동작하지 않고,
서버가 계속 떠 있는 호스팅(Render, Railway, Fly.io 등)이 필요합니다.

## 구조

- `server/game.js` — 라운드 상태 머신 (카드 배분 → 전달 → 발견자 확인 → 순차 고발 → 진상 해명)
- `server/cards.js` — 인원수별 카드 구성 및 범인 판별 규칙
- `server/bot.js` — 봇 AI
- `server/roomManager.js`, `server/index.js` — 방 관리, 정보 필터링, 소켓 이벤트, 재접속 처리
- `public/` — 로비/게임 보드 프론트엔드
