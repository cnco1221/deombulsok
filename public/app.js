const socket = io();

const SESSION_KEY = 'deombulsok_session_token';

let myPlayerId = null;
let state = null;
let selectedForCheck = []; // finderCheck free-choice: up to 2 suspect ids
let resuming = !!localStorage.getItem(SESSION_KEY);

// ---------- DOM refs ----------
const screenLobby = document.getElementById('screen-lobby');
const screenGame = document.getElementById('screen-game');
const lobbyEntry = document.getElementById('lobby-entry');
const lobbyRoom = document.getElementById('lobby-room');
const lobbyError = document.getElementById('lobby-error');
const lobbyResuming = document.getElementById('lobby-resuming');

if (resuming) render();

socket.on('connect', () => {
  const token = localStorage.getItem(SESSION_KEY);
  if (token) {
    resuming = true;
    render();
    socket.emit('session:resume', { token });
  }
});

socket.on('session:resumeFailed', () => {
  localStorage.removeItem(SESSION_KEY);
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
  if (s.mySessionToken) localStorage.setItem(SESSION_KEY, s.mySessionToken);
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

  document.getElementById('hdr-room-code').textContent = state.code;
  document.getElementById('hdr-round').textContent = state.round;
  document.getElementById('hdr-max-round').textContent = state.maxRounds;
  const finder = state.players.find((p) => p.id === state.finderId);
  document.getElementById('hdr-finder').textContent = `발견자: ${finder ? finder.nickname : '-'}`;

  renderPlayersStrip();
  renderCrimeScene();
  renderMyInfo();
  renderActionPanel();
  renderLog();
  renderOverlay();
}

function renderPlayersStrip() {
  const strip = document.getElementById('players-strip');
  strip.innerHTML = '';
  state.players.forEach((p) => {
    const el = document.createElement('div');
    const isFinder = p.id === state.finderId;
    const isTurn = p.id === state.turnPlayerId;
    el.className = 'player-chip' + (isFinder ? ' finder' : '') + (isTurn ? ' turn' : '') + (!p.isBot && !p.connected ? ' disconnected' : '');
    el.innerHTML = `<span class="dot" style="background:${p.color}"></span>
      <span>${escapeHtml(p.nickname)}${p.id === myPlayerId ? ' (나)' : ''}${!p.isBot && !p.connected ? ' 🔌' : ''}</span>
      <span class="chips">🕵️${p.detectiveChips} ❌${p.mistakeChips}</span>`;
    strip.appendChild(el);
  });
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
    if (s.revealed && state.lastRoundResult && state.lastRoundResult.culpritSuspectId === s.id) {
      face.classList.add('culprit');
    }
    if (known && s.value === 5) face.classList.add('five-card');
    if (canSelectForCheck || canAccuse) {
      face.classList.add('selectable');
      face.setAttribute('role', 'button');
      face.setAttribute('tabindex', '0');
      if (canSelectForCheck && selectedForCheck.includes(s.id)) face.classList.add('selected');
    }

    const plainLabel = known ? (s.value === null ? '무지' : s.value) : '?';
    face.innerHTML = `<span>${known ? valueLabelHtml(s.value) : '?'}</span>` + (s.unseenMarker ? '<span class="unseen-marker">🚫확인안됨</span>' : '');
    face.setAttribute('aria-label', `용의자 카드: ${plainLabel}`);

    face.addEventListener('click', () => onSuspectClick(s.id, canSelectForCheck, canAccuse));
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onSuspectClick(s.id, canSelectForCheck, canAccuse);
    });
    wrap.appendChild(face);

    const stack = document.createElement('div');
    stack.className = 'chip-stack';
    s.accusations.forEach((a) => {
      const chip = document.createElement('div');
      chip.className = 'mini-chip';
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
    sharedEl.innerHTML = valueLabelHtml(state.sharedCard.value);
    sharedEl.classList.toggle('five-card', state.sharedCard.value === 5);
  } else {
    sharedBox.classList.add('hidden');
  }
}

function onSuspectClick(suspectId, canSelectForCheck, canAccuse) {
  if (canSelectForCheck) {
    const idx = selectedForCheck.indexOf(suspectId);
    if (idx >= 0) selectedForCheck.splice(idx, 1);
    else if (selectedForCheck.length < 2) selectedForCheck.push(suspectId);
    renderCrimeScene();
    renderActionPanel();
  } else if (canAccuse) {
    socket.emit('game:placeAccusation', { suspectId });
  }
}

function isMyActionTurn() {
  if (state.phase === 'finderCheck') return state.finderId === myPlayerId;
  if (state.phase === 'accusation') return state.turnPlayerId === myPlayerId;
  return false;
}

function renderMyInfo() {
  const body = document.getElementById('my-info-body');
  const k = state.myKnowledge;
  if (!k) { body.innerHTML = ''; return; }
  let html = '';
  html += kv('내 카드', fmtVal(k.ownCardValue));
  if (!state.twoPlayerMode && state.phase !== 'passCards') {
    html += kv('전달받은 카드', fmtVal(k.receivedCardValue));
  }
  const seenEntries = Object.entries(k.seenSuspects || {});
  if (seenEntries.length) {
    seenEntries.forEach(([sid, val], i) => {
      html += kv(`확인한 용의자 ${i + 1}`, fmtVal(val));
    });
  }
  body.innerHTML = html;
}

function kv(k, v) {
  return `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}
function fmtVal(v) {
  if (v === null) return '무지';
  if (v === undefined) return '-';
  return valueLabelHtml(v);
}

// 5는 "5가 있으면 최솟값이 범인" 규칙을 뒤집는 특수 카드라 항상 화살표+빨간색으로 강조 표시한다.
function valueLabelHtml(v) {
  if (v === null) return '무지';
  if (v === 5) return '<span class="five-value"><span class="arrow">▶</span>5<span class="arrow">◀</span></span>';
  return String(v);
}

function renderActionPanel() {
  const title = document.getElementById('phase-title');
  const body = document.getElementById('action-body');
  body.innerHTML = '';

  if (state.phase === 'passCards') {
    title.textContent = '카드 확인';
    const acked = state.ackedPlayers.includes(myPlayerId);
    body.innerHTML = `<p>내 카드를 확인했으면 아래 버튼을 눌러 왼쪽 사람에게 전달하세요.</p>
      <p>${state.ackedPlayers.length} / ${state.players.length} 명 확인 완료</p>`;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = acked ? '확인 완료' : '확인했어요';
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
      title.textContent = '대기 중';
      body.innerHTML = `<p>${actingPlayer ? escapeHtml(actingPlayer.nickname) : '다른 참가자'}의 차례를 기다리는 중...</p>`;
      return;
    }

    if (iAlreadyAccused) {
      title.textContent = '완료';
      body.innerHTML = '<p>당신의 차례가 끝났습니다. 다른 참가자를 기다리세요.</p>';
      return;
    }

    if (seenCount < 2) {
      if (state.phase === 'finderCheck') {
        title.textContent = '발견자: 용의자 확인 (2장 선택)';
        body.innerHTML = `<p>용의자 카드 중 2장을 클릭해서 선택하세요. (${selectedForCheck.length}/2)</p>`;
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = '확인하기';
        btn.disabled = selectedForCheck.length !== 2;
        btn.addEventListener('click', () => {
          socket.emit('game:checkSuspects', { suspectIds: selectedForCheck.slice() });
        });
        body.appendChild(btn);
      } else {
        title.textContent = '용의자 확인';
        body.innerHTML = `<p>직전 사람이 고발한 카드를 제외한 나머지 2장을 확인합니다.</p>`;
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.textContent = '확인하기';
        btn.addEventListener('click', () => socket.emit('game:checkSuspects', {}));
        body.appendChild(btn);
      }
      return;
    }

    title.textContent = '고발: 범인이라 생각하는 용의자를 선택';
    body.innerHTML = `<p>위 용의자 카드를 클릭해서 탐정 칩을 놓으세요. (미확인 카드에 놓아도 됩니다 — 블러핑 가능)</p>`;
    return;
  }

  if (state.phase === 'result') {
    title.textContent = '진상 해명';
    body.innerHTML = '<p>결과 팝업을 확인하세요.</p>';
    return;
  }

  if (state.phase === 'gameover') {
    title.textContent = '게임 종료';
    body.innerHTML = '';
    return;
  }
}

function renderLog() {
  const body = document.getElementById('log-body');
  body.innerHTML = state.log.map((l) => `<div>${escapeHtml(l.text)}</div>`).join('');
  body.scrollTop = body.scrollHeight;
}

function renderOverlay() {
  const overlay = document.getElementById('overlay');
  const box = document.getElementById('overlay-box');

  if (state.phase === 'result' && state.lastRoundResult) {
    overlay.classList.remove('hidden');
    const r = state.lastRoundResult;
    let html = `<h2>${state.round}라운드 진상 해명</h2>`;
    r.suspects.forEach((s) => {
      const isCulprit = s.id === r.culpritSuspectId;
      html += `<div class="result-suspect${isCulprit ? ' culprit' : ''}">
        <span>${valueLabelHtml(s.value)}</span>
        <span>${isCulprit ? '👉 범인' : ''}</span>
      </div>`;
    });
    if (r.chipTransfers.length) {
      html += '<h3>실수 칩 이동</h3>';
      r.chipTransfers.forEach((t) => {
        const p = state.players.find((pp) => pp.id === t.toPlayerId);
        html += `<div>${p ? escapeHtml(p.nickname) : '?'}이(가) 칩 ${t.count}개를 실수 칩으로 받았습니다.</div>`;
      });
    }
    if (r.removedChips.length) {
      html += '<h3>제거된 칩</h3>';
      r.removedChips.forEach((t) => {
        const p = state.players.find((pp) => pp.id === t.fromPlayerId);
        html += `<div>${p ? escapeHtml(p.nickname) : '?'}의 칩 ${t.count}개가 완전히 제거되었습니다.</div>`;
      });
    }
    box.innerHTML = html;

    const isHost = state.hostId === myPlayerId;
    const footer = document.createElement('div');
    footer.style.marginTop = '16px';
    if (isHost) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = '다음 라운드';
      btn.addEventListener('click', () => socket.emit('game:nextRound'));
      footer.appendChild(btn);
    } else {
      footer.innerHTML = '<p style="color:var(--muted)">방장이 다음 라운드를 시작할 때까지 기다리세요.</p>';
    }
    box.appendChild(footer);
    return;
  }

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
  localStorage.removeItem(SESSION_KEY);
  location.reload();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
