const socket = io();

const SESSION_KEY = 'deombulsok_session_token';

let myPlayerId = null;
let state = null;
let selectedForCheck = []; // finderCheck free-choice: up to 2 suspect ids
let resuming = !!sessionStorage.getItem(SESSION_KEY);

// ---------- DOM refs ----------
const screenLobby = document.getElementById('screen-lobby');
const screenGame = document.getElementById('screen-game');
const lobbyEntry = document.getElementById('lobby-entry');
const lobbyRoom = document.getElementById('lobby-room');
const lobbyError = document.getElementById('lobby-error');
const lobbyResuming = document.getElementById('lobby-resuming');

if (resuming) render();

socket.on('connect', () => {
  const token = sessionStorage.getItem(SESSION_KEY);
  if (token) {
    resuming = true;
    render();
    socket.emit('session:resume', { token });
  }
});

socket.on('session:resumeFailed', () => {
  sessionStorage.removeItem(SESSION_KEY);
  resuming = false;
  state = null;
  render();
});

document.getElementById('create-room-btn').addEventListener('click', () => {
  const nickname = document.getElementById('nickname-input').value.trim() || '플레이어';
  socket.emit('room:create', { nickname });
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const nickname = document.getElementById('nickname-input').value.trim() || '플레이어';
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) { lobbyError.textContent = '방 코드를 입력하세요.'; return; }
  socket.emit('room:join', { code, nickname });
});

document.getElementById('bot-toggle').addEventListener('change', () => {
  socket.emit('room:toggleBot');
});

document.getElementById('start-game-btn').addEventListener('click', () => {
  socket.emit('game:start');
});

// Fullscreen gives the board more real room to work with than trying to shrink everything to fit.
const fullscreenBtn = document.getElementById('fullscreen-btn');
fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.title = document.fullscreenElement ? '전체화면 종료' : '전체화면';
});

// Cancelling a game needs everyone's agreement; bots always agree (pre-added server-side).
document.getElementById('cancel-vote-btn').addEventListener('click', () => {
  socket.emit('game:voteCancel');
});

socket.on('room:error', ({ error }) => {
  const msgs = {
    room_not_found: '존재하지 않는 방 코드입니다.',
    already_started: '이미 시작된 게임입니다.',
    room_full: '방이 가득 찼습니다 (최대 5인).',
    not_enough_players: '최소 2명이 필요합니다.',
    too_many_players: '최대 5명까지 가능합니다.',
  };
  lobbyError.textContent = msgs[error] || error;
});

socket.on('room:state', (s) => {
  state = s;
  myPlayerId = s.myId;
  resuming = false;
  selectedForCheck = [];
  if (s.mySessionToken) sessionStorage.setItem(SESSION_KEY, s.mySessionToken);
  render();
});

// ---------- Render ----------
function render() {
  if (resuming && !state) {
    renderResuming();
    return;
  }
  if (!state) {
    renderEntry();
    return;
  }
  if (!state.started) {
    renderLobby();
  } else {
    renderGame();
  }
}

function renderResuming() {
  screenLobby.classList.remove('hidden');
  screenGame.classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
  lobbyEntry.classList.add('hidden');
  lobbyRoom.classList.add('hidden');
  lobbyResuming.classList.remove('hidden');
}

function renderEntry() {
  screenLobby.classList.remove('hidden');
  screenGame.classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
  lobbyResuming.classList.add('hidden');
  lobbyRoom.classList.add('hidden');
  lobbyEntry.classList.remove('hidden');
}

function renderLobby() {
  screenLobby.classList.remove('hidden');
  screenGame.classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');

  lobbyResuming.classList.add('hidden');
  lobbyEntry.classList.add('hidden');
  lobbyRoom.classList.remove('hidden');
  document.getElementById('room-code-display').textContent = state.code;

  const isHost = state.hostId === myPlayerId;
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <span>${escapeHtml(p.nickname)}</span>
      ${p.isHost ? '<span class="host-tag">방장</span>' : ''}
      ${p.isBot ? '<span class="bot-tag">봇</span>' : ''}
      ${!p.isBot && !p.connected ? '<span class="disconnected-tag">연결 끊김</span>' : ''}`;
    list.appendChild(li);
  });

  const botToggle = document.getElementById('bot-toggle');
  botToggle.checked = state.fillWithBots;
  botToggle.disabled = !isHost;

  const startBtn = document.getElementById('start-game-btn');
  const waitingHint = document.getElementById('waiting-hint');
  if (isHost) {
    const canStart = state.players.length >= 2 || state.fillWithBots;
    startBtn.classList.remove('hidden');
    startBtn.disabled = !canStart;
    waitingHint.textContent = canStart ? '' : '최소 2명이 모이거나 "봇으로 채우기"를 켜야 시작할 수 있습니다.';
  } else {
    startBtn.classList.add('hidden');
    waitingHint.textContent = '방장이 게임을 시작할 때까지 기다리세요...';
  }
}

function renderGame() {
  screenLobby.classList.add('hidden');
  screenGame.classList.remove('hidden');

  document.getElementById('hdr-round').textContent = state.round;
  document.getElementById('hdr-max-round').textContent = state.maxRounds;

  renderPlayersStrip();
  renderCrimeScene();
  renderMyHand();
  renderActionPanel();
  renderLog();
  renderOverlay();
  renderCancelVote();
}

function renderCancelVote() {
  const btn = document.getElementById('cancel-vote-btn');
  if (state.phase === 'gameover') {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  const votes = state.cancelVotes || [];
  const iVoted = votes.includes(myPlayerId);
  btn.textContent = `✕ 취소 (${votes.length}/${state.players.length})`;
  btn.classList.toggle('voted', iVoted);
}

// Seats players in a circle around the table (crime scene), like sitting around it,
// instead of a single row — position is a percentage point on an ellipse inscribed in .table-area.
function renderPlayersStrip() {
  const ring = document.getElementById('players-strip');
  ring.innerHTML = '';
  const n = state.players.length;
  // Keep the ring's edge points far enough from the container border that a chip's own
  // rendered width (clamped via CSS text-overflow) never pushes past the viewport.
  const isMobile = window.innerWidth <= 600;
  const RX = isMobile ? 42 : 44; // ellipse radius, % of table-area width
  const RY = isMobile ? 43 : 42; // ellipse radius, % of table-area height
  const myIndex = state.players.findIndex((p) => p.id === myPlayerId);
  state.players.forEach((p, i) => {
    // Rotate the ring so my own seat always lands at 90° (bottom-center), others fanning
    // out clockwise from there, instead of a fixed seat 0-at-top layout.
    const offset = myIndex >= 0 ? (i - myIndex + n) % n : i;
    const angle = 90 + (360 / n) * offset;
    const rad = (angle * Math.PI) / 180;
    const x = 50 + RX * Math.cos(rad);
    const y = 50 + RY * Math.sin(rad);

    const el = document.createElement('div');
    const isFinder = p.id === state.finderId;
    const isTurn = p.id === state.turnPlayerId;
    el.className = 'player-chip' + (isFinder ? ' finder' : '') + (isTurn ? ' turn' : '') + (!p.isBot && !p.connected ? ' disconnected' : '');
    el.style.left = x + '%';
    el.style.top = y + '%';
    el.innerHTML = `<div class="chip-top">
        <span class="dot" style="background:${p.color}"></span>
        <span class="name">${escapeHtml(p.nickname)}${p.id === myPlayerId ? ' (나)' : ''}${!p.isBot && !p.connected ? ' 🔌' : ''}</span>
      </div>
      <span class="chips">🕵️${p.detectiveChips} ❌${p.mistakeChips}</span>`;
    ring.appendChild(el);
  });
}

// White person-silhouette card face with the value centered on it (used for suspect/victim/shared cards).
function personCardMarkup(numberHtml) {
  return `<svg class="person-svg" viewBox="0 0 100 145" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path class="person-shape" d="M27,48 L73,48 Q78,48 78,53 L78,135 Q78,140 73,140 L56,140 L56,100 L44,100 L44,140 L27,140 Q22,140 22,135 L22,53 Q22,48 27,48 Z"></path>
      <circle class="person-shape" cx="50" cy="30" r="18"></circle>
    </svg>
    <span class="card-number">${numberHtml}</span>`;
}

function renderCrimeScene() {
  const row = document.getElementById('suspects-row');
  row.innerHTML = '';
  const canSelectForCheck = state.phase === 'finderCheck' && state.finderId === myPlayerId && Object.keys(state.myKnowledge.seenSuspects).length < 2;
  const iAlreadyAccused = state.crimeScene.suspects.some((s) => s.accusations.some((a) => a.playerId === myPlayerId));
  const canAccuse = isMyActionTurn() && Object.keys(state.myKnowledge.seenSuspects).length >= 2 && !iAlreadyAccused;

  state.crimeScene.suspects.forEach((s) => {
    const wrap = document.createElement('div');
    wrap.className = 'suspect-card';

    const face = document.createElement('div');
    const known = 'value' in s;
    face.className = 'suspect-face' + (known ? ' known' : '');
    const isCulprit = s.revealed && state.lastRoundResult && state.lastRoundResult.culpritSuspectId === s.id;
    if (isCulprit) {
      face.classList.add('culprit');
    }
    if (known && s.value === 5) face.classList.add('five-card');
    if (canSelectForCheck) {
      face.classList.add('selectable');
      face.setAttribute('role', 'button');
      face.setAttribute('tabindex', '0');
      if (selectedForCheck.includes(s.id)) face.classList.add('selected');
    }

    const plainLabel = known ? (s.value === null ? 'X' : s.value) : '?';
    face.innerHTML = personCardMarkup(known ? valueLabelHtml(s.value) : '?') + (s.unseenMarker ? '<span class="unseen-marker">🚫확인안됨</span>' : '');
    face.setAttribute('aria-label', `용의자 카드: ${plainLabel}`);

    face.addEventListener('click', () => onSuspectClick(s.id, canSelectForCheck));
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onSuspectClick(s.id, canSelectForCheck);
    });
    wrap.appendChild(face);

    if (isCulprit) {
      const culpritLabel = document.createElement('div');
      culpritLabel.className = 'culprit-label';
      culpritLabel.textContent = '👉 범인';
      wrap.appendChild(culpritLabel);
    }

    if (canAccuse) {
      const accuseBtn = document.createElement('button');
      accuseBtn.className = 'accuse-btn primary';
      accuseBtn.textContent = '고발';
      accuseBtn.addEventListener('click', () => socket.emit('game:placeAccusation', { suspectId: s.id }));
      wrap.appendChild(accuseBtn);
    }

    const stack = document.createElement('div');
    stack.className = 'chip-stack';
    s.accusations.forEach((a, idx) => {
      const isLatest = s.id === state.lastAccusedSuspectId && idx === s.accusations.length - 1;
      const chip = document.createElement('div');
      chip.className = 'mini-chip' + (isLatest ? ' latest' : '');
      chip.style.background = a.color;
      chip.title = a.nickname;
      stack.appendChild(chip);
    });
    wrap.appendChild(stack);

    row.appendChild(wrap);
  });

  const sharedBox = document.getElementById('shared-card-box');
  if (state.twoPlayerMode && state.sharedCard) {
    sharedBox.classList.remove('hidden');
    const sharedEl = document.getElementById('shared-card-value');
    sharedEl.innerHTML = personCardMarkup(valueLabelHtml(state.sharedCard.value));
    sharedEl.classList.toggle('five-card', state.sharedCard.value === 5);
  } else {
    sharedBox.classList.add('hidden');
  }
}

function onSuspectClick(suspectId, canSelectForCheck) {
  if (!canSelectForCheck) return;
  const idx = selectedForCheck.indexOf(suspectId);
  if (idx >= 0) selectedForCheck.splice(idx, 1);
  else if (selectedForCheck.length < 2) selectedForCheck.push(suspectId);
  renderCrimeScene();
  renderActionPanel();
}

function isMyActionTurn() {
  if (state.phase === 'finderCheck') return state.finderId === myPlayerId;
  if (state.phase === 'accusation') return state.turnPlayerId === myPlayerId;
  return false;
}

// My own card (and, once dealt, the card passed to me) shown as small person-cards on the board.
function renderMyHand() {
  const el = document.getElementById('my-hand');
  const k = state.myKnowledge;
  if (!k) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  let html = handSlotHtml('첫번째 단서', valueLabelHtml(k.ownCardValue));
  if (!state.twoPlayerMode) {
    // Still waiting on the others to pass theirs — nothing to show yet.
    const receivedHtml = state.phase === 'passCards' ? '?' : valueLabelHtml(k.receivedCardValue);
    html += handSlotHtml('두번째 단서', receivedHtml);
  }
  el.innerHTML = html;
}

function handSlotHtml(label, cardHtml) {
  return `<div class="hand-slot">
    <div class="hand-label">${label}</div>
    <div class="mini-card">${personCardMarkup(cardHtml)}</div>
  </div>`;
}

// 5는 "5가 있으면 최솟값이 범인" 규칙을 뒤집는 특수 카드라 항상 둥근 화살표 고리+빨간색으로 강조 표시한다.
function valueLabelHtml(v) {
  if (v === null) return 'X';
  if (v === 5) {
    return `<span class="five-value">
      <svg class="five-ring" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="15.5"></circle>
        <polygon points="16,0.5 25.5,4 16.5,8"></polygon>
        <polygon points="24,35.5 14.5,32 23.5,28"></polygon>
      </svg>
      <span class="five-digit">5</span>
    </span>`;
  }
  return String(v);
}

function renderActionPanel() {
  const title = document.getElementById('phase-title');
  const body = document.getElementById('action-body');
  body.innerHTML = '';

  if (state.phase === 'passCards') {
    const acked = state.ackedPlayers.includes(myPlayerId);
    title.textContent = acked
      ? `왼쪽 사람에게 전달 (${state.ackedPlayers.length}/${state.players.length})`
      : `카드 확인 (${state.ackedPlayers.length}/${state.players.length})`;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = '확인';
    btn.disabled = acked;
    btn.addEventListener('click', () => socket.emit('game:ackCard'));
    body.appendChild(btn);
    return;
  }

  if (state.phase === 'finderCheck' || state.phase === 'accusation') {
    const myTurn = isMyActionTurn();
    const seenCount = Object.keys(state.myKnowledge.seenSuspects).length;
    const iAlreadyAccused = state.crimeScene.suspects.some((s) => s.accusations.some((a) => a.playerId === myPlayerId));

    if (!myTurn) {
      const actingPlayer = state.players.find((p) => p.id === (state.phase === 'finderCheck' ? state.finderId : state.turnPlayerId));
      title.textContent = `${actingPlayer ? escapeHtml(actingPlayer.nickname) : '다른 참가자'} 차례`;
      return;
    }

    if (iAlreadyAccused) {
      title.textContent = '대기 중';
      return;
    }

    if (seenCount < 2) {
      title.textContent = state.phase === 'finderCheck' ? `용의자 선택 (${selectedForCheck.length}/2)` : '용의자 확인';
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = '확인';
      if (state.phase === 'finderCheck') {
        btn.disabled = selectedForCheck.length !== 2;
        btn.addEventListener('click', () => {
          socket.emit('game:checkSuspects', { suspectIds: selectedForCheck.slice() });
        });
      } else {
        btn.addEventListener('click', () => socket.emit('game:checkSuspects', {}));
      }
      body.appendChild(btn);
      return;
    }

    title.textContent = '고발할 카드 선택';
    return;
  }

  if (state.phase === 'result') {
    title.textContent = '진상 해명';
    if (state.hostId === myPlayerId) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = '다음 라운드';
      btn.addEventListener('click', () => socket.emit('game:nextRound'));
      body.appendChild(btn);
    }
    return;
  }

  if (state.phase === 'gameover') {
    title.textContent = '게임 종료';
    body.innerHTML = '';
    return;
  }
}

function renderLog() {
  const latest = document.getElementById('log-latest');
  const last = state.log[state.log.length - 1];
  latest.textContent = last ? last.text : '';
}

function renderOverlay() {
  const overlay = document.getElementById('overlay');
  const box = document.getElementById('overlay-box');

  if (state.phase === 'gameover' && state.finalRanking) {
    overlay.classList.remove('hidden');
    let html = '<h2>게임 종료!</h2>';
    state.finalRanking.forEach((r, i) => {
      html += `<div class="ranking-row${i === 0 ? ' first' : ''}">
        <span>${i + 1}위. ${escapeHtml(r.nickname)}</span>
        <span>실수칩 ${r.mistakeChips} / 탐정칩 ${r.detectiveChips}</span>
      </div>`;
    });
    html += '<div style="margin-top:16px;"><button class="primary" onclick="returnToLobby()">로비로 돌아가기</button></div>';
    box.innerHTML = html;
    return;
  }

  overlay.classList.add('hidden');
}

function returnToLobby() {
  socket.emit('room:leave');
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
