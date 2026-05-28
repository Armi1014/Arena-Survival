import {
  ADMIN_PASSWORD_DIGEST,
  DEFAULT_SONGS,
  GAME_CONFIG,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PLAYER_BASE,
  SCORE_CONFIG,
  clamp,
  distanceSquared,
  formatTime,
  getXpThreshold,
  randomRange,
} from "./data/constants.js";
import { CHARACTER_DEFS, CHARACTER_IDS, ENGINEER_UNLOCK_KILLS, KATANA_UNLOCK_BOSSES, getCharacterById, isCharacterUnlocked } from "./data/characters.js";
import { getBossScale, getDifficultySnapshot } from "./data/difficulty.js";
import { BOSS_DEF, ENEMY_DEFS } from "./data/enemies.js";
import { UPGRADE_DEFS, getUpgradeById } from "./data/upgrades.js";
import { deleteSongAudio, hydrateAdminSongAudio, recordRun, resetStats, saveSongAudio, updateMusic, updateProgress, updateSettings, updateWallet } from "./storage.js";

function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

function roundRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function shuffleInPlace(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

async function digestText(text) {
  if (!globalThis.crypto?.subtle) {
    return "";
  }
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function digestMatches(left, right) {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

const MENU_TAB_LABELS = {
  play: "Play",
  quests: "Quests",
  characters: "Characters",
  stats: "Stats",
  guide: "Wiki",
  shop: "Shop",
  controls: "Controls",
  settings: "Settings",
  admin: "Admin",
};

const ENEMY_GUIDE_COPY = {
  nibbler: "Fast chaser that pressures your movement lane.",
  spitter: "Keeps range and fires projectiles through the arena.",
  "acid-spitter": "Keeps distance and spits acid that leaves hazardous pools.",
  bumper: "Winds up, then charges through your position.",
  tank: "Slow heavy unit that blocks space and soaks damage.",
  sentinel: "Boss-summoned unit that telegraphs a dash attack.",
  [BOSS_DEF.id]: "Large boss unit with charge, burst, and summon phases.",
};
const ENEMY_GUIDE_DEFS = [...Object.values(ENEMY_DEFS), BOSS_DEF];
const TRACKED_ENEMY_IDS = new Set(ENEMY_GUIDE_DEFS.map((definition) => definition.id));
const BOSS_ATTACK_PHASES = ["charge", "volley", "burst", "summon"];

const ENGINEER_TURRET = {
  deployCooldown: 8,
  lifetime: 8,
  range: 360,
  fireCooldown: 0.55,
};

function createBossAttackQueue(previousPhase = "") {
  const queue = shuffleInPlace([...BOSS_ATTACK_PHASES]);
  if (previousPhase && queue[0] === previousPhase && queue.length > 1) {
    const swapIndex = 1 + Math.floor(Math.random() * (queue.length - 1));
    [queue[0], queue[swapIndex]] = [queue[swapIndex], queue[0]];
  }
  return queue;
}

const UPGRADE_ICONS = {
  "rapid-pop": "⚡",
  "rocket-fizz": "🚀",
  "gumdrop-shells": "💥",
  "pin-pop": "🎯",
  "confetti-fan": "🔱",
  "skipping-shoes": "👟",
  "zip-ribbon": "🏃",
  "heart-balloon": "❤️",
  "glitter-vac": "🧲",
  "bubble-guard": "🛡️",
  "xp-surge": "✨",
  "grenade-payload": "💣",
  "grenade-cycler": "🔄",
  "shatter-rounds": "🧨",
  "dash-reload": "🔋",
  "overheal-shield": "💚",
  "volatile-grenade": "🌋",
  "sharpened-edge": "🗡️",
  "long-blade": "📏",
  "wide-cut": "🌙",
  "quick-draw": "⚔️",
  "flow-strike": "🌊",
  "bleeding-cut": "🩸",
  "counter-guard": "🛡️",
  "dash-slash": "💨",
};
const UPGRADE_SHIELD_INTERVALS = [16, 12, 9];

function getUpgradeFamily(upgrade) {
  if (upgrade.characters?.includes(CHARACTER_IDS.katana)) {
    return "Katana";
  }
  if (upgrade.excludeCharacters?.includes(CHARACTER_IDS.katana)) {
    return "Blaster";
  }
  if (upgrade.isAvailable) {
    return "Ability";
  }
  return "Survival";
}

function getUpgradeEffectCopy(upgrade, rank) {
  return upgrade.describe(rank).replace(/^Rank \d+: /, "");
}

function getUpgradeBoostCopy(upgrade, rank) {
  switch (upgrade.id) {
    case "rapid-pop":
      return `+${Math.round((1 - 0.88 ** rank) * 100)}% Fire Speed`;
    case "rocket-fizz":
      return "+90 Projectile Speed";
    case "gumdrop-shells":
      return "+2 Bullet Size / +0.15 Damage";
    case "pin-pop":
      return "+1 Pierce";
    case "confetti-fan":
      return "+1 Extra Pellet";
    case "skipping-shoes":
      return "+26 Move Speed";
    case "zip-ribbon":
      return "-14% Dash Cooldown";
    case "heart-balloon":
      return "+1 Max Health / +2 Heal";
    case "glitter-vac":
      return "+40 Magnet Radius";
    case "xp-surge":
      return `+${Math.round((1.18 ** rank - 1) * 100)}% XP Value`;
    case "bubble-guard":
      return `+Shield Regen: ${UPGRADE_SHIELD_INTERVALS[rank - 1]}s`;
    case "shatter-rounds":
      return `+${rank + 1} Shatter Fragments`;
    case "dash-reload":
      return `+${Math.round(rank * 35)}% Dash Reload`;
    case "sharpened-edge":
      return "+0.55 Slash Damage";
    case "long-blade":
      return "+22 Slash Range";
    case "wide-cut":
      return "+12deg Slash Arc";
    case "quick-draw":
      return "+12% Slash Speed";
    case "flow-strike":
      return "+1 Slash Target";
    case "bleeding-cut":
      return `+${rank + 1}s Bleed`;
    case "counter-guard":
      return `+${(0.1 + rank * 0.08).toFixed(2)}s Guard`;
    case "dash-slash":
      return `+${Math.round(rank * 65)}% Dash Slash`;
    case "overheal-shield":
      return `+${rank} Overheal Shield`;
    case "grenade-payload":
      return "+3 Damage / +10 Radius";
    case "grenade-cycler":
      return "-15% Grenade Cooldown";
    case "volatile-grenade":
      return `+${rank + 2}s Burn Zone`;
    default:
      return getUpgradeEffectCopy(upgrade, rank);
  }
}

function formatWholeNumber(value) {
  return Math.floor(Math.max(0, value)).toLocaleString();
}

function weightedEnemyPick(weights, budget) {
  const candidates = Object.values(ENEMY_DEFS).filter((definition) => definition.cost <= budget + 0.001);
  if (!candidates.length) {
    return "nibbler";
  }
  const totalWeight = candidates.reduce((sum, definition) => sum + (weights[definition.id] ?? 0), 0);
  if (!totalWeight) {
    return candidates[0].id;
  }
  let roll = Math.random() * totalWeight;
  for (const definition of candidates) {
    roll -= weights[definition.id] ?? 0;
    if (roll <= 0) {
      return definition.id;
    }
  }
  return candidates[candidates.length - 1].id;
}

export class Game {
  constructor({ canvas, ui, save, audio }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.ui = ui;
    this.save = save;
    this.audio = audio;

    this.mode = "title";
    this.helpReturnMode = "title";
    this.pointer = { x: LOGICAL_WIDTH * 0.5, y: LOGICAL_HEIGHT * 0.5, inside: false };
    this.keys = new Set();
    this.banner = null;
    this.backgroundTime = 0;
    this.animationFrameId = 0;
    this.lastFrameTime = 0;
    this.screenShake = 0;
    this.hitSoundCooldown = 0;
    this.menuTab = "play";
    this.resetStatsPending = false;
    this.adminUnlocked = false;
    this.adminClearSongsPending = false;
    this.adminDeleteSongPendingId = "";

    this.run = null;
    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.turrets = [];
    this.damageZones = [];
    this.pickups = [];
    this.effects = [];
    this.floatingTexts = [];
    this.toasts = [];
    this.upgradeCounts = Object.create(null);
    this.pendingLevelUps = 0;
    this.upgradeChoices = [];
    this.spawnBudget = 0;
    this.enemyId = 0;
    this.projectileId = 0;
    this.grenadeId = 0;
    this.turretId = 0;
    this.effectId = 0;
    this.textId = 0;
    this.toastId = 0;
    this.nextBossTime = GAME_CONFIG.bossInterval;
    this.warnedBossAt = null;

    this.buildMenuGuide();
    this.renderQuestMenu();
    this.renderCharacterMenu();
    this.renderSongShop();
    this.renderAdminPanel();
    this.updateAdminModeUi();
    this.setMenuTab(this.menuTab, false);
    this.loop = this.loop.bind(this);
    this.updateSoundButton();
    this.updateMusicVolumeInput();
    this.updateSavedScoreLabels();
    this.updateGrenadeLobby();
    this.syncScreens();
    this.ui.runHighlights?.replaceChildren();
    this.updateHud();
    this.render();
    this.hydrateSongAudio();
  }

  async hydrateSongAudio() {
    try {
      const adminSongs = await hydrateAdminSongAudio(this.save.music?.adminSongs ?? []);
      this.save = {
        ...this.save,
        music: {
          ...(this.save.music ?? {}),
          adminSongs,
        },
      };
      this.renderSongShop();
      this.renderAdminPanel();
    } catch {
      this.showToast("Could not load saved song files");
    }
  }

  startLoop() {
    if (!this.animationFrameId) {
      this.animationFrameId = window.requestAnimationFrame(this.loop);
    }
  }

  loop(timestamp) {
    if (!this.lastFrameTime) {
      this.lastFrameTime = timestamp;
    }
    const deltaSeconds = Math.min(GAME_CONFIG.maxDeltaSeconds, Math.max(0, (timestamp - this.lastFrameTime) / 1000));
    this.lastFrameTime = timestamp;
    this.step(deltaSeconds);
    this.animationFrameId = window.requestAnimationFrame(this.loop);
  }

  step(deltaSeconds) {
    this.backgroundTime += deltaSeconds;
    if (this.mode === "playing") {
      this.updateGame(deltaSeconds);
    }
    if (this.mode !== "playing") {
      this.updateToasts(deltaSeconds);
    }
    this.render();
    this.updateHud();
  }

  stepManual(totalSeconds, stepSeconds = 1 / 60) {
    let remaining = totalSeconds;
    while (remaining > 0) {
      const deltaSeconds = Math.min(stepSeconds, remaining);
      this.step(deltaSeconds);
      remaining -= deltaSeconds;
    }
  }

  onPointerMove(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = clamp(((clientX - bounds.left) / bounds.width) * LOGICAL_WIDTH, 0, LOGICAL_WIDTH);
    this.pointer.y = clamp(((clientY - bounds.top) / bounds.height) * LOGICAL_HEIGHT, 0, LOGICAL_HEIGHT);
    this.pointer.inside = true;
  }

  handleCanvasClick() {
    this.tryAutoFire();
  }

  onKeyDown(code) {
    this.keys.add(code);
    if (code === "Escape") {
      if (this.mode === "help") {
        this.closeHelp();
      } else if (this.mode === "playing") {
        this.pause();
      } else if (this.mode === "paused") {
        this.resume();
      }
      return false;
    }
    if (code === "KeyM") {
      this.toggleMute();
      return false;
    }
    if (code === "Space") {
      if (this.mode === "playing") {
        this.tryDash();
      }
      return false;
    }
    if (code === "KeyE") {
      if (this.mode === "playing") {
        this.tryGrenade();
      }
      return false;
    }
    if (code === "KeyT") {
      if (this.mode === "playing") {
        this.tryDeployTurret();
      }
      return false;
    }
    if (["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(code)) {
      if (this.mode === "upgrade") {
        const index = Number(code.at(-1)) - 1;
        const upgrade = this.upgradeChoices[index];
        if (upgrade) {
          this.selectUpgrade(upgrade.id);
        }
        return false;
      }
    }
    return true;
  }

  onKeyUp(code) {
    this.keys.delete(code);
  }

  handleBlur() {
    this.keys.clear();
    if (this.mode === "playing") {
      this.pause("Game paused because the tab lost focus.");
    }
  }

  startRun() {
    const selectedCharacter = this.getSelectedCharacter();
    const slash = selectedCharacter.slash ?? CHARACTER_DEFS[CHARACTER_IDS.katana].slash;
    this.run = {
      elapsed: 0,
      level: 1,
      xp: 0,
      xpToNext: getXpThreshold(1),
      kills: 0,
      bossKills: 0,
      shotsFired: 0,
      killScore: 0,
      score: 0,
      damageTaken: 0,
      enemyKills: {},
      enemyDeaths: {},
      recorded: false,
    };
    this.player = {
      x: LOGICAL_WIDTH * 0.5,
      y: LOGICAL_HEIGHT * 0.5,
      radius: PLAYER_BASE.radius,
      hp: PLAYER_BASE.maxHp,
      maxHp: PLAYER_BASE.maxHp,
      moveSpeed: PLAYER_BASE.moveSpeed,
      fireCooldown: PLAYER_BASE.fireCooldown,
      fireCooldownRemaining: 0,
      projectileSpeed: PLAYER_BASE.projectileSpeed,
      projectileRadius: PLAYER_BASE.projectileRadius,
      projectileDamage: PLAYER_BASE.projectileDamage,
      projectileLifetime: PLAYER_BASE.projectileLifetime,
      characterId: selectedCharacter.id,
      attackType: selectedCharacter.attackType,
      pierce: PLAYER_BASE.pierce,
      multishot: PLAYER_BASE.multishot,
      spreadAngle: PLAYER_BASE.spreadAngle,
      dashSpeed: PLAYER_BASE.dashSpeed,
      dashDuration: PLAYER_BASE.dashDuration,
      dashTimeRemaining: 0,
      dashCooldown: PLAYER_BASE.dashCooldown,
      dashCooldownRemaining: 0,
      dashInvulnerability: PLAYER_BASE.dashInvulnerability,
      invulnerabilityRemaining: 0,
      dashVector: { x: 0, y: -1 },
      magnetRadius: PLAYER_BASE.magnetRadius,
      shields: 0,
      maxShields: PLAYER_BASE.maxShields,
      shieldRegenSeconds: PLAYER_BASE.shieldRegenSeconds,
      shieldRegenTimer: 0,
      xpMultiplier: PLAYER_BASE.xpMultiplier,
      grenadeEquipped: Boolean(this.save.progress?.grenadeUnlocked && this.save.progress?.grenadeEquipped),
      grenadeCooldown: PLAYER_BASE.grenadeCooldown,
      grenadeCooldownRemaining: 0,
      grenadeDamage: PLAYER_BASE.grenadeDamage,
      grenadeRadius: PLAYER_BASE.grenadeRadius,
      grenadeProjectileSpeed: PLAYER_BASE.grenadeProjectileSpeed,
      grenadeFuse: PLAYER_BASE.grenadeFuse,
      shatterFragments: 0,
      dashReloadRatio: 0,
      overhealShieldBonus: 0,
      turretDeployCooldown: selectedCharacter.id === CHARACTER_IDS.engineer ? ENGINEER_TURRET.deployCooldown : 0,
      turretDeployCooldownRemaining: 0,
      turretLifetime: ENGINEER_TURRET.lifetime,
      turretRange: ENGINEER_TURRET.range,
      turretFireCooldown: ENGINEER_TURRET.fireCooldown,
      maxTurrets: selectedCharacter.id === CHARACTER_IDS.engineer ? 1 : 0,
      grenadeZoneDuration: 0,
      grenadeZoneDamage: 0,
      slashDamage: slash?.damage ?? 0,
      slashRange: slash?.range ?? 0,
      slashArc: slash?.arc ?? 0,
      slashMaxTargets: slash?.maxTargets ?? 1,
      bleedDamagePerSecond: slash?.bleedDamagePerSecond ?? 0,
      bleedDuration: slash?.bleedDuration ?? 0,
      counterInvulnerability: slash?.counterInvulnerability ?? 0,
      dashSlashDamage: slash?.dashSlashDamage ?? 0,
    };
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.turrets = [];
    this.damageZones = [];
    this.pickups = [];
    this.effects = [];
    this.floatingTexts = [];
    this.toasts = [];
    this.upgradeCounts = Object.create(null);
    this.runMilestones = new Set();
    this.runHighlights = [];
    this.maxedUpgradeIds = new Set();
    this.pendingLevelUps = 0;
    this.upgradeChoices = [];
    this.spawnBudget = 0;
    this.enemyId = 0;
    this.projectileId = 0;
    this.grenadeId = 0;
    this.turretId = 0;
    this.effectId = 0;
    this.textId = 0;
    this.toastId = 0;
    this.nextBossTime = GAME_CONFIG.bossInterval;
    this.warnedBossAt = null;
    this.banner = null;
    this.mode = "playing";
    this.helpReturnMode = "paused";
    this.resetStatsPending = false;
    this.updateResetStatsButton();
    this.hitSoundCooldown = 0;
    this.screenShake = 0;
    this.syncScreens();
    this.playSelectedMusic();
    this.updateHud();
    this.announce("Run started.");
  }

  returnToTitle() {
    const savedProgress = this.saveCurrentRunProgress();
    this.mode = "title";
    this.helpReturnMode = "title";
    this.run = null;
    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.turrets = [];
    this.damageZones = [];
    this.pickups = [];
    this.effects = [];
    this.floatingTexts = [];
    this.toasts = [];
    this.banner = null;
    this.pendingLevelUps = 0;
    this.upgradeChoices = [];
    this.runMilestones = new Set();
    this.runHighlights = [];
    this.maxedUpgradeIds = new Set();
    this.updateGrenadeLobby();
    this.setMenuTab("play", false);
    this.syncScreens();
    this.updateHud();
    this.announce(savedProgress ? "Run progress saved. Returned to title." : "Returned to title.");
  }

  saveCurrentRunProgress() {
    if (!this.run || this.run.recorded) {
      return false;
    }
    this.save = recordRun(this.save, this.run);
    this.run.recorded = true;
    this.updateSavedScoreLabels();
    this.buildMenuGuide();
    this.updateGrenadeLobby();
    this.renderQuestMenu();
    this.renderCharacterMenu();
    return true;
  }

  restartRun() {
    this.startRun();
  }

  showHelp() {
    if (this.mode === "help") {
      return;
    }
    this.helpReturnMode = this.mode === "playing" ? "paused" : this.mode;
    if (this.mode === "playing") {
      this.mode = "paused";
    }
    this.mode = "help";
    this.syncScreens();
    this.announce("Controls shown.");
  }

  closeHelp() {
    this.mode = this.helpReturnMode ?? "title";
    this.syncScreens();
    this.announce("Controls closed.");
  }

  pause(message = "Game paused.") {
    if (this.mode !== "playing") {
      return;
    }
    this.mode = "paused";
    this.syncScreens();
    this.announce(message);
  }

  resume() {
    if (this.mode !== "paused") {
      return;
    }
    this.mode = "playing";
    this.syncScreens();
    this.announce("Game resumed.");
  }

  toggleMute() {
    this.save = updateSettings(this.save, { muted: !this.save.settings.muted });
    this.audio.setMuted(this.save.settings.muted);
    this.updateSoundButton();
    this.announce(`Sound ${this.save.settings.muted ? "muted" : "enabled"}.`);
  }

  forceUpgrade(upgradeId) {
    const upgrade = getUpgradeById(upgradeId);
    if (!upgrade || !this.player) {
      return;
    }
    const nextRank = (this.upgradeCounts[upgradeId] ?? 0) + 1;
    const wasHealthy = this.player.hp >= this.player.maxHp;
    this.upgradeCounts[upgradeId] = nextRank;
    upgrade.apply(this.player, nextRank);
    if (upgradeId === "heart-balloon" && wasHealthy && this.player.overhealShieldBonus > 0) {
      this.player.maxShields = Math.max(this.player.maxShields, this.player.overhealShieldBonus);
      this.player.shields = Math.min(this.player.maxShields, this.player.shields + this.player.overhealShieldBonus);
      this.spawnFloatingText(this.player.x, this.player.y - 76, `+${this.player.overhealShieldBonus} Shield`, "#86efac", 0.9);
    }
  }

  getDebugSnapshot() {
    return {
      mode: this.mode,
      score: this.run?.score ?? 0,
      elapsed: this.run?.elapsed ?? 0,
      kills: this.run?.kills ?? 0,
      bossKills: this.run?.bossKills ?? 0,
      shotsFired: this.run?.shotsFired ?? 0,
      enemyCount: this.enemies.length,
      bossCount: this.enemies.filter((enemy) => enemy.isBoss && !enemy.dead).length,
      turretCount: this.turrets.filter((turret) => !turret.dead).length,
      playerHp: this.player?.hp ?? 0,
      characterId: this.player?.characterId ?? this.getSelectedCharacter().id,
      attackType: this.player?.attackType ?? this.getSelectedCharacter().attackType,
      dashCooldownRemaining: this.player?.dashCooldownRemaining ?? 0,
      invulnerabilityRemaining: this.player?.invulnerabilityRemaining ?? 0,
      projectileCount: this.projectiles.length,
      enemyProjectileCount: this.enemyProjectiles.length,
      damageZoneCount: this.damageZones.length,
      availableUpgrades: this.getAvailableUpgrades().map((upgrade) => upgrade.id),
      highScore: this.save.highScore,
      stats: this.save.stats,
      progress: this.save.progress,
    };
  }

  updateGame(deltaSeconds) {
    if (!this.player || !this.run) {
      return;
    }
    this.run.elapsed += deltaSeconds;
    this.hitSoundCooldown = Math.max(0, this.hitSoundCooldown - deltaSeconds);
    this.screenShake = Math.max(0, this.screenShake - deltaSeconds * 24);
    this.player.grenadeCooldownRemaining = Math.max(0, this.player.grenadeCooldownRemaining - deltaSeconds);
    this.updateBanner(deltaSeconds);
    this.updatePlayer(deltaSeconds);
    this.updateTurrets(deltaSeconds);
    this.tryAutoFire();
    this.updateBossSchedule();
    this.updateSpawning(deltaSeconds);
    this.updateEnemies(deltaSeconds);
    this.updateProjectiles(deltaSeconds);
    this.updateGrenades(deltaSeconds);
    this.updateDamageZones(deltaSeconds);
    this.updatePickups(deltaSeconds);
    this.updateEffects(deltaSeconds);
    this.updateFloatingTexts(deltaSeconds);
    this.updateToasts(deltaSeconds);
    this.handleCollisions();
    this.cleanupDeadEntities();
    this.run.score = Math.floor(this.run.elapsed * SCORE_CONFIG.survivalPerSecond + this.run.killScore);

    while (this.run.xp >= this.run.xpToNext) {
      this.run.xp -= this.run.xpToNext;
      this.run.level += 1;
      this.run.xpToNext = getXpThreshold(this.run.level);
      this.pendingLevelUps += 1;
      this.flashLevelUp();
    }

    if (this.pendingLevelUps > 0 && this.mode === "playing") {
      this.showUpgradeDraft();
    }
  }

  updatePlayer(deltaSeconds) {
    const { player } = this;
    player.fireCooldownRemaining = Math.max(0, player.fireCooldownRemaining - deltaSeconds);
    player.dashCooldownRemaining = Math.max(0, player.dashCooldownRemaining - deltaSeconds);
    player.invulnerabilityRemaining = Math.max(0, player.invulnerabilityRemaining - deltaSeconds);

    if (player.maxShields > 0 && player.shields < player.maxShields) {
      player.shieldRegenTimer += deltaSeconds;
      if (player.shieldRegenTimer >= player.shieldRegenSeconds) {
        player.shieldRegenTimer = 0;
        player.shields += 1;
        this.setBanner("Shield restored.", 1.2);
        this.spawnEffect(player.x, player.y, 38, "rgba(37, 99, 235, 0.7)", 0.35, "ring");
      }
    }

    if (player.dashTimeRemaining > 0) {
      player.dashTimeRemaining = Math.max(0, player.dashTimeRemaining - deltaSeconds);
      player.x += player.dashVector.x * player.dashSpeed * deltaSeconds;
      player.y += player.dashVector.y * player.dashSpeed * deltaSeconds;
    } else {
      const movement = this.getMovementDirection();
      player.x += movement.x * player.moveSpeed * deltaSeconds;
      player.y += movement.y * player.moveSpeed * deltaSeconds;
    }

    player.x = clamp(player.x, GAME_CONFIG.padding, LOGICAL_WIDTH - GAME_CONFIG.padding);
    player.y = clamp(player.y, GAME_CONFIG.padding, LOGICAL_HEIGHT - GAME_CONFIG.padding);
  }

  updateTurrets(deltaSeconds) {
    if (!this.player || this.player.maxTurrets <= 0) {
      return;
    }
    this.player.turretDeployCooldownRemaining = Math.max(0, this.player.turretDeployCooldownRemaining - deltaSeconds);

    for (const turret of this.turrets) {
      if (turret.dead) {
        continue;
      }
      turret.life -= deltaSeconds;
      if (turret.life <= 0) {
        turret.dead = true;
        this.spawnEffect(turret.x, turret.y, 28, "rgba(52, 211, 153, 0.52)", 0.22, "ring");
        continue;
      }
      turret.fireCooldownRemaining = Math.max(0, turret.fireCooldownRemaining - deltaSeconds);
      if (turret.fireCooldownRemaining > 0) {
        continue;
      }
      const target = this.getClosestEnemy(turret.x, turret.y, turret.range);
      if (!target) {
        continue;
      }
      const angle = Math.atan2(target.y - turret.y, target.x - turret.x);
      this.spawnPlayerProjectile(
        turret.x + Math.cos(angle) * 20,
        turret.y + Math.sin(angle) * 20,
        angle,
        this.player.projectileSpeed,
        this.player.projectileRadius,
        this.player.projectileDamage,
        this.player.projectileLifetime,
        "turret",
      );
      turret.fireCooldownRemaining = this.player.turretFireCooldown;
      this.run.shotsFired += 1;
      this.spawnEffect(turret.x, turret.y, 16, "rgba(52, 211, 153, 0.75)", 0.14, "burst");
    }
  }

  tryDeployTurret() {
    if (!this.player || this.mode !== "playing" || this.player.maxTurrets <= 0) {
      return false;
    }
    const activeTurrets = this.turrets.filter((turret) => !turret.dead).length;
    if (activeTurrets >= this.player.maxTurrets) {
      this.showToast("Turret already active");
      return false;
    }
    if (this.player.turretDeployCooldownRemaining > 0) {
      this.showToast(`Turret ready in ${this.player.turretDeployCooldownRemaining.toFixed(1)}s`);
      return false;
    }
    this.deployTurret();
    this.player.turretDeployCooldownRemaining = this.player.turretDeployCooldown;
    return true;
  }

  deployTurret() {
    const x = this.player.x;
    const y = this.player.y;
    this.turrets.push({
      id: this.turretId += 1,
      x,
      y,
      radius: 18,
      life: this.player.turretLifetime,
      maxLife: this.player.turretLifetime,
      range: this.player.turretRange,
      fireCooldownRemaining: 0.1,
      dead: false,
    });
    this.spawnEffect(x, y, 36, "rgba(52, 211, 153, 0.7)", 0.28, "ring");
    this.spawnFloatingText(x, y - 28, "Turret online", "#86efac", 0.8);
  }

  updateBossSchedule() {
    if (!this.run) {
      return;
    }
    const activeBoss = this.enemies.some((enemy) => enemy.isBoss && !enemy.dead);
    if (!activeBoss && this.run.elapsed >= this.nextBossTime - GAME_CONFIG.bossWarningLead && this.warnedBossAt !== this.nextBossTime) {
      this.warnedBossAt = this.nextBossTime;
      this.setBanner("Heavy unit incoming.", 2.2);
      this.audio.playBossWarning();
    }
    if (!activeBoss && this.run.elapsed >= this.nextBossTime) {
      const cycleIndex = Math.max(0, Math.round(this.nextBossTime / GAME_CONFIG.bossInterval) - 1);
      this.spawnBoss(cycleIndex);
      this.nextBossTime += GAME_CONFIG.bossInterval;
      this.warnedBossAt = null;
    }
  }

  updateSpawning(deltaSeconds) {
    if (!this.run || this.enemies.length >= GAME_CONFIG.maxEnemies) {
      return;
    }
    const activeBoss = this.enemies.some((enemy) => enemy.isBoss && !enemy.dead);
    if (activeBoss) {
      return;
    }
    const difficulty = getDifficultySnapshot(this.run.elapsed);
    this.spawnBudget += difficulty.spawnBudgetPerSecond * deltaSeconds;

    const minimumCost = Math.min(...Object.values(ENEMY_DEFS).map((definition) => definition.cost));
    while (this.spawnBudget >= minimumCost && this.enemies.length < GAME_CONFIG.maxEnemies) {
      const enemyType = weightedEnemyPick(difficulty.weights, this.spawnBudget);
      const definition = ENEMY_DEFS[enemyType];
      if (!definition || definition.cost > this.spawnBudget + 0.001) {
        break;
      }
      this.spawnEnemy(enemyType, difficulty.statScale);
      this.spawnBudget -= definition.cost;
    }
  }

  updateEnemies(deltaSeconds) {
    if (!this.player) {
      return;
    }
    for (const enemy of this.enemies) {
      if (enemy.dead) {
        continue;
      }
      if (enemy.bleedTime > 0 && enemy.bleedDamagePerSecond > 0) {
        enemy.bleedTime = Math.max(0, enemy.bleedTime - deltaSeconds);
        enemy.hp -= enemy.bleedDamagePerSecond * deltaSeconds;
        enemy.hitFlash = Math.max(enemy.hitFlash, 0.25);
        if (enemy.hp <= 0) {
          enemy.lastDamageSource = "bleed";
          this.killEnemy(enemy);
          continue;
        }
      }
      enemy.hitFlash = Math.max(0, enemy.hitFlash - deltaSeconds * 4);
      enemy.squish = Math.max(0, enemy.squish - deltaSeconds * 3);
      if (enemy.isBoss) {
        this.updateBoss(enemy, deltaSeconds);
      } else if (enemy.typeId === "nibbler") {
        this.updateNibbler(enemy);
      } else if (enemy.typeId === "spitter") {
        this.updateSpitter(enemy, deltaSeconds);
      } else if (enemy.typeId === "acid-spitter") {
        this.updateAcidSpitter(enemy, deltaSeconds);
      } else if (enemy.typeId === "bumper") {
        this.updateBumper(enemy, deltaSeconds);
      } else if (enemy.typeId === "tank") {
        this.updateTank(enemy);
      } else if (enemy.typeId === "sentinel") {
        this.updateSentinel(enemy, deltaSeconds);
      }
      enemy.x += enemy.vx * deltaSeconds;
      enemy.y += enemy.vy * deltaSeconds;
      enemy.x = clamp(enemy.x, -GAME_CONFIG.spawnPadding, LOGICAL_WIDTH + GAME_CONFIG.spawnPadding);
      enemy.y = clamp(enemy.y, -GAME_CONFIG.spawnPadding, LOGICAL_HEIGHT + GAME_CONFIG.spawnPadding);
    }
  }

  updateNibbler(enemy) {
    const direction = normalizeVector(this.player.x - enemy.x, this.player.y - enemy.y);
    enemy.vx = direction.x * enemy.speed;
    enemy.vy = direction.y * enemy.speed;
  }

  updateSpitter(enemy, deltaSeconds) {
    const toPlayerX = this.player.x - enemy.x;
    const toPlayerY = this.player.y - enemy.y;
    const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
    const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
    const orbit = { x: -direction.y * enemy.orbitDirection, y: direction.x * enemy.orbitDirection };
    let moveX = orbit.x * enemy.speed * 0.4;
    let moveY = orbit.y * enemy.speed * 0.4;
    if (distance > enemy.preferredRange + 36) {
      moveX += direction.x * enemy.speed;
      moveY += direction.y * enemy.speed;
    } else if (distance < enemy.preferredRange - 44) {
      moveX -= direction.x * enemy.speed * 0.9;
      moveY -= direction.y * enemy.speed * 0.9;
    }
    enemy.vx = moveX;
    enemy.vy = moveY;
    enemy.attackCooldownRemaining -= deltaSeconds;
    if (enemy.attackCooldownRemaining <= 0 && distance < enemy.attackRange) {
      this.spawnEnemyProjectile(enemy, direction, enemy.projectileSpeed, 10, enemy.projectileDamage, 3.8, "#bfdbfe", "#2563eb");
      enemy.attackCooldownRemaining = enemy.attackCooldownBase;
    }
  }

  updateAcidSpitter(enemy, deltaSeconds) {
    const toPlayerX = this.player.x - enemy.x;
    const toPlayerY = this.player.y - enemy.y;
    const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
    const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
    const orbit = { x: -direction.y * enemy.orbitDirection, y: direction.x * enemy.orbitDirection };
    let moveX = orbit.x * enemy.speed * 0.34;
    let moveY = orbit.y * enemy.speed * 0.34;
    if (distance > enemy.preferredRange + 42) {
      moveX += direction.x * enemy.speed * 0.8;
      moveY += direction.y * enemy.speed * 0.8;
    } else if (distance < enemy.preferredRange - 52) {
      moveX -= direction.x * enemy.speed;
      moveY -= direction.y * enemy.speed;
    }
    enemy.vx = moveX;
    enemy.vy = moveY;
    enemy.attackCooldownRemaining -= deltaSeconds;
    if (enemy.attackCooldownRemaining <= 0 && distance < enemy.attackRange) {
      this.spawnEnemyProjectile(enemy, direction, enemy.projectileSpeed, 12, enemy.projectileDamage, 3.2, "#bbf7d0", "#22c55e", {
        acidZoneRadius: enemy.acidZoneRadius,
        acidZoneDamage: enemy.acidZoneDamage,
        acidZoneDuration: enemy.acidZoneDuration,
      });
      enemy.attackCooldownRemaining = enemy.attackCooldownBase;
      this.spawnEffect(enemy.x, enemy.y, 20, "rgba(34, 197, 94, 0.72)", 0.16, "burst");
    }
  }

  updateTank(enemy) {
    const direction = normalizeVector(this.player.x - enemy.x, this.player.y - enemy.y);
    enemy.vx = direction.x * enemy.speed;
    enemy.vy = direction.y * enemy.speed;
  }

  updateBumper(enemy, deltaSeconds) {
    const toPlayerX = this.player.x - enemy.x;
    const toPlayerY = this.player.y - enemy.y;
    const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
    const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
    if (enemy.state === "windup") {
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.stateTimer -= deltaSeconds;
      if (enemy.stateTimer <= 0) {
        enemy.state = "charge";
        enemy.stateTimer = enemy.chargeDuration;
      }
      return;
    }
    if (enemy.state === "charge") {
      enemy.vx = enemy.chargeDirection.x * enemy.chargeSpeed;
      enemy.vy = enemy.chargeDirection.y * enemy.chargeSpeed;
      enemy.stateTimer -= deltaSeconds;
      if (
        enemy.stateTimer <= 0 ||
        enemy.x < GAME_CONFIG.padding ||
        enemy.x > LOGICAL_WIDTH - GAME_CONFIG.padding ||
        enemy.y < GAME_CONFIG.padding ||
        enemy.y > LOGICAL_HEIGHT - GAME_CONFIG.padding
      ) {
        enemy.state = "seek";
        enemy.attackCooldownRemaining = enemy.chargeCooldown;
      }
      return;
    }
    enemy.vx = direction.x * enemy.speed;
    enemy.vy = direction.y * enemy.speed;
    enemy.attackCooldownRemaining -= deltaSeconds;
    if (enemy.attackCooldownRemaining <= 0 && distance < 330) {
      enemy.state = "windup";
      enemy.stateTimer = enemy.chargeWindup;
      enemy.chargeDirection = direction;
      enemy.squish = 0.9;
    }
  }

  updateSentinel(enemy, deltaSeconds) {
    const toPlayerX = this.player.x - enemy.x;
    const toPlayerY = this.player.y - enemy.y;
    const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
    const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
    if (enemy.state === "windup") {
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.stateTimer -= deltaSeconds;
      if (enemy.stateTimer <= 0) {
        enemy.state = "dash";
        enemy.stateTimer = enemy.dashDuration;
      }
      return;
    }
    if (enemy.state === "dash") {
      enemy.vx = enemy.chargeDirection.x * enemy.chargeSpeed;
      enemy.vy = enemy.chargeDirection.y * enemy.chargeSpeed;
      enemy.stateTimer -= deltaSeconds;
      if (
        enemy.stateTimer <= 0 ||
        enemy.x < GAME_CONFIG.padding ||
        enemy.x > LOGICAL_WIDTH - GAME_CONFIG.padding ||
        enemy.y < GAME_CONFIG.padding ||
        enemy.y > LOGICAL_HEIGHT - GAME_CONFIG.padding
      ) {
        enemy.state = "seek";
        enemy.attackCooldownRemaining = enemy.dashCooldown;
      }
      return;
    }
    enemy.vx = direction.x * enemy.speed;
    enemy.vy = direction.y * enemy.speed;
    enemy.attackCooldownRemaining -= deltaSeconds;
    if (enemy.attackCooldownRemaining <= 0 && distance < 380) {
      enemy.state = "windup";
      enemy.stateTimer = enemy.dashWindup;
      enemy.chargeDirection = direction;
      enemy.squish = 0.95;
    }
  }

  updateBoss(enemy, deltaSeconds) {
    const toPlayerX = this.player.x - enemy.x;
    const toPlayerY = this.player.y - enemy.y;
    const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
    const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
    if (enemy.state === "roam") {
      enemy.phaseTimer -= deltaSeconds;
      enemy.vx = direction.x * enemy.speed * 0.7 + Math.cos(this.backgroundTime + enemy.id) * 24;
      enemy.vy = direction.y * enemy.speed * 0.7 + Math.sin(this.backgroundTime + enemy.id * 0.5) * 24;
      if (enemy.phaseTimer <= 0) {
        const phase = this.getNextBossAttackPhase(enemy);
        if (phase === "charge") {
          enemy.state = "charge-windup";
          enemy.phaseTimer = 0.85;
          enemy.chargeDirection = direction;
          this.setBanner("Heavy unit charging.", 1.5);
        } else if (phase === "volley") {
          enemy.state = "volley";
          enemy.phaseTimer = 1.5;
          enemy.volleyShotsRemaining = 4;
          enemy.volleyTimer = 0.05;
          this.setBanner("Targeted volley.", 1.3);
        } else if (phase === "burst") {
          enemy.state = "burst";
          enemy.phaseTimer = 1.15;
          enemy.burstShotsRemaining = 3;
          enemy.burstTimer = 0.08;
          this.setBanner("Area attack.", 1.3);
        } else {
          enemy.state = "summon";
          enemy.phaseTimer = 1.2;
          enemy.hasSummoned = false;
          this.setBanner("Heavy unit calls backup.", 1.3);
        }
      }
      return;
    }
    if (enemy.state === "charge-windup") {
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.phaseTimer -= deltaSeconds;
      if (enemy.phaseTimer <= 0) {
        enemy.state = "charge";
        enemy.phaseTimer = 0.9;
        this.fireBossChargeShots(enemy);
      }
      return;
    }
    if (enemy.state === "charge") {
      enemy.vx = enemy.chargeDirection.x * enemy.chargeSpeed;
      enemy.vy = enemy.chargeDirection.y * enemy.chargeSpeed;
      enemy.phaseTimer -= deltaSeconds;
      if (
        enemy.phaseTimer <= 0 ||
        enemy.x < GAME_CONFIG.padding ||
        enemy.x > LOGICAL_WIDTH - GAME_CONFIG.padding ||
        enemy.y < GAME_CONFIG.padding ||
        enemy.y > LOGICAL_HEIGHT - GAME_CONFIG.padding
      ) {
        enemy.state = "roam";
        enemy.phaseTimer = 2;
      }
      return;
    }
    if (enemy.state === "volley") {
      enemy.phaseTimer -= deltaSeconds;
      enemy.vx = direction.x * enemy.speed * 0.18;
      enemy.vy = direction.y * enemy.speed * 0.18;
      enemy.volleyTimer -= deltaSeconds;
      if (enemy.volleyTimer <= 0 && enemy.volleyShotsRemaining > 0) {
        this.fireBossVolley(enemy);
        enemy.volleyShotsRemaining -= 1;
        enemy.volleyTimer = 0.28;
      }
      if (enemy.phaseTimer <= 0 || enemy.volleyShotsRemaining <= 0) {
        enemy.state = "roam";
        enemy.phaseTimer = 1.85;
      }
      return;
    }
    if (enemy.state === "burst") {
      enemy.phaseTimer -= deltaSeconds;
      enemy.vx = direction.x * enemy.speed * 0.22;
      enemy.vy = direction.y * enemy.speed * 0.22;
      enemy.burstTimer -= deltaSeconds;
      if (enemy.burstTimer <= 0 && enemy.burstShotsRemaining > 0) {
        this.fireBossBurst(enemy);
        enemy.burstShotsRemaining -= 1;
        enemy.burstTimer = 0.26;
      }
      if (enemy.phaseTimer <= 0 || enemy.burstShotsRemaining <= 0) {
        enemy.state = "roam";
        enemy.phaseTimer = 2.2;
      }
      return;
    }
    if (enemy.state === "summon") {
      enemy.phaseTimer -= deltaSeconds;
      enemy.vx = direction.x * enemy.speed * 0.18;
      enemy.vy = direction.y * enemy.speed * 0.18;
      if (!enemy.hasSummoned && enemy.phaseTimer <= 0.62) {
        this.summonBossAdds(enemy);
        enemy.hasSummoned = true;
      }
      if (enemy.phaseTimer <= 0) {
        enemy.state = "roam";
        enemy.phaseTimer = 2.3;
      }
    }
  }

  getNextBossAttackPhase(boss) {
    if (!Array.isArray(boss.attackQueue) || boss.attackQueue.length === 0) {
      boss.attackQueue = createBossAttackQueue(boss.lastAttackPhase);
    }
    const phase = boss.attackQueue.shift() ?? "charge";
    boss.lastAttackPhase = phase;
    return phase;
  }

  updateProjectiles(deltaSeconds) {
    const advance = (projectile) => {
      projectile.x += projectile.vx * deltaSeconds;
      projectile.y += projectile.vy * deltaSeconds;
      projectile.life -= deltaSeconds;
      if (
        projectile.life <= 0 ||
        projectile.x < -80 ||
        projectile.x > LOGICAL_WIDTH + 80 ||
        projectile.y < -80 ||
        projectile.y > LOGICAL_HEIGHT + 80
      ) {
        projectile.dead = true;
      }
    };
    this.projectiles.forEach(advance);
    for (const projectile of this.enemyProjectiles) {
      if (projectile.homingTimeRemaining > 0 && projectile.homingTarget === "player" && this.player) {
        const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
        const currentAngle = Math.atan2(projectile.vy, projectile.vx);
        const targetAngle = Math.atan2(this.player.y - projectile.y, this.player.x - projectile.x);
        const deltaAngle = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
        const turn = clamp(deltaAngle, -projectile.homingTurnRate * deltaSeconds, projectile.homingTurnRate * deltaSeconds);
        const nextAngle = currentAngle + turn;
        projectile.vx = Math.cos(nextAngle) * speed;
        projectile.vy = Math.sin(nextAngle) * speed;
        projectile.homingTimeRemaining = Math.max(0, projectile.homingTimeRemaining - deltaSeconds);
      }
      advance(projectile);
      if (projectile.dead && projectile.acidZoneRadius && !projectile.zoneSpawned) {
        this.spawnAcidZone(projectile.x, projectile.y, projectile.acidZoneRadius, projectile.acidZoneDamage, projectile.acidZoneDuration);
        projectile.zoneSpawned = true;
      }
    }
  }

  updateGrenades(deltaSeconds) {
    for (const grenade of this.grenades) {
      if (grenade.dead) {
        continue;
      }
      grenade.x += grenade.vx * deltaSeconds;
      grenade.y += grenade.vy * deltaSeconds;
      grenade.life -= deltaSeconds;
      if (
        grenade.life <= 0 ||
        grenade.x < -80 ||
        grenade.x > LOGICAL_WIDTH + 80 ||
        grenade.y < -80 ||
        grenade.y > LOGICAL_HEIGHT + 80
      ) {
        this.explodeGrenade(grenade);
      }
    }
  }

  updatePickups(deltaSeconds) {
    if (!this.player) {
      return;
    }
    for (const pickup of this.pickups) {
      if (pickup.dead) {
        continue;
      }
      pickup.life -= deltaSeconds;
      if (pickup.life <= 0) {
        pickup.dead = true;
        continue;
      }
      const toPlayerX = this.player.x - pickup.x;
      const toPlayerY = this.player.y - pickup.y;
      const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
      if (distance < this.player.magnetRadius || distance < 36) {
        const pull = 1 - clamp(distance / this.player.magnetRadius, 0, 1);
        const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
        pickup.vx += direction.x * (420 + pull * 540) * deltaSeconds;
        pickup.vy += direction.y * (420 + pull * 540) * deltaSeconds;
      }
      pickup.vx *= 0.92;
      pickup.vy *= 0.92;
      pickup.x += pickup.vx * deltaSeconds;
      pickup.y += pickup.vy * deltaSeconds;
      if (distanceSquared(pickup.x, pickup.y, this.player.x, this.player.y) <= (pickup.radius + this.player.radius + 2) ** 2) {
        pickup.dead = true;
        this.run.xp += pickup.value * this.player.xpMultiplier;
        this.spawnFloatingText(pickup.x, pickup.y - 10, `+${Math.ceil(pickup.value * this.player.xpMultiplier)} XP`, "#86efac", 0.55);
        this.spawnEffect(pickup.x, pickup.y, 18, "rgba(15, 118, 110, 0.75)", 0.22, "burst");
      }
    }
  }

  updateDamageZones(deltaSeconds) {
    for (const zone of this.damageZones) {
      zone.life -= deltaSeconds;
      zone.tickRemaining -= deltaSeconds;
      if (zone.tickRemaining <= 0) {
        zone.tickRemaining = zone.tickInterval;
        if (zone.owner === "enemy") {
          if (this.player && distanceSquared(zone.x, zone.y, this.player.x, this.player.y) <= (zone.radius + this.player.radius) ** 2) {
            this.takePlayerDamage(zone.damage, zone.sourceEnemyTypeId ?? "");
          }
          continue;
        }
        for (const enemy of this.enemies) {
          if (enemy.dead) {
            continue;
          }
          const hitRadius = zone.radius + enemy.radius;
          if (distanceSquared(zone.x, zone.y, enemy.x, enemy.y) <= hitRadius * hitRadius) {
            this.damageEnemy(enemy, zone.damage, "zone");
          }
        }
      }
    }
  }

  updateEffects(deltaSeconds) {
    for (const effect of this.effects) {
      effect.life -= deltaSeconds;
    }
  }

  updateFloatingTexts(deltaSeconds) {
    for (const text of this.floatingTexts) {
      text.life -= deltaSeconds;
      text.y += text.vy * deltaSeconds;
    }
  }

  updateToasts(deltaSeconds) {
    for (const toast of this.toasts) {
      toast.life -= deltaSeconds;
    }
    this.toasts = this.toasts.filter((toast) => toast.life > 0);
    this.renderToasts();
  }

  handleCollisions() {
    if (!this.player || !this.run) {
      return;
    }
    for (const projectile of this.projectiles) {
      if (projectile.dead) {
        continue;
      }
      for (const enemy of this.enemies) {
        if (enemy.dead || projectile.hitIds.has(enemy.id)) {
          continue;
        }
        const collisionRadius = projectile.radius + enemy.radius;
        if (distanceSquared(projectile.x, projectile.y, enemy.x, enemy.y) <= collisionRadius * collisionRadius) {
          projectile.hitIds.add(enemy.id);
          projectile.remainingHits -= 1;
          this.damageEnemy(enemy, projectile.damage, projectile.source);
          if (projectile.remainingHits <= 0) {
            projectile.dead = true;
            break;
          }
        }
      }
    }

    for (const projectile of this.enemyProjectiles) {
      if (projectile.dead) {
        continue;
      }
      const collisionRadius = projectile.radius + this.player.radius;
      if (distanceSquared(projectile.x, projectile.y, this.player.x, this.player.y) <= collisionRadius * collisionRadius) {
        projectile.dead = true;
        if (projectile.acidZoneRadius && !projectile.zoneSpawned) {
          this.spawnAcidZone(projectile.x, projectile.y, projectile.acidZoneRadius, projectile.acidZoneDamage, projectile.acidZoneDuration);
          projectile.zoneSpawned = true;
        }
        this.takePlayerDamage(projectile.damage, projectile.sourceEnemyTypeId);
      }
    }

    for (const grenade of this.grenades) {
      if (grenade.dead) {
        continue;
      }
      for (const enemy of this.enemies) {
        if (enemy.dead) {
          continue;
        }
        const collisionRadius = grenade.radius + enemy.radius;
        if (distanceSquared(grenade.x, grenade.y, enemy.x, enemy.y) <= collisionRadius * collisionRadius) {
          this.explodeGrenade(grenade);
          break;
        }
      }
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) {
        continue;
      }
      const collisionRadius = enemy.radius + this.player.radius;
      if (distanceSquared(enemy.x, enemy.y, this.player.x, this.player.y) <= collisionRadius * collisionRadius) {
        const didDamage = this.takePlayerDamage(enemy.contactDamage, enemy.typeId);
        if (didDamage) {
          const push = normalizeVector(this.player.x - enemy.x, this.player.y - enemy.y);
          enemy.x -= push.x * 12;
          enemy.y -= push.y * 12;
          this.player.x += push.x * 16;
          this.player.y += push.y * 16;
        }
      }
    }
  }

  cleanupDeadEntities() {
    this.enemies = this.enemies.filter((enemy) => !enemy.dead);
    this.projectiles = this.projectiles.filter((projectile) => !projectile.dead);
    this.enemyProjectiles = this.enemyProjectiles.filter((projectile) => !projectile.dead);
    this.grenades = this.grenades.filter((grenade) => !grenade.dead);
    this.turrets = this.turrets.filter((turret) => !turret.dead);
    this.pickups = this.pickups.filter((pickup) => !pickup.dead);
    this.effects = this.effects.filter((effect) => effect.life > 0);
    this.damageZones = this.damageZones.filter((zone) => zone.life > 0);
    this.floatingTexts = this.floatingTexts.filter((text) => text.life > 0);
  }

  damageEnemy(enemy, damage, source = "weapon") {
    enemy.hp -= damage;
    enemy.lastDamageSource = source;
    enemy.hitFlash = 1;
    enemy.squish = 0.8;
    this.spawnEffect(enemy.x, enemy.y, enemy.radius * 0.82, "rgba(255, 255, 255, 0.78)", 0.16, "ring");
    if (this.hitSoundCooldown <= 0) {
      this.audio.playHit();
      this.hitSoundCooldown = 0.05;
    }
    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    }
  }

  takePlayerDamage(amount, sourceEnemyTypeId = "") {
    if (!this.player || this.player.invulnerabilityRemaining > 0 || this.mode !== "playing") {
      return false;
    }
    if (this.player.shields > 0) {
      this.player.shields -= 1;
      this.player.invulnerabilityRemaining = 0.28;
      this.screenShake = Math.max(this.screenShake, 6);
      this.spawnEffect(this.player.x, this.player.y, 32, "rgba(37, 99, 235, 0.75)", 0.3, "ring");
      if (this.hitSoundCooldown <= 0) {
        this.audio.playHit();
        this.hitSoundCooldown = 0.06;
      }
      return true;
    }
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.player.invulnerabilityRemaining = 0.75;
    this.run.damageTaken += amount;
    this.screenShake = Math.max(this.screenShake, 11);
    if (this.hitSoundCooldown <= 0) {
      this.audio.playHit();
      this.hitSoundCooldown = 0.06;
    }
    if (this.player.hp <= 0) {
      this.recordEnemyDeath(sourceEnemyTypeId);
      this.endRun();
    }
    return true;
  }

  recordEnemyKill(enemyTypeId) {
    if (!this.run || !TRACKED_ENEMY_IDS.has(enemyTypeId)) {
      return;
    }
    this.run.enemyKills[enemyTypeId] = (this.run.enemyKills[enemyTypeId] ?? 0) + 1;
  }

  recordEnemyDeath(enemyTypeId) {
    if (!this.run || !TRACKED_ENEMY_IDS.has(enemyTypeId)) {
      return;
    }
    this.run.enemyDeaths[enemyTypeId] = (this.run.enemyDeaths[enemyTypeId] ?? 0) + 1;
  }

  endRun() {
    if (!this.run) {
      return;
    }
    const previousHighScore = this.save.highScore;
    const previousBest = { ...(this.save.stats?.best ?? {}) };
    const unlockedGrenade = !this.save.progress?.grenadeUnlocked && this.run.kills >= 250;
    const unlockedKatana =
      !isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.katana) &&
      (this.save.stats?.total?.bosses ?? 0) + this.run.bossKills >= KATANA_UNLOCK_BOSSES;
    const unlockedEngineer =
      !isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.engineer) &&
      (this.save.stats?.total?.kills ?? 0) + this.run.kills >= ENGINEER_UNLOCK_KILLS;
    this.mode = "gameOver";
    this.syncScreens();
    this.audio.playDeath();
    this.setBanner("Run finished.", 1.5);
    if (!this.run.recorded) {
      this.save = recordRun(this.save, this.run);
      this.run.recorded = true;
      this.updateSavedScoreLabels();
      this.buildMenuGuide();
    }
    if (this.run.score > previousHighScore) {
      this.ui.gameOverTitle.textContent = "New high score!";
    } else if (unlockedKatana) {
      this.ui.gameOverTitle.textContent = "Katana unlocked!";
    } else if (unlockedEngineer) {
      this.ui.gameOverTitle.textContent = "Engineer unlocked!";
    } else if (unlockedGrenade) {
      this.ui.gameOverTitle.textContent = "Grenade unlocked!";
    } else {
      this.ui.gameOverTitle.textContent = "The wave overran you.";
    }
    this.ui.finalScore.textContent = Math.floor(this.run.score).toLocaleString();
    this.ui.finalTime.textContent = formatTime(this.run.elapsed);
    this.ui.finalKills.textContent = this.run.kills.toString();
    this.ui.finalBosses.textContent = this.run.bossKills.toString();
    this.buildRunHighlights(previousHighScore, previousBest, unlockedGrenade, unlockedKatana, unlockedEngineer);
    this.updateGrenadeLobby();
    this.renderQuestMenu();
    this.renderCharacterMenu();
    this.announce(`Run over. Final score ${Math.floor(this.run.score)}.`);
  }

  getSongCatalog() {
    const adminSongs = this.save.music?.adminSongs ?? [];
    return [...DEFAULT_SONGS, ...adminSongs];
  }

  getSelectedCharacter() {
    const selectedId = this.save.progress?.selectedCharacterId ?? CHARACTER_IDS.gunner;
    if (isCharacterUnlocked(this.save.progress, this.save.stats, selectedId)) {
      return getCharacterById(selectedId);
    }
    return CHARACTER_DEFS[CHARACTER_IDS.gunner];
  }

  selectCharacter(characterId) {
    const character = getCharacterById(characterId);
    if (this.getSelectedCharacter().id === character.id) {
      return;
    }
    if (!isCharacterUnlocked(this.save.progress, this.save.stats, characterId)) {
      this.showToast("Character locked");
      return;
    }
    this.save = updateProgress(this.save, {
      katanaUnlocked: isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.katana),
      engineerUnlocked: isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.engineer),
      selectedCharacterId: character.id,
    });
    this.renderCharacterMenu();
    this.renderQuestMenu();
    this.showToast(`${character.name} selected`);
    this.announce(`${character.name} selected.`);
  }

  getQuestRows() {
    const bestKills = Math.max(0, this.save.stats?.best?.kills ?? 0);
    const totalKills = Math.max(0, this.save.stats?.total?.kills ?? 0);
    const totalBosses = Math.max(0, this.save.stats?.total?.bosses ?? 0);
    return [
      {
        id: "grenade",
        title: "Grenade Training",
        reward: "Grenade ability",
        progress: Math.min(250, bestKills),
        requirement: 250,
        unlocked: Boolean(this.save.progress?.grenadeUnlocked),
        description: "Get 250 kills in a single run.",
      },
      {
        id: "katana",
        title: "Blade Trial",
        reward: "Katana character",
        progress: Math.min(KATANA_UNLOCK_BOSSES, totalBosses),
        requirement: KATANA_UNLOCK_BOSSES,
        unlocked: isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.katana),
        description: `Defeat ${KATANA_UNLOCK_BOSSES} bosses total.`,
      },
      {
        id: "engineer",
        title: "Engineering License",
        reward: "Engineer character",
        progress: Math.min(ENGINEER_UNLOCK_KILLS, totalKills),
        requirement: ENGINEER_UNLOCK_KILLS,
        unlocked: isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.engineer),
        description: `Defeat ${ENGINEER_UNLOCK_KILLS} enemies total.`,
      },
    ];
  }

  renderQuestMenu() {
    if (!this.ui.questList) {
      return;
    }
    const rows = this.getQuestRows().map((quest) => {
      const row = document.createElement("div");
      row.className = `quest-row${quest.unlocked ? " unlocked" : ""}`;
      const body = document.createElement("div");
      const progressPercent = clamp(quest.progress / quest.requirement, 0, 1) * 100;
      body.innerHTML = `
        <strong>${quest.title}</strong>
        <span>${quest.reward} - ${quest.unlocked ? "Unlocked" : `${quest.progress}/${quest.requirement}`}</span>
        <p>${quest.description}</p>
        <div class="quest-progress" aria-hidden="true"><span style="width: ${progressPercent}%"></span></div>
      `;
      const badge = document.createElement("span");
      badge.className = "quest-badge";
      badge.textContent = quest.unlocked ? "Done" : "Locked";
      row.replaceChildren(body, badge);
      return row;
    });
    this.ui.questList.replaceChildren(...rows);
  }

  renderCharacterMenu() {
    if (!this.ui.characterList) {
      return;
    }
    const selectedId = this.getSelectedCharacter().id;
    const nodes = Object.values(CHARACTER_DEFS).map((character) => {
      const unlocked = isCharacterUnlocked(this.save.progress, this.save.stats, character.id);
      const selected = selectedId === character.id;
      const card = document.createElement("div");
      card.className = `character-row${selected ? " selected" : ""}${unlocked ? "" : " locked"}`;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-disabled", selected ? "true" : "false");
      card.setAttribute("aria-label", `${character.name}. ${selected ? "Selected" : unlocked ? "Select character" : "Locked"}.`);
      const body = document.createElement("div");
      const requirement =
        character.id === CHARACTER_IDS.katana
          ? `Defeat ${KATANA_UNLOCK_BOSSES} bosses total (${Math.min(KATANA_UNLOCK_BOSSES, this.save.stats?.total?.bosses ?? 0)}/${KATANA_UNLOCK_BOSSES})`
          : character.id === CHARACTER_IDS.engineer
            ? `Defeat ${ENGINEER_UNLOCK_KILLS} enemies total (${Math.min(ENGINEER_UNLOCK_KILLS, this.save.stats?.total?.kills ?? 0)}/${ENGINEER_UNLOCK_KILLS})`
            : "Unlocked by default";
      body.innerHTML = `
        <strong>${character.name}</strong>
        <span>${character.attackType === "melee" ? "Melee" : "Ranged"} - ${unlocked ? "Unlocked" : requirement}</span>
        <p>${character.description}</p>
      `;
      const button = document.createElement("button");
      button.type = "button";
      button.className = selected ? "ghost-button" : "primary-button";
      button.textContent = selected ? "Selected" : unlocked ? "Select" : "Locked";
      button.disabled = selected;
      button.setAttribute("aria-disabled", !unlocked || selected ? "true" : "false");
      const handleSelect = () => {
        if (selected) {
          return;
        }
        this.selectCharacter(character.id);
      };
      const handlePointerSelect = (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleSelect();
      };
      button.addEventListener("pointerdown", handlePointerSelect);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handleSelect();
      });
      card.addEventListener("pointerdown", handlePointerSelect);
      card.addEventListener("click", handleSelect);
      card.addEventListener("keydown", (event) => {
        if (event.code === "Enter" || event.code === "Space") {
          event.preventDefault();
          handleSelect();
        }
      });
      card.replaceChildren(body, button);
      return card;
    });
    this.ui.characterList.replaceChildren(...nodes);
  }

  getSelectedSong() {
    const catalog = this.getSongCatalog();
    return catalog.find((song) => song.id === this.save.music?.selectedSongId) ?? catalog[0] ?? null;
  }

  isSongOwned(songId) {
    return Boolean(this.save.music?.ownedSongIds?.includes(songId));
  }

  playSelectedMusic() {
    this.audio.playMusic(this.getSelectedSong()).catch(() => {});
  }

  buySong(songId) {
    const song = this.getSongCatalog().find((item) => item.id === songId);
    if (!song || this.isSongOwned(songId)) {
      return;
    }
    const price = Math.max(0, Math.floor(song.price ?? 0));
    const gold = Math.max(0, this.save.wallet?.gold ?? 0);
    if (gold < price) {
      this.showToast("Not enough gold");
      return;
    }
    this.save = updateWallet(this.save, { gold: gold - price });
    this.save = updateMusic(this.save, { ownedSongIds: [...(this.save.music?.ownedSongIds ?? []), songId] });
    this.showToast(`${song.title} unlocked`);
    this.renderSongShop();
    this.renderAdminPanel();
    this.updateHud();
  }

  selectSong(songId) {
    if (!this.isSongOwned(songId)) {
      return;
    }
    this.save = updateMusic(this.save, { selectedSongId: songId });
    this.playSelectedMusic();
    this.renderSongShop();
    this.renderAdminPanel();
    this.showToast("Music changed");
  }

  requestCustomSong() {
    const request = { id: `request-${Date.now()}`, status: "pending", priceHuf: 500, createdAt: Date.now() };
    this.save = updateMusic(this.save, { customRequests: [...(this.save.music?.customRequests ?? []), request] });
    this.showToast("Custom request saved");
    this.renderSongShop();
    this.renderAdminPanel();
  }

  setMusicVolume(volume) {
    const safeVolume = clamp(volume, 0, 1);
    this.save = updateSettings(this.save, { musicVolume: safeVolume });
    this.audio.setMusicVolume(safeVolume);
    this.updateMusicVolumeInput();
  }

  updateMusicVolumeInput() {
    if (this.ui.musicVolumeInput) {
      this.ui.musicVolumeInput.value = (this.save.settings?.musicVolume ?? 0.45).toString();
    }
  }

  renderSongShop() {
    if (!this.ui.songShopList || !this.ui.shopGold) {
      return;
    }
    this.ui.shopGold.textContent = formatWholeNumber(this.save.wallet?.gold ?? 0);
    const selectedSongId = this.save.music?.selectedSongId;
    const nodes = this.getSongCatalog().map((song) => {
      const owned = this.isSongOwned(song.id);
      const selected = selectedSongId === song.id;
      const row = document.createElement("div");
      row.className = "song-row";
      const body = document.createElement("div");
      body.innerHTML = `<strong>${song.title}</strong><span>${song.artist ?? "Local song"} - ${owned ? "Owned" : `${formatWholeNumber(song.price ?? 0)} gold`}${song.custom ? " - Custom" : ""}</span>`;
      const actions = document.createElement("div");
      actions.className = "song-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = owned ? "ghost-button" : "primary-button";
      button.textContent = selected ? "Selected" : owned ? "Select" : "Buy";
      button.disabled = selected;
      button.addEventListener("click", () => (owned ? this.selectSong(song.id) : this.buySong(song.id)));
      actions.append(button);
      row.replaceChildren(body, actions);
      return row;
    });
    this.ui.songShopList.replaceChildren(...nodes);
  }

  async unlockAdmin(password) {
    const passwordDigest = await digestText(password ?? "");
    if (!passwordDigest || !digestMatches(passwordDigest, ADMIN_PASSWORD_DIGEST)) {
      this.showToast("Wrong admin password");
      return;
    }
    this.adminUnlocked = true;
    if (this.ui.adminPasswordInput) {
      this.ui.adminPasswordInput.value = "";
    }
    this.renderAdminPanel();
    this.updateAdminModeUi();
    this.showToast("Admin unlocked");
  }

  toggleAdminMode() {
    if (!this.adminUnlocked) {
      this.showToast("Unlock admin first");
      this.setMenuTab("admin");
      return;
    }
    const enabled = !this.save.settings?.adminModeEnabled;
    this.save = updateSettings(this.save, { adminModeEnabled: enabled });
    this.updateAdminModeUi();
    this.announce(`Admin mode ${enabled ? "enabled" : "disabled"}.`);
  }

  updateAdminModeUi() {
    this.updateAdminModeButton();
    this.updateAdminGamePanel();
  }

  updateAdminModeButton() {
    if (!this.ui.adminModeButton) {
      return;
    }
    const enabled = Boolean(this.save.settings?.adminModeEnabled);
    this.ui.adminModeButton.textContent = this.adminUnlocked ? `Admin Mode: ${enabled ? "On" : "Off"}` : "Unlock in Admin Tools";
    this.ui.adminModeButton.setAttribute("aria-pressed", this.adminUnlocked && enabled ? "true" : "false");
  }

  updateAdminGamePanel() {
    if (!this.ui.adminGamePanel) {
      return;
    }
    const modeEnabled = Boolean(this.save.settings?.adminModeEnabled);
    const isPlayingRun = Boolean(this.run && this.player && this.mode === "playing");
    const showPanel = Boolean(this.adminUnlocked && modeEnabled && isPlayingRun);
    this.ui.adminGamePanel.hidden = !showPanel;
    this.ui.adminGamePanel.dataset.locked = "false";
    if (this.ui.adminGameStatus) {
      this.ui.adminGameStatus.textContent = "Admin Tools";
    }
    for (const button of [
      this.ui.adminHealButton,
      this.ui.adminLevelButton,
      this.ui.adminGoldRunButton,
      this.ui.adminClearEnemiesButton,
      this.ui.adminSpawnBossButton,
    ]) {
      if (button) {
        button.disabled = !showPanel;
      }
    }
  }

  canUseRunAdminTools() {
    return Boolean(this.adminUnlocked && this.save.settings?.adminModeEnabled && this.run && this.player && this.mode === "playing");
  }

  adminHealPlayer() {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    this.player.hp = this.player.maxHp;
    this.player.shields = this.player.maxShields;
    this.player.invulnerabilityRemaining = Math.max(this.player.invulnerabilityRemaining, 0.75);
    this.spawnFloatingText(this.player.x, this.player.y - 48, "Admin Heal", "#86efac", 0.9);
    this.showToast("Admin heal");
    this.updateHud();
  }

  adminGrantRunGold(amount = 100) {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    this.save = updateWallet(this.save, { gold: (this.save.wallet?.gold ?? 0) + safeAmount });
    this.spawnFloatingText(this.player.x, this.player.y - 72, `+${safeAmount} gold`, "#fbbf24", 0.9);
    this.renderSongShop();
    this.renderAdminPanel();
    this.updateHud();
  }

  adminUnlockAllCharacters() {
    if (!this.adminUnlocked) {
      return;
    }
    this.save = updateProgress(this.save, {
      katanaUnlocked: true,
      engineerUnlocked: true,
    });
    this.renderCharacterMenu();
    this.renderQuestMenu();
    this.renderAdminPanel();
    this.showToast("All characters unlocked");
    this.announce("All characters unlocked.");
  }

  adminForceLevelUp() {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    this.run.level += 1;
    this.run.xp = 0;
    this.run.xpToNext = getXpThreshold(this.run.level);
    this.pendingLevelUps += 1;
    this.flashLevelUp();
    this.showUpgradeDraft();
  }

  adminClearEnemies() {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    const enemyCount = this.enemies.filter((enemy) => !enemy.dead).length;
    for (const enemy of this.enemies) {
      if (!enemy.dead) {
        this.spawnEffect(enemy.x, enemy.y, enemy.radius * 1.1, "rgba(34, 211, 238, 0.58)", 0.22, "ring");
      }
    }
    this.enemies = [];
    this.enemyProjectiles = [];
    this.spawnBudget = 0;
    this.showToast(enemyCount ? `Cleared ${enemyCount} enemies` : "No enemies to clear");
    this.updateHud();
  }

  adminSpawnBoss() {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    if (this.enemies.some((enemy) => enemy.isBoss && !enemy.dead)) {
      this.showToast("Boss already active");
      return;
    }
    const cycleIndex = Math.max(0, Math.floor((this.run.elapsed || 0) / GAME_CONFIG.bossInterval));
    this.spawnBoss(cycleIndex);
    this.nextBossTime = Math.max(this.nextBossTime, this.run.elapsed + GAME_CONFIG.bossInterval);
    this.showToast("Admin boss spawned");
  }

  setAdminGold(value) {
    if (!this.adminUnlocked) {
      return;
    }
    this.save = updateWallet(this.save, { gold: value });
    this.renderSongShop();
    this.renderAdminPanel();
    this.updateHud();
  }

  async addAdminSongFromForm() {
    if (!this.adminUnlocked || !this.ui.adminSongTitle || !this.ui.adminSongPrice || !this.ui.adminSongFile) {
      return;
    }
    const file = this.ui.adminSongFile.files?.[0];
    const title = this.ui.adminSongTitle.value.trim() || file?.name?.replace(/\.[^.]+$/, "") || "Custom Song";
    const artist = this.ui.adminSongArtist?.value.trim() || "Local Admin";
    const price = Math.max(0, Math.floor(Number(this.ui.adminSongPrice.value) || 0));
    const songId = `admin-${Date.now()}`;
    const audioKey = file ? songId : "";
    const song = {
      id: songId,
      title,
      artist,
      price,
      audioKey,
      src: file ? URL.createObjectURL(file) : "",
      custom: true,
    };
    try {
      if (file) {
        await saveSongAudio(songId, file);
      }
      const persistedSong = { ...song, src: "" };
      this.save = updateMusic(this.save, { adminSongs: [...(this.save.music?.adminSongs ?? []), persistedSong] });
      this.save = {
        ...this.save,
        music: {
          ...(this.save.music ?? {}),
          adminSongs: (this.save.music?.adminSongs ?? []).map((item) => (item.id === song.id ? song : item)),
        },
      };
      this.ui.adminSongTitle.value = "";
      if (this.ui.adminSongArtist) {
        this.ui.adminSongArtist.value = "";
      }
      this.ui.adminSongPrice.value = "";
      this.ui.adminSongFile.value = "";
      this.renderSongShop();
      this.renderAdminPanel();
      this.showToast("Song added");
    } catch {
      if (song.src) {
        URL.revokeObjectURL(song.src);
      }
      this.showToast("Song file could not be saved");
    }
  }

  adminUnlockSong(songId) {
    if (!this.adminUnlocked) {
      return;
    }
    this.save = updateMusic(this.save, { ownedSongIds: [...(this.save.music?.ownedSongIds ?? []), songId] });
    this.renderSongShop();
    this.renderAdminPanel();
  }

  adminLockSong(songId) {
    if (!this.adminUnlocked || songId === DEFAULT_SONGS[0].id) {
      return;
    }
    const ownedSongIds = (this.save.music?.ownedSongIds ?? []).filter((id) => id !== songId);
    const selectedSongId = this.save.music?.selectedSongId === songId ? DEFAULT_SONGS[0].id : this.save.music?.selectedSongId;
    this.save = updateMusic(this.save, { ownedSongIds, selectedSongId });
    this.renderSongShop();
    this.renderAdminPanel();
    this.showToast("Song locked");
  }

  adminUnlockAllSongs() {
    if (!this.adminUnlocked) {
      return;
    }
    this.save = updateMusic(this.save, { ownedSongIds: this.getSongCatalog().map((song) => song.id) });
    this.renderSongShop();
    this.renderAdminPanel();
    this.showToast("All songs unlocked");
  }

  async adminDeleteSong(songId) {
    if (!this.adminUnlocked) {
      return;
    }
    const songToDelete = (this.save.music?.adminSongs ?? []).find((song) => song.id === songId);
    if (!songToDelete) {
      return;
    }
    if (this.adminDeleteSongPendingId !== songId) {
      this.adminDeleteSongPendingId = songId;
      this.showToast(`Click Delete again to remove ${songToDelete.title}`);
      this.renderAdminPanel();
      return;
    }
    this.adminDeleteSongPendingId = "";
    const adminSongs = (this.save.music?.adminSongs ?? []).filter((song) => song.id !== songId);
    const ownedSongIds = (this.save.music?.ownedSongIds ?? []).filter((id) => id !== songId);
    const selectedSongId = this.save.music?.selectedSongId === songId ? DEFAULT_SONGS[0].id : this.save.music?.selectedSongId;
    this.save = updateMusic(this.save, { adminSongs, ownedSongIds, selectedSongId });
    deleteSongAudio(songId).catch(() => {});
    this.renderSongShop();
    this.renderAdminPanel();
    this.showToast("Song deleted");
  }

  async adminClearCustomSongs() {
    if (!this.adminUnlocked) {
      return;
    }
    const customSongs = this.save.music?.adminSongs ?? [];
    if (!customSongs.length) {
      this.showToast("No custom songs to clear");
      return;
    }
    if (!this.adminClearSongsPending) {
      this.adminClearSongsPending = true;
      this.showToast("Click Clear Custom Songs again to confirm");
      return;
    }
    this.adminClearSongsPending = false;
    const customSongIds = new Set(customSongs.map((song) => song.id));
    const ownedSongIds = (this.save.music?.ownedSongIds ?? []).filter((id) => !customSongIds.has(id));
    const selectedSongId = customSongIds.has(this.save.music?.selectedSongId) ? DEFAULT_SONGS[0].id : this.save.music?.selectedSongId;
    this.save = updateMusic(this.save, { adminSongs: [], ownedSongIds, selectedSongId });
    await Promise.all(customSongs.map((song) => deleteSongAudio(song.id).catch(() => {})));
    this.renderSongShop();
    this.renderAdminPanel();
    this.showToast("Custom songs cleared");
  }

  renderAdminPanel() {
    if (!this.ui.adminLogin || !this.ui.adminTools) {
      return;
    }
    this.ui.adminLogin.hidden = this.adminUnlocked;
    this.ui.adminTools.hidden = !this.adminUnlocked;
    if (!this.adminUnlocked) {
      return;
    }
    if (this.ui.adminGoldInput) {
      this.ui.adminGoldInput.value = Math.max(0, this.save.wallet?.gold ?? 0).toString();
    }
    if (this.ui.adminUnlockCharactersButton) {
      const allCharactersUnlocked = isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.katana) &&
        isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.engineer);
      this.ui.adminUnlockCharactersButton.textContent = allCharactersUnlocked ? "All Characters Unlocked" : "Unlock All Characters";
      this.ui.adminUnlockCharactersButton.disabled = allCharactersUnlocked;
    }
    if (!this.ui.adminSongList) {
      return;
    }
    const nodes = this.getSongCatalog().map((song) => {
      const row = document.createElement("div");
      row.className = "song-row";
      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = song.title;
      const meta = document.createElement("span");
      meta.textContent = `${song.artist ?? "Local song"} - ${song.builtIn ? "Built-in" : "Admin"} - ${this.isSongOwned(song.id) ? "Owned" : "Locked"} - ${formatWholeNumber(song.price ?? 0)} gold`;
      body.replaceChildren(title, meta);
      const actions = document.createElement("div");
      actions.className = "song-actions admin-song-actions";
      if (!song.builtIn) {
        const titleInput = document.createElement("input");
        titleInput.className = "text-input admin-title-input";
        titleInput.type = "text";
        titleInput.value = song.title;
        titleInput.placeholder = "Title";
        titleInput.addEventListener("change", () => this.adminUpdateSong(song.id, { title: titleInput.value }));
        actions.append(titleInput);
        const artistInput = document.createElement("input");
        artistInput.className = "text-input admin-artist-input";
        artistInput.type = "text";
        artistInput.value = song.artist ?? "";
        artistInput.placeholder = "Artist";
        artistInput.addEventListener("change", () => this.adminUpdateSong(song.id, { artist: artistInput.value }));
        actions.append(artistInput);
        const priceInput = document.createElement("input");
        priceInput.className = "text-input admin-price-input";
        priceInput.type = "number";
        priceInput.min = "0";
        priceInput.step = "1";
        priceInput.value = Math.max(0, song.price ?? 0).toString();
        priceInput.addEventListener("change", () => this.adminSetSongPrice(song.id, Number(priceInput.value)));
        actions.append(priceInput);
      }
      const select = document.createElement("button");
      select.type = "button";
      select.className = "ghost-button";
      select.textContent = this.save.music?.selectedSongId === song.id ? "Selected" : "Select";
      select.disabled = this.save.music?.selectedSongId === song.id || !this.isSongOwned(song.id);
      select.addEventListener("click", () => this.selectSong(song.id));
      actions.append(select);
      const unlock = document.createElement("button");
      unlock.type = "button";
      unlock.className = "ghost-button";
      unlock.textContent = this.isSongOwned(song.id) ? "Owned" : "Unlock";
      unlock.disabled = this.isSongOwned(song.id);
      unlock.addEventListener("click", () => this.adminUnlockSong(song.id));
      actions.append(unlock);
      if (this.isSongOwned(song.id) && song.id !== DEFAULT_SONGS[0].id) {
        const lock = document.createElement("button");
        lock.type = "button";
        lock.className = "ghost-button";
        lock.textContent = "Lock";
        lock.addEventListener("click", () => this.adminLockSong(song.id));
        actions.append(lock);
      }
      if (!song.builtIn) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger-button";
        remove.textContent = this.adminDeleteSongPendingId === song.id ? "Confirm Delete" : "Delete";
        remove.addEventListener("click", () => this.adminDeleteSong(song.id));
        actions.append(remove);
      }
      row.replaceChildren(body, actions);
      return row;
    });
    this.ui.adminSongList.replaceChildren(...nodes);
  }
  adminSetSongPrice(songId, price) {
    if (!this.adminUnlocked) {
      return;
    }
    const adminSongs = (this.save.music?.adminSongs ?? []).map((song) =>
      song.id === songId ? { ...song, price: Math.max(0, Math.floor(Number(price) || 0)) } : song,
    );
    this.save = updateMusic(this.save, { adminSongs });
    this.renderSongShop();
    this.renderAdminPanel();
  }

  adminUpdateSong(songId, updates) {
    if (!this.adminUnlocked) {
      return;
    }
    const adminSongs = (this.save.music?.adminSongs ?? []).map((song) => {
      if (song.id !== songId) {
        return song;
      }
      return {
        ...song,
        title: typeof updates.title === "string" ? updates.title.trim() || song.title : song.title,
        artist: typeof updates.artist === "string" ? updates.artist.trim() || "Local Admin" : song.artist,
      };
    });
    this.save = updateMusic(this.save, { adminSongs });
    this.renderSongShop();
    this.renderAdminPanel();
    this.showToast("Song updated");
  }

  buildRunHighlights(previousHighScore, previousBest, unlockedGrenade, unlockedKatana, unlockedEngineer) {
    const highlights = [...this.runHighlights];
    const score = Math.floor(this.run.score);
    const bestChecks = [
      ["New best score", score, previousHighScore, score.toLocaleString()],
      ["New best time", this.run.elapsed, previousBest.time ?? 0, formatTime(this.run.elapsed)],
      ["New best kills", this.run.kills, previousBest.kills ?? 0, this.run.kills.toLocaleString()],
      ["New best bosses", this.run.bossKills, previousBest.bosses ?? 0, this.run.bossKills.toLocaleString()],
      ["New best level", this.run.level, previousBest.level ?? 0, this.run.level.toString()],
    ];
    for (const [title, value, previous, label] of bestChecks) {
      if (value > previous) {
        highlights.unshift({ title, value: label });
      }
    }
    if (unlockedGrenade) {
      highlights.unshift({ title: "Grenade unlocked", value: "Quest complete" });
    } else if (!this.save.progress?.grenadeUnlocked) {
      highlights.push({ title: "Grenade quest", value: `${Math.min(250, Math.max(this.run.kills, previousBest.kills ?? 0))}/250 kills` });
    }
    if (unlockedKatana) {
      highlights.unshift({ title: "Katana unlocked", value: "Quest complete" });
    } else if (!isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.katana)) {
      const totalBosses = Math.min(KATANA_UNLOCK_BOSSES, this.save.stats?.total?.bosses ?? 0);
      highlights.push({ title: "Katana quest", value: `${totalBosses}/${KATANA_UNLOCK_BOSSES} bosses` });
    }
    if (unlockedEngineer) {
      highlights.unshift({ title: "Engineer unlocked", value: "Quest complete" });
    } else if (!isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.engineer)) {
      const totalKills = Math.min(ENGINEER_UNLOCK_KILLS, this.save.stats?.total?.kills ?? 0);
      highlights.push({ title: "Engineer quest", value: `${formatWholeNumber(totalKills)}/${formatWholeNumber(ENGINEER_UNLOCK_KILLS)} kills` });
    }
    if (this.maxedUpgradeIds.size > 0) {
      highlights.push({ title: "Maxed upgrades", value: this.maxedUpgradeIds.size.toString() });
    }
    if (!this.ui.runHighlights) {
      return;
    }
    const nodes = highlights.slice(0, 7).map((highlight) => {
      const row = document.createElement("div");
      row.className = "highlight-row";
      const title = document.createElement("strong");
      title.textContent = highlight.title;
      const value = document.createElement("span");
      value.textContent = highlight.value;
      row.replaceChildren(title, value);
      return row;
    });
    this.ui.runHighlights.replaceChildren(...nodes);
  }

  tryDash() {
    if (!this.player || this.mode !== "playing" || this.player.dashCooldownRemaining > 0 || this.player.dashTimeRemaining > 0) {
      return;
    }
    let direction = this.getMovementDirection();
    if (!direction.x && !direction.y) {
      direction = normalizeVector(this.pointer.x - this.player.x, this.pointer.y - this.player.y);
    }
    if (!direction.x && !direction.y) {
      direction = { x: 0, y: -1 };
    }
    this.player.dashVector = direction;
    this.player.dashTimeRemaining = this.player.dashDuration;
    this.player.dashCooldownRemaining = this.player.dashCooldown;
    this.player.invulnerabilityRemaining = Math.max(this.player.invulnerabilityRemaining, this.player.dashInvulnerability);
    if (this.player.dashReloadRatio > 0) {
      this.player.fireCooldownRemaining = Math.max(0, this.player.fireCooldownRemaining - this.player.fireCooldown * this.player.dashReloadRatio);
      this.spawnFloatingText(this.player.x, this.player.y - 28, "Reload", "#fef08a", 0.62);
    }
    this.screenShake = Math.max(this.screenShake, 4);
    this.audio.playDash();
    this.spawnEffect(this.player.x, this.player.y, 38, "rgba(245, 158, 11, 0.82)", 0.32, "ring");
    this.spawnEffect(this.player.x - direction.x * 18, this.player.y - direction.y * 18, 24, "rgba(34, 211, 238, 0.72)", 0.2, "burst");
    if (this.player.attackType === "melee" && this.player.dashSlashDamage > 0) {
      this.performKatanaSlash(direction, { damageMultiplier: this.player.dashSlashDamage, fullCircle: true, source: "dash-slash" });
    }
  }

  tryAutoFire() {
    if (!this.player || this.mode !== "playing" || this.player.fireCooldownRemaining > 0) {
      return;
    }
    if (this.player.attackType === "melee") {
      this.slashWeapon();
    } else {
      this.fireWeapon();
    }
  }

  getClosestEnemy(x, y, maxDistance = Infinity) {
    let closestEnemy = null;
    let closestDistance = maxDistance * maxDistance;
    for (const enemy of this.enemies) {
      if (enemy.dead) {
        continue;
      }
      const distance = distanceSquared(x, y, enemy.x, enemy.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestEnemy = enemy;
      }
    }
    return closestEnemy;
  }

  getAimDirection() {
    if (!this.player) {
      return { x: 0, y: -1 };
    }

    const closestEnemy = this.getClosestEnemy(this.player.x, this.player.y);
    const target = closestEnemy ?? this.pointer;
    const direction = normalizeVector(target.x - this.player.x, target.y - this.player.y);
    return direction.x || direction.y ? direction : { x: 0, y: -1 };
  }

  fireWeapon() {
    if (!this.player || !this.run) {
      return;
    }
    const direction = this.getAimDirection();
    const baseAngle = Math.atan2(direction.y, direction.x);
    const shotCount = this.player.multishot;
    const centerOffset = (shotCount - 1) * 0.5;
    for (let shotIndex = 0; shotIndex < shotCount; shotIndex += 1) {
      const angle = baseAngle + (shotIndex - centerOffset) * this.player.spreadAngle;
      const spawnX = this.player.x + Math.cos(angle) * (this.player.radius + this.player.projectileRadius + 4);
      const spawnY = this.player.y + Math.sin(angle) * (this.player.radius + this.player.projectileRadius + 4);
      this.projectiles.push({
        id: this.projectileId += 1,
        x: spawnX,
        y: spawnY,
        vx: Math.cos(angle) * this.player.projectileSpeed,
        vy: Math.sin(angle) * this.player.projectileSpeed,
        radius: this.player.projectileRadius,
        damage: this.player.projectileDamage,
        life: this.player.projectileLifetime,
        remainingHits: 1 + this.player.pierce,
        hitIds: new Set(),
        color: "#ecfeff",
        accent: "#22d3ee",
        owner: "player",
        source: "weapon",
        dead: false,
      });
    }
    this.player.fireCooldownRemaining = this.player.fireCooldown;
    this.run.shotsFired += shotCount;
    this.audio.playShoot();
    this.spawnEffect(this.player.x, this.player.y, 18, "rgba(103, 232, 249, 0.95)", 0.14, "burst");
  }

  slashWeapon(options = {}) {
    if (!this.player || !this.run) {
      return;
    }
    const direction = this.getAimDirection();
    const hitCount = this.performKatanaSlash(direction, {
      damageMultiplier: options.damageMultiplier ?? 1,
      fullCircle: Boolean(options.fullCircle),
      source: options.source ?? "katana",
    });
    if (!options.skipCooldown) {
      this.player.fireCooldownRemaining = this.player.fireCooldown;
      this.run.shotsFired += 1;
    }
    this.audio.playShoot();
    if (hitCount > 0 && this.player.counterInvulnerability > 0) {
      this.player.invulnerabilityRemaining = Math.max(this.player.invulnerabilityRemaining, this.player.counterInvulnerability);
    }
  }

  performKatanaSlash(direction, { damageMultiplier = 1, fullCircle = false, source = "katana" } = {}) {
    const baseAngle = Math.atan2(direction.y, direction.x);
    const range = this.player.slashRange;
    const arc = fullCircle ? Math.PI * 2 : this.player.slashArc;
    const maxTargets = Math.max(1, this.player.slashMaxTargets);
    const candidates = [];
    for (const enemy of this.enemies) {
      if (enemy.dead) {
        continue;
      }
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > range + enemy.radius) {
        continue;
      }
      const angle = Math.atan2(dy, dx);
      const delta = Math.abs(Math.atan2(Math.sin(angle - baseAngle), Math.cos(angle - baseAngle)));
      if (!fullCircle && delta > arc * 0.5) {
        continue;
      }
      candidates.push({ enemy, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const hits = candidates.slice(0, maxTargets);
    for (const { enemy } of hits) {
      if (this.player.bleedDamagePerSecond > 0 && this.player.bleedDuration > 0) {
        enemy.bleedDamagePerSecond = this.player.bleedDamagePerSecond;
        enemy.bleedTime = Math.max(enemy.bleedTime ?? 0, this.player.bleedDuration);
      }
      this.damageEnemy(enemy, this.player.slashDamage * damageMultiplier, source);
    }
    this.spawnSlashEffect(baseAngle, range, arc, fullCircle);
    this.screenShake = Math.max(this.screenShake, hits.length ? 6 : 2);
    return hits.length;
  }

  spawnSlashEffect(angle, range, arc, fullCircle) {
    this.effects.push({
      id: this.effectId += 1,
      x: this.player.x,
      y: this.player.y,
      radius: range,
      color: "rgba(248, 250, 252, 0.88)",
      life: 0.18,
      maxLife: 0.18,
      kind: "slash",
      angle,
      arc,
      fullCircle,
    });
  }

  tryGrenade() {
    if (
      !this.player ||
      !this.run ||
      this.mode !== "playing" ||
      !this.player.grenadeEquipped ||
      this.player.grenadeCooldownRemaining > 0
    ) {
      return;
    }
    const direction = this.getAimDirection();
    const spawnX = this.player.x + direction.x * (this.player.radius + 16);
    const spawnY = this.player.y + direction.y * (this.player.radius + 16);
    this.grenades.push({
      id: this.grenadeId += 1,
      x: spawnX,
      y: spawnY,
      vx: direction.x * this.player.grenadeProjectileSpeed,
      vy: direction.y * this.player.grenadeProjectileSpeed,
      radius: 13,
      blastRadius: this.player.grenadeRadius,
      damage: this.player.grenadeDamage,
      life: this.player.grenadeFuse,
      dead: false,
    });
    this.player.grenadeCooldownRemaining = this.player.grenadeCooldown;
    this.screenShake = Math.max(this.screenShake, 4);
    this.spawnEffect(spawnX, spawnY, 18, "rgba(249, 115, 22, 0.86)", 0.16, "burst");
  }

  explodeGrenade(grenade) {
    if (grenade.dead) {
      return;
    }
    grenade.dead = true;
    this.screenShake = Math.max(this.screenShake, 13);
    this.spawnEffect(grenade.x, grenade.y, grenade.blastRadius, "rgba(249, 115, 22, 0.65)", 0.34, "ring");
    this.spawnEffect(grenade.x, grenade.y, grenade.blastRadius * 0.46, "rgba(254, 240, 138, 0.76)", 0.24, "burst");
    for (const enemy of this.enemies) {
      if (enemy.dead) {
        continue;
      }
      const hitRadius = grenade.blastRadius + enemy.radius;
      if (distanceSquared(grenade.x, grenade.y, enemy.x, enemy.y) <= hitRadius * hitRadius) {
        this.damageEnemy(enemy, grenade.damage, "grenade");
      }
    }
    if (this.player?.grenadeZoneDuration > 0) {
      this.damageZones.push({
        owner: "player",
        x: grenade.x,
        y: grenade.y,
        radius: grenade.blastRadius * 0.72,
        damage: this.player.grenadeZoneDamage,
        life: this.player.grenadeZoneDuration,
        maxLife: this.player.grenadeZoneDuration,
        tickInterval: 0.45,
        tickRemaining: 0.08,
      });
      this.spawnFloatingText(grenade.x, grenade.y - grenade.blastRadius * 0.45, "Burn zone", "#fb7185", 0.85);
    }
  }

  spawnAcidZone(x, y, radius, damage, duration) {
    this.damageZones.push({
      owner: "enemy",
      sourceEnemyTypeId: "acid-spitter",
      x,
      y,
      radius,
      damage,
      life: duration,
      maxLife: duration,
      tickInterval: 0.55,
      tickRemaining: 0.08,
    });
    this.spawnEffect(x, y, radius, "rgba(34, 197, 94, 0.42)", 0.34, "ring");
  }

  spawnEnemyProjectile(owner, direction, speed, radius, damage, life, color, accent, options = {}) {
    this.enemyProjectiles.push({
      id: this.projectileId += 1,
      x: owner.x + direction.x * (owner.radius + radius + 4),
      y: owner.y + direction.y * (owner.radius + radius + 4),
      vx: direction.x * speed,
      vy: direction.y * speed,
      radius,
      damage,
      life,
      color,
      accent,
      sourceEnemyTypeId: owner.typeId,
      homingTurnRate: options.homingTurnRate ?? 0,
      homingTimeRemaining: options.homingTimeRemaining ?? 0,
      homingTarget: options.homingTarget ?? "",
      acidZoneRadius: options.acidZoneRadius ?? 0,
      acidZoneDamage: options.acidZoneDamage ?? 0,
      acidZoneDuration: options.acidZoneDuration ?? 0,
      zoneSpawned: false,
      hitIds: new Set(),
      remainingHits: 1,
      dead: false,
    });
  }

  spawnPlayerProjectile(x, y, angle, speed, radius, damage, life, source = "weapon-fragment") {
    this.projectiles.push({
      id: this.projectileId += 1,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      damage,
      life,
      remainingHits: 1,
      hitIds: new Set(),
      color: "#ecfeff",
      accent: "#22d3ee",
      owner: "player",
      source,
      dead: false,
    });
  }

  spawnEnemy(typeId, statScale, position = null) {
    const definition = ENEMY_DEFS[typeId];
    if (!definition) {
      return;
    }
    const spawnPoint = position ?? this.getSpawnPoint(definition.radius);
    const enemy = {
      id: this.enemyId += 1,
      typeId,
      isBoss: false,
      x: spawnPoint.x,
      y: spawnPoint.y,
      vx: 0,
      vy: 0,
      radius: definition.radius,
      hp: Math.round(definition.maxHp * statScale),
      maxHp: Math.round(definition.maxHp * statScale),
      speed: definition.speed * (1 + (statScale - 1) * 0.38),
      contactDamage: Math.max(1, Math.round(definition.contactDamage * (0.9 + (statScale - 1) * 0.5))),
      xpValue: definition.xpValue,
      scoreValue: definition.scoreValue,
      color: definition.color,
      accent: definition.accent,
      hitFlash: 0,
      squish: 0,
    };
    if (typeId === "spitter") {
      enemy.preferredRange = 260;
      enemy.attackRange = 420;
      enemy.attackCooldownBase = Math.max(1.25, 2.2 - (statScale - 1) * 0.35);
      enemy.attackCooldownRemaining = randomRange(0.2, enemy.attackCooldownBase);
      enemy.projectileSpeed = 260 + (statScale - 1) * 34;
      enemy.projectileDamage = 1;
      enemy.orbitDirection = Math.random() < 0.5 ? -1 : 1;
    }
    if (typeId === "acid-spitter") {
      enemy.preferredRange = 300;
      enemy.attackRange = 460;
      enemy.attackCooldownBase = Math.max(1.55, 2.75 - (statScale - 1) * 0.32);
      enemy.attackCooldownRemaining = randomRange(0.45, enemy.attackCooldownBase);
      enemy.projectileSpeed = 210 + (statScale - 1) * 28;
      enemy.projectileDamage = 1;
      enemy.acidZoneRadius = 54;
      enemy.acidZoneDamage = 1;
      enemy.acidZoneDuration = 2.6;
      enemy.orbitDirection = Math.random() < 0.5 ? -1 : 1;
    }
    if (typeId === "bumper") {
      enemy.state = "seek";
      enemy.stateTimer = 0;
      enemy.chargeWindup = 0.62;
      enemy.chargeDuration = 0.78;
      enemy.chargeCooldown = Math.max(2.1, 4.6 - (statScale - 1) * 0.4);
      enemy.attackCooldownRemaining = randomRange(0.8, enemy.chargeCooldown);
      enemy.chargeSpeed = 440 + (statScale - 1) * 60;
      enemy.chargeDirection = { x: 0, y: 0 };
    }
    if (typeId === "sentinel") {
      enemy.state = "seek";
      enemy.stateTimer = 0;
      enemy.dashWindup = 0.45;
      enemy.dashDuration = 0.55;
      enemy.dashCooldown = 3;
      enemy.attackCooldownRemaining = randomRange(0.45, 1.15);
      enemy.chargeSpeed = 520 + (statScale - 1) * 42;
      enemy.chargeDirection = { x: 0, y: 0 };
    }
    this.enemies.push(enemy);
  }

  spawnBoss(cycleIndex) {
    const scale = getBossScale(cycleIndex);
    const position = this.getSpawnPoint(BOSS_DEF.radius + 12);
    this.enemies.push({
      id: this.enemyId += 1,
      typeId: BOSS_DEF.id,
      isBoss: true,
      x: position.x,
      y: position.y,
      vx: 0,
      vy: 0,
      radius: BOSS_DEF.radius,
      hp: Math.round(BOSS_DEF.maxHp * scale.hpMultiplier),
      maxHp: Math.round(BOSS_DEF.maxHp * scale.hpMultiplier),
      speed: BOSS_DEF.speed + cycleIndex * 6,
      contactDamage: Math.max(1, Math.round(BOSS_DEF.contactDamage * scale.damageMultiplier)),
      xpValue: BOSS_DEF.xpValue,
      scoreValue: BOSS_DEF.scoreValue,
      color: BOSS_DEF.color,
      accent: BOSS_DEF.accent,
      hitFlash: 0,
      squish: 0,
      state: "roam",
      phaseTimer: 2.2,
      attackQueue: createBossAttackQueue(),
      lastAttackPhase: "",
      chargeDirection: { x: 0, y: 0 },
      chargeSpeed: 560 + cycleIndex * 20,
      cycleIndex,
      burstShotsRemaining: 0,
      burstTimer: 0,
      volleyShotsRemaining: 0,
      volleyTimer: 0,
      hasSummoned: false,
    });
    this.setBanner(`Heavy unit ${cycleIndex + 1}.`, 2.4);
    this.audio.playBossWarning();
  }

  fireBossChargeShots(boss) {
    const baseAngle = Math.atan2(boss.chargeDirection.y, boss.chargeDirection.x);
    for (const offset of [-0.34, 0.34]) {
      const angle = baseAngle + offset;
      this.spawnEnemyProjectile(
        boss,
        { x: Math.cos(angle), y: Math.sin(angle) },
        310 + boss.cycleIndex * 10,
        12,
        Math.max(1, Math.round(1 + boss.cycleIndex * 0.15)),
        3.6,
        "#fef3c7",
        "#f59e0b",
        {
          homingTurnRate: 0.9,
          homingTimeRemaining: 1.15,
          homingTarget: "player",
        },
      );
    }
  }

  fireBossVolley(boss) {
    const direction = normalizeVector(this.player.x - boss.x, this.player.y - boss.y);
    const baseAngle = Math.atan2(direction.y, direction.x);
    for (const offset of [-0.18, 0, 0.18]) {
      const angle = baseAngle + offset;
      this.spawnEnemyProjectile(
        boss,
        { x: Math.cos(angle), y: Math.sin(angle) },
        300 + boss.cycleIndex * 12,
        10,
        Math.max(1, Math.round(1 + boss.cycleIndex * 0.12)),
        4,
        "#fce7f3",
        "#fb7185",
      );
    }
  }

  fireBossBurst(boss) {
    const shots = 16 + Math.min(10, boss.cycleIndex * 2);
    for (let shotIndex = 0; shotIndex < shots; shotIndex += 1) {
      const angle = (Math.PI * 2 * shotIndex) / shots + boss.burstShotsRemaining * 0.1;
      this.spawnEnemyProjectile(
        boss,
        { x: Math.cos(angle), y: Math.sin(angle) },
        280 + boss.cycleIndex * 8,
        11,
        Math.max(1, Math.round(1 * (1 + boss.cycleIndex * 0.14))),
        4.5,
        "#ccfbf1",
        "#0f766e",
      );
    }
  }

  summonBossAdds(boss) {
    this.spawnEffect(boss.x, boss.y, boss.radius + 70, boss.accent, 0.3, "ring");
    for (let index = 0; index < 3; index += 1) {
      const angle = (Math.PI * 2 * index) / 3 + this.backgroundTime;
      const position = {
        x: clamp(boss.x + Math.cos(angle) * 112, GAME_CONFIG.padding + 28, LOGICAL_WIDTH - GAME_CONFIG.padding - 28),
        y: clamp(boss.y + Math.sin(angle) * 112, GAME_CONFIG.padding + 28, LOGICAL_HEIGHT - GAME_CONFIG.padding - 28),
      };
      this.spawnEnemy("sentinel", 1 + boss.cycleIndex * 0.12, position);
      this.spawnEffect(position.x, position.y, 30, "rgba(20, 184, 166, 0.72)", 0.24, "burst");
    }
    this.spawnFloatingText(boss.x, boss.y - boss.radius - 20, "Sentinels deployed", "#5eead4", 0.9);
  }

  killEnemy(enemy) {
    if (enemy.dead || !this.run) {
      return;
    }
    enemy.dead = true;
    this.recordEnemyKill(enemy.typeId);
    this.spawnEffect(enemy.x, enemy.y, enemy.radius * 1.2, enemy.accent, 0.3, "burst");
    this.spawnEffect(enemy.x, enemy.y, enemy.radius * 1.15, "rgba(236, 254, 255, 0.82)", 0.28, "ring");
    this.spawnFloatingText(enemy.x, enemy.y - enemy.radius, enemy.isBoss ? "BOSS DOWN" : `+${Math.round(enemy.scoreValue * SCORE_CONFIG.killUnit)}`, enemy.isBoss ? "#fef08a" : "#e0f2fe", enemy.isBoss ? 1.2 : 0.68);
    if (enemy.lastDamageSource === "grenade" || enemy.lastDamageSource === "zone") {
      this.spawnFloatingText(enemy.x, enemy.y + enemy.radius * 0.5, "Blast kill", "#fdba74", 0.74);
    }
    this.spawnXp(enemy.x, enemy.y, enemy.xpValue, enemy.isBoss ? 10 : 1);
    if (enemy.isBoss) {
      this.run.bossKills += 1;
      this.run.killScore += enemy.scoreValue * SCORE_CONFIG.killUnit + SCORE_CONFIG.bossBonus;
      this.setBanner("Heavy unit down.", 1.8);
      this.unlockMilestone("first-boss", "First boss defeated");
      this.addRunHighlight("Boss defeated", `+${SCORE_CONFIG.bossBonus.toLocaleString()} score`);
    } else {
      this.run.kills += 1;
      this.run.killScore += enemy.scoreValue * SCORE_CONFIG.killUnit;
      this.save = updateWallet(this.save, { gold: (this.save.wallet?.gold ?? 0) + 1 });
      this.spawnFloatingText(enemy.x, enemy.y + enemy.radius + 12, "+1 gold", "#fbbf24", 0.7);
      this.renderSongShop();
      this.renderAdminPanel();
      this.checkKillMilestones();
    }
    if (this.player?.shatterFragments > 0 && enemy.lastDamageSource !== "weapon-fragment") {
      this.spawnShatterFragments(enemy);
    }
  }

  spawnShatterFragments(enemy) {
    const fragments = Math.min(5, this.player.shatterFragments);
    for (let index = 0; index < fragments; index += 1) {
      const angle = (Math.PI * 2 * index) / fragments + this.backgroundTime;
      this.spawnPlayerProjectile(
        enemy.x + Math.cos(angle) * enemy.radius * 0.5,
        enemy.y + Math.sin(angle) * enemy.radius * 0.5,
        angle,
        480,
        Math.max(4, this.player.projectileRadius * 0.55),
        Math.max(0.45, this.player.projectileDamage * 0.52),
        0.52,
      );
    }
    this.spawnEffect(enemy.x, enemy.y, enemy.radius * 1.4, "rgba(56, 189, 248, 0.55)", 0.22, "ring");
  }

  checkKillMilestones() {
    for (const milestone of [100, 250, 500]) {
      if (this.run.kills >= milestone) {
        this.unlockMilestone(`kills-${milestone}`, `${milestone} kills`);
      }
    }
    if (this.run.kills >= 250 && !this.save.progress?.grenadeUnlocked) {
      this.unlockMilestone("grenade-unlock", "Grenade quest complete");
    }
    if ((this.save.stats?.total?.kills ?? 0) + this.run.kills >= ENGINEER_UNLOCK_KILLS && !isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.engineer)) {
      this.unlockMilestone("engineer-unlock", "Engineer quest complete");
    }
  }

  spawnXp(x, y, totalValue, chunks) {
    const chunkCount = Math.max(1, chunks);
    const chunkValue = totalValue / chunkCount;
    for (let index = 0; index < chunkCount; index += 1) {
      const angle = randomRange(0, Math.PI * 2);
      const speed = randomRange(40, 140);
      this.pickups.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 8,
        value: chunkValue,
        life: GAME_CONFIG.pickupLifetime,
        dead: false,
      });
    }
  }

  getSpawnPoint(radius) {
    const side = Math.floor(Math.random() * 4);
    if (side === 0) {
      return { x: -radius - GAME_CONFIG.spawnPadding, y: randomRange(radius, LOGICAL_HEIGHT - radius) };
    }
    if (side === 1) {
      return { x: LOGICAL_WIDTH + radius + GAME_CONFIG.spawnPadding, y: randomRange(radius, LOGICAL_HEIGHT - radius) };
    }
    if (side === 2) {
      return { x: randomRange(radius, LOGICAL_WIDTH - radius), y: -radius - GAME_CONFIG.spawnPadding };
    }
    return { x: randomRange(radius, LOGICAL_WIDTH - radius), y: LOGICAL_HEIGHT + radius + GAME_CONFIG.spawnPadding };
  }

  getMovementDirection() {
    const horizontal = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const vertical = (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0);
    return normalizeVector(horizontal, vertical);
  }

  getAvailableUpgrades() {
    return UPGRADE_DEFS.filter(
      (upgrade) =>
        (this.upgradeCounts[upgrade.id] ?? 0) < upgrade.cap &&
        (!upgrade.characters || upgrade.characters.includes(this.player?.characterId)) &&
        (!upgrade.excludeCharacters || !upgrade.excludeCharacters.includes(this.player?.characterId)) &&
        (!upgrade.isAvailable || upgrade.isAvailable(this.player)),
    );
  }

  showUpgradeDraft() {
    const available = this.getAvailableUpgrades();
    if (!available.length) {
      this.pendingLevelUps = 0;
      return;
    }
    this.mode = "upgrade";
    this.upgradeChoices = shuffleInPlace([...available]).slice(0, Math.min(3, available.length));
    this.audio.playLevelUp();
    this.buildUpgradeButtons();
    this.syncScreens();
    this.announce("Upgrade choices ready.");
  }

  buildUpgradeButtons() {
    const buttons = this.upgradeChoices.map((upgrade, index) => {
      const nextRank = (this.upgradeCounts[upgrade.id] ?? 0) + 1;
      const currentRank = nextRank - 1;
      const isMaxRank = nextRank >= upgrade.cap;
      const effectCopy = getUpgradeEffectCopy(upgrade, nextRank);
      const boostCopy = getUpgradeBoostCopy(upgrade, nextRank);
      const progressPips = Array.from({ length: upgrade.cap }, (_, pipIndex) => {
        const pipClass = pipIndex < nextRank ? " filled" : "";
        return `<span class="upgrade-progress-pip${pipClass}"></span>`;
      }).join("");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `upgrade-button upgrade-${upgrade.id}${isMaxRank ? " max-rank" : ""}`;
      button.style.setProperty("--upgrade-accent", upgrade.color);
      button.setAttribute(
        "aria-label",
        `Choose ${upgrade.name}. Rank ${nextRank} of ${upgrade.cap}. ${boostCopy}. ${effectCopy}`,
      );
      button.innerHTML = `
        <span class="upgrade-card-glow" aria-hidden="true"></span>
        <span class="upgrade-card-top">
          <span class="upgrade-icon" aria-hidden="true">${UPGRADE_ICONS[upgrade.id] ?? "⬆️"}</span>
          <span class="upgrade-card-meta">
            <span class="upgrade-family">${getUpgradeFamily(upgrade)}</span>
            <span class="upgrade-key">${index + 1}</span>
          </span>
        </span>
        <span class="upgrade-title-row">
          <h3>${upgrade.name}</h3>
          <span class="upgrade-rank${isMaxRank ? " upgrade-max-label" : ""}">${isMaxRank ? "MAX" : `${nextRank}/${upgrade.cap}`}</span>
        </span>
        <span class="upgrade-progress" aria-hidden="true">${progressPips}</span>
        <strong class="upgrade-boost">${boostCopy}</strong>
        <p>${effectCopy}</p>
        <span class="upgrade-card-footer">
          <span>${currentRank > 0 ? `Current ${currentRank}/${upgrade.cap}` : "New upgrade"}</span>
          <strong>${isMaxRank ? "Maxes now" : "Choose"}</strong>
        </span>
      `;
      button.addEventListener("click", () => this.selectUpgrade(upgrade.id));
      return button;
    });
    this.ui.upgradeCards.replaceChildren(...buttons);
  }

  selectUpgrade(upgradeId) {
    if (!this.player || this.mode !== "upgrade") {
      return;
    }
    const upgrade = getUpgradeById(upgradeId);
    if (!upgrade) {
      return;
    }
    const nextRank = (this.upgradeCounts[upgradeId] ?? 0) + 1;
    this.upgradeCounts[upgradeId] = nextRank;
    upgrade.apply(this.player, nextRank);
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    this.setBanner(`${upgrade.name} unlocked!`, 1.2);
    this.spawnFloatingText(this.player.x, this.player.y - 58, `${UPGRADE_ICONS[upgradeId] ?? "⬆️"} ${nextRank}/${upgrade.cap}`, upgrade.color, 1);
    this.showToast(`${upgrade.name} ${nextRank}/${upgrade.cap}`);
    if (nextRank >= upgrade.cap && !this.maxedUpgradeIds.has(upgradeId)) {
      this.maxedUpgradeIds.add(upgradeId);
      this.unlockMilestone(`max-${upgradeId}`, `${upgrade.name} maxed`);
      if (this.maxedUpgradeIds.size >= 3) {
        this.unlockMilestone("max-3", "3 upgrades maxed");
      }
    }
    this.announce(`${upgrade.name} selected.`);
    if (this.pendingLevelUps > 0 && this.getAvailableUpgrades().length > 0) {
      this.showUpgradeDraft();
      return;
    }
    this.mode = "playing";
    this.syncScreens();
  }

  spawnEffect(x, y, radius, color, life, kind) {
    this.effects.push({
      id: this.effectId += 1,
      x,
      y,
      radius,
      color,
      life,
      maxLife: life,
      kind,
    });
  }

  spawnFloatingText(x, y, text, color = "#f8fafc", life = 0.8) {
    this.floatingTexts.push({
      id: this.textId += 1,
      x,
      y,
      text,
      color,
      life,
      maxLife: life,
      vy: -34,
    });
  }

  showToast(text, life = 2.2) {
    this.toasts.push({
      id: this.toastId += 1,
      text,
      life,
    });
    this.toasts = this.toasts.slice(-3);
    this.renderToasts();
  }

  renderToasts() {
    if (!this.ui.toastStack) {
      return;
    }
    const nodes = this.toasts.map((toast) => {
      const node = document.createElement("div");
      node.className = "hud-toast";
      node.textContent = toast.text;
      return node;
    });
    this.ui.toastStack.replaceChildren(...nodes);
  }

  unlockMilestone(id, label) {
    if (!this.run || this.runMilestones.has(id)) {
      return;
    }
    this.runMilestones.add(id);
    this.showToast(label);
    this.addRunHighlight(label, "Milestone");
  }

  addRunHighlight(title, value) {
    if (!this.runHighlights.some((highlight) => highlight.title === title && highlight.value === value)) {
      this.runHighlights.push({ title, value });
    }
  }

  flashLevelUp() {
    this.spawnFloatingText(this.player.x, this.player.y - 48, `LEVEL ${this.run.level}`, "#a78bfa", 1);
    this.showToast(`Level ${this.run.level}`);
    this.screenShake = Math.max(this.screenShake, 7);
    if (this.ui.xpPanel) {
      this.ui.xpPanel.classList.remove("level-pulse");
      void this.ui.xpPanel.offsetWidth;
      this.ui.xpPanel.classList.add("level-pulse");
    }
  }

  setBanner(text, duration) {
    this.banner = { text, timeRemaining: duration };
  }

  updateBanner(deltaSeconds) {
    if (!this.banner) {
      return;
    }
    this.banner.timeRemaining -= deltaSeconds;
    if (this.banner.timeRemaining <= 0) {
      this.banner = null;
    }
  }

  buildMenuGuide() {
    if (this.ui.enemyGuide) {
      const enemyRows = ENEMY_GUIDE_DEFS.map((definition) => {
        const stats = this.save.stats?.enemy?.[definition.id] ?? {};
        const meta =
          definition.id === BOSS_DEF.id ? `HP ${definition.maxHp} / First at 03:00` : `HP ${definition.maxHp} / Speed ${definition.speed}`;
        return this.createGuideRow({
          title: definition.name,
          meta,
          description: ENEMY_GUIDE_COPY[definition.id],
          color: definition.color,
          counters: {
            kills: stats.kills ?? 0,
            deaths: stats.deaths ?? 0,
          },
        });
      });
      this.ui.enemyGuide.replaceChildren(...enemyRows);
    }

    if (this.ui.upgradeGuide) {
      const upgradeRows = UPGRADE_DEFS.map((upgrade) =>
        this.createGuideRow({
          title: upgrade.name,
          meta: `Cap ${upgrade.cap}`,
          description: upgrade.describe(1).replace(/^Rank 1: /, ""),
          color: upgrade.color,
        }),
      );
      this.ui.upgradeGuide.replaceChildren(...upgradeRows);
    }
  }

  createGuideRow({ title, meta, description, color, counters = null }) {
    const row = document.createElement("div");
    row.className = "guide-row";

    const swatch = document.createElement("span");
    swatch.className = "guide-swatch";
    swatch.style.background = color;
    swatch.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const details = document.createElement("span");
    details.textContent = meta;
    const copy = document.createElement("p");
    copy.textContent = description;

    const children = [heading, details, copy];
    if (counters) {
      const counterRow = document.createElement("div");
      counterRow.className = "guide-counters";
      const killCounter = document.createElement("span");
      killCounter.textContent = `You killed ${formatWholeNumber(counters.kills ?? 0)}`;
      const deathCounter = document.createElement("span");
      deathCounter.textContent = `Killed you ${formatWholeNumber(counters.deaths ?? 0)}`;
      counterRow.replaceChildren(killCounter, deathCounter);
      children.push(counterRow);
    }

    body.replaceChildren(...children);
    row.replaceChildren(swatch, body);
    return row;
  }

  setMenuTab(tabId, announceChange = true) {
    if (!MENU_TAB_LABELS[tabId]) {
      return;
    }

    this.menuTab = tabId;
    this.resetStatsPending = false;
    this.updateResetStatsButton();
    if (tabId === "shop") {
      this.renderSongShop();
    }
    if (tabId === "quests") {
      this.renderQuestMenu();
    }
    if (tabId === "characters") {
      this.renderCharacterMenu();
    }
    if (tabId === "admin") {
      this.renderAdminPanel();
    }

    for (const button of this.ui.menuTabButtons ?? []) {
      const isSelected = button.dataset.menuTab === tabId;
      button.setAttribute("aria-selected", isSelected ? "true" : "false");
      button.tabIndex = isSelected ? 0 : -1;
    }

    for (const panel of this.ui.menuPanels ?? []) {
      panel.hidden = panel.dataset.menuPanel !== tabId;
    }

    if (announceChange && this.mode === "title") {
      this.announce(`${MENU_TAB_LABELS[tabId]} menu selected.`);
    }
  }

  handleResetStatsClick() {
    if (!this.resetStatsPending) {
      this.resetStatsPending = true;
      this.updateResetStatsButton();
      this.announce("Click again to confirm stat reset.");
      return;
    }

    this.save = resetStats(this.save);
    this.resetStatsPending = false;
    this.updateSavedScoreLabels();
    this.buildMenuGuide();
    this.updateResetStatsButton();
    this.announce("Player stats reset. Sound setting preserved.");
  }

  toggleGrenadeEquip() {
    if (!this.save.progress?.grenadeUnlocked) {
      return;
    }
    this.save = updateProgress(this.save, { grenadeEquipped: !this.save.progress.grenadeEquipped });
    this.updateGrenadeLobby();
    this.announce(`Grenade ${this.save.progress.grenadeEquipped ? "equipped" : "unequipped"}.`);
  }

  updateGrenadeLobby() {
    if (!this.ui.grenadeEquipButton || !this.ui.grenadeStatus || !this.ui.grenadeQuestText) {
      return;
    }
    const progress = this.save.progress ?? {};
    const unlocked = Boolean(progress.grenadeUnlocked);
    const equipped = Boolean(unlocked && progress.grenadeEquipped);
    this.ui.grenadeEquipButton.disabled = !unlocked;
    this.ui.grenadeEquipButton.textContent = equipped ? "Unequip Grenade" : "Equip Grenade";
    this.ui.grenadeEquipButton.setAttribute("aria-pressed", equipped ? "true" : "false");
    this.ui.grenadeStatus.textContent = unlocked ? `Grenade ${equipped ? "equipped" : "unlocked"}` : "Grenade locked";
    const bestKills = Math.max(0, this.save.stats?.best?.kills ?? 0);
    this.ui.grenadeQuestText.textContent = unlocked
      ? "Press E during a run to throw a blast grenade. Grenade upgrades appear while equipped."
      : `Quest: get 250 kills in a single run. Best so far: ${formatWholeNumber(Math.min(250, bestKills))}/250.`;
  }

  updateResetStatsButton() {
    if (!this.ui.resetStatsButton || !this.ui.resetStatsNote) {
      return;
    }

    this.ui.resetStatsButton.textContent = this.resetStatsPending ? "Confirm Reset" : "Reset Stats";
    this.ui.resetStatsButton.classList.toggle("confirming", this.resetStatsPending);
    this.ui.resetStatsButton.setAttribute("aria-pressed", this.resetStatsPending ? "true" : "false");
    this.ui.resetStatsNote.textContent = this.resetStatsPending
      ? "Click Confirm Reset to clear records, lifetime totals, and enemy counters."
      : "Reset requires a second click to confirm.";
  }

  syncScreens() {
    this.ui.titleScreen.hidden = this.mode !== "title";
    this.ui.helpScreen.hidden = this.mode !== "help";
    this.ui.pauseScreen.hidden = this.mode !== "paused";
    this.ui.upgradeScreen.hidden = this.mode !== "upgrade";
    this.ui.gameOverScreen.hidden = this.mode !== "gameOver";
    this.updateAdminGamePanel();
  }

  updateHud() {
    const showHud = Boolean(this.run) && this.mode !== "title";
    this.ui.hud.hidden = !showHud;
    this.updateAdminGamePanel();
    this.updateSavedScoreLabels();
    if (!this.run || !this.player) {
      this.ui.healthHearts.replaceChildren();
      this.ui.upgradeCounter?.replaceChildren();
      this.ui.xpFill.style.width = "0%";
      this.ui.dashFill.style.width = "100%";
      this.ui.dashText.textContent = "Ready";
      if (this.ui.grenadeHudPanel && this.ui.grenadeFill && this.ui.grenadeText) {
        this.ui.grenadeHudPanel.hidden = true;
        this.ui.grenadeFill.style.width = "100%";
        this.ui.grenadeText.textContent = "Ready";
      }
      this.ui.levelText.textContent = "1";
      this.ui.scoreText.textContent = "0";
      this.ui.goldText.textContent = formatWholeNumber(this.save.wallet?.gold ?? 0);
      this.ui.killText.textContent = "0";
      this.ui.timerText.textContent = "00:00";
      this.ui.bossBanner.hidden = true;
      return;
    }
    const heartNodes = [];
    for (let heartIndex = 0; heartIndex < this.player.maxHp; heartIndex += 1) {
      const heart = document.createElement("span");
      heart.className = heartIndex < this.player.hp ? "heart filled" : "heart";
      heartNodes.push(heart);
    }
    this.ui.healthHearts.replaceChildren(...heartNodes);
    this.updateUpgradeCounter();
    this.ui.xpFill.style.width = `${clamp(this.run.xp / this.run.xpToNext, 0, 1) * 100}%`;
    this.ui.levelText.textContent = this.run.level.toString();
    const dashProgress = this.player.dashCooldown <= 0 ? 1 : 1 - this.player.dashCooldownRemaining / this.player.dashCooldown;
    this.ui.dashFill.style.width = `${clamp(dashProgress, 0, 1) * 100}%`;
    this.ui.dashText.textContent = this.player.dashCooldownRemaining <= 0 ? "Ready" : `${this.player.dashCooldownRemaining.toFixed(1)}s`;
    if (this.ui.grenadeHudPanel && this.ui.grenadeFill && this.ui.grenadeText) {
      this.ui.grenadeHudPanel.hidden = !this.player.grenadeEquipped;
      const grenadeProgress = this.player.grenadeCooldown <= 0 ? 1 : 1 - this.player.grenadeCooldownRemaining / this.player.grenadeCooldown;
      this.ui.grenadeFill.style.width = `${clamp(grenadeProgress, 0, 1) * 100}%`;
      this.ui.grenadeText.textContent = this.player.grenadeCooldownRemaining <= 0 ? "Ready" : `${this.player.grenadeCooldownRemaining.toFixed(1)}s`;
    }
    this.ui.scoreText.textContent = Math.floor(this.run.score).toLocaleString();
    this.ui.goldText.textContent = formatWholeNumber(this.save.wallet?.gold ?? 0);
    this.ui.killText.textContent = this.run.kills.toLocaleString();
    this.ui.timerText.textContent = formatTime(this.run.elapsed);
    if (this.banner) {
      this.ui.bossBanner.hidden = false;
      this.ui.bossBanner.textContent = this.banner.text;
    } else {
      this.ui.bossBanner.hidden = true;
    }
  }

  updateSoundButton() {
    this.ui.soundButton.textContent = `Sound: ${this.save.settings.muted ? "Off" : "On"}`;
    if (this.ui.menuSoundButton) {
      this.ui.menuSoundButton.textContent = `Sound: ${this.save.settings.muted ? "Off" : "On"}`;
    }
    if (!this.save.settings.muted) {
      this.playSelectedMusic();
    } else {
      this.audio.stopMusic();
    }
  }

  updateUpgradeCounter() {
    if (!this.ui.upgradeCounter) {
      return;
    }

    const chips = Object.entries(this.upgradeCounts)
      .filter(([, rank]) => rank > 0)
      .map(([upgradeId, rank]) => {
        const upgrade = getUpgradeById(upgradeId);
        const chip = document.createElement("span");
        chip.className = "upgrade-chip";
        chip.title = upgrade ? `${upgrade.name} rank ${rank}` : `Upgrade rank ${rank}`;
        chip.innerHTML = `
          <span class="upgrade-chip-icon" aria-hidden="true">${UPGRADE_ICONS[upgradeId] ?? "⬆️"}</span>
          <span class="upgrade-chip-rank">${rank}/${upgrade?.cap ?? rank}</span>
        `;
        return chip;
      });

    this.ui.upgradeCounter.replaceChildren(...chips);
  }

  updateSavedScoreLabels() {
    this.ui.titleHighScore.textContent = formatWholeNumber(this.save.highScore);
    this.ui.hudHighScore.textContent = formatWholeNumber(this.save.highScore);
    this.updateMenuStats();
    this.updateGrenadeLobby();
    this.renderQuestMenu();
    this.renderCharacterMenu();
  }

  updateMenuStats() {
    const best = this.save.stats?.best ?? {};
    const total = this.save.stats?.total ?? {};
    const values = {
      "best-score": formatWholeNumber(Math.max(best.score ?? 0, this.save.highScore)),
      "best-time": formatTime(best.time ?? 0),
      "best-kills": formatWholeNumber(best.kills ?? 0),
      "best-bosses": formatWholeNumber(best.bosses ?? 0),
      "best-level": formatWholeNumber(best.level ?? 0),
      "total-runs": formatWholeNumber(total.runs ?? 0),
      "total-score": formatWholeNumber(total.score ?? 0),
      "total-time": formatTime(total.time ?? 0),
      "total-kills": formatWholeNumber(total.kills ?? 0),
      "total-bosses": formatWholeNumber(total.bosses ?? 0),
      "total-shots": formatWholeNumber(total.shotsFired ?? 0),
      "total-damage": formatWholeNumber(total.damageTaken ?? 0),
    };

    for (const field of this.ui.statFields ?? []) {
      const value = values[field.dataset.stat];
      if (value !== undefined) {
        field.textContent = value;
      }
    }
  }

  announce(message) {
    this.ui.ariaStatus.textContent = "";
    window.setTimeout(() => {
      this.ui.ariaStatus.textContent = message;
    }, 0);
  }

  render() {
    const context = this.context;
    context.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.save();
    if (this.screenShake > 0) {
      context.translate(randomRange(-this.screenShake, this.screenShake), randomRange(-this.screenShake, this.screenShake));
    }
    this.renderBackground(context);
    this.renderArena(context);
    this.renderPickups(context);
    this.renderProjectiles(context);
    this.renderGrenades(context);
    this.renderDamageZones(context);
    this.renderTurrets(context);
    this.renderEnemies(context);
    this.renderPlayer(context);
    this.renderEffects(context);
    this.renderFloatingTexts(context);
    context.restore();
  }

  renderBackground(context) {
    const gradient = context.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
    gradient.addColorStop(0, "#08111f");
    gradient.addColorStop(0.55, "#0d1728");
    gradient.addColorStop(1, "#121826");
    context.fillStyle = gradient;
    context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const glow = context.createRadialGradient(LOGICAL_WIDTH * 0.5, LOGICAL_HEIGHT * 0.44, 80, LOGICAL_WIDTH * 0.5, LOGICAL_HEIGHT * 0.44, 620);
    glow.addColorStop(0, "rgba(34, 211, 238, 0.12)");
    glow.addColorStop(0.55, "rgba(167, 139, 250, 0.06)");
    glow.addColorStop(1, "rgba(2, 6, 23, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    context.lineWidth = 1;
    const offset = (this.backgroundTime * 18) % 80;
    for (let x = -80 + offset; x < LOGICAL_WIDTH + 80; x += 80) {
      context.strokeStyle = Math.round(x - offset) % 240 === 0 ? "rgba(34, 211, 238, 0.22)" : "rgba(125, 211, 252, 0.09)";
      context.beginPath();
      context.moveTo(x, 90);
      context.lineTo(x, LOGICAL_HEIGHT - 90);
      context.stroke();
    }
    for (let y = -80 + offset * 0.65; y < LOGICAL_HEIGHT + 80; y += 80) {
      context.strokeStyle = Math.round(y - offset * 0.65) % 240 === 0 ? "rgba(34, 211, 238, 0.2)" : "rgba(125, 211, 252, 0.08)";
      context.beginPath();
      context.moveTo(90, y);
      context.lineTo(LOGICAL_WIDTH - 90, y);
      context.stroke();
    }

    const scanY = (this.backgroundTime * 46) % LOGICAL_HEIGHT;
    const scan = context.createLinearGradient(0, scanY - 44, 0, scanY + 44);
    scan.addColorStop(0, "rgba(34, 211, 238, 0)");
    scan.addColorStop(0.5, "rgba(34, 211, 238, 0.07)");
    scan.addColorStop(1, "rgba(34, 211, 238, 0)");
    context.fillStyle = scan;
    context.fillRect(0, scanY - 44, LOGICAL_WIDTH, 88);
  }

  renderArena(context) {
    context.save();
    roundRectPath(context, 36, 36, LOGICAL_WIDTH - 72, LOGICAL_HEIGHT - 72, 10);
    context.fillStyle = "rgba(15, 23, 42, 0.28)";
    context.fill();
    context.shadowBlur = 22;
    context.shadowColor = "rgba(34, 211, 238, 0.5)";
    context.lineWidth = 4;
    context.strokeStyle = "rgba(34, 211, 238, 0.46)";
    context.stroke();
    context.shadowBlur = 0;
    context.setLineDash([14, 16]);
    context.strokeStyle = "rgba(251, 191, 36, 0.18)";
    context.lineWidth = 2;
    const centerX = LOGICAL_WIDTH * 0.5;
    const centerY = LOGICAL_HEIGHT * 0.5;
    const dashedRays = [
      [centerX, centerY, centerX, 58],
      [centerX, centerY, centerX, LOGICAL_HEIGHT - 58],
      [centerX, centerY, 58, centerY],
      [centerX, centerY, LOGICAL_WIDTH - 58, centerY],
    ];
    for (const [startX, startY, endX, endY] of dashedRays) {
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
    }
    context.setLineDash([]);
    const vignette = context.createRadialGradient(LOGICAL_WIDTH * 0.5, LOGICAL_HEIGHT * 0.5, 240, LOGICAL_WIDTH * 0.5, LOGICAL_HEIGHT * 0.5, 720);
    vignette.addColorStop(0, "rgba(2, 6, 23, 0)");
    vignette.addColorStop(1, "rgba(2, 6, 23, 0.5)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.restore();
  }

  renderPickups(context) {
    for (const pickup of this.pickups) {
      const pulse = 1 + Math.sin(this.backgroundTime * 6 + pickup.x * 0.01) * 0.15;
      context.save();
      context.translate(pickup.x, pickup.y);
      context.scale(pulse, pulse);
      context.shadowBlur = 18;
      context.shadowColor = "rgba(52, 211, 153, 0.72)";
      context.fillStyle = "rgba(52, 211, 153, 0.22)";
      context.beginPath();
      context.arc(0, 0, pickup.radius * 1.8, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#a7f3d0";
      context.beginPath();
      context.arc(0, 0, pickup.radius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = "#064e3b";
      context.beginPath();
      context.arc(0, 0, pickup.radius * 0.46, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  renderProjectiles(context) {
    const drawProjectile = (projectile, glowColor) => {
      const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
      const tailX = (projectile.vx / speed) * projectile.radius * 3.4;
      const tailY = (projectile.vy / speed) * projectile.radius * 3.4;
      context.save();
      context.lineCap = "round";
      context.strokeStyle = glowColor;
      context.lineWidth = projectile.radius * 1.15;
      context.beginPath();
      context.moveTo(projectile.x - tailX, projectile.y - tailY);
      context.lineTo(projectile.x, projectile.y);
      context.stroke();
      context.shadowBlur = 16;
      context.shadowColor = glowColor;
      context.fillStyle = projectile.accent;
      context.beginPath();
      context.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = projectile.color;
      context.beginPath();
      context.arc(
        projectile.x - projectile.radius * 0.18,
        projectile.y - projectile.radius * 0.18,
        projectile.radius * 0.45,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.restore();
    };
    this.projectiles.forEach((projectile) => drawProjectile(projectile, "rgba(34, 211, 238, 0.62)"));
    this.enemyProjectiles.forEach((projectile) => drawProjectile(projectile, "rgba(251, 113, 133, 0.58)"));
  }

  renderGrenades(context) {
    for (const grenade of this.grenades) {
      const pulse = 1 + Math.sin(this.backgroundTime * 18 + grenade.id) * 0.08;
      context.save();
      context.translate(grenade.x, grenade.y);
      context.rotate(this.backgroundTime * 8 + grenade.id);
      context.scale(pulse, pulse);
      context.shadowBlur = 18;
      context.shadowColor = "rgba(249, 115, 22, 0.8)";
      context.fillStyle = "#f97316";
      roundRectPath(context, -10, -12, 20, 24, 6);
      context.fill();
      context.strokeStyle = "#ffedd5";
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = "#fef08a";
      context.beginPath();
      context.moveTo(0, -12);
      context.lineTo(9, -22);
      context.stroke();
      context.restore();

      context.save();
      context.globalAlpha = 0.12;
      context.strokeStyle = "#f97316";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(grenade.x, grenade.y, grenade.blastRadius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  renderDamageZones(context) {
    for (const zone of this.damageZones) {
      const progress = 1 - zone.life / zone.maxLife;
      const isEnemyZone = zone.owner === "enemy";
      context.save();
      context.globalAlpha = 0.2 + Math.sin(this.backgroundTime * 12) * 0.04;
      context.fillStyle = isEnemyZone ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.34)";
      context.strokeStyle = isEnemyZone ? "rgba(187, 247, 208, 0.44)" : "rgba(254, 202, 202, 0.42)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(zone.x, zone.y, zone.radius * (0.94 + progress * 0.08), 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
    }
  }

  renderTurrets(context) {
    for (const turret of this.turrets) {
      const lifeRatio = clamp(turret.life / turret.maxLife, 0, 1);
      context.save();
      context.translate(turret.x, turret.y);
      context.shadowBlur = 18;
      context.shadowColor = "rgba(52, 211, 153, 0.72)";
      context.fillStyle = "rgba(6, 78, 59, 0.92)";
      roundRectPath(context, -turret.radius, -turret.radius, turret.radius * 2, turret.radius * 2, 7);
      context.fill();
      context.strokeStyle = "#86efac";
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = "#bbf7d0";
      context.beginPath();
      context.arc(0, 0, 6, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(187, 247, 208, 0.35)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, turret.range * 0.18 * lifeRatio, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  renderEnemies(context) {
    for (const enemy of this.enemies) {
      const scale = 1 + enemy.squish * 0.1;
      const bodyColor = enemy.hitFlash > 0 ? "#ffffff" : enemy.color;
      const accentColor = enemy.hitFlash > 0 ? "#e5ebf2" : enemy.accent;
      context.save();
      context.translate(enemy.x, enemy.y);
      context.scale(scale, 1 / scale);
      context.lineWidth = 3;
      context.shadowBlur = enemy.isBoss ? 24 : 14;
      context.shadowColor = enemy.hitFlash > 0 ? "rgba(255, 255, 255, 0.72)" : enemy.color;
      context.strokeStyle = "rgba(255, 255, 255, 0.22)";
      if (enemy.isBoss) {
        roundRectPath(context, -enemy.radius, -enemy.radius, enemy.radius * 2, enemy.radius * 2, 10);
        context.fillStyle = bodyColor;
        context.fill();
        context.stroke();
        context.fillStyle = accentColor;
        roundRectPath(context, -enemy.radius * 0.56, -8, enemy.radius * 1.12, 16, 4);
        context.fill();
        if (enemy.state?.includes("windup")) {
          context.strokeStyle = "rgba(251, 191, 36, 0.9)";
          context.lineWidth = 5;
          context.beginPath();
          context.arc(0, 0, enemy.radius + 10 + Math.sin(this.backgroundTime * 18) * 4, 0, Math.PI * 2);
          context.stroke();
        }
        context.strokeStyle = "rgba(255, 255, 255, 0.5)";
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(-enemy.radius * 0.42, -enemy.radius * 0.32);
        context.lineTo(enemy.radius * 0.42, enemy.radius * 0.32);
        context.moveTo(enemy.radius * 0.42, -enemy.radius * 0.32);
        context.lineTo(-enemy.radius * 0.42, enemy.radius * 0.32);
        context.stroke();
      } else if (enemy.typeId === "nibbler") {
        context.rotate(Math.atan2(enemy.vy, enemy.vx));
        context.fillStyle = bodyColor;
        context.beginPath();
        context.arc(0, 0, enemy.radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = accentColor;
        context.beginPath();
        context.moveTo(enemy.radius * 0.72, 0);
        context.lineTo(-enemy.radius * 0.28, -enemy.radius * 0.42);
        context.lineTo(-enemy.radius * 0.28, enemy.radius * 0.42);
        context.closePath();
        context.fill();
      } else if (enemy.typeId === "spitter") {
        context.fillStyle = bodyColor;
        context.beginPath();
        context.arc(0, 0, enemy.radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = accentColor;
        roundRectPath(context, -enemy.radius * 0.56, -5, enemy.radius * 1.12, 10, 4);
        context.fill();
        context.fillStyle = "#dbeafe";
        context.beginPath();
        context.arc(0, 0, enemy.radius * 0.24, 0, Math.PI * 2);
        context.fill();
      } else if (enemy.typeId === "acid-spitter") {
        context.fillStyle = bodyColor;
        context.beginPath();
        context.arc(0, 0, enemy.radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.fillStyle = accentColor;
        context.beginPath();
        context.arc(enemy.radius * 0.32, 0, enemy.radius * 0.34, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#bbf7d0";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(-enemy.radius * 0.45, -enemy.radius * 0.38);
        context.lineTo(enemy.radius * 0.42, enemy.radius * 0.38);
        context.stroke();
      } else if (enemy.typeId === "tank") {
        roundRectPath(context, -enemy.radius, -enemy.radius, enemy.radius * 2, enemy.radius * 2, 8);
        context.fillStyle = bodyColor;
        context.fill();
        context.stroke();
        context.fillStyle = accentColor;
        roundRectPath(context, -enemy.radius * 0.68, -enemy.radius * 0.28, enemy.radius * 1.36, enemy.radius * 0.56, 5);
        context.fill();
        context.strokeStyle = "rgba(248, 250, 252, 0.42)";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(-enemy.radius * 0.5, -enemy.radius * 0.5);
        context.lineTo(enemy.radius * 0.5, enemy.radius * 0.5);
        context.moveTo(enemy.radius * 0.5, -enemy.radius * 0.5);
        context.lineTo(-enemy.radius * 0.5, enemy.radius * 0.5);
        context.stroke();
      } else {
        if (enemy.state === "windup") {
          context.strokeStyle = "rgba(251, 191, 36, 0.84)";
          context.lineWidth = 5;
          context.beginPath();
          context.arc(0, 0, enemy.radius + 9 + Math.sin(this.backgroundTime * 22) * 3, 0, Math.PI * 2);
          context.stroke();
        }
        roundRectPath(context, -enemy.radius, -enemy.radius, enemy.radius * 2, enemy.radius * 2, 6);
        context.fillStyle = bodyColor;
        context.fill();
        context.stroke();
        context.fillStyle = accentColor;
        roundRectPath(context, -enemy.radius * 0.62, -enemy.radius * 0.18, enemy.radius * 1.24, enemy.radius * 0.36, 4);
        context.fill();
      }
      context.restore();

      const hpRatio = clamp(enemy.hp / enemy.maxHp, 0, 1);
      const width = enemy.radius * 1.7;
      const left = enemy.x - width * 0.5;
      const top = enemy.y - enemy.radius - 18;
      roundRectPath(context, left, top, width, 6, 3);
      context.fillStyle = "rgba(2, 6, 23, 0.7)";
      context.fill();
      roundRectPath(context, left, top, width * hpRatio, 6, 3);
      context.fillStyle = enemy.isBoss ? "#34d399" : "#fb7185";
      context.fill();
    }
  }

  renderPlayer(context) {
    if (!this.player) {
      if (this.mode === "title") {
        context.save();
        context.translate(LOGICAL_WIDTH * 0.5, LOGICAL_HEIGHT * 0.62);
        context.shadowBlur = 26;
        context.shadowColor = "rgba(34, 211, 238, 0.76)";
        context.fillStyle = "#22d3ee";
        context.beginPath();
        context.arc(0, 0, 28, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#ecfeff";
        context.lineWidth = 4;
        context.stroke();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(34, -12);
        context.stroke();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(0, 0, 8, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
      return;
    }

    const aim = this.getAimDirection();
    const character = getCharacterById(this.player.characterId);
    context.save();
    context.translate(this.player.x, this.player.y);
    if (this.player.invulnerabilityRemaining > 0) {
      context.globalAlpha = 0.72 + Math.sin(this.backgroundTime * 18) * 0.14;
    }
    const isKatana = this.player.attackType === "melee";
    const isEngineer = this.player.characterId === CHARACTER_IDS.engineer;
    context.shadowBlur = this.player.dashTimeRemaining > 0 ? 28 : 18;
    context.shadowColor = isKatana ? "rgba(248, 113, 113, 0.8)" : isEngineer ? "rgba(52, 211, 153, 0.78)" : "rgba(34, 211, 238, 0.8)";
    context.fillStyle = character.color;
    context.beginPath();
    context.arc(0, 0, this.player.radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = isKatana ? "#fecaca" : isEngineer ? "#bbf7d0" : "#cffafe";
    context.lineWidth = 3;
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = "#ffffff";
    context.lineWidth = isKatana ? 5 : 4;
    context.beginPath();
    context.moveTo(aim.x * 4, aim.y * 4);
    context.lineTo(aim.x * (this.player.radius + (isKatana ? 22 : 11)), aim.y * (this.player.radius + (isKatana ? 22 : 11)));
    context.stroke();
    if (isKatana) {
      context.strokeStyle = "#ef4444";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(-aim.y * 8, aim.x * 8);
      context.lineTo(aim.x * (this.player.radius + 12) - aim.y * 8, aim.y * (this.player.radius + 12) + aim.x * 8);
      context.stroke();
    }
    context.fillStyle = isKatana ? "#7f1d1d" : "#083344";
    context.beginPath();
    context.arc(0, 0, this.player.radius * 0.34, 0, Math.PI * 2);
    context.fill();
    context.restore();

    for (let shieldIndex = 0; shieldIndex < this.player.shields; shieldIndex += 1) {
      const angle = this.backgroundTime * 2 + (Math.PI * 2 * shieldIndex) / Math.max(1, this.player.shields);
      const x = this.player.x + Math.cos(angle) * (this.player.radius + 16);
      const y = this.player.y + Math.sin(angle) * (this.player.radius + 16);
      context.save();
      context.shadowBlur = 14;
      context.shadowColor = "rgba(52, 211, 153, 0.9)";
      context.fillStyle = "rgba(52, 211, 153, 0.95)";
      context.beginPath();
      context.arc(x, y, 6, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  renderEffects(context) {
    for (const effect of this.effects) {
      const progress = 1 - effect.life / effect.maxLife;
      const alpha = 1 - progress;
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = effect.color;
      context.fillStyle = effect.color;
      context.shadowBlur = effect.kind === "ring" ? 18 : 22;
      context.shadowColor = effect.color;
      if (effect.kind === "slash") {
        context.translate(effect.x, effect.y);
        context.rotate(effect.angle);
        context.lineWidth = 8 - progress * 4;
        context.beginPath();
        if (effect.fullCircle) {
          context.arc(0, 0, effect.radius * (0.55 + progress * 0.18), 0, Math.PI * 2);
        } else {
          context.arc(0, 0, effect.radius * (0.7 + progress * 0.12), -effect.arc * 0.5, effect.arc * 0.5);
        }
        context.stroke();
      } else if (effect.kind === "ring") {
        context.lineWidth = 3 + progress * 3;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius * (0.6 + progress * 0.7), 0, Math.PI * 2);
        context.stroke();
      } else {
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius * (0.4 + progress * 0.6), 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = alpha * 0.52;
        for (let sparkIndex = 0; sparkIndex < 6; sparkIndex += 1) {
          const angle = sparkIndex * (Math.PI / 3) + effect.id;
          const distance = effect.radius * progress * 1.15;
          context.beginPath();
          context.arc(effect.x + Math.cos(angle) * distance, effect.y + Math.sin(angle) * distance, 2.5, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.restore();
    }
  }

  renderFloatingTexts(context) {
    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 18px Segoe UI, Arial, sans-serif";
    for (const text of this.floatingTexts) {
      const progress = 1 - text.life / text.maxLife;
      context.globalAlpha = Math.max(0, 1 - progress);
      context.fillStyle = text.color;
      context.shadowBlur = 12;
      context.shadowColor = text.color;
      context.fillText(text.text, text.x, text.y);
    }
    context.restore();
  }
}



