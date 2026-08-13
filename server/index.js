const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const G = require('./game');
const Bot = require('./bot');
const RM = require('./roomManager');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

function botDelay() {
  return 700 + Math.floor(Math.random() * 1200);
}

function broadcastRoom(room) {
  room.players.forEach((p) => {
    if (!p.isBot && p.socketId) {
      const payload = RM.serializeForPlayer(room, p.id);
      io.to(p.socketId).emit('room:state', payload);
    }
  });
}

// Drives bots forward one action at a time; safe to call after every mutation.
function maybeRunBots(room) {
  if (!room.started) return;

  if (room.phase === 'passCards') {
    const nextBot = room.players.find((p) => p.isBot && !room.ackedPlayers.has(p.id));
    if (nextBot) {
      setTimeout(() => {
        if (!RM.getRoom(room.code)) return;
        G.ackCard(room, nextBot.id);
        broadcastRoom(room);
        maybeRunBots(room);
      }, botDelay());
    }
    return;
  }

  if (room.phase === 'finderCheck' || room.phase === 'accusation') {
    const acting = G.currentActingPlayer(room);
    if (acting && acting.isBot) {
      setTimeout(() => {
        if (!RM.getRoom(room.code)) return;
        const suspects = room.crimeScene.suspects;
        let idsToCheck;
        if (room.phase === 'finderCheck') {
          idsToCheck = Bot.botFinderCheckChoice(suspects.map((s) => s.id));
        } else {
          idsToCheck = G.getForcedCheckIds(room);
        }
        const checkResult = G.checkSuspects(room, acting.id, idsToCheck);
        if (!checkResult.ok) return;
        broadcastRoom(room);

        setTimeout(() => {
          if (!RM.getRoom(room.code)) return;
          const knowledge = room.playerKnowledge[acting.id];
          const choiceId = Bot.botAccusationChoice({
            suspects: room.crimeScene.suspects,
            knowledge,
            lastAccusedSuspectId: room.lastAccusedSuspectId,
            isFirstFinderTurn: room.phase === 'finderCheck',
          });
          G.placeAccusation(room, acting.id, choiceId);
          broadcastRoom(room);
          maybeRunBots(room);
        }, botDelay());
      }, botDelay());
    }
    return;
  }
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ nickname }) => {
    const room = RM.createNewRoom();
    const player = G.addPlayer(room, { socketId: socket.id, nickname });
    RM.socketToPlayer.set(socket.id, { code: room.code, playerId: player.id });
    RM.registerToken(room, player);
    socket.join(room.code);
    broadcastRoom(room);
  });

  socket.on('room:join', ({ code, nickname }) => {
    const room = RM.getRoom((code || '').toUpperCase());
    if (!room) return socket.emit('room:error', { error: 'room_not_found' });
    if (room.started) return socket.emit('room:error', { error: 'already_started' });
    if (room.players.length >= 5) return socket.emit('room:error', { error: 'room_full' });
    const player = G.addPlayer(room, { socketId: socket.id, nickname });
    RM.socketToPlayer.set(socket.id, { code: room.code, playerId: player.id });
    RM.registerToken(room, player);
    socket.join(room.code);
    broadcastRoom(room);
  });

  // Re-attaches a fresh socket (e.g. after a page reload) to the player it was previously
  // playing as, using the durable token the client cached from an earlier room:state.
  socket.on('session:resume', ({ token }) => {
    const link = token && RM.tokenToPlayer.get(token);
    const room = link && RM.getRoom(link.code);
    const player = room && room.players.find((p) => p.id === link.playerId);
    if (!room || !player) {
      socket.emit('session:resumeFailed');
      return;
    }
    if (player.socketId && player.socketId !== socket.id) {
      RM.socketToPlayer.delete(player.socketId);
    }
    player.socketId = socket.id;
    player.connected = true;
    RM.socketToPlayer.set(socket.id, { code: room.code, playerId: player.id });
    RM.clearAbandonTimer(room);
    socket.join(room.code);
    broadcastRoom(room);
    maybeRunBots(room);
  });

  socket.on('room:toggleBot', () => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    const room = RM.getRoom(link.code);
    if (!room || room.started) return;
    if (room.hostId !== link.playerId) return;
    room.fillWithBots = !room.fillWithBots;
    broadcastRoom(room);
  });

  socket.on('game:start', () => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    const room = RM.getRoom(link.code);
    if (!room || room.started) return;
    if (room.hostId !== link.playerId) return;

    if (room.fillWithBots && room.players.length < 5) {
      G.fillWithBotsUpTo(room, 5);
    }
    if (room.players.length < 2) return socket.emit('room:error', { error: 'not_enough_players' });
    if (room.players.length > 5) return socket.emit('room:error', { error: 'too_many_players' });

    room.started = true;
    const n = room.players.length;
    const initialFinder = Math.floor(Math.random() * n);
    G.beginRound(room, initialFinder);
    broadcastRoom(room);
    maybeRunBots(room);
  });

  socket.on('game:ackCard', () => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    const room = RM.getRoom(link.code);
    if (!room) return;
    if (G.ackCard(room, link.playerId)) {
      broadcastRoom(room);
      maybeRunBots(room);
    }
  });

  socket.on('game:checkSuspects', ({ suspectIds }) => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    const room = RM.getRoom(link.code);
    if (!room) return;
    const ids = room.phase === 'accusation' ? G.getForcedCheckIds(room) : suspectIds;
    const result = G.checkSuspects(room, link.playerId, ids);
    if (result.ok) {
      const payload = RM.serializeForPlayer(room, link.playerId);
      socket.emit('room:state', payload);
    } else {
      socket.emit('room:error', { error: result.error });
    }
  });

  socket.on('game:placeAccusation', ({ suspectId }) => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    const room = RM.getRoom(link.code);
    if (!room) return;
    const result = G.placeAccusation(room, link.playerId, suspectId);
    if (result.ok) {
      broadcastRoom(room);
      maybeRunBots(room);
    } else {
      socket.emit('room:error', { error: result.error });
    }
  });

  socket.on('game:nextRound', () => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    const room = RM.getRoom(link.code);
    if (!room) return;
    if (room.hostId !== link.playerId) return;
    const result = G.nextRound(room);
    if (result.ok) {
      broadcastRoom(room);
      if (!result.gameOver) maybeRunBots(room);
    }
  });

  // Explicit, intentional leave: always drops the player for good (forgets their resume token).
  socket.on('room:leave', () => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    RM.socketToPlayer.delete(socket.id);
    const room = RM.getRoom(link.code);
    if (!room) return;
    const player = room.players.find((p) => p.id === link.playerId);
    if (!player) return;
    RM.forgetToken(player);
    if (!room.started) {
      G.removePlayer(room, link.playerId);
    } else {
      // Mid-game we can't safely splice a seat out (finder/turn order is index-based),
      // so just mark them gone; their seat sits out the rest of the game.
      player.connected = false;
      player.socketId = null;
      G.reassignHost(room);
    }
    if (RM.getRoom(room.code)) {
      RM.deleteRoomIfEmpty(room);
      if (RM.getRoom(room.code)) broadcastRoom(room);
    }
  });

  // Unintentional drop (closed tab, refresh, network blip): keep the seat warm so
  // session:resume can restore it later, instead of tearing down room/game state.
  socket.on('disconnect', () => {
    const link = RM.socketToPlayer.get(socket.id);
    if (!link) return;
    RM.socketToPlayer.delete(socket.id);
    const room = RM.getRoom(link.code);
    if (!room) return;
    const player = room.players.find((p) => p.id === link.playerId);
    if (!player || player.socketId !== socket.id) return; // a newer socket (resume) already replaced this one

    if (!room.started) {
      G.removePlayer(room, link.playerId);
      RM.forgetToken(player);
      RM.deleteRoomIfEmpty(room);
      if (RM.getRoom(room.code)) broadcastRoom(room);
      return;
    }

    player.connected = false;
    player.socketId = null;
    G.reassignHost(room);
    const anyHumanLeft = room.players.some((p) => !p.isBot && p.connected);
    if (!anyHumanLeft) {
      RM.scheduleAbandonCleanup(room);
    } else {
      broadcastRoom(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`덤불속 서버 실행 중: http://localhost:${PORT}`);
});
