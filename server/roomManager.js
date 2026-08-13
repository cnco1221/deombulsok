const G = require('./game');

const rooms = new Map(); // code -> room
const socketToPlayer = new Map(); // socketId -> { code, playerId }
const tokenToPlayer = new Map(); // session token -> { code, playerId }

const ABANDONED_ROOM_GRACE_MS = 10 * 60 * 1000; // keep a mid-game room alive this long with no connected humans

function getRoom(code) {
  return rooms.get(code);
}

function createNewRoom() {
  let code;
  do {
    code = G.makeRoomCode();
  } while (rooms.has(code));
  const room = G.createRoom(code);
  rooms.set(code, room);
  return room;
}

function registerToken(room, player) {
  if (player.token) tokenToPlayer.set(player.token, { code: room.code, playerId: player.id });
}

function forgetToken(player) {
  if (player.token) tokenToPlayer.delete(player.token);
}

function destroyRoom(room) {
  clearAbandonTimer(room);
  room.players.forEach((p) => forgetToken(p));
  rooms.delete(room.code);
}

function deleteRoomIfEmpty(room) {
  const anyHumanLeft = room.players.some((p) => !p.isBot && p.connected);
  if (!anyHumanLeft) destroyRoom(room);
}

function clearAbandonTimer(room) {
  if (room._abandonTimer) {
    clearTimeout(room._abandonTimer);
    room._abandonTimer = null;
  }
}

// Called when a started room loses its last connected human: give them a window to reconnect
// via session:resume before the room (and its cards/state) are discarded for good.
function scheduleAbandonCleanup(room) {
  clearAbandonTimer(room);
  room._abandonTimer = setTimeout(() => {
    const stillEmpty = !room.players.some((p) => !p.isBot && p.connected);
    if (stillEmpty && rooms.get(room.code) === room) destroyRoom(room);
  }, ABANDONED_ROOM_GRACE_MS);
}

// Build the per-player filtered view of the room/game state (§4 information filtering)
function serializeForPlayer(room, playerId) {
  const knowledge = room.playerKnowledge ? room.playerKnowledge[playerId] : null;
  const revealAll = room.phase === 'result' || room.phase === 'gameover';
  const me = room.players.find((p) => p.id === playerId);

  let crimeScene = null;
  if (room.crimeScene) {
    crimeScene = {
      suspects: room.crimeScene.suspects.map((s) => {
        const knownToMe = knowledge && Object.prototype.hasOwnProperty.call(knowledge.seenSuspects, s.id);
        const value = revealAll || knownToMe ? s.value : undefined;
        return {
          id: s.id,
          value,
          unseenMarker: s.unseenMarker,
          revealed: revealAll,
          accusations: s.accusations.map((a) => {
            const p = room.players.find((pp) => pp.id === a.playerId);
            return { playerId: a.playerId, nickname: p ? p.nickname : '?', color: p ? p.color : '#999' };
          }),
        };
      }),
    };
  }

  return {
    code: room.code,
    hostId: room.hostId,
    myId: playerId,
    mySessionToken: me ? me.token : null,
    fillWithBots: room.fillWithBots,
    started: room.started,
    phase: room.phase,
    round: room.round,
    maxRounds: room.maxRounds,
    twoPlayerMode: room.twoPlayerMode,
    sharedCard: room.sharedCard,
    finderIndex: room.finderIndex,
    finderId: room.players[room.finderIndex] ? room.players[room.finderIndex].id : null,
    turnIndex: room.turnIndex,
    turnPlayerId: room.turnIndex !== null && room.turnIndex !== undefined ? (room.players[room.turnIndex] ? room.players[room.turnIndex].id : null) : null,
    lastAccusedSuspectId: room.lastAccusedSuspectId,
    ackedPlayers: room.ackedPlayers ? Array.from(room.ackedPlayers) : [],
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isBot: p.isBot,
      color: p.color,
      detectiveChips: p.detectiveChips,
      mistakeChips: p.mistakeChips,
      connected: p.connected,
      isHost: p.id === room.hostId,
    })),
    myKnowledge: knowledge
      ? {
          ownCardValue: knowledge.ownCardValue,
          receivedCardValue: knowledge.receivedCardValue,
          seenSuspects: knowledge.seenSuspects,
        }
      : null,
    crimeScene,
    lastRoundResult: room.lastRoundResult,
    finalRanking: room.finalRanking,
    log: room.log.slice(-40),
  };
}

module.exports = {
  rooms,
  socketToPlayer,
  tokenToPlayer,
  getRoom,
  createNewRoom,
  registerToken,
  forgetToken,
  destroyRoom,
  deleteRoomIfEmpty,
  clearAbandonTimer,
  scheduleAbandonCleanup,
  serializeForPlayer,
};
