import { getMultiplayerWebSocketUrl } from "./online.js";

const RECONNECTABLE_CLOSE_CODES = new Set([1006, 1011, 1012, 1013]);

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
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect() {
    const url = getMultiplayerWebSocketUrl();
    if (!url) {
      this.handlers.onError?.("Online multiplayer is not configured.");
      return Promise.reject(new Error("Online multiplayer is not configured."));
    }
    this.close();
    this.manualClose = false;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.handlers.onStatus?.("Connected to multiplayer server.");
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        this.handlers.onError?.("Could not connect to multiplayer server.");
        reject(new Error("Could not connect to multiplayer server."));
      }, { once: true });
      socket.addEventListener("message", (event) => this.handleMessage(event.data));
      socket.addEventListener("close", (event) => {
        const wasManual = this.manualClose;
        this.socket = null;
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
  }

  async createRoom(profile) {
    await this.connect();
    this.send("room:create", profile);
  }

  async joinRoom(roomCode, profile) {
    await this.connect();
    this.roomCode = roomCode.trim().toUpperCase();
    this.send("room:join", { ...profile, roomCode: this.roomCode }, this.roomCode);
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
      return;
    }
    if (message.type === "room:joined") {
      this.role = "guest";
      this.state = message.payload ?? null;
      this.handlers.onJoined?.(message);
      this.handlers.onState?.(this.state);
      return;
    }
    if (message.type === "room:state") {
      this.state = message.payload ?? null;
      this.handlers.onState?.(this.state);
      return;
    }
    if (message.type === "room:error") {
      this.handlers.onError?.(message.payload?.error || "Multiplayer error.");
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
