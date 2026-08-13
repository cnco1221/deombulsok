const crypto = require('crypto');
const { buildDeck, determineCulpritIndex } = require('./cards');

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
const BOT_NAMES = ['탐정봇', '명탐정AI', '추리로봇', '눈치봇', '콧수염봇'];
const MAX_ROUNDS = 7;
const START_DETECTIVE_CHIPS = 7;
const MISTAKE_CHIP_LOSE_THRESHOLD = 5;

function uid() {
  return crypto.randomUUID();
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(code) {
  return {
    code,
    hostId: null,
    players: [], // { id, socketId, nickname, isBot, color, detectiveChips, mistakeChips, connected }
    fillWithBots: false,
    started: false,
    round: 0,
    maxRounds: MAX_ROUNDS,
    phase: 'lobby', // lobby | firstFinderDraw | passCards | finderCheck | accusation | result | gameover
    finderIndex: 0,
    turnIndex: 0, // index into players[] for whose turn it is during 'accusation' phase
    crimeScene: null, // { victim: {value}, suspects: [{id, value, unseenMarker, accusations:[{playerId}]}] }
    twoPlayerMode: false,
    sharedCard: null, // { value } for 2p mode
    playerKnowledge: {}, // playerId -> { ownCardValue, receivedCardValue, seenSuspects: {suspectId:value} }
    ackedPlayers: new Set(),
    lastAccusedSuspectId: null,
    lastRoundResult: null,
    log: [],
    finalRanking: null,
  };
}

function addPlayer(room, { socketId, nickname, isBot }) {
  const player = {
    id: uid(),
    socketId: socketId || null,
    token: isBot ? null : uid(), // durable secret used to resume this player's session after a reconnect
    nickname: nickname || (isBot ? BOT_NAMES[room.players.filter((p) => p.isBot).length % BOT_NAMES.length] : '플레이어'),
    isBot: !!isBot,
    color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
    detectiveChips: START_DETECTIVE_CHIPS,
    mistakeChips: 0,
    connected: true,
  };
  room.players.push(player);
  if (!room.hostId && !isBot) room.hostId = player.id;
  return player;
}

function removePlayer(room, playerId) {
  room.players = room.players.filter((p) => p.id !== playerId);
  if (room.hostId === playerId) {
    reassignHost(room);
  }
}

// Picks a new host from connected humans (falls back to any human, then anyone). No-op if current host is still valid.
function reassignHost(room) {
  const currentHost = room.players.find((p) => p.id === room.hostId);
  if (currentHost && currentHost.connected) return;
  const connectedHuman = room.players.find((p) => !p.isBot && p.connected);
  if (connectedHuman) { room.hostId = connectedHuman.id; return; }
  const anyHuman = room.players.find((p) => !p.isBot);
  room.hostId = anyHuman ? anyHuman.id : (room.players[0] ? room.players[0].id : null);
}

function fillWithBotsUpTo(room, target = 5) {
  while (room.players.length < target) {
    addPlayer(room, { isBot: true });
  }
}

function pushLog(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 200) room.log.shift();
}

// --- Round setup ---

function beginRound(room, finderIndex) {
  room.round += 1;
  room.finderIndex = finderIndex;
  room.turnIndex = null;
  room.lastAccusedSuspectId = null;
  room.lastRoundResult = null;
  room.ackedPlayers = new Set();
  room.sharedCard = null;

  const n = room.players.length;
  room.twoPlayerMode = n === 2;
  const deck = buildDeck(n);

  const playerCards = deck.slice(0, n);
  const remaining = deck.slice(n); // 4 or 5 cards

  const victimValue = remaining[0];
  const suspectValues = remaining.slice(1, 4);
  room.crimeScene = {
    victim: { value: victimValue },
    suspects: suspectValues.map((v) => ({
      id: uid(),
      value: v,
      unseenMarker: false,
      revealed: false,
      accusations: [], // { playerId }
    })),
  };

  room.playerKnowledge = {};
  room.players.forEach((p, i) => {
    room.playerKnowledge[p.id] = {
      ownCardValue: playerCards[i],
      receivedCardValue: null,
      seenSuspects: {},
    };
  });

  if (room.twoPlayerMode) {
    // 5th remaining card revealed to both players; no card-passing phase
    room.sharedCard = { value: remaining[4] };
    room.players.forEach((p) => {
      room.playerKnowledge[p.id].receivedCardValue = room.sharedCard.value;
    });
    room.phase = 'finderCheck';
  } else {
    room.phase = 'passCards';
  }

  pushLog(room, `--- ${room.round}라운드 시작 (발견자: ${room.players[finderIndex].nickname}) ---`);
}

function ackCard(room, playerId) {
  if (room.phase !== 'passCards') return false;
  room.ackedPlayers.add(playerId);
  if (room.ackedPlayers.size >= room.players.length) {
    performPass(room);
  }
  return true;
}

function performPass(room) {
  const n = room.players.length;
  // pass to the left (clockwise): player i receives card that was originally player i-1's card
  for (let i = 0; i < n; i++) {
    const fromIdx = (i - 1 + n) % n;
    const fromPlayer = room.players[fromIdx];
    const receivingPlayer = room.players[i];
    const passedValue = room.playerKnowledge[fromPlayer.id].ownCardValue;
    room.playerKnowledge[receivingPlayer.id].receivedCardValue = passedValue;
  }
  room.phase = 'finderCheck';
  pushLog(room, '카드 전달 완료. 발견자가 용의자를 확인합니다.');
}

// --- Suspect checking & accusation ---

function getForcedCheckIds(room) {
  // Phase 3: everyone except the immediately-previous accuser's suspect
  const all = room.crimeScene.suspects.map((s) => s.id);
  return all.filter((id) => id !== room.lastAccusedSuspectId);
}

function currentActingPlayer(room) {
  if (room.phase === 'finderCheck') return room.players[room.finderIndex];
  if (room.phase === 'accusation') return room.players[room.turnIndex];
  return null;
}

function checkSuspects(room, playerId, suspectIds) {
  const acting = currentActingPlayer(room);
  if (!acting || acting.id !== playerId) return { ok: false, error: 'not_your_turn' };

  let idsToReveal;
  if (room.phase === 'finderCheck') {
    const valid = room.crimeScene.suspects.map((s) => s.id);
    if (!Array.isArray(suspectIds) || suspectIds.length !== 2 ||
        !suspectIds.every((id) => valid.includes(id)) || suspectIds[0] === suspectIds[1]) {
      return { ok: false, error: 'invalid_choice' };
    }
    idsToReveal = suspectIds;
  } else if (room.phase === 'accusation') {
    idsToReveal = getForcedCheckIds(room);
  } else {
    return { ok: false, error: 'wrong_phase' };
  }

  const knowledge = room.playerKnowledge[playerId];
  const revealed = {};
  room.crimeScene.suspects.forEach((s) => {
    if (idsToReveal.includes(s.id)) {
      knowledge.seenSuspects[s.id] = s.value;
      revealed[s.id] = s.value;
    }
  });

  if (room.phase === 'finderCheck') {
    const unseenId = room.crimeScene.suspects.map((s) => s.id).find((id) => !idsToReveal.includes(id));
    room.crimeScene.suspects.forEach((s) => { s.unseenMarker = s.id === unseenId; });
  }

  return { ok: true, revealed };
}

function placeAccusation(room, playerId, suspectId) {
  const acting = currentActingPlayer(room);
  if (!acting || acting.id !== playerId) return { ok: false, error: 'not_your_turn' };
  const suspect = room.crimeScene.suspects.find((s) => s.id === suspectId);
  if (!suspect) return { ok: false, error: 'invalid_suspect' };
  const player = room.players.find((p) => p.id === playerId);
  if (player.detectiveChips <= 0) return { ok: false, error: 'no_chips' };

  suspect.accusations.push({ playerId });
  player.detectiveChips -= 1;
  room.lastAccusedSuspectId = suspectId;
  pushLog(room, `${player.nickname}이(가) 용의자에게 탐정 칩을 놓았습니다.`);

  if (room.phase === 'finderCheck') {
    // move to accusation phase, starting with player after finder
    const n = room.players.length;
    if (n === 1) return { ok: false, error: 'invalid_room' };
    room.turnIndex = (room.finderIndex + 1) % n;
    room.phase = 'accusation';
    if (room.turnIndex === room.finderIndex) {
      // shouldn't happen for n>1
      resolveRound(room);
    }
    return { ok: true, done: false };
  }

  // phase === 'accusation'
  const n = room.players.length;
  const nextTurn = (room.turnIndex + 1) % n;
  if (nextTurn === room.finderIndex) {
    resolveRound(room);
    return { ok: true, done: true };
  }
  room.turnIndex = nextTurn;
  return { ok: true, done: false };
}

function resolveRound(room) {
  const suspects = room.crimeScene.suspects;
  const values = suspects.map((s) => s.value);
  const culpritIdx = determineCulpritIndex(values);
  suspects.forEach((s) => { s.revealed = true; });

  const chipTransfers = []; // { toPlayerId, count, suspectId }
  const removedChips = []; // { fromPlayerId, count, suspectId }
  const mistakeGainThisRound = {}; // playerId -> count

  suspects.forEach((s, idx) => {
    if (s.accusations.length === 0) return;
    if (idx === culpritIdx) {
      const byPlayer = {};
      s.accusations.forEach((a) => { byPlayer[a.playerId] = (byPlayer[a.playerId] || 0) + 1; });
      Object.entries(byPlayer).forEach(([pid, count]) => removedChips.push({ fromPlayerId: pid, count, suspectId: s.id }));
    } else {
      const lastAccuserId = s.accusations[s.accusations.length - 1].playerId;
      const count = s.accusations.length;
      const taker = room.players.find((p) => p.id === lastAccuserId);
      taker.mistakeChips += count;
      mistakeGainThisRound[lastAccuserId] = (mistakeGainThisRound[lastAccuserId] || 0) + count;
      chipTransfers.push({ toPlayerId: lastAccuserId, count, suspectId: s.id });
    }
  });

  room.lastRoundResult = {
    culpritSuspectId: culpritIdx >= 0 ? suspects[culpritIdx].id : null,
    victimValue: room.crimeScene.victim.value,
    suspects: suspects.map((s) => ({ id: s.id, value: s.value, accusations: s.accusations.slice() })),
    chipTransfers,
    removedChips,
    mistakeGainThisRound,
  };
  room.phase = 'result';
  room.turnIndex = null;
  pushLog(room, `${room.round}라운드 종료. 범인이 밝혀졌습니다.`);
}

function checkGameEnd(room) {
  const loser = room.players.find((p) => p.mistakeChips >= MISTAKE_CHIP_LOSE_THRESHOLD || p.detectiveChips <= 0);
  if (loser) return true;
  if (room.round >= room.maxRounds) return true;
  return false;
}

function determineNextFinderIndex(room) {
  const n = room.players.length;
  if (room.twoPlayerMode) {
    return (room.finderIndex + 1) % n;
  }
  const gains = room.lastRoundResult ? room.lastRoundResult.mistakeGainThisRound : {};
  let best = null;
  let bestDist = Infinity;
  let bestGain = -1;
  room.players.forEach((p, idx) => {
    if (idx === room.finderIndex) return;
    const gain = gains[p.id] || 0;
    const dist = (idx - room.finderIndex + n) % n;
    if (gain > bestGain || (gain === bestGain && dist < bestDist)) {
      bestGain = gain;
      bestDist = dist;
      best = idx;
    }
  });
  return best === null ? (room.finderIndex + 1) % n : best;
}

function endGame(room) {
  room.phase = 'gameover';
  const ranking = room.players
    .slice()
    .sort((a, b) => a.mistakeChips - b.mistakeChips || b.detectiveChips - a.detectiveChips)
    .map((p) => ({ playerId: p.id, nickname: p.nickname, mistakeChips: p.mistakeChips, detectiveChips: p.detectiveChips }));
  room.finalRanking = ranking;
  pushLog(room, `게임 종료! 우승: ${ranking[0].nickname}`);
}

function nextRound(room) {
  if (room.phase !== 'result') return { ok: false, error: 'wrong_phase' };
  if (checkGameEnd(room)) {
    endGame(room);
    return { ok: true, gameOver: true };
  }
  const nextFinder = determineNextFinderIndex(room);
  beginRound(room, nextFinder);
  return { ok: true, gameOver: false };
}

module.exports = {
  createRoom,
  addPlayer,
  removePlayer,
  reassignHost,
  fillWithBotsUpTo,
  makeRoomCode,
  beginRound,
  ackCard,
  checkSuspects,
  placeAccusation,
  currentActingPlayer,
  getForcedCheckIds,
  nextRound,
  pushLog,
  START_DETECTIVE_CHIPS,
  MISTAKE_CHIP_LOSE_THRESHOLD,
};
