import { AudioSystem } from "./audio.js";
import { Game } from "./game.js";
import { fetchLeaderboard, isOnlineLeaderboardEnabled, submitScore } from "./online.js";
import { loadSave } from "./storage.js";

const LEADERBOARD_NAME_STORAGE_KEY = "arena-survival-leaderboard-name";
const save = loadSave();
const audio = new AudioSystem(save.settings);

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
  grenadeFill: document.querySelector("#grenade-fill"),
  grenadeText: document.querySelector("#grenade-text"),
  levelText: document.querySelector("#level-text"),
  scoreText: document.querySelector("#score-text"),
  goldText: document.querySelector("#gold-text"),
  killText: document.querySelector("#kill-text"),
  timerText: document.querySelector("#timer-text"),
  hudHighScore: document.querySelector("#hud-high-score"),
  bossBanner: document.querySelector("#boss-banner"),
  titleScreen: document.querySelector("#title-screen"),
  helpScreen: document.querySelector("#help-screen"),
  pauseScreen: document.querySelector("#pause-screen"),
  upgradeScreen: document.querySelector("#upgrade-screen"),
  gameOverScreen: document.querySelector("#gameover-screen"),
  titleHighScore: document.querySelector("#title-high-score"),
  finalScore: document.querySelector("#final-score"),
  finalTime: document.querySelector("#final-time"),
  finalKills: document.querySelector("#final-kills"),
  finalBosses: document.querySelector("#final-bosses"),
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
  adminClearEnemiesButton: document.querySelector("#admin-clear-enemies-button"),
  adminSpawnBossButton: document.querySelector("#admin-spawn-boss-button"),
  leaderboardRefreshButton: document.querySelector("#leaderboard-refresh-button"),
  leaderboardStatus: document.querySelector("#leaderboard-status"),
  leaderboardList: document.querySelector("#leaderboard-list"),
  menuTabButtons: Array.from(document.querySelectorAll("[data-menu-tab]")),
  menuPanels: Array.from(document.querySelectorAll("[data-menu-panel]")),
  statFields: Array.from(document.querySelectorAll("[data-stat]")),
  enemyGuide: document.querySelector("#enemy-guide"),
  upgradeGuide: document.querySelector("#upgrade-guide"),
  upgradeCards: document.querySelector("#upgrade-cards"),
  ariaStatus: document.querySelector("#aria-status"),
};

const canvas = document.querySelector("#game-canvas");
const game = new Game({ canvas, ui, save, audio });

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

function getLeaderboardStatus(result) {
  if (result?.disabled) {
    return "Online leaderboard is not configured yet.";
  }
  if (result?.offline) {
    return "Online leaderboard is unavailable right now.";
  }
  return result?.error || "Leaderboard request failed.";
}

function initializeOnlineLeaderboardUi() {
  const enabled = isOnlineLeaderboardEnabled();
  game.setOnlineLeaderboardEnabled(enabled);
  if (ui.leaderboardRefreshButton) {
    ui.leaderboardRefreshButton.disabled = !enabled;
  }
  if (ui.leaderboardNameInput) {
    ui.leaderboardNameInput.value = loadLeaderboardName();
  }
  if (!enabled) {
    game.setLeaderboardStatus("Online leaderboard is not configured yet.");
    game.renderLeaderboardEntries([]);
  } else {
    game.setLeaderboardStatus("Press Refresh to load online scores.");
  }
}

async function refreshLeaderboard() {
  if (!isOnlineLeaderboardEnabled()) {
    game.setLeaderboardStatus("Online leaderboard is not configured yet.");
    game.renderLeaderboardEntries([]);
    return;
  }

  if (ui.leaderboardRefreshButton) {
    ui.leaderboardRefreshButton.disabled = true;
  }
  game.setLeaderboardStatus("Loading leaderboard...");
  const result = await fetchLeaderboard();
  if (result.ok) {
    game.renderLeaderboardEntries(result.entries);
    game.setLeaderboardStatus(result.entries.length ? "Top online runs loaded." : "No online scores yet.");
  } else {
    game.setLeaderboardStatus(getLeaderboardStatus(result));
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
  const result = await submitScore({ name, ...runResult });
  if (result.ok) {
    game.markScoreSubmitted();
    game.setScoreSubmitStatus("Score submitted.");
    game.renderLeaderboardEntries(result.entries);
    game.setLeaderboardStatus("Leaderboard updated.");
  } else {
    game.setScoreSubmitStatus(getLeaderboardStatus(result));
  }
  game.setScoreSubmitLoading(false);
}

function selectMenuTab(tabId) {
  game.setMenuTab(tabId);
  if (tabId === "leaderboard") {
    refreshLeaderboard();
  }
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
ui.adminAddSongButton?.addEventListener("click", () => game.addAdminSongFromForm());
ui.adminUnlockCharactersButton?.addEventListener("click", () => game.adminUnlockAllCharacters());
ui.adminUnlockAllSongsButton?.addEventListener("click", () => game.adminUnlockAllSongs());
ui.adminClearCustomSongsButton?.addEventListener("click", () => game.adminClearCustomSongs());
ui.adminHealButton?.addEventListener("click", () => game.adminHealPlayer());
ui.adminLevelButton?.addEventListener("click", () => game.adminForceLevelUp());
ui.adminGoldRunButton?.addEventListener("click", () => game.adminGrantRunGold(100));
ui.adminClearEnemiesButton?.addEventListener("click", () => game.adminClearEnemies());
ui.adminSpawnBossButton?.addEventListener("click", () => game.adminSpawnBoss());
ui.leaderboardRefreshButton?.addEventListener("click", () => refreshLeaderboard());
ui.submitScoreButton?.addEventListener("click", () => submitCurrentScore());
ui.leaderboardNameInput?.addEventListener("change", () => saveLeaderboardName((ui.leaderboardNameInput.value ?? "").trim()));

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

canvas.addEventListener("pointermove", (event) => game.onPointerMove(event.clientX, event.clientY));
canvas.addEventListener("pointerdown", (event) => {
  unlockAudio();
  game.onPointerMove(event.clientX, event.clientY);
  game.handleCanvasClick();
});

window.addEventListener("keydown", (event) => {
  const isInteractiveTarget = Boolean(event.target.closest?.("button, a, input, select, textarea, [role='tab']"));
  if (
    !isInteractiveTarget &&
    ["Space", "Escape", "KeyM", "KeyE", "KeyT", "KeyW", "KeyA", "KeyS", "KeyD", "Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(
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
});

window.addEventListener("keyup", (event) => game.onKeyUp(event.code));
window.addEventListener("blur", () => game.handleBlur());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.handleBlur();
  }
});

async function runSelfTest() {
  unlockAudio();
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
  };

  game.selectCharacter("gunner");
  game.startRun();
  results.started = game.getDebugSnapshot().mode === "playing";
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
  results.acidSpitterProjectile = game.enemyProjectiles.some((projectile) => projectile.acidZoneRadius > 0);

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
  const bossAttackProbe = Array.from({ length: 8 }, () => game.getNextBossAttackPhase(boss));
  const bossPhases = ["charge", "volley", "burst", "summon"];
  results.bossRandomAttackBag =
    bossPhases.every((phase) => bossAttackProbe.slice(0, 4).includes(phase)) &&
    bossPhases.every((phase) => bossAttackProbe.slice(4, 8).includes(phase));
  boss.chargeDirection = { x: -1, y: 0 };
  game.enemyProjectiles = [];
  game.fireBossChargeShots(boss);
  results.bossHomingShots = game.enemyProjectiles.filter((projectile) => projectile.homingTarget === "player").length === 2;
  game.enemyProjectiles = [];
  game.summonBossAdds(boss);
  results.bossSummonSentinels = game.enemies.filter((enemy) => enemy.typeId === "sentinel").length >= 3;

  game.startRun();
  game.spawnEnemy("sentinel", 1, { x: game.player.x + 260, y: game.player.y });
  const sentinel = game.enemies.at(-1);
  sentinel.attackCooldownRemaining = 0;
  game.stepManual(0.1);
  game.stepManual(0.46);
  results.sentinelDashAttack = sentinel.typeId === "sentinel" && sentinel.state === "dash";

  game.startRun();
  game.forceUpgrade("bubble-guard");
  game.forceUpgrade("bubble-guard");
  game.forceUpgrade("bubble-guard");
  results.upgradeCapRemoval = !game.getDebugSnapshot().availableUpgrades.includes("bubble-guard");
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
    Boolean(scoreSubmitPanel && !scoreSubmitPanel.hidden && scoreSubmitButton?.disabled) &&
    game.getLastCompletedRunResult()?.score === 9999;
  results.highScorePersist = game.getDebugSnapshot().highScore >= 9999;
  results.katanaUnlock = Boolean(game.getDebugSnapshot().progress?.katanaUnlocked);
  game.setMenuTab("leaderboard");
  await refreshLeaderboard();
  results.leaderboardOfflinePanel =
    !isOnlineLeaderboardEnabled() &&
    document.querySelector("#leaderboard-status")?.textContent.includes("not configured") &&
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

if (new URLSearchParams(window.location.search).get("selfTest") === "1") {
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
