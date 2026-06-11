const cors = require("cors");
const express = require("express");
const fs = require("fs");
const { createServer } = require("http");
const path = require("path");
const WebSocket = require("ws");

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT) || 8787;
const maxStoredEntries = 100;
const maxReturnedEntries = 20;
const validCharacters = new Set(["gunner", "katana", "engineer"]);
const validLeaderboardModes = new Set(["solo", "coop"]);
const dataDirectory = process.env.LEADERBOARD_DATA_DIR || path.join(__dirname, "data");
const dataFile = path.join(dataDirectory, "leaderboard.json");
const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const maxCoopPlayers = 4;
const maxRoomAgeMs = 1000 * 60 * 60 * 2;
const staleSocketMs = 1000 * 35;

let leaderboardEntries = [];
let playerProfiles = new Map();
const rooms = new Map();

app.use(cors());
app.use(express.json({ limit: "16kb" }));

function compareEntries(left, right) {
  return (
    right.score - left.score ||
    right.time - left.time ||
    right.kills - left.kills ||
    right.bosses - left.bosses ||
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function getTopEntries(limit = maxReturnedEntries, mode = "solo") {
  return leaderboardEntries
    .filter((entry) => entry.mode === mode)
    .slice()
    .sort(compareEntries)
    .slice(0, limit);
}

function normalizeMode(mode) {
  return validLeaderboardModes.has(mode) ? mode : "solo";
}

function normalizePlayers(players, fallbackName, fallbackCharacter) {
  if (!Array.isArray(players)) {
    return [{ name: fallbackName, character: fallbackCharacter }];
  }
  return players
    .filter((player) => player && typeof player.name === "string")
    .map((player) => ({
      name: player.name.trim().slice(0, 20) || "Player",
      character: validCharacters.has(player.character) ? player.character : "gunner",
    }))
    .slice(0, maxCoopPlayers);
}

function normalizeProfileName(name) {
  return String(name || "Player").trim().slice(0, 20) || "Player";
}

function getProfileKey(name) {
  return normalizeProfileName(name).toLowerCase();
}

function createEmptyProfile(name) {
  return {
    name: normalizeProfileName(name),
    totalRuns: 0,
    totalScore: 0,
    bestScore: 0,
    bestTime: 0,
    totalTime: 0,
    totalKills: 0,
    totalBosses: 0,
    highestLevel: 1,
    characters: {},
    modes: { solo: 0, coop: 0 },
    recentRuns: [],
    lastSeenAt: "",
  };
}

function updateProfileFromEntry(profileName, character, entry) {
  const key = getProfileKey(profileName);
  const profile = playerProfiles.get(key) || createEmptyProfile(profileName);
  profile.name = normalizeProfileName(profileName);
  profile.totalRuns += 1;
  profile.totalScore += entry.score;
  profile.bestScore = Math.max(profile.bestScore, entry.score);
  profile.bestTime = Math.max(profile.bestTime, entry.time);
  profile.totalTime += entry.time;
  profile.totalKills += entry.kills;
  profile.totalBosses += entry.bosses;
  profile.highestLevel = Math.max(profile.highestLevel, entry.level);
  profile.characters[character] = (profile.characters[character] || 0) + 1;
  profile.modes[entry.mode] = (profile.modes[entry.mode] || 0) + 1;
  profile.lastSeenAt = entry.createdAt;
  profile.recentRuns = [
    {
      mode: entry.mode,
      score: entry.score,
      time: entry.time,
      kills: entry.kills,
      bosses: entry.bosses,
      level: entry.level,
      character,
      createdAt: entry.createdAt,
    },
    ...profile.recentRuns,
  ].slice(0, 10);
  playerProfiles.set(key, profile);
}

function rebuildProfilesFromEntries() {
  playerProfiles = new Map();
  for (const entry of leaderboardEntries) {
    if (entry.mode === "coop" && Array.isArray(entry.players) && entry.players.length) {
      for (const player of entry.players) {
        updateProfileFromEntry(player.name, player.character, entry);
      }
    } else {
      updateProfileFromEntry(entry.name, entry.character, entry);
    }
  }
}

function normalizeStoredEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .filter((entry) => entry && typeof entry.name === "string")
    .map((entry) => {
      const mode = normalizeMode(entry.mode);
      const character = validCharacters.has(entry.character) ? entry.character : "gunner";
      const name = entry.name.slice(0, 40);
      return {
        mode,
        name,
        players: mode === "coop" ? normalizePlayers(entry.players, name, character) : undefined,
        score: Number.isFinite(entry.score) ? entry.score : 0,
        time: Number.isFinite(entry.time) ? entry.time : 0,
        kills: Number.isInteger(entry.kills) ? entry.kills : 0,
        bosses: Number.isInteger(entry.bosses) ? entry.bosses : 0,
        level: Number.isInteger(entry.level) ? entry.level : 1,
        character,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
      };
    })
    .sort(compareEntries)
    .slice(0, maxStoredEntries);
}

function loadLeaderboard() {
  try {
    if (!fs.existsSync(dataFile)) {
      leaderboardEntries = [];
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    leaderboardEntries = normalizeStoredEntries(parsed.entries);
    rebuildProfilesFromEntries();
  } catch (error) {
    console.warn(`Could not load leaderboard data: ${error.message}`);
    leaderboardEntries = [];
    playerProfiles = new Map();
  }
}

function saveLeaderboard() {
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify({
      entries: leaderboardEntries,
      profiles: Object.fromEntries(playerProfiles),
    }, null, 2));
  } catch (error) {
    console.warn(`Could not save leaderboard data: ${error.message}`);
  }
}

function readFiniteNumber(body, field, min, max, integer = true) {
  const value = body?.[field];
  if (!Number.isFinite(value)) {
    return { error: `${field} must be a finite number.` };
  }
  if (value < min || value > max) {
    return { error: `${field} must be between ${min} and ${max}.` };
  }
  if (integer && !Number.isInteger(value)) {
    return { error: `${field} must be an integer.` };
  }
  return { value };
}

function validateScorePayload(body) {
  const mode = normalizeMode(body?.mode);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 40) {
    return { error: "name must be 1-40 characters." };
  }

  const score = readFiniteNumber(body, "score", 0, 9999999);
  const time = readFiniteNumber(body, "time", 0, 7200, false);
  const kills = readFiniteNumber(body, "kills", 0, 100000);
  const bosses = readFiniteNumber(body, "bosses", 0, 1000);
  const level = readFiniteNumber(body, "level", 1, 999);
  const character = typeof body?.character === "string" ? body.character.trim() : "";

  for (const result of [score, time, kills, bosses, level]) {
    if (result.error) {
      return result;
    }
  }

  if (!validCharacters.has(character)) {
    return { error: "character must be one of: gunner, katana, engineer." };
  }

  const players = mode === "coop" ? normalizePlayers(body.players, name, character) : undefined;
  if (mode === "coop" && (!players || players.length < 1 || players.length > maxCoopPlayers)) {
    return { error: `coop scores must include one to ${maxCoopPlayers} players.` };
  }

  return {
    entry: {
      mode,
      name,
      players,
      score: score.value,
      time: time.value,
      kills: kills.value,
      bosses: bosses.value,
      level: level.value,
      character,
      createdAt: new Date().toISOString(),
    },
  };
}

function sendJson(ws, message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastRoom(room, message, exceptPlayerId = "") {
  for (const player of room.players.values()) {
    if (player.id !== exceptPlayerId) {
      sendJson(player.ws, message);
    }
  }
}

function createRoomCode() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      code += roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  return `${Date.now().toString(36).slice(-5)}`.toUpperCase();
}

function createPlayerId(role) {
  return `${role}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeRoomPlayer(payload, role) {
  return {
    name: typeof payload?.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 20) : role === "host" ? "Host" : "Guest",
    character: validCharacters.has(payload?.character) ? payload.character : "gunner",
    accessoryIds: Array.isArray(payload?.accessoryIds) ? payload.accessoryIds.filter((id) => typeof id === "string").slice(0, 1) : [],
  };
}

function serializeRoom(room) {
  return {
    roomCode: room.code,
    status: room.status,
    hostId: room.hostId,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      role: player.role,
      name: player.name,
      character: player.character,
      accessoryIds: player.accessoryIds,
      ready: Boolean(player.ready),
      connected: player.ws?.readyState === WebSocket.OPEN,
    })),
  };
}

function touchRoom(room) {
  room.updatedAt = Date.now();
}

function sendRoomState(room) {
  broadcastRoom(room, { type: "room:state", payload: serializeRoom(room) });
}

function closeRoom(room, reason = "Room closed.") {
  broadcastRoom(room, { type: "room:closed", payload: { reason } });
  for (const player of room.players.values()) {
    try {
      player.ws?.close();
    } catch {
      // Socket might already be closed.
    }
  }
  rooms.delete(room.code);
}

function getPlayerRoom(playerId) {
  for (const room of rooms.values()) {
    if (room.players.has(playerId)) {
      return room;
    }
  }
  return null;
}

function relayToHost(room, sender, type, payload, seq) {
  const host = room.players.get(room.hostId);
  if (!host || host.id === sender.id) {
    return;
  }
  sendJson(host.ws, {
    type,
    roomCode: room.code,
    playerId: sender.id,
    seq,
    payload,
  });
}

app.get("/health", (request, response) => {
  response.json({ ok: true, websocket: true });
});

app.get("/leaderboard", (request, response) => {
  const mode = normalizeMode(String(request.query.mode || "solo"));
  response.json({ mode, entries: getTopEntries(maxReturnedEntries, mode) });
});

app.get("/profiles/:name", (request, response) => {
  const profile = playerProfiles.get(getProfileKey(request.params.name));
  response.json({ ok: true, profile: profile || null });
});

app.post("/leaderboard/submit", (request, response) => {
  const validated = validateScorePayload(request.body);
  if (validated.error) {
    response.status(400).json({ ok: false, error: validated.error });
    return;
  }

  leaderboardEntries.push(validated.entry);
  leaderboardEntries = [
    ...getTopEntries(maxStoredEntries, "solo"),
    ...getTopEntries(maxStoredEntries, "coop"),
  ].slice(0, maxStoredEntries * 2);
  if (validated.entry.mode === "coop" && Array.isArray(validated.entry.players)) {
    for (const player of validated.entry.players) {
      updateProfileFromEntry(player.name, player.character, validated.entry);
    }
  } else {
    updateProfileFromEntry(validated.entry.name, validated.entry.character, validated.entry);
  }
  saveLeaderboard();
  response.status(201).json({
    ok: true,
    entry: validated.entry,
    entries: getTopEntries(maxReturnedEntries, validated.entry.mode),
  });
});

const wss = new WebSocket.Server({ server, path: "/multiplayer" });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.playerId = "";
  ws.on("pong", () => {
    ws.isAlive = true;
    ws.lastSeenAt = Date.now();
  });
  ws.lastSeenAt = Date.now();

  ws.on("message", (rawMessage) => {
    ws.lastSeenAt = Date.now();
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      sendJson(ws, { type: "room:error", payload: { error: "Invalid JSON message." } });
      return;
    }
    if (!message || typeof message.type !== "string") {
      sendJson(ws, { type: "room:error", payload: { error: "Message type is required." } });
      return;
    }

    const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
    if (message.type === "room:create") {
      const code = createRoomCode();
      const playerId = createPlayerId("host");
      const playerData = sanitizeRoomPlayer(payload, "host");
      const room = {
        code,
        hostId: playerId,
        status: "lobby",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        players: new Map(),
      };
      const player = { id: playerId, role: "host", ready: false, ws, ...playerData };
      room.players.set(playerId, player);
      rooms.set(code, room);
      ws.playerId = playerId;
      sendJson(ws, { type: "room:created", roomCode: code, playerId, payload: serializeRoom(room) });
      sendRoomState(room);
      return;
    }

    if (message.type === "room:join") {
      const code = String(message.roomCode || payload.roomCode || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(ws, { type: "room:error", payload: { error: "Room not found." } });
        return;
      }
      if (room.status !== "lobby") {
        sendJson(ws, { type: "room:error", payload: { error: "Run already started." } });
        return;
      }
      if (room.players.size >= maxCoopPlayers) {
        sendJson(ws, { type: "room:error", payload: { error: "Room is full." } });
        return;
      }
      const playerId = createPlayerId("guest");
      const playerData = sanitizeRoomPlayer(payload, "guest");
      room.players.set(playerId, { id: playerId, role: "guest", ready: false, ws, ...playerData });
      ws.playerId = playerId;
      touchRoom(room);
      sendJson(ws, { type: "room:joined", roomCode: code, playerId, payload: serializeRoom(room) });
      broadcastRoom(room, { type: "peer:joined", roomCode: code, playerId, payload: serializeRoom(room) }, playerId);
      sendRoomState(room);
      return;
    }

    const room = getPlayerRoom(ws.playerId);
    if (!room) {
      sendJson(ws, { type: "room:error", payload: { error: "Join or create a room first." } });
      return;
    }
    const sender = room.players.get(ws.playerId);
    if (!sender) {
      sendJson(ws, { type: "room:error", payload: { error: "Player not found in room." } });
      return;
    }
    touchRoom(room);

    if (message.type === "room:ready") {
      sender.ready = Boolean(payload.ready);
      const playerData = sanitizeRoomPlayer(payload, sender.role);
      sender.name = playerData.name;
      sender.character = playerData.character;
      sender.accessoryIds = playerData.accessoryIds;
      sendRoomState(room);
      return;
    }

    if (message.type === "run:start") {
      if (sender.id !== room.hostId) {
        sendJson(ws, { type: "room:error", payload: { error: "Only the host can start the run." } });
        return;
      }
      if (room.players.size < 2 || room.players.size > maxCoopPlayers || !Array.from(room.players.values()).every((player) => player.ready)) {
        sendJson(ws, { type: "room:error", payload: { error: `Co-op needs 2 to ${maxCoopPlayers} ready players.` } });
        return;
      }
      room.status = "running";
      sendRoomState(room);
      broadcastRoom(room, {
        type: "host:event",
        roomCode: room.code,
        playerId: sender.id,
        seq: message.seq,
        payload: { eventType: "run:start", room: serializeRoom(room) },
      });
      return;
    }

    if (message.type === "host:snapshot") {
      if (sender.id !== room.hostId) {
        return;
      }
      broadcastRoom(room, {
        type: "host:snapshot",
        roomCode: room.code,
        playerId: sender.id,
        seq: message.seq,
        payload,
      }, sender.id);
      return;
    }

    if (message.type === "host:event") {
      if (sender.id !== room.hostId) {
        return;
      }
      broadcastRoom(room, {
        type: "host:event",
        roomCode: room.code,
        playerId: sender.id,
        seq: message.seq,
        payload,
      }, sender.id);
      return;
    }

    if (message.type === "input:update") {
      relayToHost(room, sender, "peer:input", payload, message.seq);
      return;
    }

    if (message.type === "upgrade:pick" || message.type === "revive:update") {
      relayToHost(room, sender, message.type, payload, message.seq);
      return;
    }

    if (message.type === "room:leave") {
      ws.close();
      return;
    }

    sendJson(ws, { type: "room:error", payload: { error: `Unsupported message type: ${message.type}` } });
  });

  ws.on("close", () => {
    const room = getPlayerRoom(ws.playerId);
    if (!room) {
      return;
    }
    const player = room.players.get(ws.playerId);
    if (!player) {
      return;
    }
    if (player.id === room.hostId) {
      closeRoom(room, "Host disconnected.");
      return;
    }
    room.players.delete(player.id);
    room.status = room.status === "running" ? "paused" : room.status;
    touchRoom(room);
    broadcastRoom(room, { type: "peer:left", roomCode: room.code, playerId: player.id, payload: serializeRoom(room) });
    sendRoomState(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const client of wss.clients) {
    if (client.isAlive === false || now - (client.lastSeenAt || now) > staleSocketMs) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
  for (const room of rooms.values()) {
    if (now - room.updatedAt > maxRoomAgeMs || room.players.size === 0) {
      closeRoom(room, "Room expired.");
    }
  }
}, 10000).unref();

loadLeaderboard();

app.use((request, response) => {
  response.status(404).json({ ok: false, error: "Not found." });
});

server.listen(port, () => {
  console.log(`Arena Survival online API listening on ${port}`);
});
