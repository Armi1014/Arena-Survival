import { AudioSystem } from "./audio.js";
import { Game } from "./game.js";
import { MultiplayerClient } from "./multiplayer.js";
import { checkLeaderboardHealth, fetchLeaderboard, isOnlineLeaderboardEnabled, submitScore } from "./online.js";
import { loadSave } from "./storage.js";

const LEADERBOARD_NAME_STORAGE_KEY = "arena-survival-leaderboard-name";
const LOCAL_LEADERBOARD_STORAGE_KEY = "arena-survival-local-leaderboard";
const SELF_TEST_MODE = new URLSearchParams(window.location.search).get("selfTest") === "1";
const save = loadSave();
const audio = new AudioSystem(save.settings);
let leaderboardMode = "solo";

const ui = {
  hud: document.querySelector("#hud"),
  healthHearts: document.querySelector("#health-hearts"),
  upgradeCounter: document.querySelector("#upgrade-counter"),
  toastStack: document.querySelector("#toast-stack"),
  xpPanel: document.querySelector("#xp-panel"),
  xpFill: document.querySelector("#xp-fill"),
  dashFill: document.querySelector("#dash-fill"),
  dashText: document.querySelector("#dash-text"),
  grenadeHudPanel: document.querySelector("#grenade-hud-panel"),
  abilityHudLabel: document.querySelector("#ability-hud-label"),
  grenadeFill: document.querySelector("#grenade-fill"),
  grenadeText: document.querySelector("#grenade-text"),
  levelText: document.querySelector("#level-text"),
  scoreText: document.querySelector("#score-text"),
  goldCounter: document.querySelector("#gold-counter"),
  goldText: document.querySelector("#gold-text"),
  killText: document.querySelector("#kill-text"),
  timerText: document.querySelector("#timer-text"),
  hudHighScore: document.querySelector("#hud-high-score"),
  bossBanner: document.querySelector("#boss-banner"),
  titleScreen: document.querySelector("#title-screen"),
  helpScreen: document.querySelector("#help-screen"),
  pauseScreen: document.querySelector("#pause-screen"),
  healOfferScreen: document.querySelector("#heal-offer-screen"),
  healOfferGold: document.querySelector("#heal-offer-gold"),
  healOfferAcceptButton: document.querySelector("#heal-offer-accept-button"),
  healOfferSkipButton: document.querySelector("#heal-offer-skip-button"),
  upgradeScreen: document.querySelector("#upgrade-screen"),
  gameOverScreen: document.querySelector("#gameover-screen"),
  titleHighScore: document.querySelector("#title-high-score"),
  finalScore: document.querySelector("#final-score"),
  finalTime: document.querySelector("#final-time"),
  finalKills: document.querySelector("#final-kills"),
  finalBosses: document.querySelector("#final-bosses"),
  deathCauseCard: document.querySelector("#death-cause-card"),
  deathCauseText: document.querySelector("#death-cause-text"),
  runHighlights: document.querySelector("#run-highlights"),
  scoreSubmitPanel: document.querySelector("#score-submit-panel"),
  scoreSubmitStatus: document.querySelector("#score-submit-status"),
  leaderboardNameInput: document.querySelector("#leaderboard-name-input"),
  submitScoreButton: document.querySelector("#submit-score-button"),
  gameOverTitle: document.querySelector("#gameover-title"),
  soundButton: document.querySelector("#sound-button"),
  menuSoundButton: document.querySelector("#menu-sound-button"),
  resetStatsButton: document.querySelector("#reset-stats-button"),
  resetStatsNote: document.querySelector("#reset-stats-note"),
  grenadeEquipButton: document.querySelector("#grenade-equip-button"),
  grenadeStatus: document.querySelector("#grenade-status"),
  grenadeQuestText: document.querySelector("#grenade-quest-text"),
  landmineEquipButton: document.querySelector("#landmine-equip-button"),
  landmineStatus: document.querySelector("#landmine-status"),
  landmineQuestText: document.querySelector("#landmine-quest-text"),
  abilitySlotStatus: document.querySelector("#ability-slot-status"),
  loadoutCharacterName: document.querySelector("#loadout-character-name"),
  loadoutAccessoryList: document.querySelector("#loadout-accessory-list"),
  questList: document.querySelector("#quest-list"),
  characterList: document.querySelector("#character-list"),
  shopGold: document.querySelector("#shop-gold"),
  songShopList: document.querySelector("#song-shop-list"),
  customSongRequestButton: document.querySelector("#custom-song-request-button"),
  musicVolumeInput: document.querySelector("#music-volume-input"),
  adminLogin: document.querySelector("#admin-login"),
  adminTools: document.querySelector("#admin-tools"),
  openAdminButton: document.querySelector("#open-admin-button"),
  adminModeButton: document.querySelector("#admin-mode-button"),
  adminBackButton: document.querySelector("#admin-back-button"),
  adminPasswordInput: document.querySelector("#admin-password-input"),
  adminLoginButton: document.querySelector("#admin-login-button"),
  adminGoldInput: document.querySelector("#admin-gold-input"),
  adminSongTitle: document.querySelector("#admin-song-title"),
  adminSongArtist: document.querySelector("#admin-song-artist"),
  adminSongPrice: document.querySelector("#admin-song-price"),
  adminSongFile: document.querySelector("#admin-song-file"),
  adminAddSongButton: document.querySelector("#admin-add-song-button"),
  adminUnlockCharactersButton: document.querySelector("#admin-unlock-characters-button"),
  adminUnlockAllSongsButton: document.querySelector("#admin-unlock-all-songs-button"),
  adminClearCustomSongsButton: document.querySelector("#admin-clear-custom-songs-button"),
  adminSongList: document.querySelector("#admin-song-list"),
  adminGamePanel: document.querySelector("#admin-game-panel"),
  adminGameStatus: document.querySelector("#admin-game-status"),
  adminHealButton: document.querySelector("#admin-heal-button"),
  adminLevelButton: document.querySelector("#admin-level-button"),
  adminGoldRunButton: document.querySelector("#admin-gold-run-button"),
  adminResetAbilityButton: document.querySelector("#admin-reset-ability-button"),
  adminClearEnemiesButton: document.querySelector("#admin-clear-enemies-button"),
  adminClearProjectilesButton: document.querySelector("#admin-clear-projectiles-button"),
  adminSpawnBossButton: document.querySelector("#admin-spawn-boss-button"),
  adminSpawnEnemyButton: document.querySelector("#admin-spawn-enemy-button"),
  adminMenuHealButton: document.querySelector("#admin-menu-heal-button"),
  adminMenuLevelButton: document.querySelector("#admin-menu-level-button"),
  adminGrantXpButton: document.querySelector("#admin-grant-xp-button"),
  adminMenuGoldButton: document.querySelector("#admin-menu-gold-button"),
  adminResetAbilityMenuButton: document.querySelector("#admin-reset-ability-menu-button"),
  adminMenuClearEnemiesButton: document.querySelector("#admin-menu-clear-enemies-button"),
  adminMenuClearProjectilesButton: document.querySelector("#admin-menu-clear-projectiles-button"),
  adminMenuSpawnBossButton: document.querySelector("#admin-menu-spawn-boss-button"),
  adminMenuSpawnEnemyButton: document.querySelector("#admin-menu-spawn-enemy-button"),
  adminSpawnEnemySelect: document.querySelector("#admin-spawn-enemy-select"),
  adminAddSaveGoldButton: document.querySelector("#admin-add-save-gold-button"),
  adminUnlockAbilitiesButton: document.querySelector("#admin-unlock-abilities-button"),
  leaderboardRefreshButton: document.querySelector("#leaderboard-refresh-button"),
  leaderboardStatus: document.querySelector("#leaderboard-status"),
  leaderboardList: document.querySelector("#leaderboard-list"),
  leaderboardModeButtons: Array.from(document.querySelectorAll("[data-leaderboard-mode]")),
  coopHostButton: document.querySelector("#coop-host-button"),
  coopJoinButton: document.querySelector("#coop-join-button"),
  coopRoomCodeInput: document.querySelector("#coop-room-code-input"),
  coopRoomPanel: document.querySelector("#coop-room-panel"),
  coopRoomCode: document.querySelector("#coop-room-code"),
  coopCopyCodeButton: document.querySelector("#coop-copy-code-button"),
  coopPlayerList: document.querySelector("#coop-player-list"),
  coopReadyButton: document.querySelector("#coop-ready-button"),
  coopStartButton: document.querySelector("#coop-start-button"),
  coopLeaveButton: document.querySelector("#coop-leave-button"),
  coopStatusText: document.querySelector("#coop-status-text"),
  coopStatusPill: document.querySelector("#coop-status-pill"),
  menuTabButtons: Array.from(document.querySelectorAll("[data-menu-tab]")),
  menuPanels: Array.from(document.querySelectorAll("[data-menu-panel]")),
  statFields: Array.from(document.querySelectorAll("[data-stat]")),
  quickRunGuide: document.querySelector("#quick-run-guide"),
  wikiUnlockGuide: document.querySelector("#wiki-unlock-guide"),
  wikiStrategyGuide: document.querySelector("#wiki-strategy-guide"),
  enemyGuide: document.querySelector("#enemy-guide"),
  upgradeGuide: document.querySelector("#upgrade-guide"),
  wikiWindow: document.querySelector("#menu-panel-guide"),
  wikiDragHandle: document.querySelector("#wiki-window-header"),
  wikiCloseButton: document.querySelector("#wiki-close-button"),
  upgradeCards: document.querySelector("#upgrade-cards"),
  ariaStatus: document.querySelector("#aria-status"),
};

const canvas = document.querySelector("#game-canvas");
const game = new Game({ canvas, ui, save, audio });
const multiplayer = new MultiplayerClient({
  onStatus: (message) => setCoopStatus(message, true),
  onError: (message) => setCoopStatus(message, false),
  onCreated: (message) => {
    setCoopStatus(`Room ${message.roomCode} created.`, true);
  },
  onJoined: (message) => {
    setCoopStatus(`Joined room ${message.roomCode}.`, true);
  },
  onState: (state) => renderCoopRoomState(state),
  onPeerInput: (message) => game.applyRemoteInput(message.playerId, message.payload),
  onUpgradePick: (message) => game.selectCoopUpgradeForPlayer(message.playerId, message.payload?.upgradeId),
  onHostSnapshot: (message) => game.applyMultiplayerSnapshot(message.payload),
  onHostEvent: (message) => handleHostEvent(message.payload),
  onPeerLeft: (message) => {
    game.handleCoopPeerLeft(message.playerId);
    setCoopStatus("Teammate disconnected.", false);
  },
  onClosedRoom: (reason) => setCoopStatus(reason, false),
  onClosed: () => renderCoopRoomState(multiplayer.state),
});
game.setMultiplayerHooks({
  sendUpgradePick: (upgradeId) => multiplayer.sendUpgradePick(upgradeId),
  sendHostEvent: (payload) => multiplayer.sendHostEvent(payload),
});

function unlockAudio() {
  audio.unlock().catch(() => {
    // Headless validation does not provide a user gesture for Web Audio.
  });
}

function loadLeaderboardName() {
  try {
    return window.localStorage.getItem(LEADERBOARD_NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLeaderboardName(name) {
  try {
    window.localStorage.setItem(LEADERBOARD_NAME_STORAGE_KEY, name);
  } catch {
    // Private browsing or storage-disabled browsers can still submit for this session.
  }
}

function getMultiplayerDisplayName() {
  return (ui.leaderboardNameInput?.value || loadLeaderboardName() || "Player").trim().slice(0, 20) || "Player";
}

function getMultiplayerProfile() {
  return game.createMultiplayerProfile(getMultiplayerDisplayName());
}

function setCoopStatus(message, online = multiplayer.isConnected()) {
  if (ui.coopStatusText) {
    ui.coopStatusText.textContent = message;
  }
  if (ui.coopStatusPill) {
    ui.coopStatusPill.textContent = online ? "Online" : "Offline";
    ui.coopStatusPill.classList.toggle("online", Boolean(online));
  }
}

function setCoopControlsEnabled(enabled, message = "") {
  for (const control of [ui.coopHostButton, ui.coopJoinButton, ui.coopRoomCodeInput, ui.coopReadyButton, ui.coopStartButton]) {
    if (control) {
      control.disabled = !enabled;
    }
  }
  if (message) {
    setCoopStatus(message, enabled && multiplayer.isConnected());
  }
}

function renderCoopRoomState(state) {
  const hasRoom = Boolean(state?.roomCode);
  if (ui.coopRoomPanel) {
    ui.coopRoomPanel.hidden = !hasRoom;
  }
  if (ui.coopRoomCode) {
    ui.coopRoomCode.textContent = state?.roomCode ?? "-----";
  }
  if (ui.coopPlayerList) {
    const players = Array.isArray(state?.players) ? state.players : [];
    const nodes = players.map((player) => {
      const card = document.createElement("div");
      card.className = "coop-player-card";
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = `${player.name}${player.id === multiplayer.playerId ? " (You)" : ""}`;
      const meta = document.createElement("span");
      meta.className = "coop-player-meta";
      meta.textContent = `${player.role} · ${player.character}`;
      details.replaceChildren(name, meta);
      const ready = document.createElement("span");
      ready.className = `coop-ready-badge${player.ready ? " ready" : ""}`;
      ready.textContent = player.ready ? "Ready" : "Not ready";
      card.replaceChildren(details, ready);
      return card;
    });
    ui.coopPlayerList.replaceChildren(...nodes);
  }
  const localPlayer = state?.players?.find((player) => player.id === multiplayer.playerId);
  if (ui.coopReadyButton) {
    ui.coopReadyButton.textContent = localPlayer?.ready ? "Unready" : "Ready";
  }
  if (ui.coopStartButton) {
    const players = state?.players ?? [];
    const canStart = multiplayer.role === "host" && players.length >= 2 && players.length <= 4 && players.every((player) => player.ready);
    ui.coopStartButton.disabled = !canStart;
  }
}

function handleHostEvent(payload = {}) {
  if (payload.eventType === "sound") {
    game.playRemoteSoundCue(payload);
    return;
  }
  if (payload.eventType === "run:start" && multiplayer.role === "guest") {
    const room = payload.room;
    game.startMultiplayerGuest({
      roomCode: room?.roomCode,
      localPlayerId: multiplayer.playerId,
      players: room?.players ?? [],
    });
    return;
  }
  if (payload.eventType === "upgrade:offer" && multiplayer.role === "guest" && payload.playerId === multiplayer.playerId) {
    game.showGuestUpgradeOffer(payload.choices ?? []);
    return;
  }
  if (payload.eventType === "upgrade:complete" && game.isMultiplayerGuest()) {
    game.mode = "playing";
    game.syncScreens();
  }
}

function compareLeaderboardEntries(left, right) {
  return (
    (Number(right.score) || 0) - (Number(left.score) || 0) ||
    (Number(right.time) || 0) - (Number(left.time) || 0) ||
    (Number(right.kills) || 0) - (Number(left.kills) || 0) ||
    (Number(right.bosses) || 0) - (Number(left.bosses) || 0) ||
    new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime()
  );
}

function loadLocalLeaderboardEntries(mode = leaderboardMode) {
  try {
    const entries = JSON.parse(window.localStorage.getItem(LOCAL_LEADERBOARD_STORAGE_KEY) ?? "[]");
    return Array.isArray(entries) ? entries.filter((entry) => (entry.mode ?? "solo") === mode).sort(compareLeaderboardEntries).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function getLocalLeaderboardEntryId(entry) {
  return [
    entry.name ?? "Player",
    Math.floor(Number(entry.score) || 0),
    Math.round((Number(entry.time) || 0) * 1000),
    Math.floor(Number(entry.kills) || 0),
    Math.floor(Number(entry.bosses) || 0),
    Math.floor(Number(entry.level) || 1),
    entry.mode ?? "solo",
    entry.character ?? "gunner",
  ].join("|");
}

function saveLocalLeaderboardEntry(entry) {
  const localEntry = {
    ...entry,
    localId: entry.localId ?? getLocalLeaderboardEntryId(entry),
  };
  const entries = [
    localEntry,
    ...loadLocalLeaderboardEntries().filter((savedEntry) => (savedEntry.localId ?? getLocalLeaderboardEntryId(savedEntry)) !== localEntry.localId),
  ]
    .sort(compareLeaderboardEntries)
    .slice(0, 100);
  try {
    window.localStorage.setItem(LOCAL_LEADERBOARD_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage-disabled browsers can still view the score for this session through the returned list.
  }
  return entries.slice(0, 20);
}

function renderLocalLeaderboard(status) {
  const entries = loadLocalLeaderboardEntries(leaderboardMode);
  game.renderLeaderboardEntries(entries);
  game.setLeaderboardStatus(status ?? (entries.length ? "Showing local leaderboard." : "No local scores yet."));
}

function getLeaderboardStatus(result) {
  if (result?.disabled) {
    return "Online leaderboard is not configured yet.";
  }
  if (result?.offline) {
    return "Online leaderboard is unavailable right now.";
  }
  return result?.error || "Leaderboard request failed.";
}

async function initializeOnlineLeaderboardUi() {
  const enabled = isOnlineLeaderboardEnabled();
  game.setOnlineLeaderboardEnabled(enabled);
  if (ui.leaderboardRefreshButton) {
    ui.leaderboardRefreshButton.disabled = !enabled;
  }
  if (ui.leaderboardNameInput) {
    ui.leaderboardNameInput.value = loadLeaderboardName();
  }
  if (!enabled) {
    renderLocalLeaderboard("Online leaderboard is not configured. Showing local scores.");
    setCoopControlsEnabled(false, "Online co-op is not configured.");
    return;
  }
  if (SELF_TEST_MODE) {
    game.setLeaderboardStatus("Online leaderboard check skipped for self-test.");
    return;
  }
  game.setLeaderboardStatus("Checking online leaderboard...");
  const health = await checkLeaderboardHealth();
  if (health.ok) {
    setCoopControlsEnabled(Boolean(health.payload?.websocket), health.payload?.websocket ? "Online co-op ready." : "Co-op backend needs the WebSocket update.");
    await refreshLeaderboard({ loadingStatus: "Loading global scores..." });
  } else {
    setCoopControlsEnabled(false, "Online co-op is unavailable right now.");
    renderLocalLeaderboard(`${getLeaderboardStatus(health)} Press Refresh to retry online scores. Showing local scores.`);
  }
}

async function refreshLeaderboard({ loadingStatus = "Loading leaderboard..." } = {}) {
  if (!isOnlineLeaderboardEnabled()) {
    renderLocalLeaderboard("Online leaderboard is not configured. Showing local scores.");
    return;
  }

  if (ui.leaderboardRefreshButton) {
    ui.leaderboardRefreshButton.disabled = true;
  }
  game.setLeaderboardStatus(loadingStatus);
  const result = await fetchLeaderboard(leaderboardMode);
  if (result.ok) {
    game.renderLeaderboardEntries(result.entries);
    game.setLeaderboardStatus(result.entries.length ? `${leaderboardMode === "coop" ? "Co-op" : "Solo"} online scores loaded.` : "No online scores yet.");
  } else {
    renderLocalLeaderboard(`${getLeaderboardStatus(result)} Press Refresh to retry online scores. Showing local scores.`);
  }
  if (ui.leaderboardRefreshButton) {
    ui.leaderboardRefreshButton.disabled = !isOnlineLeaderboardEnabled();
  }
}

async function submitCurrentScore() {
  const runResult = game.getLastCompletedRunResult();
  if (!runResult) {
    game.setScoreSubmitStatus("No completed run is ready to submit.");
    return;
  }

  const name = (ui.leaderboardNameInput?.value ?? "").trim();
  if (!name) {
    game.setScoreSubmitStatus("Enter a display name first.");
    ui.leaderboardNameInput?.focus();
    return;
  }

  if (name.length > 20) {
    game.setScoreSubmitStatus("Display name must be 20 characters or less.");
    ui.leaderboardNameInput?.focus();
    return;
  }

  saveLeaderboardName(name);
  game.setScoreSubmitLoading(true);
  game.setScoreSubmitStatus("Submitting score...");
  const isCoopScore = runResult.mode === "coop";
  if (isCoopScore && leaderboardMode !== "coop") {
    leaderboardMode = "coop";
    for (const button of ui.leaderboardModeButtons ?? []) {
      button.classList.toggle("is-active", button.dataset.leaderboardMode === leaderboardMode);
    }
  }
  const submitName = isCoopScore ? runResult.name || name : name;
  const result = await submitScore({ ...runResult, name: submitName });
  if (result.ok) {
    game.markScoreSubmitted();
    game.setScoreSubmitStatus("Score submitted online.");
    game.renderLeaderboardEntries(result.entries);
    game.setLeaderboardStatus("Global leaderboard updated.");
  } else {
    const localEntries = saveLocalLeaderboardEntry({
      name: submitName,
      ...runResult,
      createdAt: new Date().toISOString(),
    });
    game.markScoreSavedLocally();
    game.setScoreSubmitStatus(`${getLeaderboardStatus(result)} Saved locally. Retry online when available.`);
    game.renderLeaderboardEntries(localEntries);
    game.setLeaderboardStatus("Showing local scores until online retry succeeds.");
  }
  game.setScoreSubmitLoading(false);
}

function selectMenuTab(tabId) {
  game.setMenuTab(tabId);
  if (tabId === "leaderboard") {
    refreshLeaderboard();
  }
}

function setLeaderboardMode(mode) {
  leaderboardMode = mode === "coop" ? "coop" : "solo";
  for (const button of ui.leaderboardModeButtons ?? []) {
    button.classList.toggle("is-active", button.dataset.leaderboardMode === leaderboardMode);
  }
  refreshLeaderboard({ loadingStatus: `Loading ${leaderboardMode === "coop" ? "co-op" : "solo"} leaderboard...` });
}

initializeOnlineLeaderboardUi();

document.querySelector("#start-button").addEventListener("click", () => {
  unlockAudio();
  game.startRun();
});

document.querySelector("#help-button").addEventListener("click", () => game.setMenuTab("controls"));
document.querySelector("#close-help-button").addEventListener("click", () => game.closeHelp());
document.querySelector("#resume-button").addEventListener("click", () => game.resume());
document.querySelector("#pause-help-button").addEventListener("click", () => game.showHelp());
document.querySelector("#quit-button").addEventListener("click", () => game.returnToTitle());
document.querySelector("#restart-button").addEventListener("click", () => {
  unlockAudio();
  game.restartRun();
});
document.querySelector("#gameover-help-button").addEventListener("click", () => game.showHelp());
document.querySelector("#gameover-quit-button").addEventListener("click", () => game.returnToTitle());
ui.soundButton.addEventListener("click", () => {
  unlockAudio();
  game.toggleMute();
});
ui.menuSoundButton.addEventListener("click", () => {
  unlockAudio();
  game.toggleMute();
});
ui.resetStatsButton.addEventListener("click", () => game.handleResetStatsClick());
ui.grenadeEquipButton?.addEventListener("click", () => game.toggleGrenadeEquip());
ui.landmineEquipButton?.addEventListener("click", () => game.toggleAbilityEquip("landmine"));
ui.healOfferAcceptButton?.addEventListener("click", () => game.acceptHealOffer());
ui.healOfferSkipButton?.addEventListener("click", () => game.skipHealOffer());
ui.customSongRequestButton?.addEventListener("click", () => game.requestCustomSong());
ui.musicVolumeInput?.addEventListener("input", () => {
  unlockAudio();
  game.setMusicVolume(Number(ui.musicVolumeInput.value));
});
ui.openAdminButton?.addEventListener("click", () => {
  game.setMenuTab("admin");
  ui.adminBackButton?.focus();
});
ui.adminBackButton?.addEventListener("click", () => {
  game.setMenuTab("settings");
  ui.openAdminButton?.focus();
});
ui.adminModeButton?.addEventListener("click", () => game.toggleAdminMode());
ui.adminLoginButton?.addEventListener("click", () => {
  game.unlockAdmin(ui.adminPasswordInput.value).catch(() => game.showToast("Admin unlock failed"));
});
ui.adminPasswordInput?.addEventListener("keydown", (event) => {
  if (event.code === "Enter") {
    event.preventDefault();
    game.unlockAdmin(ui.adminPasswordInput.value).catch(() => game.showToast("Admin unlock failed"));
  }
});
ui.adminGoldInput?.addEventListener("change", () => game.setAdminGold(Number(ui.adminGoldInput.value)));
ui.adminAddSaveGoldButton?.addEventListener("click", () => game.adminGrantSaveGold(1000));
ui.adminAddSongButton?.addEventListener("click", () => game.addAdminSongFromForm());
ui.adminUnlockCharactersButton?.addEventListener("click", () => game.adminUnlockAllCharacters());
ui.adminUnlockAbilitiesButton?.addEventListener("click", () => game.adminUnlockAllAbilities());
ui.adminUnlockAllSongsButton?.addEventListener("click", () => game.adminUnlockAllSongs());
ui.adminClearCustomSongsButton?.addEventListener("click", () => game.adminClearCustomSongs());
ui.adminHealButton?.addEventListener("click", () => game.adminHealPlayer());
ui.adminLevelButton?.addEventListener("click", () => game.adminForceLevelUp());
ui.adminGoldRunButton?.addEventListener("click", () => game.adminGrantRunGold(100));
ui.adminResetAbilityButton?.addEventListener("click", () => game.adminResetAbilityCooldown());
ui.adminClearEnemiesButton?.addEventListener("click", () => game.adminClearEnemies());
ui.adminClearProjectilesButton?.addEventListener("click", () => game.adminClearProjectiles());
ui.adminSpawnBossButton?.addEventListener("click", () => game.adminSpawnBoss());
ui.adminSpawnEnemyButton?.addEventListener("click", () => game.adminSpawnEnemy(ui.adminSpawnEnemySelect?.value || "nibbler"));
ui.adminMenuHealButton?.addEventListener("click", () => game.adminHealPlayer());
ui.adminMenuLevelButton?.addEventListener("click", () => game.adminForceLevelUp());
ui.adminGrantXpButton?.addEventListener("click", () => game.adminGrantXp(120));
ui.adminMenuGoldButton?.addEventListener("click", () => game.adminGrantRunGold(100));
ui.adminResetAbilityMenuButton?.addEventListener("click", () => game.adminResetAbilityCooldown());
ui.adminMenuClearEnemiesButton?.addEventListener("click", () => game.adminClearEnemies());
ui.adminMenuClearProjectilesButton?.addEventListener("click", () => game.adminClearProjectiles());
ui.adminMenuSpawnBossButton?.addEventListener("click", () => game.adminSpawnBoss());
ui.adminMenuSpawnEnemyButton?.addEventListener("click", () => game.adminSpawnEnemy(ui.adminSpawnEnemySelect?.value || "nibbler"));
ui.wikiCloseButton?.addEventListener("click", () => game.closeWikiWindow());
ui.leaderboardRefreshButton?.addEventListener("click", () => refreshLeaderboard());
ui.submitScoreButton?.addEventListener("click", () => submitCurrentScore());
ui.leaderboardNameInput?.addEventListener("change", () => saveLeaderboardName((ui.leaderboardNameInput.value ?? "").trim()));
ui.leaderboardModeButtons?.forEach((button) => {
  button.addEventListener("click", () => setLeaderboardMode(button.dataset.leaderboardMode));
});
ui.coopHostButton?.addEventListener("click", () => {
  unlockAudio();
  multiplayer.createRoom(getMultiplayerProfile()).catch((error) => setCoopStatus(error.message, false));
});
ui.coopJoinButton?.addEventListener("click", () => {
  unlockAudio();
  const roomCode = (ui.coopRoomCodeInput?.value ?? "").trim().toUpperCase();
  if (roomCode.length !== 5) {
    setCoopStatus("Enter a 5-character room code.", false);
    ui.coopRoomCodeInput?.focus();
    return;
  }
  multiplayer.joinRoom(roomCode, getMultiplayerProfile()).catch((error) => setCoopStatus(error.message, false));
});
ui.coopReadyButton?.addEventListener("click", () => {
  const localPlayer = multiplayer.state?.players?.find((player) => player.id === multiplayer.playerId);
  multiplayer.setReady(!localPlayer?.ready, getMultiplayerProfile());
});
ui.coopStartButton?.addEventListener("click", () => {
  if (multiplayer.role !== "host" || !multiplayer.state) {
    return;
  }
  game.startRun({
    multiplayer: {
      role: "host",
      roomCode: multiplayer.state.roomCode,
      localPlayerId: multiplayer.playerId,
      players: multiplayer.state.players,
    },
  });
  multiplayer.startRun();
});
ui.coopLeaveButton?.addEventListener("click", () => {
  multiplayer.leave();
  game.returnToTitle();
  setCoopStatus("Left co-op room.", false);
});
ui.coopCopyCodeButton?.addEventListener("click", () => {
  const code = multiplayer.state?.roomCode ?? "";
  if (!code) {
    return;
  }
  navigator.clipboard?.writeText(code).then(
    () => setCoopStatus(`Copied room ${code}.`, true),
    () => setCoopStatus(`Room code: ${code}`, true),
  );
});

function focusMenuTab(nextIndex) {
  const buttonCount = ui.menuTabButtons.length;
  const safeIndex = (nextIndex + buttonCount) % buttonCount;
  const nextButton = ui.menuTabButtons[safeIndex];
  nextButton.focus();
  selectMenuTab(nextButton.dataset.menuTab);
}

ui.menuTabButtons.forEach((button, index) => {
  button.addEventListener("click", () => selectMenuTab(button.dataset.menuTab));
  button.addEventListener("keydown", (event) => {
    if (event.code === "ArrowRight" || event.code === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      focusMenuTab(index + 1);
    } else if (event.code === "ArrowLeft" || event.code === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      focusMenuTab(index - 1);
    } else if (event.code === "Home") {
      event.preventDefault();
      event.stopPropagation();
      focusMenuTab(0);
    } else if (event.code === "End") {
      event.preventDefault();
      event.stopPropagation();
      focusMenuTab(ui.menuTabButtons.length - 1);
    }
  });
});

function sendGuestInput() {
  if (multiplayer.role === "guest" && multiplayer.isConnected() && game.mode !== "title") {
    multiplayer.sendInput(game.createInputSnapshot());
  }
}

canvas.addEventListener("pointermove", (event) => {
  game.onPointerMove(event.clientX, event.clientY);
  sendGuestInput();
});
canvas.addEventListener("pointerdown", (event) => {
  unlockAudio();
  game.onPointerMove(event.clientX, event.clientY);
  game.handleCanvasClick();
  sendGuestInput();
});
canvas.addEventListener(
  "wheel",
  (event) => {
    if (game.onWheel(event.deltaY, event.clientX, event.clientY) === false) {
      event.preventDefault();
    }
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  const isInteractiveTarget = Boolean(event.target.closest?.("button, a, input, select, textarea, [role='tab']"));
  if (
    !isInteractiveTarget &&
    [
      "Space",
      "Escape",
      "KeyM",
      "KeyE",
      "KeyF",
      "KeyT",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Equal",
      "Minus",
      "Digit0",
      "NumpadAdd",
      "NumpadSubtract",
      "Numpad0",
      "Digit1",
      "Digit2",
      "Digit3",
      "Numpad1",
      "Numpad2",
      "Numpad3",
    ].includes(
      event.code,
    )
  ) {
    event.preventDefault();
  }
  const isUpgradeShortcut = ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(event.code);
  if (isInteractiveTarget && event.code !== "Escape" && event.code !== "KeyM" && !isUpgradeShortcut) {
    return;
  }
  unlockAudio();
  game.onKeyDown(event.code);
  sendGuestInput();
});

window.addEventListener("keyup", (event) => {
  game.onKeyUp(event.code);
  sendGuestInput();
});
window.addEventListener("blur", () => game.handleBlur());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.handleBlur();
  }
});

window.setInterval(() => {
  sendGuestInput();
  if (multiplayer.role === "host" && multiplayer.isConnected() && game.isMultiplayerHost() && game.mode !== "title") {
    multiplayer.sendSnapshot(game.createMultiplayerSnapshot());
  }
}, 90);

async function runSelfTest() {
  const results = {
    started: false,
    paused: false,
    resumed: false,
    automaticFire: false,
    autoTargetClosest: false,
    dashCooldown: false,
    bossSpawn: false,
    engineerUnlock: false,
    engineerTurret: false,
    characterMenuSelection: false,
    acidSpitterProjectile: false,
    tankEnemy: false,
    adminGamePanel: false,
    adminManualBoss: false,
    adminUnlockAllCharacters: false,
    bossRandomAttackBag: false,
    bossHomingShots: false,
    bossSummonSentinels: false,
    sentinelDashAttack: false,
    sprinterEnemy: false,
    marksmanProjectile: false,
    landmineAbility: false,
    engineerAutoTurret: false,
    katanaLifesteal: false,
    upgradeCapRemoval: false,
    katanaUnlock: false,
    katanaMeleeAttack: false,
    katanaUpgradePool: false,
    highScorePersist: false,
    runStatsPersist: false,
    enemyGuideStatsPersist: false,
    quitToTitleSavesProgress: false,
    leaderboardOfflinePanel: false,
    gameOverSubmitPanel: false,
    musicDefaultsRemoved: false,
    enemyGoldValues: false,
    medkitUpgradeMaxHpOnly: false,
    medkitPickupRules: false,
    levelHealOffer: false,
    inventoryLoadoutSlot: false,
    inventoryQuestCards: false,
    inventoryDropdownToggle: false,
    engineerTurretBalance: false,
    worldCamera: false,
    zoomControls: false,
    deathCauseCard: false,
    acidSpitterVisualTuning: false,
    leaderboardRetryState: false,
  };

  game.selectCharacter("gunner");
  game.startRun();
  const startSnapshot = game.getDebugSnapshot();
  results.started = startSnapshot.mode === "playing";
  results.worldCamera =
    startSnapshot.world.infinite === true &&
    Math.abs(startSnapshot.camera.zoom - 0.72) < 0.001 &&
    Math.abs(startSnapshot.camera.x + 1280 / (2 * startSnapshot.camera.zoom)) < 0.001 &&
    Math.abs(startSnapshot.camera.y + 720 / (2 * startSnapshot.camera.zoom)) < 0.001;
  game.adjustCameraZoom(-1);
  const zoomedOutSnapshot = game.getDebugSnapshot();
  game.adjustCameraZoom(1);
  const zoomedInAgainSnapshot = game.getDebugSnapshot();
  results.zoomControls =
    zoomedOutSnapshot.camera.zoom < startSnapshot.camera.zoom &&
    zoomedOutSnapshot.camera.x < startSnapshot.camera.x &&
    Math.abs(zoomedInAgainSnapshot.camera.zoom - startSnapshot.camera.zoom) < 0.001;
  game.pause();
  results.paused = game.getDebugSnapshot().mode === "paused";
  game.resume();
  results.resumed = game.getDebugSnapshot().mode === "playing";
  const firstShotCount = game.getDebugSnapshot().shotsFired;
  game.stepManual(0.4);
  results.automaticFire = game.getDebugSnapshot().shotsFired > firstShotCount;
  game.startRun();
  game.pointer = { x: game.player.x - 240, y: game.player.y, inside: true };
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 180, y: game.player.y });
  game.spawnEnemy("nibbler", 1, { x: game.player.x - 360, y: game.player.y });
  game.tryAutoFire();
  const autoTargetShot = game.projectiles.at(-1);
  results.autoTargetClosest = Boolean(autoTargetShot && autoTargetShot.vx > 0 && Math.abs(autoTargetShot.vy) < 0.001);
  game.tryDash();
  const dashSnapshot = game.getDebugSnapshot();
  results.dashCooldown = dashSnapshot.dashCooldownRemaining > 0 && dashSnapshot.invulnerabilityRemaining > 0;
  game.run.elapsed = 179.95;
  game.stepManual(0.1);
  results.bossSpawn = game.getDebugSnapshot().bossCount === 1;

  game.startRun();
  const previousEngineerProgress = { ...game.save.progress };
  const previousTotalKills = game.save.stats.total.kills;
  const previousTotalBosses = game.save.stats.total.bosses;
  game.save.progress = {
    ...game.save.progress,
    katanaUnlocked: true,
    engineerUnlocked: true,
    selectedCharacterId: "engineer",
  };
  game.save.stats.total.bosses = Math.max(game.save.stats.total.bosses, 3);
  results.engineerUnlock = game.getSelectedCharacter().id === "engineer";
  game.startRun();
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 170, y: game.player.y });
  const engineerShotCount = game.getDebugSnapshot().shotsFired;
  const deployedTurret = game.tryDeployTurret();
  const turretOnPlayer = Boolean(game.turrets[0] && game.turrets[0].x === game.player.x && game.turrets[0].y === game.player.y);
  game.stepManual(0.2);
  const engineerSnapshot = game.getDebugSnapshot();
  results.engineerTurret = deployedTurret && turretOnPlayer && engineerSnapshot.turretCount === 1 && engineerSnapshot.shotsFired > engineerShotCount;
  game.renderCharacterMenu();
  [...document.querySelectorAll("#character-list .character-row")].find((row) => row.innerText.includes("Katana"))?.click();
  const selectedKatanaFromMenu = game.getSelectedCharacter().id === "katana";
  [...document.querySelectorAll("#character-list .character-row")].find((row) => row.innerText.includes("Engineer"))?.click();
  results.characterMenuSelection = selectedKatanaFromMenu && game.getSelectedCharacter().id === "engineer";
  game.save.progress = previousEngineerProgress;
  game.save.stats.total.kills = previousTotalKills;
  game.save.stats.total.bosses = previousTotalBosses;

  game.startRun();
  game.spawnEnemy("acid-spitter", 1, { x: game.player.x + 260, y: game.player.y });
  const acidSpitter = game.enemies.at(-1);
  acidSpitter.attackCooldownRemaining = 0;
  game.stepManual(0.1);
  const acidProjectile = game.enemyProjectiles.find((projectile) => projectile.acidZoneRadius > 0);
  results.acidSpitterProjectile = Boolean(acidProjectile);
  results.acidSpitterVisualTuning =
    Boolean(acidProjectile) &&
    acidProjectile.kind === "acid-spit" &&
    acidProjectile.radius === 8 &&
    acidProjectile.trailScale > 5 &&
    Math.hypot(acidProjectile.vx, acidProjectile.vy) >= 350;

  game.startRun();
  game.spawnEnemy("tank", 1, { x: game.player.x + 260, y: game.player.y });
  const tank = game.enemies.at(-1);
  game.stepManual(0.1);
  results.tankEnemy = tank.typeId === "tank" && tank.maxHp >= 38 && tank.vx < 0;

  const previousAdminUnlocked = game.adminUnlocked;
  const previousAdminModeEnabled = game.save.settings.adminModeEnabled;
  game.adminUnlocked = false;
  game.save.settings.adminModeEnabled = true;
  game.startRun();
  const adminPanel = document.querySelector("#admin-game-panel");
  const adminSpawnButton = document.querySelector("#admin-spawn-boss-button");
  const lockedAdminPanelHidden = Boolean(adminPanel && adminPanel.hidden && adminSpawnButton?.disabled);
  game.adminUnlocked = true;
  game.updateAdminModeUi();
  game.adminSpawnBoss();
  results.adminGamePanel = lockedAdminPanelHidden && Boolean(adminPanel && !adminPanel.hidden && adminPanel.dataset.locked === "false");
  results.adminManualBoss = game.getDebugSnapshot().bossCount === 1;
  game.save.progress = { ...previousEngineerProgress, katanaUnlocked: false, engineerUnlocked: false, selectedCharacterId: "gunner" };
  game.adminUnlockAllCharacters();
  results.adminUnlockAllCharacters = Boolean(game.save.progress.katanaUnlocked && game.save.progress.engineerUnlocked);
  game.adminUnlocked = previousAdminUnlocked;
  game.save.settings.adminModeEnabled = previousAdminModeEnabled;

  game.startRun();
  game.spawnBoss(0);
  const boss = game.enemies.find((enemy) => enemy.isBoss);
  const bossArena = game.getDebugSnapshot().bossArena;
  if (bossArena) {
    game.player.x = bossArena.x - 200;
    game.clampCombatToBossArena();
  }
  results.bossArenaClamp = Boolean(bossArena) && game.player.x >= bossArena.x;
  const bossAttackProbe = Array.from({ length: 8 }, () => game.getNextBossAttackPhase(boss));
  const bossPhases = ["charge", "volley", "burst", "summon"];
  results.bossRandomAttackBag =
    bossPhases.every((phase) => bossAttackProbe.slice(0, 4).includes(phase)) &&
    bossPhases.every((phase) => bossAttackProbe.slice(4, 8).includes(phase));
  boss.chargeDirection = { x: -1, y: 0 };
  game.enemyProjectiles = [];
  game.fireBossChargeShots(boss);
  results.bossHomingShots = game.enemyProjectiles.filter((projectile) => projectile.homingTarget === "player").length === 4;
  game.enemyProjectiles = [];
  game.summonBossAdds(boss);
  const bossSentinels = game.enemies.filter((enemy) => enemy.typeId === "sentinel");
  results.bossSummonSentinels = bossSentinels.length >= 3 && bossSentinels.every((enemy) => enemy.noDrops);
  const rewardProbe = bossSentinels[0];
  const rewardProbeState = { kills: game.run.kills, pickups: game.pickups.length, gold: game.run.goldEarned, xp: game.run.xp };
  if (rewardProbe) {
    game.damageEnemy(rewardProbe, rewardProbe.hp, "self-test");
  }
  results.bossMinionDropsNothing =
    Boolean(rewardProbe?.dead) &&
    game.run.kills === rewardProbeState.kills &&
    game.pickups.length === rewardProbeState.pickups &&
    game.run.goldEarned === rewardProbeState.gold &&
    game.run.xp === rewardProbeState.xp;

  game.startRun();
  game.spawnEnemy("sentinel", 1, { x: game.player.x + 260, y: game.player.y });
  const sentinel = game.enemies.at(-1);
  sentinel.attackCooldownRemaining = 0;
  game.stepManual(0.1);
  game.stepManual(0.46);
  results.sentinelDashAttack = sentinel.typeId === "sentinel" && sentinel.state === "dash";

  game.startRun();
  game.spawnEnemy("sprinter", 1, { x: game.player.x + 220, y: game.player.y });
  const sprinter = game.enemies.at(-1);
  game.stepManual(0.1);
  results.sprinterEnemy = sprinter.typeId === "sprinter" && sprinter.speed > 190 && sprinter.vx < 0;

  game.startRun();
  game.spawnEnemy("marksman", 1, { x: game.player.x + 360, y: game.player.y });
  const marksman = game.enemies.at(-1);
  marksman.attackCooldownRemaining = 0;
  game.stepManual(0.1);
  results.marksmanProjectile = game.enemyProjectiles.some((projectile) => projectile.sourceEnemyTypeId === "marksman");

  game.save.progress = { ...game.save.progress, landmineUnlocked: true, equippedAbilityId: "landmine", grenadeEquipped: false };
  game.startRun();
  game.tryAbility();
  const mine = game.landmines.at(-1);
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 10, y: game.player.y });
  game.stepManual(0.6);
  results.landmineAbility = Boolean(mine && mine.dead && game.getDebugSnapshot().landmineCount === 0);

  game.save.progress = { ...game.save.progress, engineerUnlocked: true, selectedCharacterId: "engineer" };
  game.startRun();
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 170, y: game.player.y });
  game.stepManual(0.1);
  results.engineerAutoTurret = game.getDebugSnapshot().turretCount === 1;

  game.save.progress = { ...game.save.progress, engineerUnlocked: true, selectedCharacterId: "engineer" };
  game.startRun();
  const baseTurret = {
    cooldown: game.player.turretDeployCooldown,
    lifetime: game.player.turretLifetime,
    range: game.player.turretRange,
    fireCooldown: game.player.turretFireCooldown,
  };
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 170, y: game.player.y });
  game.tryDeployTurret();
  game.stepManual(0.2);
  const turretShot = game.projectiles.find((projectile) => projectile.source === "turret");
  game.forceUpgrade("rapid-assembly");
  game.forceUpgrade("calibrated-turret");
  game.forceUpgrade("overclocked-sentry");
  results.engineerTurretBalance =
    baseTurret.cooldown === 10 &&
    baseTurret.lifetime === 8 &&
    baseTurret.range === 300 &&
    baseTurret.fireCooldown === 0.8 &&
    Boolean(turretShot && Math.abs(turretShot.damage - 0.6) < 0.001) &&
    Math.abs(game.player.turretDeployCooldown - 8.2) < 0.001 &&
    game.player.turretLifetime === 11 &&
    game.player.turretRange === 360 &&
    game.player.turretDamageBonus === 0.5 &&
    Math.abs(game.player.turretFireCooldown - 0.704) < 0.001;

  game.save.progress = { ...game.save.progress, engineerUnlocked: true, selectedCharacterId: "engineer" };
  game.startRun();
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 170, y: game.player.y });
  game.forceUpgrade("twin-sentries");
  game.forceUpgrade("twin-sentries");
  game.forceUpgrade("rapid-assembly");
  game.forceUpgrade("rapid-assembly");
  game.forceUpgrade("rapid-assembly");
  game.forceUpgrade("rapid-assembly");
  game.stepManual(0.1);
  game.stepManual(game.player.turretDeployCooldown + 0.1);
  game.stepManual(game.player.turretDeployCooldown + 0.1);
  results.engineerThreeTurrets = game.getDebugSnapshot().turretCount === 3;

  game.save.progress = { ...game.save.progress, katanaUnlocked: true, selectedCharacterId: "katana" };
  game.startRun();
  game.player.hp = Math.max(1, game.player.maxHp - 1);
  game.run.kills = 49;
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 60, y: game.player.y });
  const lifestealTarget = game.enemies.at(-1);
  game.damageEnemy(lifestealTarget, lifestealTarget.hp, "self-test");
  results.katanaLifesteal = game.player.hp === game.player.maxHp;

  game.startRun();
  game.forceUpgrade("bubble-guard");
  game.forceUpgrade("bubble-guard");
  game.forceUpgrade("bubble-guard");
  results.upgradeCapRemoval = !game.getDebugSnapshot().availableUpgrades.includes("bubble-guard");

  const builtInSongIds = new Set(["arcade-pulse", "neon-run", "boss-voltage"]);
  results.musicDefaultsRemoved =
    !game.getSongCatalog().some((song) => song.builtIn || builtInSongIds.has(song.id)) &&
    !(game.save.music?.ownedSongIds ?? []).some((songId) => builtInSongIds.has(songId)) &&
    !builtInSongIds.has(game.save.music?.selectedSongId ?? "");

  game.startRun();
  const expectedGoldValues = [
    ["nibbler", 2],
    ["sprinter", 1],
    ["spitter", 5],
    ["marksman", 6],
    ["acid-spitter", 7],
    ["bumper", 8],
    ["tank", 15],
    ["sentinel", 3],
  ];
  const enemyGoldOk = expectedGoldValues.every(([enemyId, goldValue]) => {
    game.spawnEnemy(enemyId, 1, { x: game.player.x + 220, y: game.player.y });
    return game.getEnemyGoldValue(game.enemies.at(-1)) === goldValue;
  });
  game.spawnBoss(0);
  results.enemyGoldValues = enemyGoldOk && game.getEnemyGoldValue(game.enemies.find((enemy) => enemy.isBoss)) === 25;

  game.startRun();
  game.player.hp = 2;
  game.forceUpgrade("heart-balloon");
  results.medkitUpgradeMaxHpOnly = game.player.maxHp === 6 && game.player.hp === 2;

  game.startRun();
  const medkit = {
    type: "medkit",
    x: game.player.x,
    y: game.player.y,
    vx: 0,
    vy: 0,
    radius: 11,
    value: 2,
    life: 16,
    dead: false,
  };
  game.pickups.push(medkit);
  game.updatePickups(0.016);
  const medkitIgnoredAtFullHp = !medkit.dead && game.player.hp === game.player.maxHp;
  game.player.hp = game.player.maxHp - 2;
  game.updatePickups(0.016);
  results.medkitPickupRules = medkitIgnoredAtFullHp && medkit.dead && game.player.hp === game.player.maxHp;

  const previousGoldForHealOffer = game.save.wallet.gold;
  game.save.wallet.gold = 500;
  game.startRun();
  game.pendingLevelUps = 1;
  game.pendingHealOfferLevels = [10];
  game.player.hp = game.player.maxHp;
  game.showNextLevelReward();
  const healOfferSkipsFullHp = game.mode === "upgrade";
  game.save.wallet.gold = 499;
  game.startRun();
  game.pendingLevelUps = 1;
  game.pendingHealOfferLevels = [10];
  game.player.hp = game.player.maxHp - 1;
  game.showNextLevelReward();
  const healOfferSkipsInsufficientGold = game.mode === "upgrade";
  game.save.wallet.gold = 500;
  game.startRun();
  game.pendingLevelUps = 1;
  game.pendingHealOfferLevels = [10];
  game.player.hp = game.player.maxHp - 1;
  game.showNextLevelReward();
  const healOfferShowsWhenEligible = game.mode === "healOffer";
  results.levelHealOffer = healOfferSkipsFullHp && healOfferSkipsInsufficientGold && healOfferShowsWhenEligible;
  game.save.wallet.gold = previousGoldForHealOffer;

  game.save.progress = {
    ...game.save.progress,
    grenadeUnlocked: true,
    landmineUnlocked: true,
    selectedCharacterId: "gunner",
    equippedAbilityId: "",
    grenadeEquipped: false,
    loadouts: {
      ...game.getLoadouts(),
      gunner: { accessoryIds: [] },
    },
  };
  game.toggleAbilityEquip("grenade");
  const grenadeLoadoutEquipped = game.getEquippedAbilityId() === "grenade" && game.getSelectedAccessoryIds("gunner").join(",") === "grenade";
  game.toggleAbilityEquip("landmine");
  const landmineLoadoutEquipped = game.getEquippedAbilityId() === "landmine" && game.getSelectedAccessoryIds("gunner").join(",") === "landmine";
  game.renderCharacterMenu();
  game.renderQuestMenu();
  results.inventoryLoadoutSlot =
    grenadeLoadoutEquipped &&
    landmineLoadoutEquipped &&
    document.querySelector("#loadout-character-name")?.textContent === "Gunner" &&
    document.querySelector("#loadout-accessory-list")?.textContent === "Landmine";
  results.inventoryQuestCards =
    document.querySelector("#menu-tab-characters .menu-tab-label")?.textContent?.trim() === "Inventory" &&
    document.querySelectorAll("#character-list .inventory-section").length === 2 &&
    document.querySelectorAll("#quest-list .quest-section").length >= 1 &&
    document.querySelectorAll("#quest-list .quest-row .quest-badge").length >= 4 &&
    !document.querySelector("#menu-panel-play #grenade-equip-button") &&
    !document.querySelector("#menu-panel-play #landmine-equip-button");
  const characterDropdown = document.querySelector('#character-list [data-inventory-section="characters"]');
  characterDropdown?.querySelector("summary")?.click();
  const dropdownClosedAfterClick = characterDropdown?.open === false;
  game.updateHud();
  results.inventoryDropdownToggle =
    dropdownClosedAfterClick && document.querySelector('#character-list [data-inventory-section="characters"]')?.open === false;

  const statsBefore = {
    runs: game.save.stats.total.runs,
    kills: game.save.stats.total.kills,
    bosses: game.save.stats.total.bosses,
    shotsFired: game.save.stats.total.shotsFired,
    damageTaken: game.save.stats.total.damageTaken,
  };
  game.run.score = 9999;
  game.run.elapsed = 123;
  game.run.kills = 14;
  game.run.bossKills = 3;
  game.run.shotsFired = 31;
  game.run.damageTaken = 4;
  game.run.level = 5;
  game.endRun();
  const scoreSubmitPanel = document.querySelector("#score-submit-panel");
  const scoreSubmitButton = document.querySelector("#submit-score-button");
  results.gameOverSubmitPanel =
    Boolean(scoreSubmitPanel && !scoreSubmitPanel.hidden && scoreSubmitButton) &&
    game.getLastCompletedRunResult()?.score === 9999;
  game.markScoreSavedLocally();
  results.leaderboardRetryState =
    scoreSubmitButton?.textContent === "Retry Online" &&
    scoreSubmitButton.disabled === false &&
    document.querySelector("#score-submit-status")?.textContent.includes("Retry online");
  game.scoreSubmitState = "idle";
  game.onlineScoreSubmitted = false;
  game.updateScoreSubmitPanel();
  results.highScorePersist = game.getDebugSnapshot().highScore >= 9999;
  results.katanaUnlock = Boolean(game.getDebugSnapshot().progress?.katanaUnlocked);
  game.setMenuTab("leaderboard");
  const originalFetch = window.fetch;
  window.fetch = () => Promise.reject(new Error("Self-test leaderboard offline"));
  await refreshLeaderboard();
  window.fetch = originalFetch;
  results.leaderboardOfflinePanel =
    document.querySelector("#leaderboard-status")?.textContent.includes("unavailable") &&
    Boolean(document.querySelector("#leaderboard-list"));
  game.selectCharacter("katana");
  game.startRun();
  const katanaTarget = { x: game.player.x + 70, y: game.player.y };
  game.spawnEnemy("nibbler", 1, katanaTarget);
  const katanaEnemy = game.enemies.at(-1);
  game.tryAutoFire();
  const katanaSnapshot = game.getDebugSnapshot();
  results.katanaMeleeAttack =
    katanaSnapshot.attackType === "melee" &&
    katanaSnapshot.shotsFired === 1 &&
    katanaSnapshot.projectileCount === 0 &&
    katanaEnemy.hp < katanaEnemy.maxHp;
  results.katanaUpgradePool =
    katanaSnapshot.availableUpgrades.includes("sharpened-edge") && !katanaSnapshot.availableUpgrades.includes("rapid-pop");
  results.runStatsPersist =
    game.save.stats.best.score >= 9999 &&
    game.save.stats.best.time >= 123 &&
    game.save.stats.best.kills >= 14 &&
    game.save.stats.best.bosses >= 3 &&
    game.save.stats.best.level >= 5 &&
    game.save.stats.total.runs >= statsBefore.runs + 1 &&
    game.save.stats.total.kills >= statsBefore.kills + 14 &&
    game.save.stats.total.bosses >= statsBefore.bosses + 3 &&
    game.save.stats.total.shotsFired >= statsBefore.shotsFired + 31 &&
    game.save.stats.total.damageTaken >= statsBefore.damageTaken + 4;

  const enemyStatsBefore = {
    kills: game.save.stats.enemy?.nibbler?.kills ?? 0,
    deaths: game.save.stats.enemy?.nibbler?.deaths ?? 0,
  };
  game.startRun();
  game.spawnEnemy("nibbler", 1, { x: game.player.x + 120, y: game.player.y });
  const guideEnemy = game.enemies.at(-1);
  game.damageEnemy(guideEnemy, guideEnemy.hp, "self-test");
  game.player.hp = 1;
  game.takePlayerDamage(1, "nibbler");
  results.deathCauseCard =
    game.getLastCompletedRunResult()?.deathCause?.label === "Killed by Runner - Contact" &&
    document.querySelector("#death-cause-card")?.hidden === false &&
    document.querySelector("#death-cause-text")?.textContent === "Killed by Runner - Contact";
  results.enemyGuideStatsPersist =
    (game.save.stats.enemy?.nibbler?.kills ?? 0) >= enemyStatsBefore.kills + 1 &&
    (game.save.stats.enemy?.nibbler?.deaths ?? 0) >= enemyStatsBefore.deaths + 1;

  const quitStatsBefore = {
    runs: game.save.stats.total.runs,
    kills: game.save.stats.total.kills,
    bosses: game.save.stats.total.bosses,
    shotsFired: game.save.stats.total.shotsFired,
    damageTaken: game.save.stats.total.damageTaken,
  };
  game.startRun();
  game.run.score = 321;
  game.run.elapsed = 45;
  game.run.kills = 7;
  game.run.bossKills = 1;
  game.run.shotsFired = 5;
  game.run.damageTaken = 2;
  game.run.level = 3;
  game.run.enemyKills.nibbler = 7;
  game.returnToTitle();
  results.quitToTitleSavesProgress =
    game.mode === "title" &&
    !game.run &&
    game.save.stats.total.runs >= quitStatsBefore.runs + 1 &&
    game.save.stats.total.kills >= quitStatsBefore.kills + 7 &&
    game.save.stats.total.bosses >= quitStatsBefore.bosses + 1 &&
    game.save.stats.total.shotsFired >= quitStatsBefore.shotsFired + 5 &&
    game.save.stats.total.damageTaken >= quitStatsBefore.damageTaken + 2 &&
    (game.save.stats.enemy?.nibbler?.kills ?? 0) >= enemyStatsBefore.kills + 8;

  const success = Object.values(results).every(Boolean);
  document.body.dataset.selfTest = success ? "pass" : "fail";
  const output = document.querySelector("#self-test-output");
  output.hidden = false;
  output.textContent = JSON.stringify({ success, results }, null, 2);
}

if (SELF_TEST_MODE) {
  runSelfTest().catch((error) => {
    document.body.dataset.selfTest = "fail";
    const output = document.querySelector("#self-test-output");
    output.hidden = false;
    output.textContent = String(error?.stack ?? error);
  });
} else {
  game.startLoop();
}

window.__bubbleBlitz = game;
window.__bubbleBlitzSelfTest = runSelfTest;
