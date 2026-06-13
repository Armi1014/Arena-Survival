import { getMultiplayerWebSocketUrl } from "./online.js";

const RECONNECTABLE_CLOSE_CODES = new Set([1006, 1011, 1012, 1013]);
const CONNECT_TIMEOUT_MS = 9000;
const ROOM_RESPONSE_TIMEOUT_MS = 12000;
const CONNECT_RETRY_DELAYS_MS = [0, 1500, 3000, 5000, 8000];

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class MultiplayerClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.socket = null;
    this.roomCode = "";
    this.playerId = "";
    this.role = "";
    this.sequence = 0;
    this.state = null;
    this.manualClose = false;
    this.pendingRoomRequest = null;
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect() {
    const url = getMultiplayerWebSocketUrl();
    if (!url) {
      this.handlers.onError?.("Online multiplayer is not configured.");
      return Promise.reject(new Error("Online multiplayer is not configured."));
    }
    this.close();
    this.manualClose = false;
    let lastError = null;
    for (let attempt = 0; attempt < CONNECT_RETRY_DELAYS_MS.length; attempt += 1) {
      const waitMs = CONNECT_RETRY_DELAYS_MS[attempt];
      if (waitMs > 0) {
        this.handlers.onStatus?.(`Loading online co-op... retry ${attempt + 1}/${CONNECT_RETRY_DELAYS_MS.length}`);
        await delay(waitMs);
      } else {
        this.handlers.onStatus?.("Connecting to online co-op...");
      }
      try {
        await this.openSocket(url);
        return;
      } catch (error) {
        lastError = error;
        if (this.manualClose) {
          throw error;
        }
      }
    }
    this.handlers.onError?.("Online co-op is still loading. Try again in a few seconds.");
    throw lastError ?? new Error("Could not connect to multiplayer server.");
  }

  openSocket(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let opened = false;
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (opened || settled) {
          return;
        }
        settled = true;
        try {
          socket.close();
        } catch {
          // Ignore a socket that failed while Render was loading.
        }
        reject(new Error("Multiplayer connection timed out."));
      }, CONNECT_TIMEOUT_MS);

      this.socket = socket;
      socket.addEventListener("open", () => {
        opened = true;
        settled = true;
        window.clearTimeout(timeoutId);
        this.handlers.onStatus?.("Connected to multiplayer server.");
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        if (!opened && !settled) {
          settled = true;
          window.clearTimeout(timeoutId);
          reject(new Error("Could not connect to multiplayer server."));
        }
      }, { once: true });
      socket.addEventListener("message", (event) => this.handleMessage(event.data));
      socket.addEventListener("close", (event) => {
        window.clearTimeout(timeoutId);
        if (!opened && !settled) {
          settled = true;
          reject(new Error("Multiplayer connection closed before it opened."));
          return;
        }
        const wasManual = this.manualClose;
        this.socket = null;
        this.settleRoomRequest(new Error("Multiplayer connection closed."));
        if (!wasManual && RECONNECTABLE_CLOSE_CODES.has(event.code)) {
          this.handlers.onError?.("Multiplayer connection was interrupted.");
        }
        this.handlers.onClosed?.(event);
      });
    });
  }

  close() {
    this.manualClose = true;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
    this.roomCode = "";
    this.playerId = "";
    this.role = "";
    this.state = null;
    this.settleRoomRequest(new Error("Multiplayer connection closed."));
  }

  async createRoom(profile) {
    await this.connect();
    return this.requestRoom("room:create", profile);
  }

  async joinRoom(roomCode, profile) {
    await this.connect();
    this.roomCode = roomCode.trim().toUpperCase();
    return this.requestRoom("room:join", { ...profile, roomCode: this.roomCode }, this.roomCode);
  }

  requestRoom(type, payload = {}, roomCode = this.roomCode) {
    if (this.pendingRoomRequest) {
      this.settleRoomRequest(new Error("Another multiplayer room request started."));
    }
    return new Promise((resolve, reject) => {
      const request = {
        resolve,
        reject,
        timeoutId: window.setTimeout(() => {
          if (this.pendingRoomRequest === request) {
            this.pendingRoomRequest = null;
            reject(new Error("Room request timed out. Try again."));
          }
        }, ROOM_RESPONSE_TIMEOUT_MS),
      };
      this.pendingRoomRequest = request;
      if (!this.send(type, payload, roomCode)) {
        this.settleRoomRequest(new Error("Multiplayer connection is not open."));
      }
    });
  }

  settleRoomRequest(error = null, message = null) {
    const request = this.pendingRoomRequest;
    if (!request) {
      return;
    }
    window.clearTimeout(request.timeoutId);
    this.pendingRoomRequest = null;
    if (error) {
      request.reject(error);
      return;
    }
    request.resolve(message);
  }

  setReady(ready, profile) {
    this.send("room:ready", { ...profile, ready });
  }

  startRun() {
    this.send("run:start", {});
  }

  sendInput(input) {
    this.send("input:update", input);
  }

  sendSnapshot(snapshot) {
    this.send("host:snapshot", snapshot);
  }

  sendHostEvent(payload) {
    this.send("host:event", payload);
  }

  sendUpgradePick(upgradeId) {
    this.send("upgrade:pick", { upgradeId });
  }

  sendReviveUpdate(active) {
    this.send("revive:update", { active: Boolean(active) });
  }

  leave() {
    this.send("room:leave", {});
    this.close();
  }

  send(type, payload = {}, roomCode = this.roomCode) {
    if (!this.isConnected()) {
      return false;
    }
    this.sequence += 1;
    this.socket.send(JSON.stringify({
      type,
      roomCode,
      playerId: this.playerId,
      seq: this.sequence,
      payload,
    }));
    return true;
  }

  handleMessage(rawData) {
    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      this.handlers.onError?.("Received an invalid multiplayer message.");
      return;
    }
    if (!message || typeof message.type !== "string") {
      return;
    }
    if (message.roomCode) {
      this.roomCode = message.roomCode;
    }
    if (message.playerId && (message.type === "room:created" || message.type === "room:joined")) {
      this.playerId = message.playerId;
    }
    if (message.type === "room:created") {
      this.role = "host";
      this.state = message.payload ?? null;
      this.handlers.onCreated?.(message);
      this.handlers.onState?.(this.state);
      this.settleRoomRequest(null, message);
      return;
    }
    if (message.type === "room:joined") {
      this.role = "guest";
      this.state = message.payload ?? null;
      this.handlers.onJoined?.(message);
      this.handlers.onState?.(this.state);
      this.settleRoomRequest(null, message);
      return;
    }
    if (message.type === "room:state") {
      this.state = message.payload ?? null;
      this.handlers.onState?.(this.state);
      return;
    }
    if (message.type === "room:error") {
      const error = new Error(message.payload?.error || "Multiplayer error.");
      this.handlers.onError?.(error.message);
      this.settleRoomRequest(error);
      return;
    }
    if (message.type === "peer:joined") {
      this.handlers.onPeerJoined?.(message);
      if (message.payload) {
        this.state = message.payload;
        this.handlers.onState?.(this.state);
      }
      return;
    }
    if (message.type === "peer:left") {
      this.handlers.onPeerLeft?.(message);
      if (message.payload) {
        this.state = message.payload;
        this.handlers.onState?.(this.state);
      }
      return;
    }
    if (message.type === "peer:input") {
      this.handlers.onPeerInput?.(message);
      return;
    }
    if (message.type === "upgrade:pick") {
      this.handlers.onUpgradePick?.(message);
      return;
    }
    if (message.type === "revive:update") {
      this.handlers.onReviveUpdate?.(message);
      return;
    }
    if (message.type === "host:snapshot") {
      this.handlers.onHostSnapshot?.(message);
      return;
    }
    if (message.type === "host:event") {
      this.handlers.onHostEvent?.(message);
      return;
    }
    if (message.type === "room:closed") {
      this.handlers.onClosedRoom?.(message.payload?.reason || "Room closed.");
      this.close();
    }
  }
}
