import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createDefaultCosmetic,
  createInitialSimState,
  createPlayerState,
  enforceInputTimeouts,
  stepSimulation,
} from './src/shared/physics.ts';
import type {
  ClientToServerMessage,
  PlayerCosmetic,
  RoomSnapshot,
  ServerToClientMessage,
  WorldSimulationState,
} from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface ServerPlayerConn {
  playerId: string;
  slot: 0 | 1 | 2 | 3;
  ws: WebSocket | null;
  lastSeenAt: number;
}

interface GameRoom {
  roomCode: string;
  hostId: string;
  fillBots: boolean;
  sim: WorldSimulationState;
  conns: Map<string, ServerPlayerConn>;
  lastTickMs: number;
  lastBroadcastMs: number;
  emptySinceMs: number | null;
}

const rooms = new Map<string, GameRoom>();
const socketToMember = new WeakMap<WebSocket, { roomCode: string; playerId: string }>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function generatePlayerId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

function sendMsg(ws: WebSocket | null, msg: ServerToClientMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function makeRoomSnapshot(room: GameRoom): RoomSnapshot {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    fillBots: room.fillBots,
    sim: room.sim,
  };
}

function broadcastRoomState(room: GameRoom): void {
  const payload = JSON.stringify({
    type: 'room:state',
    snapshot: makeRoomSnapshot(room),
  } satisfies ServerToClientMessage);

  for (const conn of room.conns.values()) {
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(payload);
    }
  }
}

function syncBotsInRoom(room: GameRoom): void {
  for (let i = 0; i < 4; i++) {
    const slot = i as 0 | 1 | 2 | 3;
    const p = room.sim.players[slot];
    const hasHuman = Array.from(room.conns.values()).some((c) => c.slot === slot);
    if (!hasHuman) {
      if (room.fillBots) {
        const bot = createPlayerState(slot, { isBot: true, connected: true });
        room.sim.players[slot] = bot;
      } else {
        const empty = createPlayerState(slot, {
          id: `empty-${slot}`,
          name: `مقعد ${slot + 1}`,
          isBot: false,
          connected: false,
        });
        room.sim.players[slot] = empty;
      }
    } else if (p.isBot) {
      p.isBot = false;
    }
  }
}

function createRoom(hostWs: WebSocket, name: string, cosmetic: PlayerCosmetic): void {
  const roomCode = generateRoomCode();
  const playerId = generatePlayerId();
  const cleanName = (name || 'قبطان').trim().slice(0, 16) || 'قبطان';

  const sim = createInitialSimState('online', cleanName, cosmetic);
  sim.phase = 'waiting';
  sim.players[0].id = playerId;
  sim.players[0].ready = true;
  for (let i = 1; i < 4; i++) {
    const slot = i as 1 | 2 | 3;
    sim.players[slot] = createPlayerState(slot, { isBot: true, connected: true });
  }

  const room: GameRoom = {
    roomCode,
    hostId: playerId,
    fillBots: true,
    sim,
    conns: new Map([
      [
        playerId,
        {
          playerId,
          slot: 0,
          ws: hostWs,
          lastSeenAt: Date.now(),
        },
      ],
    ]),
    lastTickMs: Date.now(),
    lastBroadcastMs: Date.now(),
    emptySinceMs: null,
  };

  rooms.set(roomCode, room);
  socketToMember.set(hostWs, { roomCode, playerId });

  sendMsg(hostWs, {
    type: 'room:joined',
    roomCode,
    playerId,
    slot: 0,
    snapshot: makeRoomSnapshot(room),
  });
}

function joinRoom(
  ws: WebSocket,
  rawCode: string,
  name: string,
  cosmetic: PlayerCosmetic,
  reconnectPlayerId?: string,
): void {
  const roomCode = (rawCode || '').trim().toUpperCase();
  const room = rooms.get(roomCode);
  if (!room) {
    sendMsg(ws, { type: 'room:error', message: 'الغرفة غير موجودة أو انتهت صلاحيتها.' });
    return;
  }

  // Reconnection check
  if (reconnectPlayerId && room.conns.has(reconnectPlayerId)) {
    const existing = room.conns.get(reconnectPlayerId)!;
    existing.ws = ws;
    existing.lastSeenAt = Date.now();
    const p = room.sim.players[existing.slot];
    p.connected = true;
    p.isBot = false;
    room.emptySinceMs = null;
    socketToMember.set(ws, { roomCode, playerId: reconnectPlayerId });
    sendMsg(ws, {
      type: 'room:joined',
      roomCode,
      playerId: reconnectPlayerId,
      slot: existing.slot,
      snapshot: makeRoomSnapshot(room),
    });
    broadcastRoomState(room);
    return;
  }

  // Find an open human slot (prefer slots without an active human connection)
  const takenSlots = new Set(Array.from(room.conns.values()).map((c) => c.slot));
  let openSlot: 0 | 1 | 2 | 3 | null = null;
  for (let i = 0; i < 4; i++) {
    const s = i as 0 | 1 | 2 | 3;
    if (!takenSlots.has(s)) {
      openSlot = s;
      break;
    }
  }

  if (openSlot === null) {
    sendMsg(ws, { type: 'room:error', message: 'الغرفة ممتلئة (4/4 لاعبين).' });
    return;
  }

  const playerId = generatePlayerId();
  const cleanName = (name || `لاعب ${openSlot + 1}`).trim().slice(0, 16);
  const playerState = createPlayerState(openSlot, {
    id: playerId,
    name: cleanName,
    connected: true,
    isBot: false,
    cosmetic: cosmetic ?? createDefaultCosmetic(openSlot),
  });
  playerState.ready = true;
  room.sim.players[openSlot] = playerState;
  room.emptySinceMs = null;

  room.conns.set(playerId, {
    playerId,
    slot: openSlot,
    ws,
    lastSeenAt: Date.now(),
  });
  socketToMember.set(ws, { roomCode, playerId });

  sendMsg(ws, {
    type: 'room:joined',
    roomCode,
    playerId,
    slot: openSlot,
    snapshot: makeRoomSnapshot(room),
  });
  broadcastRoomState(room);
}

function handleDisconnect(ws: WebSocket, permanentLeave: boolean): void {
  const member = socketToMember.get(ws);
  if (!member) return;
  socketToMember.delete(ws);

  const room = rooms.get(member.roomCode);
  if (!room) return;
  const conn = room.conns.get(member.playerId);
  if (!conn) return;

  const p = room.sim.players[conn.slot];
  // Immediately release any stuck input on disconnect
  p.farting = false;
  p.moveDir = 0;

  if (permanentLeave) {
    room.conns.delete(member.playerId);
    syncBotsInRoom(room);
  } else {
    conn.ws = null;
    conn.lastSeenAt = Date.now();
    p.connected = false;
  }

  // Host migration if host left permanently or all sockets closed
  const activeHumans = Array.from(room.conns.values()).filter((c) => c.ws && c.ws.readyState === WebSocket.OPEN);
  if (activeHumans.length === 0) {
    room.emptySinceMs = Date.now();
  } else if (!activeHumans.some((c) => c.playerId === room.hostId)) {
    room.hostId = activeHumans[0].playerId;
  }

  broadcastRoomState(room);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        sendMsg(ws, { type: 'pong', serverTime: Date.now() });
        return;
      }

      if (msg.type === 'room:create') {
        handleDisconnect(ws, true);
        createRoom(ws, msg.name, msg.cosmetic);
        return;
      }

      if (msg.type === 'room:join') {
        handleDisconnect(ws, true);
        joinRoom(ws, msg.roomCode, msg.name, msg.cosmetic, msg.playerId);
        return;
      }

      const member = socketToMember.get(ws);
      if (!member) return;
      const room = rooms.get(member.roomCode);
      if (!room) return;
      const conn = room.conns.get(member.playerId);
      if (!conn) return;
      conn.lastSeenAt = Date.now();

      const player = room.sim.players[conn.slot];

      switch (msg.type) {
        case 'room:leave':
          handleDisconnect(ws, true);
          break;
        case 'room:ready':
          player.ready = Boolean(msg.ready);
          broadcastRoomState(room);
          break;
        case 'room:cosmetic':
          player.cosmetic = msg.cosmetic;
          broadcastRoomState(room);
          break;
        case 'room:toggleBots':
          if (member.playerId === room.hostId) {
            room.fillBots = Boolean(msg.fillBots);
            syncBotsInRoom(room);
            broadcastRoomState(room);
          }
          break;
        case 'room:start':
          if (member.playerId === room.hostId) {
            room.sim.phase = 'playing';
            room.sim.elapsedTime = 0;
            room.sim.falls = 0;
            room.sim.checkpointIndex = 0;
            room.sim.raft.x = 0;
            room.sim.raft.z = 0;
            room.sim.raft.vx = 0;
            room.sim.raft.vz = 0;
            room.sim.raft.yaw = 0;
            room.sim.raft.omega = 0;
            room.sim.progress = 0;
            broadcastRoomState(room);
          }
          break;
        case 'room:restart':
          if (member.playerId === room.hostId) {
            const preservedPlayers = room.sim.players;
            const fresh = createInitialSimState('online');
            fresh.players = preservedPlayers;
            for (const p of fresh.players) {
              p.farting = false;
              p.fartHoldTime = 0;
              p.fartPower = 0;
              p.moveDir = 0;
              p.stats = {
                totalFartTime: 0,
                fartCount: 0,
                maxBurstDuration: 0,
                torqueImpulseSum: 0,
                wallImpactCount: 0,
              };
            }
            room.sim = fresh;
            syncBotsInRoom(room);
            broadcastRoomState(room);
          }
          break;
        case 'input:state':
          player.moveDir = msg.moveDir === -1 || msg.moveDir === 1 ? msg.moveDir : 0;
          player.farting = Boolean(msg.farting);
          player.lastInputAt = Date.now();
          break;
      }
    });

    ws.on('close', () => {
      handleDisconnect(ws, false);
    });
  });

  // Authoritative 30Hz physics loop + 20Hz state broadcast
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      // Clean up disconnected stale connections after 15s reconnect grace window
      for (const [pid, conn] of room.conns.entries()) {
        if (!conn.ws && now - conn.lastSeenAt > 15000) {
          room.conns.delete(pid);
          syncBotsInRoom(room);
        }
      }

      if (room.emptySinceMs && now - room.emptySinceMs > 30000) {
        rooms.delete(code);
        continue;
      }

      const rawDt = (now - room.lastTickMs) / 1000;
      room.lastTickMs = now;

      if (room.sim.phase === 'playing' || room.sim.phase === 'falling') {
        enforceInputTimeouts(room.sim, now);

        // Bots in online rooms only run if fillBots is enabled
        if (room.fillBots) {
          // Run simple bot assist for bot seats
          room.sim.mode = 'solo';
          stepSimulation(room.sim, rawDt);
          room.sim.mode = 'online';
        } else {
          stepSimulation(room.sim, rawDt);
        }
      }

      if (now - room.lastBroadcastMs >= 48) {
        room.lastBroadcastMs = now;
        broadcastRoomState(room);
      }
    }
  }, 33);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Crazy Raft server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
