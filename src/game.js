import {
  ADMIN_PASSWORD_DIGEST,
  CAMERA_CONFIG,
  DEFAULT_SONGS,
  GAME_CONFIG,
  GOLD_CONFIG,
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
  characters: "Inventory",
  stats: "Stats",
  leaderboard: "Leaderboard",
  guide: "Wiki",
  shop: "Shop",
  controls: "Controls",
  settings: "Settings",
  admin: "Admin",
};

const ENEMY_GUIDE_COPY = {
  nibbler: "Fast chaser that pressures your movement lane.",
  sprinter: "Lightweight rusher that trades health for extra speed.",
  spitter: "Keeps range and fires projectiles through the arena.",
  marksman: "Slow ranged unit that fires fast precision shots from long range.",
  "acid-spitter": "Keeps distance and spits acid that leaves hazardous pools.",
  bumper: "Winds up, then charges through your position.",
  tank: "Slow heavy unit that blocks space and soaks damage.",
  sentinel: "Boss-summoned unit that telegraphs a dash attack.",
  [BOSS_DEF.id]: "Large boss unit with charge, burst, and summon phases.",
};
const ENEMY_GUIDE_DEFS = [...Object.values(ENEMY_DEFS), BOSS_DEF];
const TRACKED_ENEMY_IDS = new Set(ENEMY_GUIDE_DEFS.map((definition) => definition.id));
const BOSS_ATTACK_PHASES = ["charge", "volley", "burst", "summon"];

const QUICK_RUN_GUIDE = [
  {
    title: "Early run",
    label: "00:00-02:00",
    copy: "Circle wide, keep an escape lane open, and collect XP after a pack thins out instead of diving through enemies.",
  },
  {
    title: "Level-up priorities",
    label: "Core picks",
    copy: "Take damage, cooldown, pierce, or slash reach early. Add movement, shields, and magnet once the arena starts to crowd.",
  },
  {
    title: "Boss waves",
    label: "03:00+",
    copy: "Do not spend dash before a charge. Clear summons first, then punish the boss while homing shots and volleys are cooling down.",
  },
];

const STRATEGY_GUIDE = [
  {
    title: "Kiting route",
    label: "Movement",
    copy: "Use slow arcs around the arena edge, then cut through the center only when dash is ready and the enemy pack has stretched out.",
  },
  {
    title: "Ability slot",
    label: "Grenade / Mine",
    copy: "Grenade is better for immediate pack breaks. Landmine rewards planning and choke points, especially with cluster upgrades.",
  },
  {
    title: "Gold and XP",
    label: "Economy",
    copy: "Bosses pay much more gold and XP. Risky pickup dives are not worth losing health unless they secure an upgrade before a boss.",
  },
  {
    title: "Engineer setup",
    label: "Turrets",
    copy: "Engineer turrets auto-deploy when enemies are present. Turret upgrades compound best when you already have projectile damage.",
  },
  {
    title: "Katana sustain",
    label: "Melee",
    copy: "Katana heals every 50 normal kills. Use reach, arc, and guard upgrades to farm safely instead of face-tanking contact damage.",
  },
  {
    title: "Boss counterplay",
    label: "Heavy Unit",
    copy: "Strafe across volley lines, dash through charge paths, and keep moving after the charge because homing shots continue to bend.",
  },
];

const ENEMY_THREAT_NOTES = {
  nibbler: "Basic pressure unit. Counter by kiting diagonally and thinning the front of the pack.",
  sprinter: "Fast but fragile. Counter with early damage or wide movement before it collapses your lane.",
  spitter: "Ranged area pressure. Counter by side-stepping shots and forcing it inside your weapon range.",
  marksman: "Long-range precision shooter. Counter by changing direction after it lines up a shot.",
  "acid-spitter": "Creates hazard zones. Counter by leaving the pool immediately and rotating away from corners.",
  bumper: "Telegraphed charger. Counter by saving dash until the windup commits.",
  tank: "Slow wall with high HP. Counter with pierce, splash, and clearing smaller enemies first.",
  sentinel: "Boss summon with dash pressure. Counter by clearing it before it boxes you in.",
  [BOSS_DEF.id]: "Major wave check. Counter with saved dash, wide spacing, and clearing summons before tunneling boss damage.",
};

const ENGINEER_TURRET = {
  deployCooldown: 10,
  lifetime: 8,
  range: 300,
  fireCooldown: 0.8,
  damageScale: 0.6,
};

const ABILITY_IDS = {
  grenade: "grenade",
  landmine: "landmine",
};

const ABILITY_LABELS = {
  [ABILITY_IDS.grenade]: "Grenade",
  [ABILITY_IDS.landmine]: "Landmine",
};

const ACCESSORY_DEFS = [
  {
    id: ABILITY_IDS.grenade,
    name: "Grenade",
    slot: "Ability",
    description: "Throw a fast blast grenade with E during a run.",
    isUnlocked: (progress) => Boolean(progress?.grenadeUnlocked),
    lockedText: "Get 250 kills in a single run.",
  },
  {
    id: ABILITY_IDS.landmine,
    name: "Landmine",
    slot: "Ability",
    description: "Place an armed tripmine with E during a run.",
    isUnlocked: (progress) => Boolean(progress?.landmineUnlocked),
    lockedText: "Survive 05:00 in a single run.",
  },
];

const HEAL_OFFER_CONFIG = {
  interval: 10,
  price: 500,
};

const MEDKIT_PICKUP = {
  normalDropChance: 0.035,
  bossDropChance: 0.35,
  healAmount: 2,
  lifetime: 16,
};

const COOP_CONFIG = {
  maxPlayers: 4,
  reviveRadius: 74,
  reviveSeconds: 3,
  reviveHp: 2,
  disconnectGraceSeconds: 8,
  spawnMultiplierPerExtraPlayer: 0.38,
  enemyCapPerExtraPlayer: 0.34,
  enemyHpPerExtraPlayer: 0.24,
  enemyDamagePerExtraPlayer: 0.08,
  bossHpPerExtraPlayer: 0.3,
};

const GUEST_INTERPOLATION_CONFIG = {
  minDuration: 0.055,
  maxDuration: 0.16,
};

const TEAMMATE_INDICATOR_CONFIG = {
  edgePadding: 54,
  smoothness: 14,
};

const BOSS_ARENA_CONFIG = {
  minWidth: 1320,
  minHeight: 760,
  paddingX: 420,
  paddingY: 300,
  wallPadding: 24,
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
  "ability-reload": "🔋",
  "overheal-shield": "💚",
  "volatile-grenade": "🌋",
  "blast-plating": "💥",
  "fast-trigger": "⏱️",
  "cluster-charge": "🧨",
  "sharpened-edge": "🗡️",
  "long-blade": "📏",
  "wide-cut": "🌙",
  "quick-draw": "⚔️",
  "flow-strike": "🌊",
  "bleeding-cut": "🩸",
  "counter-guard": "🛡️",
  "dash-slash": "💨",
  "rapid-assembly": "🔧",
  "twin-sentries": "🛰️",
  "calibrated-turret": "📡",
  "overclocked-sentry": "⚙️",
  "piercing-sentry": "🎯",
};
const UPGRADE_SHIELD_INTERVALS = [16, 12, 9];

function getUpgradeFamily(upgrade) {
  if (upgrade.characters?.includes(CHARACTER_IDS.katana)) {
    return "Katana";
  }
  if (upgrade.characters?.includes(CHARACTER_IDS.engineer)) {
    return "Engineer";
  }
  if (upgrade.id.includes("grenade")) {
    return "Grenade";
  }
  if (["blast-plating", "fast-trigger", "cluster-charge"].includes(upgrade.id)) {
    return "Landmine";
  }
  if (upgrade.id === "ability-reload" || upgrade.isAvailable) {
    return "Ability";
  }
  if (upgrade.excludeCharacters?.includes(CHARACTER_IDS.katana)) {
    return "Blaster";
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
      return "+1 Max Health";
    case "glitter-vac":
      return "+40 Magnet Radius";
    case "xp-surge":
      return `+${Math.round((1.18 ** rank - 1) * 100)}% XP Value`;
    case "bubble-guard":
      return `+Shield Regen: ${UPGRADE_SHIELD_INTERVALS[rank - 1]}s`;
    case "shatter-rounds":
      return `+${rank + 1} Shatter Fragments`;
    case "ability-reload":
      return `-${Math.round((1 - 0.86 ** rank) * 100)}% Ability Cooldown`;
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
    case "blast-plating":
      return "+3 Damage / +12 Radius";
    case "fast-trigger":
      return "-16% Cooldown / Faster Arm";
    case "cluster-charge":
      return `+${rank + 3} Mine Fragments`;
    case "rapid-assembly":
      return "-18% Turret Cooldown / +3s Lifetime";
    case "twin-sentries":
      return "+1 Active Turret";
    case "calibrated-turret":
      return "+60 Range / +0.5 Damage";
    case "overclocked-sentry":
      return "-12% Turret Fire Cooldown";
    case "piercing-sentry":
      return "+1 Turret Pierce";
    default:
      return getUpgradeEffectCopy(upgrade, rank);
  }
}

function formatWholeNumber(value) {
  return Math.floor(Math.max(0, value)).toLocaleString();
}

function getWeightedEnemyCandidates(weights) {
  return Object.values(ENEMY_DEFS).filter((definition) => (weights[definition.id] ?? 0) > 0);
}

function weightedEnemyPick(weights, candidates = getWeightedEnemyCandidates(weights)) {
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
    this.pointer = { x: 0, y: 0, screenX: LOGICAL_WIDTH * 0.5, screenY: LOGICAL_HEIGHT * 0.5, inside: false };
    this.camera = { x: 0, y: 0, zoom: CAMERA_CONFIG.defaultZoom };
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
    this.lastCompletedRunResult = null;
    this.onlineLeaderboardEnabled = false;
    this.onlineScoreSubmitted = false;
    this.scoreSubmitState = "idle";
    this.wikiDragState = null;
    this.pendingHealOfferLevels = [];
    this.activeHealOfferLevel = 0;
    this.lastRenderedShopGold = null;
    this.players = [];
    this.multiplayerSession = null;
    this.multiplayerHooks = {};
    this.remoteInputs = new Map();
    this.inputActions = { dash: 0, ability: 0, turret: 0 };
    this.coopUpgradeDraft = null;
    this.remoteRunRecorded = false;
    this.remoteSnapshotPrevious = null;
    this.remoteSnapshotNext = null;
    this.remoteSnapshotReceivedAt = 0;
    this.remoteSnapshotDuration = 0.07;
    this.teammateIndicator = null;
    this.bossArena = null;

    this.run = null;
    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.landmines = [];
    this.turrets = [];
    this.damageZones = [];
    this.pickups = [];
    this.effects = [];
    this.floatingTexts = [];
    this.toasts = [];
    this.upgradeCounts = Object.create(null);
    this.pendingLevelUps = 0;
    this.upgradeChoices = [];
    this.pendingHealOfferLevels = [];
    this.activeHealOfferLevel = 0;
    this.spawnBudget = 0;
    this.spawnTargetType = "";
    this.spawnVarietyPity = 0;
    this.enemyId = 0;
    this.projectileId = 0;
    this.pickupId = 0;
    this.grenadeId = 0;
    this.landmineId = 0;
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
    this.setupWikiWindow();
    this.setupWikiNavigation();
    this.setMenuTab(this.menuTab, false);
    this.loop = this.loop.bind(this);
    this.updateSoundButton();
    this.updateMusicVolumeInput();
    this.updateSavedScoreLabels();
    this.updateAbilityLobby();
    this.syncScreens();
    this.ui.runHighlights?.replaceChildren();
    this.updateScoreSubmitPanel();
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
    const guestPresentationActive = this.isMultiplayerGuest() && this.remoteSnapshotNext;
    if (guestPresentationActive) {
      this.updateGuestPresentation(deltaSeconds);
    } else if (this.mode === "playing") {
      this.updateGame(deltaSeconds);
    }
    if (this.mode !== "playing" && !guestPresentationActive) {
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

  setMultiplayerHooks(hooks = {}) {
    this.multiplayerHooks = hooks;
  }

  isCoopRun() {
    return Boolean(this.multiplayerSession);
  }

  isMultiplayerHost() {
    return this.multiplayerSession?.role === "host";
  }

  isMultiplayerGuest() {
    return this.multiplayerSession?.role === "guest";
  }

  getLocalPlayer() {
    if (!this.players?.length) {
      return this.player;
    }
    return this.players.find((player) => player.id === this.multiplayerSession?.localPlayerId) ?? this.players[0] ?? this.player;
  }

  getAlivePlayers() {
    return (this.players?.length ? this.players : [this.player]).filter((player) => player && !player.dead && !player.downed);
  }

  getCoopPlayerCount() {
    if (!this.isCoopRun()) {
      return 1;
    }
    return clamp(this.players?.length || 1, 1, COOP_CONFIG.maxPlayers);
  }

  getCoopEnemyScale() {
    const extraPlayers = Math.max(0, this.getCoopPlayerCount() - 1);
    return {
      spawnMultiplier: 1 + extraPlayers * COOP_CONFIG.spawnMultiplierPerExtraPlayer,
      maxEnemies: Math.round(GAME_CONFIG.maxEnemies * (1 + extraPlayers * COOP_CONFIG.enemyCapPerExtraPlayer)),
      enemyHp: 1 + extraPlayers * COOP_CONFIG.enemyHpPerExtraPlayer,
      enemyDamage: 1 + extraPlayers * COOP_CONFIG.enemyDamagePerExtraPlayer,
      bossHp: 1 + extraPlayers * COOP_CONFIG.bossHpPerExtraPlayer,
    };
  }

  getClosestAlivePlayer(x, y) {
    let closest = null;
    let closestDistance = Infinity;
    for (const player of this.getAlivePlayers()) {
      const distance = distanceSquared(x, y, player.x, player.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = player;
      }
    }
    return closest;
  }

  withPlayer(player, action) {
    const previousPlayer = this.player;
    const previousUpgradeCounts = this.upgradeCounts;
    this.player = player;
    this.upgradeCounts = player?.upgradeCounts ?? this.upgradeCounts;
    try {
      return action();
    } finally {
      this.player = previousPlayer;
      this.upgradeCounts = previousUpgradeCounts;
    }
  }

  getSoundListenerPlayer() {
    return this.getLocalPlayer() ?? this.player ?? { x: 0, y: 0, id: "solo" };
  }

  emitHostSound(soundId, x, y, options = {}) {
    if (!this.isMultiplayerHost()) {
      return;
    }
    this.multiplayerHooks.sendHostEvent?.({
      eventType: "sound",
      soundId,
      x,
      y,
      ownerId: options.ownerId ?? this.player?.id ?? "",
      intensity: options.intensity ?? 1,
      kind: options.kind ?? "",
      power: options.power ?? 1,
    });
  }

  playSoundCue(soundId, x = this.player?.x ?? 0, y = this.player?.y ?? 0, options = {}) {
    const listener = this.getSoundListenerPlayer();
    const ownerId = options.ownerId ?? this.player?.id ?? "";
    const isLocalOwner = !ownerId || ownerId === listener?.id;
    if (this.isCoopRun() && !isLocalOwner) {
      this.audio.playPositionalEffect(soundId, { x, y }, listener, options);
    } else {
      this.audio.playEffectById(soundId, options);
    }
    this.emitHostSound(soundId, x, y, { ...options, ownerId });
  }

  playRemoteSoundCue(payload = {}) {
    if (!payload.soundId || !this.isMultiplayerGuest()) {
      return;
    }
    const listener = this.getSoundListenerPlayer();
    const source = {
      x: Number.isFinite(payload.x) ? payload.x : listener.x,
      y: Number.isFinite(payload.y) ? payload.y : listener.y,
    };
    const options = {
      intensity: payload.intensity ?? 1,
      kind: payload.kind ?? "",
      power: payload.power ?? 1,
    };
    if (payload.ownerId && payload.ownerId === listener?.id) {
      this.audio.playEffectById(payload.soundId, options);
      return;
    }
    this.audio.playPositionalEffect(payload.soundId, source, listener, options);
  }

  createCoopPlayerState(profile, index = 0) {
    const character = getCharacterById(profile?.character) ?? CHARACTER_DEFS[CHARACTER_IDS.gunner];
    const slash = character.slash ?? CHARACTER_DEFS[CHARACTER_IDS.katana].slash;
    const accessoryIds = Array.isArray(profile?.accessoryIds) ? profile.accessoryIds : [];
    const equippedAbilityId = accessoryIds.includes(ABILITY_IDS.landmine)
      ? ABILITY_IDS.landmine
      : accessoryIds.includes(ABILITY_IDS.grenade)
        ? ABILITY_IDS.grenade
        : "";
    return {
      id: profile?.id || `player-${index + 1}`,
      name: profile?.name || (index === 0 ? "Host" : "Guest"),
      isLocal: Boolean(profile?.isLocal),
      x: index === 0 ? -34 : 34,
      y: 0,
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
      characterId: character.id,
      attackType: character.attackType,
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
      equippedAbilityId,
      grenadeEquipped: equippedAbilityId === ABILITY_IDS.grenade,
      grenadeCooldown: PLAYER_BASE.grenadeCooldown,
      grenadeCooldownRemaining: 0,
      grenadeDamage: PLAYER_BASE.grenadeDamage,
      grenadeRadius: PLAYER_BASE.grenadeRadius,
      grenadeProjectileSpeed: PLAYER_BASE.grenadeProjectileSpeed,
      grenadeFuse: PLAYER_BASE.grenadeFuse,
      landmineCooldown: PLAYER_BASE.landmineCooldown,
      landmineCooldownRemaining: 0,
      landmineDamage: PLAYER_BASE.landmineDamage,
      landmineRadius: PLAYER_BASE.landmineRadius,
      landmineArmTime: PLAYER_BASE.landmineArmTime,
      landmineTriggerRadius: PLAYER_BASE.landmineTriggerRadius,
      maxLandmines: PLAYER_BASE.maxLandmines,
      landmineClusterFragments: 0,
      shatterFragments: 0,
      overhealShieldBonus: 0,
      turretDeployCooldown: character.id === CHARACTER_IDS.engineer ? ENGINEER_TURRET.deployCooldown : 0,
      turretDeployCooldownRemaining: 0,
      turretLifetime: ENGINEER_TURRET.lifetime,
      turretRange: ENGINEER_TURRET.range,
      turretFireCooldown: ENGINEER_TURRET.fireCooldown,
      turretDamageBonus: 0,
      turretPierce: 0,
      maxTurrets: character.id === CHARACTER_IDS.engineer ? 1 : 0,
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
      downed: false,
      deathCause: null,
      reviveProgress: 0,
      pointer: { x: 0, y: -160 },
      inputKeys: new Set(),
      remoteActionSeq: { dash: 0, ability: 0, turret: 0 },
      upgradeCounts: Object.create(null),
    };
  }

  createMultiplayerProfile(name = "Player") {
    const character = this.getSelectedCharacter();
    return {
      name: String(name || "Player").trim().slice(0, 20) || "Player",
      character: character.id,
      accessoryIds: this.getSelectedAccessoryIds(character.id),
    };
  }

  createInputSnapshot() {
    return {
      keys: Array.from(this.keys),
      pointer: { x: this.pointer.x, y: this.pointer.y },
      actions: { ...this.inputActions },
      revive: this.keys.has("KeyF"),
    };
  }

  applyRemoteInput(playerId, input = {}) {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player || player.id === this.multiplayerSession?.localPlayerId) {
      return;
    }
    player.inputKeys = new Set(Array.isArray(input.keys) ? input.keys.filter((key) => typeof key === "string") : []);
    player.pointer = {
      x: Number.isFinite(input.pointer?.x) ? input.pointer.x : player.x,
      y: Number.isFinite(input.pointer?.y) ? input.pointer.y : player.y - 160,
    };
    const actions = input.actions ?? {};
    for (const [actionName, methodName] of [
      ["dash", "tryDash"],
      ["ability", "tryAbility"],
      ["turret", "tryDeployTurret"],
    ]) {
      const nextSeq = Math.max(0, Math.floor(Number(actions[actionName]) || 0));
      if (nextSeq > (player.remoteActionSeq?.[actionName] ?? 0) && this.mode === "playing" && !player.downed) {
        player.remoteActionSeq[actionName] = nextSeq;
        this.withPlayer(player, () => this[methodName]());
      }
    }
  }

  createMultiplayerSnapshot() {
    return {
      mode: this.mode,
      run: this.run ? {
        elapsed: this.run.elapsed,
        level: this.run.level,
        xp: this.run.xp,
        xpToNext: this.run.xpToNext,
        kills: this.run.kills,
        bossKills: this.run.bossKills,
        shotsFired: this.run.shotsFired,
        killScore: this.run.killScore,
        score: this.run.score,
        damageTaken: this.run.damageTaken,
        enemyKills: this.run.enemyKills,
        enemyDeaths: this.run.enemyDeaths,
        goldEarned: this.run.goldEarned,
        deathCause: this.run.deathCause,
      } : null,
      players: this.players.map((player) => this.serializePlayer(player)),
      enemies: this.enemies,
      projectiles: this.projectiles.map((projectile) => ({ ...projectile, hitIds: undefined })),
      enemyProjectiles: this.enemyProjectiles.map((projectile) => ({ ...projectile, hitIds: undefined })),
      grenades: this.grenades,
      landmines: this.landmines,
      turrets: this.turrets,
      damageZones: this.damageZones,
      pickups: this.pickups.filter((pickup) => !pickup.dead).map((pickup) => this.serializePickup(pickup)),
      effects: [],
      floatingTexts: [],
      bossArena: this.bossArena ? { ...this.bossArena } : null,
      banner: this.banner,
    };
  }

  serializePlayer(player) {
    return {
      ...player,
      inputKeys: Array.from(player.inputKeys ?? []),
      upgradeCounts: { ...(player.upgradeCounts ?? {}) },
    };
  }

  serializePickup(pickup) {
    return {
      id: pickup.id ?? null,
      type: pickup.type,
      x: pickup.x,
      y: pickup.y,
      vx: pickup.vx,
      vy: pickup.vy,
      radius: pickup.radius,
      value: pickup.value,
      life: pickup.life,
      maxLife: pickup.maxLife,
      collectorId: pickup.collectorId ?? "",
      dead: Boolean(pickup.dead),
    };
  }

  normalizeMultiplayerSnapshot(snapshot) {
    const normalizePlayer = (player) => ({
      ...player,
      isLocal: player.id === this.multiplayerSession?.localPlayerId,
      inputKeys: new Set(player.inputKeys ?? []),
      upgradeCounts: { ...(player.upgradeCounts ?? {}) },
    });
    const normalizeProjectile = (projectile) => ({
      ...projectile,
      hitIds: new Set(projectile.hitIds ?? []),
    });
    return {
      mode: snapshot.mode ?? this.mode,
      run: snapshot.run ? { ...snapshot.run, recorded: this.run?.recorded ?? false } : this.run,
      players: Array.isArray(snapshot.players) ? snapshot.players.map(normalizePlayer) : this.players,
      enemies: Array.isArray(snapshot.enemies) ? snapshot.enemies.map((enemy) => ({ ...enemy })) : this.enemies,
      projectiles: Array.isArray(snapshot.projectiles) ? snapshot.projectiles.map(normalizeProjectile) : this.projectiles,
      enemyProjectiles: Array.isArray(snapshot.enemyProjectiles) ? snapshot.enemyProjectiles.map(normalizeProjectile) : this.enemyProjectiles,
      grenades: Array.isArray(snapshot.grenades) ? snapshot.grenades.map((grenade) => ({ ...grenade })) : this.grenades,
      landmines: Array.isArray(snapshot.landmines) ? snapshot.landmines.map((mine) => ({ ...mine })) : this.landmines,
      turrets: Array.isArray(snapshot.turrets) ? snapshot.turrets.map((turret) => ({ ...turret })) : this.turrets,
      damageZones: Array.isArray(snapshot.damageZones) ? snapshot.damageZones.map((zone) => ({ ...zone })) : this.damageZones,
      pickups: Array.isArray(snapshot.pickups) ? snapshot.pickups.map((pickup, index) => ({ ...pickup, id: pickup.id ?? `pickup-${index}` })) : this.pickups,
      effects: Array.isArray(snapshot.effects) ? snapshot.effects.map((effect) => ({ ...effect })) : this.effects,
      floatingTexts: Array.isArray(snapshot.floatingTexts) ? snapshot.floatingTexts.map((text) => ({ ...text })) : this.floatingTexts,
      bossArena: snapshot.bossArena ? { ...snapshot.bossArena } : null,
      banner: snapshot.banner ?? this.banner,
    };
  }

  captureRenderableSnapshot() {
    return {
      players: this.players.map((player) => this.serializePlayer(player)),
      enemies: this.enemies.map((enemy) => ({ ...enemy })),
      projectiles: this.projectiles.map((projectile) => ({ ...projectile, hitIds: Array.from(projectile.hitIds ?? []) })),
      enemyProjectiles: this.enemyProjectiles.map((projectile) => ({ ...projectile, hitIds: Array.from(projectile.hitIds ?? []) })),
      grenades: this.grenades.map((grenade) => ({ ...grenade })),
      landmines: this.landmines.map((mine) => ({ ...mine })),
      turrets: this.turrets.map((turret) => ({ ...turret })),
      damageZones: this.damageZones.map((zone) => ({ ...zone })),
      pickups: this.pickups.filter((pickup) => !pickup.dead).map((pickup) => this.serializePickup(pickup)),
      effects: [],
      floatingTexts: [],
      bossArena: this.bossArena ? { ...this.bossArena } : null,
    };
  }

  interpolateEntity(previous, next, ratio) {
    if (!previous) {
      return { ...next };
    }
    const output = { ...next };
    for (const field of ["x", "y", "vx", "vy", "life", "reviveProgress", "muzzleFlash"]) {
      if (Number.isFinite(previous[field]) && Number.isFinite(next[field])) {
        output[field] = lerp(previous[field], next[field], ratio);
      }
    }
    if (next.hitIds instanceof Set) {
      output.hitIds = new Set(next.hitIds);
    }
    if (next.inputKeys instanceof Set) {
      output.inputKeys = new Set(next.inputKeys);
    }
    if (next.upgradeCounts) {
      output.upgradeCounts = { ...next.upgradeCounts };
    }
    return output;
  }

  interpolateEntityList(previousList = [], nextList = [], ratio = 1) {
    const getKey = (entity, index) => entity?.id ?? `${entity?.type ?? "entity"}-${index}`;
    const previousById = new Map(previousList.map((entity, index) => [getKey(entity, index), entity]));
    return nextList.map((entity, index) => this.interpolateEntity(previousById.get(getKey(entity, index)), entity, ratio));
  }

  applyRenderableSnapshot(snapshot, ratio = 1) {
    const previous = this.remoteSnapshotPrevious ?? {};
    this.players = this.interpolateEntityList(previous.players, snapshot.players, ratio).map((player) => ({
      ...player,
      isLocal: player.id === this.multiplayerSession?.localPlayerId,
      inputKeys: new Set(player.inputKeys ?? []),
      upgradeCounts: { ...(player.upgradeCounts ?? {}) },
    }));
    this.player = this.getLocalPlayer();
    this.upgradeCounts = this.player?.upgradeCounts ?? this.upgradeCounts;
    this.enemies = this.interpolateEntityList(previous.enemies, snapshot.enemies, ratio);
    this.projectiles = this.interpolateEntityList(previous.projectiles, snapshot.projectiles, ratio).map((projectile) => ({
      ...projectile,
      hitIds: new Set(projectile.hitIds ?? []),
    }));
    this.enemyProjectiles = this.interpolateEntityList(previous.enemyProjectiles, snapshot.enemyProjectiles, ratio).map((projectile) => ({
      ...projectile,
      hitIds: new Set(projectile.hitIds ?? []),
    }));
    this.grenades = this.interpolateEntityList(previous.grenades, snapshot.grenades, ratio);
    this.landmines = this.interpolateEntityList(previous.landmines, snapshot.landmines, ratio);
    this.turrets = this.interpolateEntityList(previous.turrets, snapshot.turrets, ratio);
    this.damageZones = this.interpolateEntityList(previous.damageZones, snapshot.damageZones, ratio);
    this.pickups = this.interpolateEntityList(previous.pickups, snapshot.pickups, ratio);
    this.effects = this.interpolateEntityList(previous.effects, snapshot.effects, ratio);
    this.floatingTexts = this.interpolateEntityList(previous.floatingTexts, snapshot.floatingTexts, ratio);
    this.bossArena = snapshot.bossArena ? { ...snapshot.bossArena } : null;
  }

  updateGuestPresentation(deltaSeconds) {
    if (this.remoteSnapshotNext) {
      const now = performance.now() / 1000;
      const ratio = clamp((now - this.remoteSnapshotReceivedAt) / this.remoteSnapshotDuration, 0, 1);
      this.applyRenderableSnapshot(this.remoteSnapshotNext, ratio);
    }
    this.updateBanner(deltaSeconds);
    this.updateEffects(deltaSeconds);
    this.updateFloatingTexts(deltaSeconds);
    this.updateToasts(deltaSeconds);
    this.cleanupDeadEntities();
    this.updateCamera();
  }

  applyMultiplayerSnapshot(snapshot) {
    if (!snapshot || !this.isMultiplayerGuest()) {
      return;
    }
    const normalized = this.normalizeMultiplayerSnapshot(snapshot);
    const now = performance.now() / 1000;
    const previousReceivedAt = this.remoteSnapshotReceivedAt || now;
    this.remoteSnapshotPrevious = this.captureRenderableSnapshot();
    this.remoteSnapshotNext = normalized;
    const measuredDuration = clamp(now - previousReceivedAt, GUEST_INTERPOLATION_CONFIG.minDuration, GUEST_INTERPOLATION_CONFIG.maxDuration);
    this.remoteSnapshotDuration = clamp(lerp(this.remoteSnapshotDuration || measuredDuration, measuredDuration, 0.35), GUEST_INTERPOLATION_CONFIG.minDuration, GUEST_INTERPOLATION_CONFIG.maxDuration);
    this.remoteSnapshotReceivedAt = now;
    this.mode = normalized.mode ?? this.mode;
    this.run = normalized.run;
    this.banner = normalized.banner ?? this.banner;
    if (!this.players.length) {
      this.applyRenderableSnapshot(normalized, 1);
    }
    if (this.mode === "gameOver" && this.run && !this.remoteRunRecorded) {
      if (this.ui.gameOverTitle) {
        this.ui.gameOverTitle.textContent = "Co-op run finished.";
      }
      if (this.ui.finalScore) {
        this.ui.finalScore.textContent = Math.floor(this.run.score).toLocaleString();
      }
      if (this.ui.finalTime) {
        this.ui.finalTime.textContent = formatTime(this.run.elapsed);
      }
      if (this.ui.finalKills) {
        this.ui.finalKills.textContent = this.run.kills.toString();
      }
      if (this.ui.finalBosses) {
        this.ui.finalBosses.textContent = this.run.bossKills.toString();
      }
      this.updateDeathCauseCard(this.run.deathCause);
      this.save = recordRun(this.save, this.run);
      this.remoteRunRecorded = true;
      this.lastCompletedRunResult = this.buildLeaderboardRunResult();
      this.updateScoreSubmitPanel();
      this.renderQuestMenu();
      this.renderCharacterMenu();
      this.updateAbilityLobby();
    }
    this.syncScreens();
    this.updateHud();
  }

  getCameraZoom() {
    return clamp(this.camera.zoom ?? CAMERA_CONFIG.defaultZoom, CAMERA_CONFIG.minZoom, CAMERA_CONFIG.maxZoom);
  }

  getCameraViewSize() {
    const zoom = this.getCameraZoom();
    return {
      width: LOGICAL_WIDTH / zoom,
      height: LOGICAL_HEIGHT / zoom,
    };
  }

  updateCamera() {
    const zoom = this.getCameraZoom();
    const view = this.getCameraViewSize();
    this.camera.zoom = zoom;
    const followPlayer = this.getLocalPlayer();
    if (!followPlayer) {
      this.camera.x = -view.width * 0.5;
      this.camera.y = -view.height * 0.5;
      return;
    }
    this.camera.x = followPlayer.x - view.width * 0.5;
    this.camera.y = followPlayer.y - view.height * 0.5;
  }

  getCameraRect(margin = 0) {
    const view = this.getCameraViewSize();
    return {
      x: this.camera.x - margin,
      y: this.camera.y - margin,
      width: view.width + margin * 2,
      height: view.height + margin * 2,
    };
  }

  getActiveSpawnRect(margin = 0) {
    const alivePlayers = this.getAlivePlayers();
    if (!this.isCoopRun() || alivePlayers.length <= 1) {
      return this.getCameraRect(margin);
    }
    const view = this.getCameraViewSize();
    const rects = alivePlayers.map((player) => ({
      x: player.x - view.width * 0.5,
      y: player.y - view.height * 0.5,
      width: view.width,
      height: view.height,
    }));
    const minX = Math.min(...rects.map((rect) => rect.x)) - margin;
    const minY = Math.min(...rects.map((rect) => rect.y)) - margin;
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width)) + margin;
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height)) + margin;
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  createBossArenaFor(boss) {
    const participants = [...this.getAlivePlayers(), boss].filter(Boolean);
    const minX = Math.min(...participants.map((entity) => entity.x - (entity.radius ?? 0)));
    const maxX = Math.max(...participants.map((entity) => entity.x + (entity.radius ?? 0)));
    const minY = Math.min(...participants.map((entity) => entity.y - (entity.radius ?? 0)));
    const maxY = Math.max(...participants.map((entity) => entity.y + (entity.radius ?? 0)));
    const width = Math.max(BOSS_ARENA_CONFIG.minWidth, maxX - minX + BOSS_ARENA_CONFIG.paddingX * 2);
    const height = Math.max(BOSS_ARENA_CONFIG.minHeight, maxY - minY + BOSS_ARENA_CONFIG.paddingY * 2);
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    this.bossArena = {
      x: centerX - width * 0.5,
      y: centerY - height * 0.5,
      width,
      height,
      bossId: boss.id,
    };
  }

  updateBossArenaState() {
    const activeBosses = this.enemies.filter((enemy) => enemy.isBoss && !enemy.dead);
    if (!activeBosses.length) {
      this.bossArena = null;
      return;
    }
    if (!this.bossArena) {
      this.createBossArenaFor(activeBosses[0]);
    }
  }

  clampEntityToBossArena(entity, radius = entity?.radius ?? 0, bounce = false) {
    if (!this.bossArena || !entity) {
      return;
    }
    const minX = this.bossArena.x + radius + BOSS_ARENA_CONFIG.wallPadding;
    const maxX = this.bossArena.x + this.bossArena.width - radius - BOSS_ARENA_CONFIG.wallPadding;
    const minY = this.bossArena.y + radius + BOSS_ARENA_CONFIG.wallPadding;
    const maxY = this.bossArena.y + this.bossArena.height - radius - BOSS_ARENA_CONFIG.wallPadding;
    const previousX = entity.x;
    const previousY = entity.y;
    entity.x = clamp(entity.x, minX, maxX);
    entity.y = clamp(entity.y, minY, maxY);
    if (bounce && entity.x !== previousX && Number.isFinite(entity.vx)) {
      entity.vx *= -0.55;
    }
    if (bounce && entity.y !== previousY && Number.isFinite(entity.vy)) {
      entity.vy *= -0.55;
    }
  }

  clampCombatToBossArena() {
    if (!this.bossArena) {
      return;
    }
    for (const player of this.players.length ? this.players : [this.player]) {
      this.clampEntityToBossArena(player, player?.radius ?? 0);
    }
    for (const enemy of this.enemies) {
      this.clampEntityToBossArena(enemy, enemy.radius, true);
    }
    for (const projectile of [...this.projectiles, ...this.enemyProjectiles, ...this.grenades, ...this.landmines]) {
      this.clampEntityToBossArena(projectile, projectile.radius ?? 0, true);
    }
    for (const entity of [...this.turrets, ...this.pickups, ...this.damageZones]) {
      this.clampEntityToBossArena(entity, entity.radius ?? 0);
    }
  }

  screenToWorld(screenX, screenY) {
    const zoom = this.getCameraZoom();
    return {
      x: this.camera.x + screenX / zoom,
      y: this.camera.y + screenY / zoom,
    };
  }

  worldToScreen(worldX, worldY) {
    const zoom = this.getCameraZoom();
    return {
      x: (worldX - this.camera.x) * zoom,
      y: (worldY - this.camera.y) * zoom,
    };
  }

  onPointerMove(clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    const screenX = clamp(((clientX - bounds.left) / bounds.width) * LOGICAL_WIDTH, 0, LOGICAL_WIDTH);
    const screenY = clamp(((clientY - bounds.top) / bounds.height) * LOGICAL_HEIGHT, 0, LOGICAL_HEIGHT);
    this.updatePointerFromScreen(screenX, screenY);
  }

  updatePointerFromScreen(screenX, screenY) {
    const worldPoint = this.screenToWorld(screenX, screenY);
    this.pointer.x = worldPoint.x;
    this.pointer.y = worldPoint.y;
    this.pointer.screenX = screenX;
    this.pointer.screenY = screenY;
    this.pointer.inside = true;
    const localPlayer = this.getLocalPlayer();
    if (localPlayer) {
      localPlayer.pointer = { x: worldPoint.x, y: worldPoint.y };
    }
  }

  refreshPointerWorldPosition() {
    if (!this.pointer.inside) {
      return;
    }
    this.updatePointerFromScreen(this.pointer.screenX ?? LOGICAL_WIDTH * 0.5, this.pointer.screenY ?? LOGICAL_HEIGHT * 0.5);
  }

  setCameraZoom(nextZoom) {
    const zoom = clamp(nextZoom, CAMERA_CONFIG.minZoom, CAMERA_CONFIG.maxZoom);
    if (Math.abs(zoom - this.getCameraZoom()) < 0.0001) {
      return false;
    }
    this.camera.zoom = zoom;
    this.updateCamera();
    this.refreshPointerWorldPosition();
    return true;
  }

  adjustCameraZoom(direction) {
    const step = 1 + CAMERA_CONFIG.keyboardStep;
    return this.setCameraZoom(direction > 0 ? this.getCameraZoom() * step : this.getCameraZoom() / step);
  }

  resetCameraZoom() {
    return this.setCameraZoom(CAMERA_CONFIG.defaultZoom);
  }

  onWheel(deltaY, clientX, clientY) {
    const bounds = this.canvas.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
      return true;
    }
    this.onPointerMove(clientX, clientY);
    const zoomFactor = Math.exp(-deltaY * CAMERA_CONFIG.wheelSensitivity);
    this.setCameraZoom(this.getCameraZoom() * zoomFactor);
    return false;
  }

  handleCanvasClick() {
    if (this.isMultiplayerGuest()) {
      return;
    }
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
      } else if (this.mode === "healOffer") {
        this.skipHealOffer();
      }
      return false;
    }
    if (this.mode === "healOffer" && (code === "Enter" || code === "KeyY")) {
      this.acceptHealOffer();
      return false;
    }
    if (this.mode === "healOffer" && code === "KeyN") {
      this.skipHealOffer();
      return false;
    }
    if (code === "KeyM") {
      this.toggleMute();
      return false;
    }
    if (code === "Equal" || code === "NumpadAdd") {
      this.adjustCameraZoom(1);
      return false;
    }
    if (code === "Minus" || code === "NumpadSubtract") {
      this.adjustCameraZoom(-1);
      return false;
    }
    if (code === "Digit0" || code === "Numpad0") {
      this.resetCameraZoom();
      return false;
    }
    if (code === "Space") {
      this.inputActions.dash += 1;
      if (this.isMultiplayerGuest()) {
        return false;
      }
      if (this.mode === "playing") {
        this.tryDash();
      }
      return false;
    }
    if (code === "KeyE") {
      this.inputActions.ability += 1;
      if (this.isMultiplayerGuest()) {
        return false;
      }
      if (this.mode === "playing") {
        this.tryAbility();
      }
      return false;
    }
    if (code === "KeyT") {
      this.inputActions.turret += 1;
      if (this.isMultiplayerGuest()) {
        return false;
      }
      if (this.mode === "playing") {
        this.tryDeployTurret();
      }
      return false;
    }
    if (code === "KeyF") {
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

  startRun(options = {}) {
    const multiplayer = options.multiplayer ?? null;
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
      goldEarned: 0,
      deathCause: null,
      recorded: false,
    };
    this.multiplayerSession = multiplayer
      ? {
          role: multiplayer.role,
          roomCode: multiplayer.roomCode,
          localPlayerId: multiplayer.localPlayerId,
          players: multiplayer.players ?? [],
        }
      : null;
    this.remoteRunRecorded = false;
    this.coopUpgradeDraft = null;
    this.remoteInputs = new Map();
    this.inputActions = { dash: 0, ability: 0, turret: 0 };
    const equippedAbilityId = this.getEquippedAbilityId();
    this.player = {
      id: multiplayer?.localPlayerId ?? "solo",
      name: multiplayer?.players?.find((player) => player.id === multiplayer.localPlayerId)?.name ?? "Player",
      isLocal: true,
      x: 0,
      y: 0,
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
      equippedAbilityId,
      grenadeEquipped: equippedAbilityId === ABILITY_IDS.grenade,
      grenadeCooldown: PLAYER_BASE.grenadeCooldown,
      grenadeCooldownRemaining: 0,
      grenadeDamage: PLAYER_BASE.grenadeDamage,
      grenadeRadius: PLAYER_BASE.grenadeRadius,
      grenadeProjectileSpeed: PLAYER_BASE.grenadeProjectileSpeed,
      grenadeFuse: PLAYER_BASE.grenadeFuse,
      landmineCooldown: PLAYER_BASE.landmineCooldown,
      landmineCooldownRemaining: 0,
      landmineDamage: PLAYER_BASE.landmineDamage,
      landmineRadius: PLAYER_BASE.landmineRadius,
      landmineArmTime: PLAYER_BASE.landmineArmTime,
      landmineTriggerRadius: PLAYER_BASE.landmineTriggerRadius,
      maxLandmines: PLAYER_BASE.maxLandmines,
      landmineClusterFragments: 0,
      shatterFragments: 0,
      overhealShieldBonus: 0,
      turretDeployCooldown: selectedCharacter.id === CHARACTER_IDS.engineer ? ENGINEER_TURRET.deployCooldown : 0,
      turretDeployCooldownRemaining: 0,
      turretLifetime: ENGINEER_TURRET.lifetime,
      turretRange: ENGINEER_TURRET.range,
      turretFireCooldown: ENGINEER_TURRET.fireCooldown,
      turretDamageBonus: 0,
      turretPierce: 0,
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
      downed: false,
      deathCause: null,
      reviveProgress: 0,
      pointer: { x: 0, y: -160 },
      inputKeys: new Set(),
      remoteActionSeq: { dash: 0, ability: 0, turret: 0 },
      upgradeCounts: this.upgradeCounts,
    };
    if (multiplayer?.players?.length) {
      const localProfile = multiplayer.players.find((player) => player.id === multiplayer.localPlayerId);
      if (localProfile) {
        this.player.name = localProfile.name;
        this.player.id = localProfile.id;
      }
    }
    this.players = [this.player];
    if (this.isMultiplayerHost()) {
      const remoteProfiles = (multiplayer.players ?? []).filter((profile) => profile.id !== multiplayer.localPlayerId);
      for (const [index, profile] of remoteProfiles.entries()) {
        this.players.push(this.createCoopPlayerState({ ...profile, isLocal: false }, index + 1));
      }
    }
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.landmines = [];
    this.turrets = [];
    this.damageZones = [];
    this.pickups = [];
    this.effects = [];
    this.floatingTexts = [];
    this.toasts = [];
    this.upgradeCounts = Object.create(null);
    this.player.upgradeCounts = this.upgradeCounts;
    this.runMilestones = new Set();
    this.runHighlights = [];
    this.maxedUpgradeIds = new Set();
    this.lastCompletedRunResult = null;
    this.onlineScoreSubmitted = false;
    this.scoreSubmitState = "idle";
    this.pendingLevelUps = 0;
    this.upgradeChoices = [];
    this.spawnBudget = 0;
    this.spawnTargetType = "";
    this.spawnVarietyPity = 0;
    this.enemyId = 0;
    this.projectileId = 0;
    this.pickupId = 0;
    this.grenadeId = 0;
    this.landmineId = 0;
    this.turretId = 0;
    this.effectId = 0;
    this.textId = 0;
    this.toastId = 0;
    this.nextBossTime = GAME_CONFIG.bossInterval;
    this.warnedBossAt = null;
    this.banner = null;
    this.bossArena = null;
    this.remoteSnapshotPrevious = null;
    this.remoteSnapshotNext = null;
    this.teammateIndicator = null;
    this.updateCamera();
    this.pointer = { x: this.player.x, y: this.player.y, screenX: LOGICAL_WIDTH * 0.5, screenY: LOGICAL_HEIGHT * 0.5, inside: false };
    this.mode = "playing";
    this.helpReturnMode = "paused";
    this.resetStatsPending = false;
    this.updateResetStatsButton();
    this.hitSoundCooldown = 0;
    this.screenShake = 0;
    this.syncScreens();
    this.updateDeathCauseCard(null);
    this.updateScoreSubmitPanel();
    this.playSelectedMusic();
    this.updateHud();
    this.announce("Run started.");
  }

  returnToTitle() {
    const savedProgress = this.saveCurrentRunProgress();
    this.mode = "title";
    this.helpReturnMode = "title";
    this.camera = { x: 0, y: 0, zoom: CAMERA_CONFIG.defaultZoom };
    this.pointer = { x: 0, y: 0, screenX: LOGICAL_WIDTH * 0.5, screenY: LOGICAL_HEIGHT * 0.5, inside: false };
    this.run = null;
    this.player = null;
    this.players = [];
    this.multiplayerSession = null;
    this.remoteInputs = new Map();
    this.coopUpgradeDraft = null;
    this.remoteRunRecorded = false;
    this.remoteSnapshotPrevious = null;
    this.remoteSnapshotNext = null;
    this.teammateIndicator = null;
    this.bossArena = null;
    this.updateCamera();
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.landmines = [];
    this.turrets = [];
    this.damageZones = [];
    this.pickups = [];
    this.effects = [];
    this.floatingTexts = [];
    this.toasts = [];
    this.banner = null;
    this.pendingLevelUps = 0;
    this.upgradeChoices = [];
    this.pendingHealOfferLevels = [];
    this.activeHealOfferLevel = 0;
    this.runMilestones = new Set();
    this.runHighlights = [];
    this.maxedUpgradeIds = new Set();
    this.lastCompletedRunResult = null;
    this.onlineScoreSubmitted = false;
    this.scoreSubmitState = "idle";
    this.updateAbilityLobby();
    this.setMenuTab("play", false);
    this.syncScreens();
    this.updateScoreSubmitPanel();
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
    this.updateAbilityLobby();
    this.renderQuestMenu();
    this.renderCharacterMenu();
    return true;
  }

  restartRun() {
    this.startRun();
  }

  startMultiplayerGuest({ roomCode, localPlayerId, players = [] } = {}) {
    this.multiplayerSession = {
      role: "guest",
      roomCode,
      localPlayerId,
      players,
    };
    this.remoteRunRecorded = false;
    this.coopUpgradeDraft = null;
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
      goldEarned: 0,
      deathCause: null,
      recorded: false,
    };
    this.players = players.map((profile, index) => this.createCoopPlayerState({ ...profile, isLocal: profile.id === localPlayerId }, index));
    this.player = this.getLocalPlayer();
    this.upgradeCounts = this.player?.upgradeCounts ?? Object.create(null);
    this.mode = "playing";
    this.helpReturnMode = "paused";
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.landmines = [];
    this.turrets = [];
    this.damageZones = [];
    this.pickups = [];
    this.effects = [];
    this.floatingTexts = [];
    this.toasts = [];
    this.pickupId = 0;
    this.banner = null;
    this.bossArena = null;
    this.remoteSnapshotPrevious = null;
    this.remoteSnapshotNext = null;
    this.teammateIndicator = null;
    this.updateCamera();
    this.syncScreens();
    this.updateDeathCauseCard(null);
    this.updateScoreSubmitPanel();
    this.updateHud();
    this.announce("Joined co-op run.");
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
    this.upgradeCounts[upgradeId] = nextRank;
    upgrade.apply(this.player, nextRank);
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
      landmineCount: this.landmines.filter((mine) => !mine.dead).length,
      playerHp: this.player?.hp ?? 0,
      players: (this.players ?? []).map((player) => ({
        id: player.id,
        hp: player.hp,
        downed: Boolean(player.downed),
        characterId: player.characterId,
      })),
      multiplayer: this.multiplayerSession ? { ...this.multiplayerSession, players: this.multiplayerSession.players } : null,
      equippedAbilityId: this.player?.equippedAbilityId ?? this.getEquippedAbilityId(),
      characterId: this.player?.characterId ?? this.getSelectedCharacter().id,
      world: { infinite: true },
      camera: { ...this.camera },
      bossArena: this.bossArena ? { ...this.bossArena } : null,
      pointer: { ...this.pointer },
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
    if (this.isMultiplayerGuest()) {
      this.updateGuestPresentation(deltaSeconds);
      return;
    }
    if (!this.player || !this.run) {
      return;
    }
    this.run.elapsed += deltaSeconds;
    if (this.run.elapsed >= 300 && !this.save.progress?.landmineUnlocked) {
      this.unlockMilestone("landmine-unlock", "Landmine quest complete");
    }
    this.hitSoundCooldown = Math.max(0, this.hitSoundCooldown - deltaSeconds);
    this.screenShake = Math.max(0, this.screenShake - deltaSeconds * 24);
    this.updateBanner(deltaSeconds);
    const localPlayer = this.getLocalPlayer();
    for (const player of this.players.length ? this.players : [this.player]) {
      if (!player || player.downed || player.dead) {
        continue;
      }
      this.withPlayer(player, () => {
        player.grenadeCooldownRemaining = Math.max(0, player.grenadeCooldownRemaining - deltaSeconds);
        player.landmineCooldownRemaining = Math.max(0, player.landmineCooldownRemaining - deltaSeconds);
        this.updatePlayer(deltaSeconds);
        this.updateTurrets(deltaSeconds);
        this.tryAutoFire();
      });
    }
    this.player = localPlayer;
    this.upgradeCounts = localPlayer?.upgradeCounts ?? this.upgradeCounts;
    this.updateCamera();
    this.updateCoopRevives(deltaSeconds);
    this.updateBossSchedule();
    this.updateBossArenaState();
    this.updateSpawning(deltaSeconds);
    this.updateEnemies(deltaSeconds);
    this.updateProjectiles(deltaSeconds);
    this.updateGrenades(deltaSeconds);
    this.updateLandmines(deltaSeconds);
    this.updateDamageZones(deltaSeconds);
    this.updatePickups(deltaSeconds);
    this.updateEffects(deltaSeconds);
    this.updateFloatingTexts(deltaSeconds);
    this.updateToasts(deltaSeconds);
    this.clampCombatToBossArena();
    this.handleCollisions();
    this.updateCamera();
    this.cleanupDeadEntities();
    this.updateBossArenaState();
    this.run.score = Math.floor(this.run.elapsed * SCORE_CONFIG.survivalPerSecond + this.run.killScore);

    while (this.run.xp >= this.run.xpToNext) {
      this.run.xp -= this.run.xpToNext;
      this.run.level += 1;
      this.run.xpToNext = getXpThreshold(this.run.level);
      this.pendingLevelUps += 1;
      if (this.run.level % HEAL_OFFER_CONFIG.interval === 0) {
        this.pendingHealOfferLevels.push(this.run.level);
      }
      this.flashLevelUp();
    }

    if (this.pendingLevelUps > 0 && this.mode === "playing") {
      if (this.isMultiplayerHost()) {
        this.showCoopUpgradeDraft();
      } else {
        this.showNextLevelReward();
      }
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

    this.clampEntityToBossArena(player, player.radius);
  }

  updateTurrets(deltaSeconds) {
    if (!this.player || this.player.maxTurrets <= 0) {
      return;
    }
    this.player.turretDeployCooldownRemaining = Math.max(0, this.player.turretDeployCooldownRemaining - deltaSeconds);

    for (const turret of this.turrets) {
      if (turret.dead || turret.ownerId !== this.player.id) {
        continue;
      }
      turret.range = Math.max(turret.range, this.player.turretRange);
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
      turret.aimAngle = angle;
      turret.muzzleFlash = 0.12;
      this.spawnPlayerProjectile(
        turret.x + Math.cos(angle) * 20,
        turret.y + Math.sin(angle) * 20,
        angle,
        this.player.projectileSpeed,
        Math.max(5, this.player.projectileRadius * 0.75),
        Math.max(0.45, this.player.projectileDamage * ENGINEER_TURRET.damageScale + this.player.turretDamageBonus),
        this.player.projectileLifetime,
        "turret",
        { remainingHits: 1 + this.player.turretPierce },
      );
      turret.fireCooldownRemaining = this.player.turretFireCooldown;
      this.run.shotsFired += 1;
      this.playSoundCue("turret-fire", turret.x, turret.y, { ownerId: this.player.id });
      this.spawnEffect(turret.x, turret.y, 16, "rgba(52, 211, 153, 0.75)", 0.14, "burst");
    }
    for (const turret of this.turrets) {
      if (!turret.dead) {
        turret.muzzleFlash = Math.max(0, (turret.muzzleFlash ?? 0) - deltaSeconds);
      }
    }
    if (
      this.mode === "playing" &&
      this.player.turretDeployCooldownRemaining <= 0 &&
      this.turrets.filter((turret) => !turret.dead && turret.ownerId === this.player.id).length < this.player.maxTurrets &&
      this.enemies.some((enemy) => !enemy.dead)
    ) {
      this.deployTurret();
      this.player.turretDeployCooldownRemaining = this.player.turretDeployCooldown;
    }
  }

  tryDeployTurret() {
    if (!this.player || this.mode !== "playing" || this.player.maxTurrets <= 0) {
      return false;
    }
    const activeTurrets = this.turrets.filter((turret) => !turret.dead && turret.ownerId === this.player.id).length;
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
      ownerId: this.player.id,
      x,
      y,
      radius: 18,
      life: this.player.turretLifetime,
      maxLife: this.player.turretLifetime,
      range: this.player.turretRange,
      fireCooldownRemaining: 0.1,
      aimAngle: -Math.PI / 2,
      muzzleFlash: 0,
      dead: false,
    });
    this.playSoundCue("turret-deploy", x, y, { ownerId: this.player.id });
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
      this.playSoundCue("boss-warning", this.player?.x ?? 0, this.player?.y ?? 0, { ownerId: "", intensity: 1.2 });
    }
    if (!activeBoss && this.run.elapsed >= this.nextBossTime) {
      const cycleIndex = Math.max(0, Math.round(this.nextBossTime / GAME_CONFIG.bossInterval) - 1);
      this.spawnBoss(cycleIndex);
      this.nextBossTime += GAME_CONFIG.bossInterval;
      this.warnedBossAt = null;
    }
  }

  updateSpawning(deltaSeconds) {
    const coopScale = this.getCoopEnemyScale();
    if (!this.run || this.enemies.length >= coopScale.maxEnemies) {
      return;
    }
    const activeBoss = this.enemies.some((enemy) => enemy.isBoss && !enemy.dead);
    if (activeBoss) {
      return;
    }
    const difficulty = getDifficultySnapshot(this.run.elapsed);
    this.spawnBudget += difficulty.spawnBudgetPerSecond * coopScale.spawnMultiplier * deltaSeconds;

    const candidates = getWeightedEnemyCandidates(difficulty.weights);
    if (!candidates.length) {
      return;
    }
    const minimumCost = Math.min(...candidates.map((definition) => definition.cost));
    while (this.spawnBudget >= minimumCost && this.enemies.length < coopScale.maxEnemies) {
      let definition = ENEMY_DEFS[this.spawnTargetType];
      if (!definition || (difficulty.weights[definition.id] ?? 0) <= 0) {
        const nonRunnerCandidates = candidates.filter((candidate) => candidate.id !== "nibbler");
        const preferredCandidates = this.spawnVarietyPity >= 2 && nonRunnerCandidates.length
          ? nonRunnerCandidates
          : candidates;
        const enemyType = weightedEnemyPick(difficulty.weights, preferredCandidates);
        definition = ENEMY_DEFS[enemyType];
        this.spawnTargetType = definition?.id ?? "";
      }
      if (!definition || definition.cost > this.spawnBudget + 0.001) {
        break;
      }
      this.spawnEnemy(definition.id, difficulty.statScale);
      this.spawnBudget -= definition.cost;
      this.spawnVarietyPity = definition.id === "nibbler" ? this.spawnVarietyPity + 1 : 0;
      this.spawnTargetType = "";
    }
  }

  updateEnemies(deltaSeconds) {
    if (!this.player || (this.isCoopRun() && this.getAlivePlayers().length === 0)) {
      return;
    }
    const localPlayer = this.getLocalPlayer();
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
      const targetPlayer = this.getClosestAlivePlayer(enemy.x, enemy.y);
      if (!targetPlayer) {
        continue;
      }
      this.player = targetPlayer;
      this.upgradeCounts = targetPlayer.upgradeCounts ?? this.upgradeCounts;
      if (enemy.isBoss) {
        this.updateBoss(enemy, deltaSeconds);
      } else if (enemy.typeId === "nibbler" || enemy.typeId === "sprinter") {
        this.updateNibbler(enemy);
      } else if (enemy.typeId === "spitter") {
        this.updateSpitter(enemy, deltaSeconds);
      } else if (enemy.typeId === "marksman") {
        this.updateMarksman(enemy, deltaSeconds);
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
      this.recycleFarEnemy(enemy, deltaSeconds);
    }
    this.player = localPlayer;
    this.upgradeCounts = localPlayer?.upgradeCounts ?? this.upgradeCounts;
  }

  recycleFarEnemy(enemy, deltaSeconds) {
    if (enemy.dead || enemy.isBoss || this.bossArena || !this.player) {
      return;
    }
    const view = this.getActiveSpawnRect(GAME_CONFIG.enemyRecycleMargin);
    const farFromCamera =
      enemy.x < view.x ||
      enemy.x > view.x + view.width ||
      enemy.y < view.y ||
      enemy.y > view.y + view.height;
    enemy.offscreenTime = farFromCamera ? (enemy.offscreenTime ?? 0) + deltaSeconds : 0;
    if (enemy.offscreenTime < GAME_CONFIG.enemyRecycleSeconds) {
      return;
    }
    const spawnPoint = this.getSpawnPoint(enemy.radius);
    enemy.x = spawnPoint.x;
    enemy.y = spawnPoint.y;
    enemy.vx = 0;
    enemy.vy = 0;
    enemy.offscreenTime = 0;
    if (Number.isFinite(enemy.attackCooldownBase)) {
      enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining ?? 0, Math.min(0.7, enemy.attackCooldownBase));
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

  updateMarksman(enemy, deltaSeconds) {
    const toPlayerX = this.player.x - enemy.x;
    const toPlayerY = this.player.y - enemy.y;
    const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
    const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
    const strafe = { x: -direction.y * enemy.orbitDirection, y: direction.x * enemy.orbitDirection };
    let moveX = strafe.x * enemy.speed * 0.28;
    let moveY = strafe.y * enemy.speed * 0.28;
    if (distance > enemy.preferredRange + 44) {
      moveX += direction.x * enemy.speed * 0.7;
      moveY += direction.y * enemy.speed * 0.7;
    } else if (distance < enemy.preferredRange - 68) {
      moveX -= direction.x * enemy.speed;
      moveY -= direction.y * enemy.speed;
    }
    enemy.vx = moveX;
    enemy.vy = moveY;
    enemy.attackCooldownRemaining -= deltaSeconds;
    if (enemy.attackCooldownRemaining <= 0 && distance < enemy.attackRange) {
      this.spawnEnemyProjectile(enemy, direction, enemy.projectileSpeed, 8, enemy.projectileDamage, 4.1, "#ede9fe", "#8b5cf6");
      enemy.attackCooldownRemaining = enemy.attackCooldownBase;
      this.spawnEffect(enemy.x, enemy.y, 20, "rgba(139, 92, 246, 0.72)", 0.16, "burst");
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
      this.spawnEnemyProjectile(enemy, direction, enemy.projectileSpeed, 8, enemy.projectileDamage, 2.7, "#ecfccb", "#84cc16", {
        acidZoneRadius: enemy.acidZoneRadius,
        acidZoneDamage: enemy.acidZoneDamage,
        acidZoneDuration: enemy.acidZoneDuration,
        kind: "acid-spit",
        trailScale: 6.2,
      });
      enemy.attackCooldownRemaining = enemy.attackCooldownBase;
      this.spawnEffect(enemy.x + direction.x * enemy.radius, enemy.y + direction.y * enemy.radius, 30, "rgba(163, 230, 53, 0.84)", 0.2, "burst");
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
      if (enemy.stateTimer <= 0) {
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
      if (enemy.stateTimer <= 0) {
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
      if (enemy.phaseTimer <= 0) {
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
      if (projectile.life <= 0) {
        projectile.dead = true;
      }
    };
    this.projectiles.forEach(advance);
    for (const projectile of this.enemyProjectiles) {
      const homingPlayer = this.getClosestAlivePlayer(projectile.x, projectile.y) ?? this.player;
      if (projectile.homingTimeRemaining > 0 && projectile.homingTarget === "player" && homingPlayer) {
        const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
        const currentAngle = Math.atan2(projectile.vy, projectile.vx);
        const targetAngle = Math.atan2(homingPlayer.y - projectile.y, homingPlayer.x - projectile.x);
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
      if (grenade.life <= 0) {
        this.explodeGrenade(grenade);
      }
    }
  }

  updateLandmines(deltaSeconds) {
    for (const mine of this.landmines) {
      if (mine.dead) {
        continue;
      }
      const wasArming = mine.armTimeRemaining > 0;
      mine.armTimeRemaining = Math.max(0, mine.armTimeRemaining - deltaSeconds);
      if (wasArming && mine.armTimeRemaining <= 0 && !mine.armedSoundPlayed) {
        mine.armedSoundPlayed = true;
        this.playSoundCue("mine-armed", mine.x, mine.y, { ownerId: mine.ownerId });
      }
      if (mine.armTimeRemaining > 0) {
        continue;
      }
      for (const enemy of this.enemies) {
        if (enemy.dead) {
          continue;
        }
        const triggerRadius = mine.triggerRadius + enemy.radius;
        if (distanceSquared(mine.x, mine.y, enemy.x, enemy.y) <= triggerRadius * triggerRadius) {
          this.explodeLandmine(mine);
          break;
        }
      }
    }
  }

  updatePickups(deltaSeconds) {
    if (!this.player) {
      return;
    }
    const candidates = this.getAlivePlayers();
    for (const pickup of this.pickups) {
      if (pickup.dead) {
        continue;
      }
      pickup.life -= deltaSeconds;
      if (pickup.life <= 0) {
        pickup.dead = true;
        continue;
      }
      const isMedkit = pickup.type === "medkit";
      let collector = candidates.find((player) => player.id === pickup.collectorId) ?? null;
      if (collector && isMedkit && collector.hp >= collector.maxHp) {
        collector = null;
      }
      let closestDistance = Infinity;
      if (!collector) {
        for (const player of candidates) {
          if (isMedkit && player.hp >= player.maxHp) {
            continue;
          }
          const distance = Math.hypot(player.x - pickup.x, player.y - pickup.y);
          if (distance < closestDistance) {
            closestDistance = distance;
            collector = player;
          }
        }
      }
      pickup.collectorId = collector?.id ?? "";
      if (!collector) {
        pickup.vx *= 0.92;
        pickup.vy *= 0.92;
        pickup.x += pickup.vx * deltaSeconds;
        pickup.y += pickup.vy * deltaSeconds;
        continue;
      }
      const toPlayerX = collector.x - pickup.x;
      const toPlayerY = collector.y - pickup.y;
      const distance = Math.max(1, Math.hypot(toPlayerX, toPlayerY));
      const collectRadius = pickup.radius + collector.radius + 3;
      if (distance <= collectRadius) {
        pickup.dead = true;
        if (isMedkit) {
          this.withPlayer(collector, () => this.collectMedkitPickup(pickup));
        } else {
          this.run.xp += pickup.value * collector.xpMultiplier;
          this.playSoundCue("pickup", pickup.x, pickup.y, { ownerId: collector.id, intensity: 0.85 });
          this.spawnFloatingText(pickup.x, pickup.y - 10, `+${Math.ceil(pickup.value * collector.xpMultiplier)} XP`, "#86efac", 0.55);
          this.spawnEffect(pickup.x, pickup.y, 18, "rgba(15, 118, 110, 0.75)", 0.22, "burst");
        }
        continue;
      }
      if (distance < collector.magnetRadius || distance < 36) {
        const pull = 1 - clamp(distance / collector.magnetRadius, 0, 1);
        const direction = { x: toPlayerX / distance, y: toPlayerY / distance };
        pickup.vx += direction.x * (360 + pull * 420) * deltaSeconds;
        pickup.vy += direction.y * (360 + pull * 420) * deltaSeconds;
      }
      const maxPickupSpeed = isMedkit ? 500 : 620;
      const pickupSpeed = Math.hypot(pickup.vx, pickup.vy);
      if (pickupSpeed > maxPickupSpeed) {
        pickup.vx = (pickup.vx / pickupSpeed) * maxPickupSpeed;
        pickup.vy = (pickup.vy / pickupSpeed) * maxPickupSpeed;
      }
      pickup.vx *= 0.88;
      pickup.vy *= 0.88;
      pickup.x += pickup.vx * deltaSeconds;
      pickup.y += pickup.vy * deltaSeconds;
      if (distanceSquared(pickup.x, pickup.y, collector.x, collector.y) <= collectRadius ** 2) {
        pickup.dead = true;
        if (isMedkit) {
          this.withPlayer(collector, () => this.collectMedkitPickup(pickup));
        } else {
          this.run.xp += pickup.value * collector.xpMultiplier;
          this.playSoundCue("pickup", pickup.x, pickup.y, { ownerId: collector.id, intensity: 0.85 });
          this.spawnFloatingText(pickup.x, pickup.y - 10, `+${Math.ceil(pickup.value * collector.xpMultiplier)} XP`, "#86efac", 0.55);
          this.spawnEffect(pickup.x, pickup.y, 18, "rgba(15, 118, 110, 0.75)", 0.22, "burst");
        }
      }
    }
  }

  collectMedkitPickup(pickup) {
    if (!this.player) {
      return;
    }
    const missingHp = Math.max(0, this.player.maxHp - this.player.hp);
    const healed = Math.min(missingHp, Math.max(0, pickup.value ?? MEDKIT_PICKUP.healAmount));
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + healed);
    if (healed > 0 && this.player.overhealShieldBonus > 0 && pickup.value > missingHp) {
      this.player.maxShields = Math.max(this.player.maxShields, this.player.overhealShieldBonus);
      this.player.shields = Math.min(this.player.maxShields, this.player.shields + this.player.overhealShieldBonus);
      this.spawnFloatingText(pickup.x, pickup.y - 30, `+${this.player.overhealShieldBonus} Shield`, "#86efac", 0.78);
    }
    this.playSoundCue("pickup", pickup.x, pickup.y, { ownerId: this.player.id });
    this.spawnFloatingText(pickup.x, pickup.y - 10, `+${healed} HP`, "#fecdd3", 0.78);
    this.spawnEffect(pickup.x, pickup.y, 24, "rgba(248, 113, 113, 0.78)", 0.24, "burst");
    this.updateHud();
  }

  updateDamageZones(deltaSeconds) {
    for (const zone of this.damageZones) {
      zone.life -= deltaSeconds;
      zone.tickRemaining -= deltaSeconds;
      if (zone.tickRemaining <= 0) {
        zone.tickRemaining = zone.tickInterval;
        if (zone.owner === "enemy") {
          for (const player of this.getAlivePlayers()) {
            if (distanceSquared(zone.x, zone.y, player.x, player.y) <= (zone.radius + player.radius) ** 2) {
              this.withPlayer(player, () => this.takePlayerDamage(zone.damage, zone.sourceEnemyTypeId ?? "", "acid-pool"));
            }
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
      for (const player of this.getAlivePlayers()) {
        const collisionRadius = projectile.radius + player.radius;
        if (distanceSquared(projectile.x, projectile.y, player.x, player.y) <= collisionRadius * collisionRadius) {
          projectile.dead = true;
          if (projectile.acidZoneRadius && !projectile.zoneSpawned) {
            this.spawnAcidZone(projectile.x, projectile.y, projectile.acidZoneRadius, projectile.acidZoneDamage, projectile.acidZoneDuration);
            projectile.zoneSpawned = true;
          }
          this.withPlayer(player, () => this.takePlayerDamage(projectile.damage, projectile.sourceEnemyTypeId, projectile.kind === "acid-spit" ? "acid-spit" : "projectile"));
          break;
        }
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
      for (const player of this.getAlivePlayers()) {
        const collisionRadius = enemy.radius + player.radius;
        if (distanceSquared(enemy.x, enemy.y, player.x, player.y) <= collisionRadius * collisionRadius) {
          const didDamage = this.withPlayer(player, () => this.takePlayerDamage(enemy.contactDamage, enemy.typeId, "contact"));
          if (didDamage) {
            const push = normalizeVector(player.x - enemy.x, player.y - enemy.y);
            enemy.x -= push.x * 12;
            enemy.y -= push.y * 12;
            player.x += push.x * 16;
            player.y += push.y * 16;
          }
        }
      }
    }
  }

  updateCoopRevives(deltaSeconds) {
    if (!this.isMultiplayerHost()) {
      return;
    }
    const downedPlayers = this.players.filter((player) => player.downed && !player.dead);
    if (!downedPlayers.length) {
      return;
    }
    const alivePlayers = this.getAlivePlayers();
    for (const downedPlayer of downedPlayers) {
      const reviver = alivePlayers.find((player) => {
        const keys = player.isLocal === false ? player.inputKeys : this.keys;
        return keys?.has("KeyF") && distanceSquared(player.x, player.y, downedPlayer.x, downedPlayer.y) <= COOP_CONFIG.reviveRadius ** 2;
      });
      if (!reviver) {
        downedPlayer.reviveProgress = Math.max(0, downedPlayer.reviveProgress - deltaSeconds * 0.75);
        continue;
      }
      downedPlayer.reviveProgress += deltaSeconds;
      this.spawnFloatingText(downedPlayer.x, downedPlayer.y - 48, "Reviving", "#bbf7d0", 0.18);
      if (downedPlayer.reviveProgress >= COOP_CONFIG.reviveSeconds) {
        downedPlayer.downed = false;
        downedPlayer.hp = Math.min(downedPlayer.maxHp, COOP_CONFIG.reviveHp);
        downedPlayer.invulnerabilityRemaining = 1.2;
        downedPlayer.reviveProgress = 0;
        this.spawnEffect(downedPlayer.x, downedPlayer.y, 48, "rgba(134, 239, 172, 0.72)", 0.32, "ring");
        this.spawnFloatingText(downedPlayer.x, downedPlayer.y - 54, "Revived", "#86efac", 0.9);
        this.playSoundCue("pickup", downedPlayer.x, downedPlayer.y, { ownerId: downedPlayer.id, intensity: 1.1 });
      }
    }
  }

  cleanupDeadEntities() {
    this.enemies = this.enemies.filter((enemy) => !enemy.dead);
    this.projectiles = this.projectiles.filter((projectile) => !projectile.dead);
    this.enemyProjectiles = this.enemyProjectiles.filter((projectile) => !projectile.dead);
    this.grenades = this.grenades.filter((grenade) => !grenade.dead);
    this.landmines = this.landmines.filter((mine) => !mine.dead);
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
        this.playSoundCue("hit", enemy.x, enemy.y, { ownerId: "", intensity: 0.65 });
      this.hitSoundCooldown = 0.05;
    }
    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    }
  }

  takePlayerDamage(amount, sourceEnemyTypeId = "", damageKind = "contact") {
    if (!this.player || this.player.invulnerabilityRemaining > 0 || this.mode !== "playing") {
      return false;
    }
    if (this.player.shields > 0) {
      this.player.shields -= 1;
      this.player.invulnerabilityRemaining = 0.28;
      this.screenShake = Math.max(this.screenShake, 6);
      this.spawnEffect(this.player.x, this.player.y, 32, "rgba(37, 99, 235, 0.75)", 0.3, "ring");
      this.playSoundCue("shield-block", this.player.x, this.player.y, { ownerId: this.player.id });
      return true;
    }
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.player.invulnerabilityRemaining = 0.75;
    this.run.damageTaken += amount;
    this.screenShake = Math.max(this.screenShake, 11);
    this.playSoundCue("player-damage", this.player.x, this.player.y, { ownerId: this.player.id });
    if (this.player.hp <= 0) {
      const deathCause = this.createDeathCause(sourceEnemyTypeId, damageKind, amount);
      this.player.deathCause = deathCause;
      this.recordEnemyDeath(sourceEnemyTypeId);
      if (this.isMultiplayerHost()) {
        this.player.downed = true;
        this.player.hp = 0;
        this.player.reviveProgress = 0;
        this.spawnFloatingText(this.player.x, this.player.y - 52, "Downed", "#fecdd3", 1);
        this.spawnEffect(this.player.x, this.player.y, 44, "rgba(248, 113, 113, 0.68)", 0.3, "ring");
        if (!this.getAlivePlayers().length) {
          this.run.deathCause = deathCause;
          this.endRun();
        }
      } else {
        this.run.deathCause = deathCause;
        this.endRun();
      }
    }
    return true;
  }

  createDeathCause(sourceEnemyTypeId = "", damageKind = "contact", amount = 0) {
    const sourceName = this.getEnemyDisplayName(sourceEnemyTypeId);
    const kindLabels = {
      contact: "Contact",
      projectile: "Projectile",
      "acid-spit": "Acid spit",
      "acid-pool": "Acid pool",
    };
    const damageLabel = kindLabels[damageKind] ?? "Hazard";
    const killerLabel = sourceName || "Unknown Hazard";
    return {
      sourceEnemyTypeId,
      sourceName: killerLabel,
      damageKind,
      damageLabel,
      amount: Math.max(0, Number(amount) || 0),
      label: `Killed by ${killerLabel} - ${damageLabel}`,
    };
  }

  getEnemyDisplayName(enemyTypeId) {
    if (enemyTypeId === BOSS_DEF.id) {
      return BOSS_DEF.name;
    }
    return ENEMY_DEFS[enemyTypeId]?.name ?? "";
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

  awardGold(baseAmount, x, y, label = "gold") {
    if (!this.run || baseAmount <= 0) {
      return 0;
    }
    const doubled = Math.random() < GOLD_CONFIG.doubleChance;
    const amount = Math.max(0, Math.floor(baseAmount * (doubled ? 2 : 1)));
    this.save = updateWallet(this.save, { gold: (this.save.wallet?.gold ?? 0) + amount });
    this.run.goldEarned = (this.run.goldEarned ?? 0) + amount;
    this.playSoundCue(doubled ? "double-gold" : "gold", x, y, { ownerId: "", intensity: doubled ? 1.15 : 0.95 });
    const text = doubled ? `DOUBLE GOLD +${amount}` : `+${amount} ${label}`;
    this.spawnFloatingText(x, y, text, doubled ? "#fde68a" : "#fbbf24", doubled ? 1.05 : 0.7);
    if (this.ui.goldCounter) {
      this.ui.goldCounter.classList.remove("gold-pop");
      void this.ui.goldCounter.offsetWidth;
      this.ui.goldCounter.classList.add("gold-pop");
    }
    this.renderSongShop();
    this.renderAdminPanel();
    this.updateHud();
    return amount;
  }

  getEnemyGoldValue(enemy) {
    if (enemy.isBoss) {
      return Math.max(0, Math.floor(enemy.goldValue ?? BOSS_DEF.goldValue ?? GOLD_CONFIG.bossKill));
    }
    return Math.max(0, Math.floor(enemy.goldValue ?? GOLD_CONFIG.enemyKills?.[enemy.typeId] ?? GOLD_CONFIG.normalKill));
  }

  maybeSpawnMedkit(enemy) {
    const chance = enemy.isBoss ? MEDKIT_PICKUP.bossDropChance : MEDKIT_PICKUP.normalDropChance;
    if (Math.random() >= chance) {
      return;
    }
    this.spawnMedkit(enemy.x, enemy.y);
  }

  endRun() {
    if (!this.run) {
      return;
    }
    const previousHighScore = this.save.highScore;
    const previousBest = { ...(this.save.stats?.best ?? {}) };
    const unlockedGrenade = !this.save.progress?.grenadeUnlocked && this.run.kills >= 250;
    const unlockedLandmine = !this.save.progress?.landmineUnlocked && this.run.elapsed >= 300;
    const unlockedKatana =
      !isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.katana) &&
      (this.save.stats?.total?.bosses ?? 0) + this.run.bossKills >= KATANA_UNLOCK_BOSSES;
    const unlockedEngineer =
      !isCharacterUnlocked(this.save.progress, this.save.stats, CHARACTER_IDS.engineer) &&
      (this.save.stats?.total?.kills ?? 0) + this.run.kills >= ENGINEER_UNLOCK_KILLS;
    this.mode = "gameOver";
    this.syncScreens();
    this.playSoundCue("death", this.player?.x ?? 0, this.player?.y ?? 0, { ownerId: this.player?.id ?? "" });
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
    } else if (unlockedLandmine) {
      this.ui.gameOverTitle.textContent = "Landmine unlocked!";
    } else {
      this.ui.gameOverTitle.textContent = "The wave overran you.";
    }
    this.ui.finalScore.textContent = Math.floor(this.run.score).toLocaleString();
    this.ui.finalTime.textContent = formatTime(this.run.elapsed);
    this.ui.finalKills.textContent = this.run.kills.toString();
    this.ui.finalBosses.textContent = this.run.bossKills.toString();
    this.updateDeathCauseCard(this.run.deathCause);
    this.lastCompletedRunResult = this.buildLeaderboardRunResult();
    this.onlineScoreSubmitted = false;
    this.buildRunHighlights(previousHighScore, previousBest, unlockedGrenade, unlockedLandmine, unlockedKatana, unlockedEngineer);
    this.updateScoreSubmitPanel();
    this.updateAbilityLobby();
    this.renderQuestMenu();
    this.renderCharacterMenu();
    this.announce(`Run over. Final score ${Math.floor(this.run.score)}.`);
  }

  updateDeathCauseCard(deathCause) {
    if (!this.ui.deathCauseCard || !this.ui.deathCauseText) {
      return;
    }
    if (!deathCause) {
      this.ui.deathCauseCard.hidden = true;
      this.ui.deathCauseText.textContent = "";
      return;
    }
    this.ui.deathCauseText.textContent = deathCause.label ?? "Killed by Unknown Hazard";
    this.ui.deathCauseCard.hidden = false;
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

  getLoadouts() {
    const loadouts = this.save.progress?.loadouts && typeof this.save.progress.loadouts === "object" ? this.save.progress.loadouts : {};
    return Object.fromEntries(
      Object.values(CHARACTER_IDS).map((characterId) => {
        const accessoryIds = Array.isArray(loadouts?.[characterId]?.accessoryIds) ? loadouts[characterId].accessoryIds : [];
        return [characterId, { accessoryIds: accessoryIds.filter((id) => ACCESSORY_DEFS.some((accessory) => accessory.id === id)).slice(0, 1) }];
      }),
    );
  }

  getSelectedAccessoryIds(characterId = this.getSelectedCharacter().id) {
    return this.getLoadouts()?.[characterId]?.accessoryIds ?? [];
  }

  isAccessoryUnlocked(accessoryId) {
    const accessory = ACCESSORY_DEFS.find((item) => item.id === accessoryId);
    return Boolean(accessory?.isUnlocked(this.save.progress));
  }

  getEquippedAbilityId() {
    const progress = this.save.progress ?? {};
    const selectedAccessoryIds = this.getSelectedAccessoryIds();
    for (const accessoryId of selectedAccessoryIds) {
      if (accessoryId === ABILITY_IDS.grenade && progress.grenadeUnlocked) {
        return ABILITY_IDS.grenade;
      }
      if (accessoryId === ABILITY_IDS.landmine && progress.landmineUnlocked) {
        return ABILITY_IDS.landmine;
      }
    }
    if (progress.equippedAbilityId === ABILITY_IDS.grenade && progress.grenadeUnlocked) {
      return ABILITY_IDS.grenade;
    }
    if (progress.equippedAbilityId === ABILITY_IDS.landmine && progress.landmineUnlocked) {
      return ABILITY_IDS.landmine;
    }
    return progress.grenadeEquipped && progress.grenadeUnlocked ? ABILITY_IDS.grenade : "";
  }

  getLoadoutSummary(characterId = this.getSelectedCharacter().id) {
    const character = getCharacterById(characterId);
    const accessoryNames = this.getSelectedAccessoryIds(characterId)
      .map((accessoryId) => ACCESSORY_DEFS.find((accessory) => accessory.id === accessoryId)?.name)
      .filter(Boolean);
    return {
      characterName: character.name,
      accessoryText: accessoryNames.length ? accessoryNames.join(", ") : "No accessories equipped",
    };
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
    this.updateAbilityLobby();
    this.renderCharacterMenu();
    this.renderQuestMenu();
    this.showToast(`${character.name} selected`);
    this.announce(`${character.name} selected.`);
  }

  getQuestRows() {
    const bestKills = Math.max(0, this.save.stats?.best?.kills ?? 0);
    const bestTime = Math.max(0, this.save.stats?.best?.time ?? 0);
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
        id: "landmine",
        title: "Demolition Trial",
        reward: "Landmine ability",
        progress: Math.min(300, Math.floor(bestTime)),
        requirement: 300,
        unlocked: Boolean(this.save.progress?.landmineUnlocked),
        description: "Survive for 5 minutes in a single run.",
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
    const quests = this.getQuestRows();
    const getQuestState = (quest) => {
      if (quest.unlocked) {
        return "completed";
      }
      return quest.progress > 0 ? "active" : "locked";
    };
    const getQuestStatusLabel = (state) => {
      if (state === "completed") {
        return "Done";
      }
      return state === "active" ? "Active" : "Locked";
    };
    const groups = [
      { title: "Active Quests", state: "active", quests: quests.filter((quest) => getQuestState(quest) === "active") },
      { title: "Completed", state: "completed", quests: quests.filter((quest) => getQuestState(quest) === "completed") },
      { title: "Locked", state: "locked", quests: quests.filter((quest) => getQuestState(quest) === "locked") },
    ];
    const nodes = groups
      .filter((group) => group.quests.length)
      .map((group) => {
        const section = document.createElement("section");
        section.className = `quest-section quest-section-${group.state}`;
        const heading = document.createElement("div");
        heading.className = "quest-section-heading";
        heading.innerHTML = `<strong>${group.title}</strong><span>${group.quests.length}</span>`;
        const cards = document.createElement("div");
        cards.className = "quest-card-grid";
        const rows = group.quests.map((quest) => {
          const state = getQuestState(quest);
          const row = document.createElement("article");
          row.className = `quest-row quest-${state}${quest.unlocked ? " unlocked" : ""}`;
          const progressPercent = clamp(quest.progress / quest.requirement, 0, 1) * 100;
          const body = document.createElement("div");
          body.className = "quest-card-body";
          body.innerHTML = `
            <div class="quest-card-title">
              <strong>${quest.title}</strong>
              <span class="quest-badge quest-badge-${state}">${getQuestStatusLabel(state)}</span>
            </div>
            <span>${quest.reward}</span>
            <p>${quest.description}</p>
            <div class="quest-progress-label"><span>${quest.unlocked ? "Unlocked" : `${quest.progress}/${quest.requirement}`}</span><span>${Math.round(progressPercent)}%</span></div>
            <div class="quest-progress" aria-hidden="true"><span style="width: ${progressPercent}%"></span></div>
          `;
          row.replaceChildren(body);
          return row;
        });
        cards.replaceChildren(...rows);
        section.replaceChildren(heading, cards);
        return section;
      });
    this.ui.questList.replaceChildren(...nodes);
  }

  renderCharacterMenu() {
    if (!this.ui.characterList) {
      return;
    }
    const selectedId = this.getSelectedCharacter().id;
    const previousSectionOpen = {
      characters: this.ui.characterList.querySelector('[data-inventory-section="characters"]')?.open ?? true,
      accessories: this.ui.characterList.querySelector('[data-inventory-section="accessories"]')?.open ?? true,
    };
    const characterRows = Object.values(CHARACTER_DEFS).map((character) => {
      const unlocked = isCharacterUnlocked(this.save.progress, this.save.stats, character.id);
      const selected = selectedId === character.id;
      const card = document.createElement("div");
      card.className = `character-row${selected ? " selected" : ""}${unlocked ? "" : " locked"}`;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-disabled", !unlocked || selected ? "true" : "false");
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
      button.disabled = selected || !unlocked;
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
    const accessoryRows = ACCESSORY_DEFS.map((accessory) => {
      const unlocked = accessory.isUnlocked(this.save.progress);
      const equipped = this.getSelectedAccessoryIds(selectedId).includes(accessory.id);
      const row = document.createElement("div");
      row.className = `accessory-row${equipped ? " selected" : ""}${unlocked ? "" : " locked"}`;
      const body = document.createElement("div");
      body.innerHTML = `
        <strong>${accessory.name}</strong>
        <span>${accessory.slot} - ${unlocked ? "Unlocked" : accessory.lockedText}</span>
        <p>${accessory.description}</p>
      `;
      const button = document.createElement("button");
      button.type = "button";
      button.className = equipped ? "ghost-button" : "primary-button";
      button.textContent = equipped ? "Equipped" : unlocked ? "Equip" : "Locked";
      button.disabled = !unlocked;
      button.setAttribute("aria-pressed", equipped ? "true" : "false");
      button.addEventListener("click", () => this.toggleAbilityEquip(accessory.id));
      row.replaceChildren(body, button);
      return row;
    });

    const charactersSection = document.createElement("details");
    charactersSection.className = "inventory-section";
    charactersSection.dataset.inventorySection = "characters";
    charactersSection.open = previousSectionOpen.characters;
    const charactersSummary = document.createElement("summary");
    charactersSummary.setAttribute("aria-expanded", charactersSection.open ? "true" : "false");
    charactersSummary.innerHTML = `<span>Characters</span><strong>${this.getSelectedCharacter().name}</strong>`;
    charactersSection.addEventListener("toggle", () => {
      charactersSummary.setAttribute("aria-expanded", charactersSection.open ? "true" : "false");
    });
    const characterList = document.createElement("div");
    characterList.className = "inventory-grid character-list-inner";
    characterList.replaceChildren(...characterRows);
    charactersSection.replaceChildren(charactersSummary, characterList);

    const accessoriesSection = document.createElement("details");
    accessoriesSection.className = "inventory-section";
    accessoriesSection.dataset.inventorySection = "accessories";
    accessoriesSection.open = previousSectionOpen.accessories;
    const accessoriesSummary = document.createElement("summary");
    accessoriesSummary.setAttribute("aria-expanded", accessoriesSection.open ? "true" : "false");
    accessoriesSummary.innerHTML = `<span>Accessories</span><strong>${this.getLoadoutSummary(selectedId).accessoryText}</strong>`;
    accessoriesSection.addEventListener("toggle", () => {
      accessoriesSummary.setAttribute("aria-expanded", accessoriesSection.open ? "true" : "false");
    });
    const accessoryList = document.createElement("div");
    accessoryList.className = "inventory-grid accessory-list";
    accessoryList.replaceChildren(...accessoryRows);
    accessoriesSection.replaceChildren(accessoriesSummary, accessoryList);

    this.ui.characterList.replaceChildren(charactersSection, accessoriesSection);
  }

  getSelectedSong() {
    const catalog = this.getSongCatalog();
    return catalog.find((song) => song.id === this.save.music?.selectedSongId) ?? null;
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
    const gold = Math.max(0, this.save.wallet?.gold ?? 0);
    this.ui.shopGold.textContent = formatWholeNumber(gold);
    const wallet = this.ui.shopGold.closest?.(".shop-wallet");
    if (wallet && this.lastRenderedShopGold !== null && this.lastRenderedShopGold !== gold) {
      wallet.classList.remove("shop-wallet-pop");
      void wallet.offsetWidth;
      wallet.classList.add("shop-wallet-pop");
    }
    this.lastRenderedShopGold = gold;
    const selectedSongId = this.save.music?.selectedSongId;
    const catalog = this.getSongCatalog();
    if (!catalog.length) {
      const empty = document.createElement("div");
      empty.className = "song-row song-empty-row";
      empty.innerHTML = `<div><strong>No songs installed</strong><span>Default songs were removed. Admins can add custom music here.</span></div>`;
      this.ui.songShopList.replaceChildren(empty);
      return;
    }
    const nodes = catalog.map((song) => {
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
      this.ui.adminResetAbilityButton,
      this.ui.adminClearEnemiesButton,
      this.ui.adminClearProjectilesButton,
      this.ui.adminSpawnBossButton,
      this.ui.adminSpawnEnemyButton,
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

  adminGrantSaveGold(amount = 1000) {
    if (!this.adminUnlocked) {
      return;
    }
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    this.save = updateWallet(this.save, { gold: (this.save.wallet?.gold ?? 0) + safeAmount });
    this.renderSongShop();
    this.renderAdminPanel();
    this.updateHud();
    this.showToast(`Added ${safeAmount} gold`);
  }

  adminGrantXp(amount = 120) {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    this.run.xp += safeAmount;
    this.spawnFloatingText(this.player.x, this.player.y - 68, `+${safeAmount} XP`, "#86efac", 0.9);
    this.showToast("Admin XP granted");
  }

  adminResetAbilityCooldown() {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    this.player.grenadeCooldownRemaining = 0;
    this.player.landmineCooldownRemaining = 0;
    this.player.turretDeployCooldownRemaining = 0;
    this.spawnFloatingText(this.player.x, this.player.y - 58, "Cooldowns ready", "#fef08a", 0.86);
    this.updateHud();
  }

  adminUnlockAllAbilities() {
    if (!this.adminUnlocked) {
      return;
    }
    this.save = updateProgress(this.save, {
      grenadeUnlocked: true,
      landmineUnlocked: true,
      equippedAbilityId: this.getEquippedAbilityId(),
    });
    this.updateAbilityLobby();
    this.renderCharacterMenu();
    this.renderQuestMenu();
    this.renderAdminPanel();
    this.showToast("All abilities unlocked");
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
    if (this.run.level % HEAL_OFFER_CONFIG.interval === 0) {
      this.pendingHealOfferLevels.push(this.run.level);
    }
    this.flashLevelUp();
    this.showNextLevelReward();
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

  adminClearProjectiles() {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    const cleared = this.projectiles.length + this.enemyProjectiles.length + this.grenades.length + this.landmines.length + this.damageZones.length;
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.grenades = [];
    this.landmines = [];
    this.damageZones = [];
    this.showToast(cleared ? `Cleared ${cleared} hazards` : "No hazards to clear");
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

  adminSpawnEnemy(typeId = "nibbler") {
    if (!this.canUseRunAdminTools()) {
      return;
    }
    if (!ENEMY_DEFS[typeId]) {
      this.showToast("Unknown enemy");
      return;
    }
    const difficulty = getDifficultySnapshot(this.run.elapsed);
    this.spawnEnemy(typeId, difficulty.statScale);
    this.showToast(`${ENEMY_DEFS[typeId].name} spawned`);
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
    if (!this.adminUnlocked) {
      return;
    }
    const ownedSongIds = (this.save.music?.ownedSongIds ?? []).filter((id) => id !== songId);
    const selectedSongId = this.save.music?.selectedSongId === songId ? "" : this.save.music?.selectedSongId;
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
    const selectedSongId = this.save.music?.selectedSongId === songId ? "" : this.save.music?.selectedSongId;
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
    const selectedSongId = customSongIds.has(this.save.music?.selectedSongId) ? "" : this.save.music?.selectedSongId;
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
    if (this.ui.adminUnlockAbilitiesButton) {
      const allAbilitiesUnlocked = Boolean(this.save.progress?.grenadeUnlocked && this.save.progress?.landmineUnlocked);
      this.ui.adminUnlockAbilitiesButton.textContent = allAbilitiesUnlocked ? "All Abilities Unlocked" : "Unlock All Abilities";
      this.ui.adminUnlockAbilitiesButton.disabled = allAbilitiesUnlocked;
    }
    if (this.ui.adminSpawnEnemySelect && !this.ui.adminSpawnEnemySelect.options.length) {
      const options = Object.values(ENEMY_DEFS).map((enemy) => {
        const option = document.createElement("option");
        option.value = enemy.id;
        option.textContent = enemy.name;
        return option;
      });
      this.ui.adminSpawnEnemySelect.replaceChildren(...options);
    }
    if (!this.ui.adminSongList) {
      return;
    }
    const catalog = this.getSongCatalog();
    if (!catalog.length) {
      const empty = document.createElement("div");
      empty.className = "song-row song-empty-row";
      empty.innerHTML = `<div><strong>No songs installed</strong><span>Add a custom song to make it available in the shop.</span></div>`;
      this.ui.adminSongList.replaceChildren(empty);
      return;
    }
    const nodes = catalog.map((song) => {
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
      if (this.isSongOwned(song.id)) {
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

  buildRunHighlights(previousHighScore, previousBest, unlockedGrenade, unlockedLandmine, unlockedKatana, unlockedEngineer) {
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
    if (unlockedLandmine) {
      highlights.unshift({ title: "Landmine unlocked", value: "Quest complete" });
    } else if (!this.save.progress?.landmineUnlocked) {
      highlights.push({ title: "Landmine quest", value: `${formatTime(Math.min(300, Math.max(this.run.elapsed, previousBest.time ?? 0)))}/05:00` });
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

  buildLeaderboardRunResult() {
    if (!this.run || !this.player) {
      return null;
    }
    return {
      mode: this.isCoopRun() ? "coop" : "solo",
      name: this.isCoopRun()
        ? this.players.map((player) => player.name || getCharacterById(player.characterId).name).join(" + ").slice(0, 40)
        : undefined,
      players: this.isCoopRun()
        ? this.players.map((player) => ({
            name: player.name || "Player",
            character: player.characterId || CHARACTER_IDS.gunner,
          }))
        : undefined,
      score: Math.floor(Math.max(0, this.run.score)),
      time: Math.max(0, this.run.elapsed),
      kills: Math.floor(Math.max(0, this.run.kills)),
      bosses: Math.floor(Math.max(0, this.run.bossKills)),
      level: Math.floor(Math.max(1, this.run.level)),
      character: this.player.characterId || CHARACTER_IDS.gunner,
      deathCause: this.run.deathCause ? { ...this.run.deathCause } : null,
    };
  }

  getLastCompletedRunResult() {
    return this.lastCompletedRunResult ? { ...this.lastCompletedRunResult } : null;
  }

  setOnlineLeaderboardEnabled(enabled) {
    this.onlineLeaderboardEnabled = Boolean(enabled);
    this.updateScoreSubmitPanel();
  }

  updateScoreSubmitPanel() {
    if (!this.ui.scoreSubmitPanel) {
      return;
    }
    const hasCompletedRun = Boolean(this.mode === "gameOver" && this.lastCompletedRunResult);
    this.ui.scoreSubmitPanel.hidden = !hasCompletedRun;
    if (!hasCompletedRun) {
      return;
    }

    const submittedOnline = this.scoreSubmitState === "submitted-online" || this.onlineScoreSubmitted;
    const retryAvailable = this.scoreSubmitState === "saved-local-retry";
    const canSubmit = !submittedOnline;
    if (this.ui.leaderboardNameInput) {
      this.ui.leaderboardNameInput.disabled = !canSubmit;
    }
    if (this.ui.submitScoreButton) {
      this.ui.submitScoreButton.disabled = !canSubmit;
      this.ui.submitScoreButton.textContent = submittedOnline ? "Submitted" : retryAvailable ? "Retry Online" : "Submit Score";
    }
    if (this.ui.scoreSubmitStatus) {
      if (submittedOnline) {
        this.ui.scoreSubmitStatus.textContent = "Score submitted online.";
      } else if (retryAvailable) {
        this.ui.scoreSubmitStatus.textContent = "Saved locally. Retry online when available.";
      } else {
        this.ui.scoreSubmitStatus.textContent = this.onlineLeaderboardEnabled
          ? "Enter a name to submit this run online."
          : "Online leaderboard is not configured. Submit saves locally.";
      }
    }
  }

  setScoreSubmitStatus(text) {
    if (this.ui.scoreSubmitStatus) {
      this.ui.scoreSubmitStatus.textContent = text;
    }
  }

  setScoreSubmitLoading(loading) {
    const canSubmit = Boolean(this.lastCompletedRunResult && this.scoreSubmitState !== "submitted-online" && !this.onlineScoreSubmitted);
    if (this.ui.leaderboardNameInput) {
      this.ui.leaderboardNameInput.disabled = loading || !canSubmit;
    }
    if (this.ui.submitScoreButton) {
      this.ui.submitScoreButton.disabled = loading || !canSubmit;
      this.ui.submitScoreButton.textContent = loading
        ? "Submitting..."
        : this.scoreSubmitState === "submitted-online" || this.onlineScoreSubmitted
          ? "Submitted"
          : this.scoreSubmitState === "saved-local-retry"
            ? "Retry Online"
            : "Submit Score";
    }
  }

  markScoreSubmitted() {
    this.onlineScoreSubmitted = true;
    this.scoreSubmitState = "submitted-online";
    this.updateScoreSubmitPanel();
  }

  markScoreSavedLocally() {
    this.onlineScoreSubmitted = false;
    this.scoreSubmitState = "saved-local-retry";
    this.updateScoreSubmitPanel();
  }

  handleCoopPeerLeft(playerId) {
    if (!this.isMultiplayerHost()) {
      return;
    }
    const peer = this.players.find((player) => player.id === playerId);
    if (peer) {
      peer.downed = true;
      peer.dead = true;
      peer.hp = 0;
    }
    this.coopUpgradeDraft?.pending?.delete(playerId);
    if (this.coopUpgradeDraft && this.coopUpgradeDraft.pending.size <= 0) {
      this.finishCoopUpgradeDraft();
    }
    if (this.mode === "playing") {
      this.pause("Teammate disconnected. Continuing solo shortly.");
    }
    window.setTimeout(() => {
      if (this.isMultiplayerHost() && this.mode === "paused") {
        this.players = this.players.filter((player) => player.id !== playerId);
        this.player = this.getLocalPlayer();
        this.resume();
      }
    }, COOP_CONFIG.disconnectGraceSeconds * 1000);
  }

  setLeaderboardStatus(text) {
    if (this.ui.leaderboardStatus) {
      this.ui.leaderboardStatus.textContent = text;
    }
  }

  renderLeaderboardEntries(entries = []) {
    if (!this.ui.leaderboardList) {
      return;
    }

    const safeEntries = Array.isArray(entries) ? entries : [];
    if (!safeEntries.length) {
      const empty = document.createElement("div");
      empty.className = "leaderboard-empty";
      empty.textContent = "No online scores yet.";
      this.ui.leaderboardList.replaceChildren(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "leaderboard-row header-row";
    for (const label of ["#", "Name", "Score", "Time", "Kills", "Bosses", "Character"]) {
      const cell = document.createElement("span");
      cell.textContent = label;
      header.append(cell);
    }

    const rows = safeEntries.slice(0, 20).map((entry, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";
      const rank = document.createElement("strong");
      rank.textContent = `#${index + 1}`;
      const name = document.createElement("strong");
      name.textContent = String(entry.name ?? "Player").slice(0, 40);
      const score = document.createElement("span");
      score.textContent = formatWholeNumber(Math.max(0, Number(entry.score) || 0));
      const time = document.createElement("span");
      time.textContent = formatTime(Math.max(0, Number(entry.time) || 0));
      const kills = document.createElement("span");
      kills.textContent = formatWholeNumber(Math.max(0, Number(entry.kills) || 0));
      const bosses = document.createElement("span");
      bosses.textContent = formatWholeNumber(Math.max(0, Number(entry.bosses) || 0));
      const character = document.createElement("span");
      character.textContent = Array.isArray(entry.players) && entry.players.length
        ? entry.players.map((player) => getCharacterById(player.character).name).join(" + ")
        : getCharacterById(entry.character).name;
      row.replaceChildren(rank, name, score, time, kills, bosses, character);
      return row;
    });

    this.ui.leaderboardList.replaceChildren(header, ...rows);
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
    this.screenShake = Math.max(this.screenShake, 4);
    this.playSoundCue("dash", this.player.x, this.player.y, { ownerId: this.player.id });
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
    const target = closestEnemy ?? this.player.pointer ?? this.pointer;
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
        ownerId: this.player.id,
        source: "weapon",
        dead: false,
      });
    }
    this.player.fireCooldownRemaining = this.player.fireCooldown;
    this.run.shotsFired += shotCount;
    this.playSoundCue("shoot", this.player.x, this.player.y, { ownerId: this.player.id });
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
    this.playSoundCue("slash", this.player.x, this.player.y, { ownerId: this.player.id });
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
      this.player.equippedAbilityId !== ABILITY_IDS.grenade ||
      this.player.grenadeCooldownRemaining > 0
    ) {
      return;
    }
    const direction = this.getAimDirection();
    const spawnX = this.player.x + direction.x * (this.player.radius + 16);
    const spawnY = this.player.y + direction.y * (this.player.radius + 16);
    this.grenades.push({
      id: this.grenadeId += 1,
      ownerId: this.player.id,
      x: spawnX,
      y: spawnY,
      vx: direction.x * this.player.grenadeProjectileSpeed,
      vy: direction.y * this.player.grenadeProjectileSpeed,
      radius: 13,
      blastRadius: this.player.grenadeRadius,
      damage: this.player.grenadeDamage,
      life: this.player.grenadeFuse,
      zoneDuration: this.player.grenadeZoneDuration,
      zoneDamage: this.player.grenadeZoneDamage,
      dead: false,
    });
    this.player.grenadeCooldownRemaining = this.player.grenadeCooldown;
    this.screenShake = Math.max(this.screenShake, 4);
    this.playSoundCue("grenade-throw", spawnX, spawnY, { ownerId: this.player.id });
    if (Math.random() < 0.1) {
      this.playSoundCue("special-grenade", spawnX, spawnY, { ownerId: this.player.id, intensity: 1.45 });
    }
    this.spawnEffect(spawnX, spawnY, 18, "rgba(249, 115, 22, 0.86)", 0.16, "burst");
  }

  tryAbility() {
    if (!this.player || this.mode !== "playing") {
      return;
    }
    if (this.player.equippedAbilityId === ABILITY_IDS.grenade) {
      this.tryGrenade();
    } else if (this.player.equippedAbilityId === ABILITY_IDS.landmine) {
      this.tryLandmine();
    } else {
      this.showToast("No ability equipped");
    }
  }

  tryLandmine() {
    if (
      !this.player ||
      !this.run ||
      this.mode !== "playing" ||
      this.player.equippedAbilityId !== ABILITY_IDS.landmine ||
      this.player.landmineCooldownRemaining > 0
    ) {
      return;
    }
    const activeMines = this.landmines.filter((mine) => !mine.dead && mine.ownerId === this.player.id).length;
    if (activeMines >= this.player.maxLandmines) {
      this.showToast("Mine limit reached");
      return;
    }
    this.landmines.push({
      id: this.landmineId += 1,
      ownerId: this.player.id,
      x: this.player.x,
      y: this.player.y,
      radius: 12,
      triggerRadius: this.player.landmineTriggerRadius,
      blastRadius: this.player.landmineRadius,
      damage: this.player.landmineDamage,
      armTimeRemaining: this.player.landmineArmTime,
      maxArmTime: this.player.landmineArmTime,
      clusterFragments: this.player.landmineClusterFragments,
      armedSoundPlayed: false,
      dead: false,
    });
    this.player.landmineCooldownRemaining = this.player.landmineCooldown;
    this.screenShake = Math.max(this.screenShake, 3);
    this.playSoundCue("mine-place", this.player.x, this.player.y, { ownerId: this.player.id });
    this.spawnEffect(this.player.x, this.player.y, 24, "rgba(245, 158, 11, 0.72)", 0.22, "ring");
    this.spawnFloatingText(this.player.x, this.player.y - 26, "Mine armed", "#fef08a", 0.74);
  }

  explodeGrenade(grenade) {
    if (grenade.dead) {
      return;
    }
    grenade.dead = true;
    this.screenShake = Math.max(this.screenShake, 13);
    this.playSoundCue("explosion", grenade.x, grenade.y, { ownerId: grenade.ownerId, power: 1, intensity: 1.15 });
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
    if (grenade.zoneDuration > 0) {
      this.damageZones.push({
        owner: "player",
        ownerId: grenade.ownerId,
        x: grenade.x,
        y: grenade.y,
        radius: grenade.blastRadius * 0.72,
        damage: grenade.zoneDamage,
        life: grenade.zoneDuration,
        maxLife: grenade.zoneDuration,
        tickInterval: 0.45,
        tickRemaining: 0.08,
      });
      this.spawnFloatingText(grenade.x, grenade.y - grenade.blastRadius * 0.45, "Burn zone", "#fb7185", 0.85);
    }
  }

  explodeLandmine(mine) {
    if (mine.dead) {
      return;
    }
    mine.dead = true;
    this.screenShake = Math.max(this.screenShake, 14);
    this.playSoundCue("mine-explosion", mine.x, mine.y, { ownerId: mine.ownerId, intensity: 1.15 });
    this.spawnEffect(mine.x, mine.y, mine.blastRadius, "rgba(245, 158, 11, 0.62)", 0.34, "ring");
    this.spawnEffect(mine.x, mine.y, mine.blastRadius * 0.42, "rgba(250, 204, 21, 0.76)", 0.24, "burst");
    for (const enemy of this.enemies) {
      if (enemy.dead) {
        continue;
      }
      const hitRadius = mine.blastRadius + enemy.radius;
      if (distanceSquared(mine.x, mine.y, enemy.x, enemy.y) <= hitRadius * hitRadius) {
        this.damageEnemy(enemy, mine.damage, "landmine");
      }
    }
    if (mine.clusterFragments > 0) {
      const fragments = Math.min(8, mine.clusterFragments);
      for (let index = 0; index < fragments; index += 1) {
        const angle = (Math.PI * 2 * index) / fragments + this.backgroundTime;
        this.spawnPlayerProjectile(mine.x, mine.y, angle, 520, 5, Math.max(1.2, mine.damage * 0.18), 0.62, "mine-fragment", {
          remainingHits: 2,
        });
      }
      this.spawnFloatingText(mine.x, mine.y - mine.blastRadius * 0.38, "Cluster charge", "#fde68a", 0.85);
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
    this.spawnEffect(x, y, radius * 1.12, "rgba(190, 242, 100, 0.68)", 0.38, "ring");
    this.spawnEffect(x, y, radius * 0.46, "rgba(217, 249, 157, 0.58)", 0.24, "burst");
  }

  spawnEnemyProjectile(owner, direction, speed, radius, damage, life, color, accent, options = {}) {
    if (!owner.isBoss) {
      this.playSoundCue("enemy-shoot", owner.x, owner.y, { ownerId: "", intensity: 0.8 });
    }
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
      kind: options.kind ?? "",
      trailScale: options.trailScale ?? 3.4,
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

  spawnPlayerProjectile(x, y, angle, speed, radius, damage, life, source = "weapon-fragment", options = {}) {
    this.projectiles.push({
      id: this.projectileId += 1,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      damage,
      life,
      remainingHits: options.remainingHits ?? 1,
      hitIds: new Set(),
      color: "#ecfeff",
      accent: "#22d3ee",
      owner: "player",
      ownerId: this.player?.id ?? "solo",
      source,
      dead: false,
    });
  }

  spawnEnemy(typeId, statScale, position = null, options = {}) {
    const definition = ENEMY_DEFS[typeId];
    if (!definition) {
      return;
    }
    const coopScale = options.noCoopScale ? { enemyHp: 1, enemyDamage: 1 } : this.getCoopEnemyScale();
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
      hp: Math.round(definition.maxHp * statScale * coopScale.enemyHp),
      maxHp: Math.round(definition.maxHp * statScale * coopScale.enemyHp),
      speed: definition.speed * (1 + (statScale - 1) * 0.38),
      contactDamage: Math.max(1, Math.round(definition.contactDamage * (0.9 + (statScale - 1) * 0.5) * coopScale.enemyDamage)),
      xpValue: definition.xpValue,
      scoreValue: definition.scoreValue,
      color: definition.color,
      accent: definition.accent,
      hitFlash: 0,
      squish: 0,
      offscreenTime: 0,
      noDrops: Boolean(options.noDrops),
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
    if (typeId === "marksman") {
      enemy.preferredRange = 360;
      enemy.attackRange = 560;
      enemy.attackCooldownBase = Math.max(1.45, 2.65 - (statScale - 1) * 0.32);
      enemy.attackCooldownRemaining = randomRange(0.55, enemy.attackCooldownBase);
      enemy.projectileSpeed = 390 + (statScale - 1) * 44;
      enemy.projectileDamage = 1;
      enemy.orbitDirection = Math.random() < 0.5 ? -1 : 1;
    }
    if (typeId === "acid-spitter") {
      enemy.preferredRange = 300;
      enemy.attackRange = 460;
      enemy.attackCooldownBase = Math.max(1.55, 2.75 - (statScale - 1) * 0.32);
      enemy.attackCooldownRemaining = randomRange(0.45, enemy.attackCooldownBase);
      enemy.projectileSpeed = 360 + (statScale - 1) * 42;
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
    const coopScale = this.getCoopEnemyScale();
    const position = this.getSpawnPoint(BOSS_DEF.radius + 12);
    const boss = {
      id: this.enemyId += 1,
      typeId: BOSS_DEF.id,
      isBoss: true,
      x: position.x,
      y: position.y,
      vx: 0,
      vy: 0,
      radius: BOSS_DEF.radius,
      hp: Math.round(BOSS_DEF.maxHp * scale.hpMultiplier * coopScale.bossHp),
      maxHp: Math.round(BOSS_DEF.maxHp * scale.hpMultiplier * coopScale.bossHp),
      speed: BOSS_DEF.speed + cycleIndex * 6,
      contactDamage: Math.max(1, Math.round(BOSS_DEF.contactDamage * scale.damageMultiplier * coopScale.enemyDamage)),
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
    };
    this.enemies.push(boss);
    this.createBossArenaFor(boss);
    this.setBanner(`Heavy unit ${cycleIndex + 1}.`, 2.4);
    this.playSoundCue("boss-spawn", boss.x, boss.y, { ownerId: "", intensity: 1.25 });
  }

  fireBossChargeShots(boss) {
    this.playSoundCue("boss-attack", boss.x, boss.y, { ownerId: "", kind: "charge", intensity: 1.1 });
    const baseAngle = Math.atan2(boss.chargeDirection.y, boss.chargeDirection.x);
    const shotCount = Math.min(6, 4 + Math.floor(boss.cycleIndex / 2));
    const spread = shotCount >= 6 ? 0.84 : 0.54;
    const centerOffset = (shotCount - 1) * 0.5;
    for (let shotIndex = 0; shotIndex < shotCount; shotIndex += 1) {
      const offset = (shotIndex - centerOffset) * (spread / Math.max(1, shotCount - 1));
      const angle = baseAngle + offset;
      this.spawnEnemyProjectile(
        boss,
        { x: Math.cos(angle), y: Math.sin(angle) },
        330 + boss.cycleIndex * 12,
        12,
        Math.max(1, Math.round(1 + boss.cycleIndex * 0.15)),
        4.2,
        "#fef3c7",
        "#f59e0b",
        {
          homingTurnRate: 1.75 + boss.cycleIndex * 0.08,
          homingTimeRemaining: 2.15,
          homingTarget: "player",
        },
      );
    }
  }

  fireBossVolley(boss) {
    this.playSoundCue("boss-attack", boss.x, boss.y, { ownerId: "", kind: "volley", intensity: 1.05 });
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
    this.playSoundCue("boss-attack", boss.x, boss.y, { ownerId: "", kind: "burst", intensity: 1.12 });
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
    this.playSoundCue("boss-attack", boss.x, boss.y, { ownerId: "", kind: "summon", intensity: 1.1 });
    this.spawnEffect(boss.x, boss.y, boss.radius + 70, boss.accent, 0.3, "ring");
    for (let index = 0; index < 3; index += 1) {
      const angle = (Math.PI * 2 * index) / 3 + this.backgroundTime;
      const position = {
        x: boss.x + Math.cos(angle) * 112,
        y: boss.y + Math.sin(angle) * 112,
      };
      this.spawnEnemy("sentinel", 1 + boss.cycleIndex * 0.12, position, { noDrops: true });
      this.spawnEffect(position.x, position.y, 30, "rgba(20, 184, 166, 0.72)", 0.24, "burst");
    }
    this.spawnFloatingText(boss.x, boss.y - boss.radius - 20, "Sentinels deployed", "#5eead4", 0.9);
  }

  killEnemy(enemy) {
    if (enemy.dead || !this.run) {
      return;
    }
    enemy.dead = true;
    const noRewards = Boolean(enemy.noDrops);
    this.recordEnemyKill(enemy.typeId);
    this.spawnEffect(enemy.x, enemy.y, enemy.radius * 1.2, enemy.accent, 0.3, "burst");
    this.spawnEffect(enemy.x, enemy.y, enemy.radius * 1.15, "rgba(236, 254, 255, 0.82)", 0.28, "ring");
    if (!noRewards) {
      this.spawnFloatingText(enemy.x, enemy.y - enemy.radius, enemy.isBoss ? "BOSS DOWN" : `+${Math.round(enemy.scoreValue * SCORE_CONFIG.killUnit)}`, enemy.isBoss ? "#fef08a" : "#e0f2fe", enemy.isBoss ? 1.2 : 0.68);
    }
    if (!noRewards && ["grenade", "landmine", "mine-fragment", "zone"].includes(enemy.lastDamageSource)) {
      this.spawnFloatingText(enemy.x, enemy.y + enemy.radius * 0.5, "Blast kill", "#fdba74", 0.74);
    }
    if (!noRewards) {
      this.spawnXp(enemy.x, enemy.y, enemy.xpValue, enemy.isBoss ? 10 : 1);
      this.maybeSpawnMedkit(enemy);
    }
    if (enemy.isBoss) {
      this.playSoundCue("boss-death", enemy.x, enemy.y, { ownerId: "", intensity: 1.2 });
      this.run.bossKills += 1;
      this.run.killScore += enemy.scoreValue * SCORE_CONFIG.killUnit + SCORE_CONFIG.bossBonus;
      this.setBanner("Heavy unit down.", 1.8);
      this.unlockMilestone("first-boss", "First boss defeated");
      this.addRunHighlight("Boss defeated", `+${SCORE_CONFIG.bossBonus.toLocaleString()} score`);
      this.awardGold(this.getEnemyGoldValue(enemy), enemy.x, enemy.y + enemy.radius + 18, "gold");
    } else {
      this.playSoundCue("enemy-death", enemy.x, enemy.y, { ownerId: "", intensity: noRewards ? 0.75 : 1 });
      if (noRewards) {
        return;
      }
      this.run.kills += 1;
      this.run.killScore += enemy.scoreValue * SCORE_CONFIG.killUnit;
      this.awardGold(this.getEnemyGoldValue(enemy), enemy.x, enemy.y + enemy.radius + 12, "gold");
      if (this.player?.characterId === CHARACTER_IDS.katana && this.run.kills % 50 === 0) {
        const previousHp = this.player.hp;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        const healed = this.player.hp > previousHp;
        this.spawnFloatingText(this.player.x, this.player.y - 54, healed ? "+1 HP Lifesteal" : "Lifesteal ready", "#fb7185", 0.9);
        if (healed) {
          this.spawnEffect(this.player.x, this.player.y, 42, "rgba(251, 113, 133, 0.58)", 0.28, "ring");
        }
      }
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
    if (this.run.elapsed >= 300 && !this.save.progress?.landmineUnlocked) {
      this.unlockMilestone("landmine-unlock", "Landmine quest complete");
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
        id: this.pickupId += 1,
        type: "xp",
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

  spawnMedkit(x, y) {
    const angle = randomRange(0, Math.PI * 2);
    const speed = randomRange(36, 108);
    this.pickups.push({
      id: this.pickupId += 1,
      type: "medkit",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 11,
      value: MEDKIT_PICKUP.healAmount,
      life: MEDKIT_PICKUP.lifetime,
      maxLife: MEDKIT_PICKUP.lifetime,
      dead: false,
    });
  }

  getSpawnPoint(radius) {
    const side = Math.floor(Math.random() * 4);
    const view = this.getActiveSpawnRect(0);
    const visibleMinX = view.x + radius;
    const visibleMaxX = view.x + view.width - radius;
    const visibleMinY = view.y + radius;
    const visibleMaxY = view.y + view.height - radius;
    if (side === 0) {
      return {
        x: view.x - radius - GAME_CONFIG.spawnPadding,
        y: randomRange(Math.min(visibleMinY, visibleMaxY), Math.max(visibleMinY, visibleMaxY)),
      };
    }
    if (side === 1) {
      return {
        x: view.x + view.width + radius + GAME_CONFIG.spawnPadding,
        y: randomRange(Math.min(visibleMinY, visibleMaxY), Math.max(visibleMinY, visibleMaxY)),
      };
    }
    if (side === 2) {
      return {
        x: randomRange(Math.min(visibleMinX, visibleMaxX), Math.max(visibleMinX, visibleMaxX)),
        y: view.y - radius - GAME_CONFIG.spawnPadding,
      };
    }
    return {
      x: randomRange(Math.min(visibleMinX, visibleMaxX), Math.max(visibleMinX, visibleMaxX)),
      y: view.y + view.height + radius + GAME_CONFIG.spawnPadding,
    };
  }

  getMovementDirection() {
    const keys = this.player?.isLocal === false ? this.player.inputKeys ?? new Set() : this.keys;
    const horizontal = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const vertical = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
    return normalizeVector(horizontal, vertical);
  }

  getAvailableUpgrades() {
    const counts = this.player?.upgradeCounts ?? this.upgradeCounts;
    return UPGRADE_DEFS.filter(
      (upgrade) =>
        (counts[upgrade.id] ?? 0) < upgrade.cap &&
        (!upgrade.characters || upgrade.characters.includes(this.player?.characterId)) &&
        (!upgrade.excludeCharacters || !upgrade.excludeCharacters.includes(this.player?.characterId)) &&
        (!upgrade.isAvailable || (this.player && upgrade.isAvailable(this.player))),
    );
  }

  showNextLevelReward() {
    if (!this.player || !this.run || this.pendingLevelUps <= 0) {
      return;
    }
    while (this.pendingHealOfferLevels.length > 0) {
      const level = this.pendingHealOfferLevels.shift();
      if (this.canShowHealOffer()) {
        this.showHealOffer(level);
        return;
      }
    }
    this.showUpgradeDraft();
  }

  canShowHealOffer() {
    return Boolean(
      this.player &&
      this.player.hp < this.player.maxHp &&
      Math.max(0, this.save.wallet?.gold ?? 0) >= HEAL_OFFER_CONFIG.price,
    );
  }

  showHealOffer(level) {
    this.mode = "healOffer";
    this.activeHealOfferLevel = level;
    if (this.ui.healOfferGold) {
      this.ui.healOfferGold.textContent = formatWholeNumber(HEAL_OFFER_CONFIG.price);
    }
    this.syncScreens();
    this.announce(`Level ${level} full heal offer available.`);
  }

  acceptHealOffer() {
    if (!this.player || !this.run || this.mode !== "healOffer" || !this.canShowHealOffer()) {
      this.skipHealOffer();
      return;
    }
    this.save = updateWallet(this.save, { gold: (this.save.wallet?.gold ?? 0) - HEAL_OFFER_CONFIG.price });
    this.player.hp = this.player.maxHp;
    this.spawnFloatingText(this.player.x, this.player.y - 58, "Full Heal", "#86efac", 0.95);
    this.spawnEffect(this.player.x, this.player.y, 48, "rgba(134, 239, 172, 0.64)", 0.32, "ring");
    this.playSoundCue("pickup", this.player.x, this.player.y, { ownerId: this.player.id });
    this.showToast(`Full heal bought for ${HEAL_OFFER_CONFIG.price} gold`);
    this.activeHealOfferLevel = 0;
    this.renderSongShop();
    this.updateHud();
    this.showUpgradeDraft();
  }

  skipHealOffer() {
    if (this.mode !== "healOffer") {
      return;
    }
    this.activeHealOfferLevel = 0;
    this.showUpgradeDraft();
  }

  showUpgradeDraft() {
    const available = this.getAvailableUpgrades();
    if (!available.length) {
      this.pendingLevelUps = 0;
      this.pendingHealOfferLevels = [];
      return;
    }
    this.mode = "upgrade";
    this.upgradeChoices = shuffleInPlace([...available]).slice(0, Math.min(3, available.length));
    this.playSoundCue("level-up", this.player?.x ?? 0, this.player?.y ?? 0, { ownerId: this.player?.id ?? "" });
    this.buildUpgradeButtons();
    this.syncScreens();
    this.announce("Upgrade choices ready.");
  }

  showCoopUpgradeDraft() {
    if (!this.isMultiplayerHost() || this.coopUpgradeDraft) {
      return;
    }
    const eligiblePlayers = this.getAlivePlayers();
    if (!eligiblePlayers.length) {
      return;
    }
    this.mode = "upgrade";
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    this.coopUpgradeDraft = {
      pending: new Set(eligiblePlayers.map((player) => player.id)),
      choicesByPlayer: {},
    };
    for (const player of eligiblePlayers) {
      const choices = this.withPlayer(player, () => shuffleInPlace([...this.getAvailableUpgrades()]).slice(0, 3));
      this.coopUpgradeDraft.choicesByPlayer[player.id] = choices.map((upgrade) => upgrade.id);
      if (player.id !== this.multiplayerSession.localPlayerId) {
        this.multiplayerHooks.sendHostEvent?.({
          eventType: "upgrade:offer",
          playerId: player.id,
          choices: choices.map((upgrade) => upgrade.id),
        });
      }
    }
    const localPlayer = this.getLocalPlayer();
    this.player = localPlayer;
    this.upgradeCounts = localPlayer?.upgradeCounts ?? this.upgradeCounts;
    this.upgradeChoices = (this.coopUpgradeDraft.choicesByPlayer[localPlayer.id] ?? [])
      .map((upgradeId) => getUpgradeById(upgradeId))
      .filter(Boolean);
    this.playSoundCue("level-up", localPlayer?.x ?? 0, localPlayer?.y ?? 0, { ownerId: localPlayer?.id ?? "" });
    this.buildUpgradeButtons();
    this.syncScreens();
    this.announce("Co-op upgrade choices ready.");
  }

  buildCoopWaitingUpgradeButtons() {
    if (!this.ui.upgradeCards) {
      return;
    }
    const waiting = document.createElement("div");
    waiting.className = "leaderboard-empty";
    waiting.textContent = "Waiting for teammate upgrade pick...";
    this.ui.upgradeCards.replaceChildren(waiting);
  }

  selectCoopUpgradeForPlayer(playerId, upgradeId) {
    if (!this.isMultiplayerHost() || !this.coopUpgradeDraft?.pending.has(playerId)) {
      return;
    }
    const allowedChoices = this.coopUpgradeDraft.choicesByPlayer[playerId] ?? [];
    if (!allowedChoices.includes(upgradeId)) {
      return;
    }
    const player = this.players.find((candidate) => candidate.id === playerId);
    const upgrade = getUpgradeById(upgradeId);
    if (!player || !upgrade) {
      return;
    }
    this.withPlayer(player, () => {
      const counts = player.upgradeCounts ?? {};
      const nextRank = (counts[upgradeId] ?? 0) + 1;
      counts[upgradeId] = nextRank;
      upgrade.apply(player, nextRank);
      this.spawnFloatingText(player.x, player.y - 58, `${UPGRADE_ICONS[upgradeId] ?? "UP"} ${nextRank}/${upgrade.cap}`, upgrade.color, 1);
      if (nextRank >= upgrade.cap && !this.maxedUpgradeIds.has(`${player.id}:${upgradeId}`)) {
        this.maxedUpgradeIds.add(`${player.id}:${upgradeId}`);
      }
    });
    this.coopUpgradeDraft.pending.delete(playerId);
    if (this.coopUpgradeDraft.pending.size <= 0) {
      this.finishCoopUpgradeDraft();
    }
  }

  finishCoopUpgradeDraft() {
    this.coopUpgradeDraft = null;
    if (this.pendingLevelUps > 0) {
      this.mode = "playing";
      this.showCoopUpgradeDraft();
      return;
    }
    this.mode = "playing";
    this.player = this.getLocalPlayer();
    this.upgradeCounts = this.player?.upgradeCounts ?? this.upgradeCounts;
    this.syncScreens();
    this.multiplayerHooks.sendHostEvent?.({ eventType: "upgrade:complete" });
  }

  showGuestUpgradeOffer(choiceIds = []) {
    if (!this.isMultiplayerGuest()) {
      return;
    }
    this.mode = "upgrade";
    this.upgradeChoices = choiceIds.map((upgradeId) => getUpgradeById(upgradeId)).filter(Boolean);
    this.buildUpgradeButtons();
    this.syncScreens();
    this.announce("Co-op upgrade choices ready.");
  }

  buildUpgradeButtons() {
    const buttons = this.upgradeChoices.map((upgrade, index) => {
      const counts = this.player?.upgradeCounts ?? this.upgradeCounts;
      const nextRank = (counts[upgrade.id] ?? 0) + 1;
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
    if (this.isMultiplayerGuest()) {
      if (this.mode === "upgrade") {
        this.multiplayerHooks.sendUpgradePick?.(upgradeId);
        this.setBanner("Waiting for host...", 1);
        this.showToast("Upgrade sent");
      }
      return;
    }
    if (!this.player || this.mode !== "upgrade") {
      return;
    }
    const upgrade = getUpgradeById(upgradeId);
    if (!upgrade) {
      return;
    }
    const counts = this.player.upgradeCounts ?? this.upgradeCounts;
    const nextRank = (counts[upgradeId] ?? 0) + 1;
    counts[upgradeId] = nextRank;
    upgrade.apply(this.player, nextRank);
    this.playSoundCue("upgrade-select", this.player.x, this.player.y, { ownerId: this.player.id });
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
    if (this.isMultiplayerHost() && this.coopUpgradeDraft) {
      this.coopUpgradeDraft.pending.delete(this.player.id);
      if (this.coopUpgradeDraft.pending.size > 0) {
        this.mode = "upgrade";
        this.buildCoopWaitingUpgradeButtons();
        this.syncScreens();
        return;
      }
      this.finishCoopUpgradeDraft();
      return;
    }
    if (this.pendingLevelUps > 0 && this.getAvailableUpgrades().length > 0) {
      this.showNextLevelReward();
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
    this.renderWikiTipCards(this.ui.quickRunGuide, QUICK_RUN_GUIDE);
    this.renderWikiTipCards(this.ui.wikiStrategyGuide, STRATEGY_GUIDE);
    this.renderWikiUnlockGuide();

    if (this.ui.enemyGuide) {
      const enemyRows = ENEMY_GUIDE_DEFS.map((definition) => {
        const stats = this.save.stats?.enemy?.[definition.id] ?? {};
        return this.createEnemyGuideCard({
          definition,
          counters: {
            kills: stats.kills ?? 0,
            deaths: stats.deaths ?? 0,
          },
        });
      });
      this.ui.enemyGuide.replaceChildren(...enemyRows);
    }

    if (this.ui.upgradeGuide) {
      const categories = ["General", "Weapon", "Survival", "Ability", "Katana", "Grenade", "Landmine", "Engineer"];
      const nodes = categories.map((category) => {
        const upgrades = UPGRADE_DEFS.filter((upgrade) => this.getUpgradeGuideCategory(upgrade) === category);
        if (!upgrades.length) {
          return null;
        }
        const section = document.createElement("section");
        section.className = "wiki-upgrade-category";
        const heading = document.createElement("h5");
        heading.textContent = category;
        const list = document.createElement("div");
        list.className = "guide-list compact-guide wiki-guide-list wiki-upgrade-card-list";
        const rows = upgrades.map((upgrade) => this.createUpgradeGuideCard(upgrade));
        list.replaceChildren(...rows);
        section.replaceChildren(heading, list);
        return section;
      }).filter(Boolean);
      this.ui.upgradeGuide.replaceChildren(...nodes);
    }
  }

  getUpgradeGuideCategory(upgrade) {
    if (upgrade.characters?.includes(CHARACTER_IDS.katana)) {
      return "Katana";
    }
    if (upgrade.characters?.includes(CHARACTER_IDS.engineer)) {
      return "Engineer";
    }
    if (upgrade.id.includes("grenade")) {
      return "Grenade";
    }
    if (["blast-plating", "fast-trigger", "cluster-charge"].includes(upgrade.id)) {
      return "Landmine";
    }
    if (upgrade.id === "ability-reload" || upgrade.isAvailable) {
      return "Ability";
    }
    if (upgrade.excludeCharacters?.includes(CHARACTER_IDS.katana)) {
      return "Weapon";
    }
    if (["heart-balloon", "bubble-guard", "overheal-shield", "skipping-shoes", "glitter-vac", "xp-surge"].includes(upgrade.id)) {
      return "Survival";
    }
    return "General";
  }

  renderWikiTipCards(container, items) {
    if (!container) {
      return;
    }
    const cards = items.map((item) => {
      const card = document.createElement("article");
      card.className = "wiki-tip-card";
      const label = document.createElement("span");
      label.className = "wiki-card-label";
      label.textContent = item.label;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const copy = document.createElement("p");
      copy.textContent = item.copy;
      card.replaceChildren(label, title, copy);
      return card;
    });
    container.replaceChildren(...cards);
  }

  renderWikiUnlockGuide() {
    if (!this.ui.wikiUnlockGuide) {
      return;
    }
    const cards = this.getWikiUnlockItems().map((item) => this.createUnlockGuideCard(item));
    this.ui.wikiUnlockGuide.replaceChildren(...cards);
  }

  getWikiUnlockItems() {
    const progress = this.save.progress ?? {};
    const stats = this.save.stats ?? {};
    const bestKills = Math.max(0, stats.best?.kills ?? 0);
    const bestTime = Math.max(0, stats.best?.time ?? 0);
    const totalKills = Math.max(0, stats.total?.kills ?? 0);
    const totalBosses = Math.max(0, stats.total?.bosses ?? 0);
    const grenadeUnlocked = Boolean(progress.grenadeUnlocked || bestKills >= 250);
    const landmineUnlocked = Boolean(progress.landmineUnlocked || bestTime >= 300);
    const katanaUnlocked = isCharacterUnlocked(progress, stats, CHARACTER_IDS.katana);
    const engineerUnlocked = isCharacterUnlocked(progress, stats, CHARACTER_IDS.engineer);
    const equippedAbility = this.getEquippedAbilityId();
    const customSongCount = this.save.music?.adminSongs?.length ?? 0;
    return [
      {
        title: "Grenade",
        status: grenadeUnlocked ? "Unlocked" : "Locked",
        unlocked: grenadeUnlocked,
        requirement: "250 kills in one run",
        currentLabel: `${formatWholeNumber(Math.min(bestKills, 250))}/250 best kills`,
        progress: bestKills / 250,
      },
      {
        title: "Landmine",
        status: landmineUnlocked ? "Unlocked" : "Locked",
        unlocked: landmineUnlocked,
        requirement: "Survive 05:00 in one run",
        currentLabel: `${formatTime(Math.min(bestTime, 300))}/05:00 best time`,
        progress: bestTime / 300,
      },
      {
        title: "Katana",
        status: katanaUnlocked ? "Unlocked" : "Locked",
        unlocked: katanaUnlocked,
        requirement: `${KATANA_UNLOCK_BOSSES} total boss kills`,
        currentLabel: `${formatWholeNumber(Math.min(totalBosses, KATANA_UNLOCK_BOSSES))}/${KATANA_UNLOCK_BOSSES} bosses`,
        progress: totalBosses / KATANA_UNLOCK_BOSSES,
      },
      {
        title: "Engineer",
        status: engineerUnlocked ? "Unlocked" : "Locked",
        unlocked: engineerUnlocked,
        requirement: `${ENGINEER_UNLOCK_KILLS} total kills`,
        currentLabel: `${formatWholeNumber(Math.min(totalKills, ENGINEER_UNLOCK_KILLS))}/${formatWholeNumber(ENGINEER_UNLOCK_KILLS)} kills`,
        progress: totalKills / ENGINEER_UNLOCK_KILLS,
      },
      {
        title: "Ability slot",
        status: equippedAbility ? "Equipped" : "Empty",
        unlocked: Boolean(equippedAbility),
        requirement: "Equip grenade or landmine",
        currentLabel: equippedAbility ? `${ABILITY_LABELS[equippedAbility]} ready` : "No ability equipped",
        progress: equippedAbility ? 1 : 0,
      },
      {
        title: "Custom songs",
        status: "Available",
        unlocked: true,
        requirement: "Request or add songs in the shop",
        currentLabel: `${formatWholeNumber(customSongCount)} custom song${customSongCount === 1 ? "" : "s"}`,
        progress: 1,
      },
    ];
  }

  createUnlockGuideCard(item) {
    const card = document.createElement("article");
    card.className = `wiki-unlock-card ${item.unlocked ? "is-unlocked" : "is-locked"}`;

    const header = document.createElement("div");
    header.className = "wiki-unlock-header";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const status = document.createElement("span");
    status.className = "wiki-status-pill";
    status.textContent = item.status;
    header.replaceChildren(title, status);

    const requirement = document.createElement("p");
    requirement.textContent = item.requirement;

    const progress = document.createElement("div");
    progress.className = "wiki-progress";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round(clamp(item.progress, 0, 1) * 100)}%`;
    progress.append(fill);

    const current = document.createElement("span");
    current.className = "wiki-progress-label";
    current.textContent = item.currentLabel;

    card.replaceChildren(header, requirement, progress, current);
    return card;
  }

  createEnemyGuideCard({ definition, counters }) {
    const row = document.createElement("article");
    row.className = "guide-row enemy-guide-card";

    const swatch = document.createElement("span");
    swatch.className = "guide-swatch";
    swatch.style.background = definition.color;
    swatch.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "guide-card-body";
    const heading = document.createElement("strong");
    heading.textContent = definition.name;
    const stats = document.createElement("div");
    stats.className = "guide-stat-row";
    stats.replaceChildren(
      this.createGuideStat("HP", formatWholeNumber(definition.maxHp)),
      this.createGuideStat("Speed", formatWholeNumber(definition.speed ?? BOSS_DEF.speed)),
      this.createGuideStat("XP", formatWholeNumber(definition.xpValue)),
      this.createGuideStat("Gold", formatWholeNumber(definition.goldValue ?? GOLD_CONFIG.enemyKills?.[definition.id] ?? GOLD_CONFIG.bossKill)),
    );
    const copy = document.createElement("p");
    copy.textContent = ENEMY_THREAT_NOTES[definition.id] ?? ENEMY_GUIDE_COPY[definition.id] ?? "Watch its movement pattern and keep space.";

    const counterRow = document.createElement("div");
    counterRow.className = "guide-counters";
    const killCounter = document.createElement("span");
    killCounter.textContent = `Killed ${formatWholeNumber(counters.kills ?? 0)}`;
    const deathCounter = document.createElement("span");
    deathCounter.textContent = `Killed you ${formatWholeNumber(counters.deaths ?? 0)}`;
    counterRow.replaceChildren(killCounter, deathCounter);

    body.replaceChildren(heading, stats, copy, counterRow);
    row.replaceChildren(swatch, body);
    return row;
  }

  createUpgradeGuideCard(upgrade) {
    const card = document.createElement("article");
    card.className = "guide-row upgrade-guide-card";

    const swatch = document.createElement("span");
    swatch.className = "guide-swatch";
    swatch.style.background = upgrade.color;
    swatch.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "guide-card-body";
    const header = document.createElement("div");
    header.className = "upgrade-guide-header";
    const title = document.createElement("strong");
    title.textContent = upgrade.name;
    const cap = document.createElement("span");
    cap.className = "wiki-cap-pill";
    cap.textContent = `Cap ${upgrade.cap}`;
    header.replaceChildren(title, cap);

    const stats = document.createElement("div");
    stats.className = "guide-stat-row";
    stats.replaceChildren(
      this.createGuideStat("Group", this.getUpgradeGuideCategory(upgrade)),
      this.createGuideStat("Rank 1", getUpgradeBoostCopy(upgrade, 1)),
    );

    const copy = document.createElement("p");
    copy.textContent = getUpgradeEffectCopy(upgrade, 1);

    body.replaceChildren(header, stats, copy);
    card.replaceChildren(swatch, body);
    return card;
  }

  createGuideStat(label, value) {
    const stat = document.createElement("span");
    stat.className = "guide-stat";
    const labelNode = document.createElement("b");
    labelNode.textContent = label;
    const valueNode = document.createElement("em");
    valueNode.textContent = value;
    stat.replaceChildren(labelNode, valueNode);
    return stat;
  }

  setupWikiNavigation() {
    const panel = this.ui.wikiWindow;
    if (!panel || panel.dataset.navReady === "true") {
      return;
    }
    const buttons = Array.from(panel.querySelectorAll("[data-wiki-target]"));
    const sections = Array.from(panel.querySelectorAll("[data-wiki-section]"));
    if (!buttons.length || !sections.length) {
      return;
    }
    panel.dataset.navReady = "true";
    const nav = panel.querySelector(".wiki-section-nav");
    const getNavOffset = () => (nav?.offsetHeight ?? 0) + 18;
    const setActive = (sectionId) => {
      for (const button of buttons) {
        const isActive = button.dataset.wikiTarget === sectionId;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-current", isActive ? "true" : "false");
      }
    };
    for (const button of buttons) {
      button.addEventListener("click", () => {
        const targetId = button.dataset.wikiTarget;
        const target = targetId ? panel.querySelector(`#${targetId}`) : null;
        if (!target) {
          return;
        }
        panel.scrollTo({
          top: Math.max(0, target.offsetTop - getNavOffset()),
          behavior: "auto",
        });
        setActive(target.id);
      });
    }
    let scrollFrame = 0;
    panel.addEventListener("scroll", () => {
      if (scrollFrame) {
        return;
      }
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        const currentTop = panel.scrollTop + getNavOffset() + 16;
        let activeId = sections[0]?.id ?? "";
        const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4;
        if (atBottom) {
          activeId = sections.at(-1)?.id ?? activeId;
        } else {
          for (const section of sections) {
            if (section.offsetTop <= currentTop) {
              activeId = section.id;
            }
          }
        }
        setActive(activeId);
      });
    });
    setActive(sections[0].id);
  }

  setupWikiWindow() {
    const windowNode = this.ui.wikiWindow;
    const handle = this.ui.wikiDragHandle;
    if (!windowNode || !handle || windowNode.dataset.dragReady === "true") {
      return;
    }
    if (window.getComputedStyle(windowNode).position !== "absolute") {
      return;
    }
    windowNode.dataset.dragReady = "true";
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest?.("button")) {
        return;
      }
      const rect = windowNode.getBoundingClientRect();
      this.wikiDragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!this.wikiDragState || this.wikiDragState.pointerId !== event.pointerId) {
        return;
      }
      const parentRect = windowNode.parentElement.getBoundingClientRect();
      const width = windowNode.offsetWidth;
      const height = windowNode.offsetHeight;
      const left = clamp(event.clientX - parentRect.left - this.wikiDragState.offsetX, 0, Math.max(0, parentRect.width - width));
      const top = clamp(event.clientY - parentRect.top - this.wikiDragState.offsetY, 0, Math.max(0, parentRect.height - height));
      windowNode.style.left = `${left}px`;
      windowNode.style.top = `${top}px`;
      windowNode.style.right = "auto";
      windowNode.style.bottom = "auto";
    });
    const stopDragging = (event) => {
      if (!this.wikiDragState || this.wikiDragState.pointerId !== event.pointerId) {
        return;
      }
      this.wikiDragState = null;
      handle.releasePointerCapture?.(event.pointerId);
    };
    handle.addEventListener("pointerup", stopDragging);
    handle.addEventListener("pointercancel", stopDragging);
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
    if (tabId === "guide") {
      this.buildMenuGuide();
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

  closeWikiWindow() {
    if (this.menuTab === "guide") {
      this.setMenuTab("play");
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
    this.renderQuestMenu();
    this.renderCharacterMenu();
    this.updateResetStatsButton();
    this.announce("Player stats reset. Sound setting preserved.");
  }

  toggleGrenadeEquip() {
    this.toggleAbilityEquip(ABILITY_IDS.grenade);
  }

  toggleAbilityEquip(abilityId) {
    const progress = this.save.progress ?? {};
    const unlocked =
      abilityId === ABILITY_IDS.grenade
        ? progress.grenadeUnlocked
        : abilityId === ABILITY_IDS.landmine
          ? progress.landmineUnlocked
          : false;
    if (!unlocked) {
      this.showToast(`${ABILITY_LABELS[abilityId] ?? "Ability"} locked`);
      return;
    }
    const selectedCharacterId = this.getSelectedCharacter().id;
    const loadouts = this.getLoadouts();
    const equippedAbilityId = this.getSelectedAccessoryIds(selectedCharacterId).includes(abilityId) ? "" : abilityId;
    loadouts[selectedCharacterId] = { accessoryIds: equippedAbilityId ? [equippedAbilityId] : [] };
    this.save = updateProgress(this.save, { equippedAbilityId, loadouts });
    this.updateAbilityLobby();
    this.renderCharacterMenu();
    const abilityLabel = ABILITY_LABELS[abilityId] ?? "Ability";
    this.announce(`${abilityLabel} ${equippedAbilityId === abilityId ? "equipped" : "unequipped"}.`);
  }

  updateAbilityLobby() {
    const progress = this.save.progress ?? {};
    const equippedAbilityId = this.getEquippedAbilityId();
    const bestKills = Math.max(0, this.save.stats?.best?.kills ?? 0);
    const bestTime = Math.max(0, this.save.stats?.best?.time ?? 0);
    this.updateHeroLoadout();

    if (this.ui.grenadeEquipButton && this.ui.grenadeStatus && this.ui.grenadeQuestText) {
      const unlocked = Boolean(progress.grenadeUnlocked);
      const equipped = equippedAbilityId === ABILITY_IDS.grenade;
      this.ui.grenadeEquipButton.disabled = !unlocked;
      this.ui.grenadeEquipButton.textContent = equipped ? "Unequip Grenade" : "Equip Grenade";
      this.ui.grenadeEquipButton.setAttribute("aria-pressed", equipped ? "true" : "false");
      this.ui.grenadeStatus.textContent = unlocked ? `Grenade ${equipped ? "equipped" : "unlocked"}` : "Grenade locked";
      this.ui.grenadeQuestText.textContent = unlocked
        ? "Press E during a run to throw a blast grenade. Grenade upgrades appear while equipped."
        : `Quest: get 250 kills in a single run. Best so far: ${formatWholeNumber(Math.min(250, bestKills))}/250.`;
    }

    if (this.ui.landmineEquipButton && this.ui.landmineStatus && this.ui.landmineQuestText) {
      const unlocked = Boolean(progress.landmineUnlocked);
      const equipped = equippedAbilityId === ABILITY_IDS.landmine;
      this.ui.landmineEquipButton.disabled = !unlocked;
      this.ui.landmineEquipButton.textContent = equipped ? "Unequip Landmine" : "Equip Landmine";
      this.ui.landmineEquipButton.setAttribute("aria-pressed", equipped ? "true" : "false");
      this.ui.landmineStatus.textContent = unlocked ? `Landmine ${equipped ? "equipped" : "unlocked"}` : "Landmine locked";
      this.ui.landmineQuestText.textContent = unlocked
        ? "Press E during a run to place an armed tripmine. Landmine upgrades appear while equipped."
        : `Quest: survive 05:00 in a single run. Best so far: ${formatTime(Math.min(300, bestTime))}/05:00.`;
    }

    if (this.ui.abilitySlotStatus) {
      this.ui.abilitySlotStatus.textContent = equippedAbilityId ? `${ABILITY_LABELS[equippedAbilityId]} equipped` : "No ability equipped";
    }
  }

  updateHeroLoadout() {
    const summary = this.getLoadoutSummary();
    if (this.ui.loadoutCharacterName) {
      this.ui.loadoutCharacterName.textContent = summary.characterName;
    }
    if (this.ui.loadoutAccessoryList) {
      this.ui.loadoutAccessoryList.textContent = summary.accessoryText;
    }
  }

  updateGrenadeLobby() {
    this.updateAbilityLobby();
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
    if (this.ui.healOfferScreen) {
      this.ui.healOfferScreen.hidden = this.mode !== "healOffer";
    }
    this.ui.upgradeScreen.hidden = this.mode !== "upgrade";
    this.ui.gameOverScreen.hidden = this.mode !== "gameOver";
    this.updateAdminGamePanel();
  }

  updateHud() {
    if (this.players?.length) {
      this.player = this.getLocalPlayer();
      this.upgradeCounts = this.player?.upgradeCounts ?? this.upgradeCounts;
    }
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
        if (this.ui.abilityHudLabel) {
          this.ui.abilityHudLabel.textContent = "Ability";
        }
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
      const abilityId = this.player.equippedAbilityId;
      this.ui.grenadeHudPanel.hidden = !abilityId;
      if (this.ui.abilityHudLabel) {
        this.ui.abilityHudLabel.textContent = abilityId ? ABILITY_LABELS[abilityId] : "Ability";
      }
      const cooldown = abilityId === ABILITY_IDS.landmine ? this.player.landmineCooldown : this.player.grenadeCooldown;
      const remaining = abilityId === ABILITY_IDS.landmine ? this.player.landmineCooldownRemaining : this.player.grenadeCooldownRemaining;
      const abilityProgress = cooldown <= 0 ? 1 : 1 - remaining / cooldown;
      this.ui.grenadeFill.style.width = `${clamp(abilityProgress, 0, 1) * 100}%`;
      this.ui.grenadeText.textContent = remaining <= 0 ? "Ready" : `${remaining.toFixed(1)}s`;
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
    this.updateAbilityLobby();
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
    this.updateCamera();
    context.save();
    if (this.screenShake > 0) {
      context.translate(randomRange(-this.screenShake, this.screenShake), randomRange(-this.screenShake, this.screenShake));
    }
    this.renderBackground(context);
    if (this.player) {
      context.save();
      const zoom = this.getCameraZoom();
      context.scale(zoom, zoom);
      context.translate(-this.camera.x, -this.camera.y);
      this.renderArena(context);
      this.renderPickups(context);
      this.renderProjectiles(context);
      this.renderGrenades(context);
      this.renderLandmines(context);
      this.renderDamageZones(context);
      this.renderTurrets(context);
      this.renderEnemies(context);
      this.renderPlayers(context);
      this.renderEffects(context);
      this.renderFloatingTexts(context);
      context.restore();
      this.renderTeammateIndicator(context);
    } else {
      this.renderPlayer(context);
    }
    context.restore();
  }

  renderTeammateIndicator(context) {
    if (!this.isCoopRun() || !this.player) {
      this.teammateIndicator = null;
      return;
    }
    const localPlayer = this.getLocalPlayer();
    const teammate = (this.players ?? []).find((player) => player && player.id !== localPlayer?.id && !player.dead);
    if (!localPlayer || !teammate) {
      this.teammateIndicator = null;
      return;
    }
    const screen = this.worldToScreen(teammate.x, teammate.y);
    const padding = TEAMMATE_INDICATOR_CONFIG.edgePadding;
    const visible =
      screen.x >= padding &&
      screen.x <= LOGICAL_WIDTH - padding &&
      screen.y >= padding &&
      screen.y <= LOGICAL_HEIGHT - padding;
    if (visible) {
      this.teammateIndicator = null;
      return;
    }

    const centerX = LOGICAL_WIDTH * 0.5;
    const centerY = LOGICAL_HEIGHT * 0.5;
    const dx = screen.x - centerX;
    const dy = screen.y - centerY;
    const scale = Math.min(
      (LOGICAL_WIDTH * 0.5 - padding) / Math.max(1, Math.abs(dx)),
      (LOGICAL_HEIGHT * 0.5 - padding) / Math.max(1, Math.abs(dy)),
    );
    const targetX = centerX + dx * scale;
    const targetY = centerY + dy * scale;
    const targetAngle = Math.atan2(dy, dx);
    const amount = 1 - Math.exp(-TEAMMATE_INDICATOR_CONFIG.smoothness / 60);
    const previous = this.teammateIndicator ?? { x: targetX, y: targetY, angle: targetAngle };
    const angleDelta = Math.atan2(Math.sin(targetAngle - previous.angle), Math.cos(targetAngle - previous.angle));
    const indicator = {
      x: lerp(previous.x, targetX, amount),
      y: lerp(previous.y, targetY, amount),
      angle: previous.angle + angleDelta * amount,
    };
    this.teammateIndicator = indicator;

    const downed = Boolean(teammate.downed);
    const distance = Math.round(Math.hypot(teammate.x - localPlayer.x, teammate.y - localPlayer.y));
    context.save();
    context.translate(indicator.x, indicator.y);
    context.shadowBlur = downed ? 26 : 20;
    context.shadowColor = downed ? "rgba(248, 113, 113, 0.96)" : "rgba(96, 165, 250, 0.86)";
    context.fillStyle = downed ? "rgba(127, 29, 29, 0.86)" : "rgba(15, 23, 42, 0.86)";
    context.strokeStyle = downed ? "#fecaca" : "#bfdbfe";
    context.lineWidth = 3;
    roundRectPath(context, -54, -24, 108, 48, 8);
    context.fill();
    context.stroke();
    context.rotate(indicator.angle);
    context.fillStyle = downed ? "#f87171" : "#60a5fa";
    context.beginPath();
    context.moveTo(24, 0);
    context.lineTo(3, -12);
    context.lineTo(3, 12);
    context.closePath();
    context.fill();
    context.rotate(-indicator.angle);
    context.shadowBlur = 0;
    context.font = "800 11px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillStyle = downed ? "#fee2e2" : "#dbeafe";
    context.fillText(downed ? "REVIVE" : (teammate.name || "ALLY").slice(0, 10).toUpperCase(), 0, -4);
    context.font = "700 10px system-ui, sans-serif";
    context.fillStyle = downed ? "#fecaca" : "#93c5fd";
    context.fillText(`${distance}px`, 0, 12);
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
    const zoom = this.getCameraZoom();
    const view = this.getCameraRect(0);
    const gridSize = 120;
    const firstGridX = Math.floor(view.x / gridSize) * gridSize;
    const lastGridX = view.x + view.width + gridSize;
    const firstGridY = Math.floor(view.y / gridSize) * gridSize;
    const lastGridY = view.y + view.height + gridSize;
    for (let worldX = firstGridX; worldX <= lastGridX; worldX += gridSize) {
      const x = Math.round((worldX - this.camera.x) * zoom) + 0.5;
      context.strokeStyle = Math.round(worldX / gridSize) % 4 === 0 ? "rgba(34, 211, 238, 0.16)" : "rgba(125, 211, 252, 0.055)";
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, LOGICAL_HEIGHT);
      context.stroke();
    }
    for (let worldY = firstGridY; worldY <= lastGridY; worldY += gridSize) {
      const y = Math.round((worldY - this.camera.y) * zoom) + 0.5;
      context.strokeStyle = Math.round(worldY / gridSize) % 4 === 0 ? "rgba(34, 211, 238, 0.14)" : "rgba(125, 211, 252, 0.05)";
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(LOGICAL_WIDTH, y);
      context.stroke();
    }
  }

  renderArena(context) {
    context.save();
    if (this.player) {
      const view = this.getCameraRect(80);
      const glow = context.createRadialGradient(this.player.x, this.player.y, 120, this.player.x, this.player.y, 820);
      glow.addColorStop(0, "rgba(34, 211, 238, 0)");
      glow.addColorStop(1, "rgba(2, 6, 23, 0.38)");
      context.fillStyle = glow;
      context.fillRect(view.x, view.y, view.width, view.height);
    }
    if (this.bossArena) {
      const { x, y, width, height } = this.bossArena;
      const pulse = 0.65 + Math.sin(this.backgroundTime * 5) * 0.15;
      context.fillStyle = "rgba(15, 23, 42, 0.16)";
      context.fillRect(x, y, width, height);
      context.shadowBlur = 24;
      context.shadowColor = "rgba(251, 191, 36, 0.72)";
      context.strokeStyle = `rgba(251, 191, 36, ${0.58 + pulse * 0.2})`;
      context.lineWidth = 8;
      context.strokeRect(x, y, width, height);
      context.shadowBlur = 0;
      context.setLineDash([18, 12]);
      context.strokeStyle = "rgba(34, 211, 238, 0.44)";
      context.lineWidth = 3;
      context.strokeRect(x + 16, y + 16, width - 32, height - 32);
      context.setLineDash([]);
    }
    context.restore();
  }

  renderPickups(context) {
    for (const pickup of this.pickups) {
      const pulse = 1 + Math.sin(this.backgroundTime * 6 + pickup.x * 0.01) * 0.15;
      context.save();
      context.translate(pickup.x, pickup.y);
      context.scale(pulse, pulse);
      if (pickup.type === "medkit") {
        const despawnRatio = clamp((3 - pickup.life) / 3, 0, 1);
        const flash = despawnRatio > 0 ? 0.45 + Math.sin(this.backgroundTime * 26) * 0.28 + despawnRatio * 0.25 : 1;
        const crossAlpha = despawnRatio > 0 ? 0.35 + Math.max(0, Math.sin(this.backgroundTime * 32)) * 0.65 : 1;
        context.globalAlpha = clamp(flash, 0.28, 1);
        context.shadowBlur = 18 + despawnRatio * 18;
        context.shadowColor = despawnRatio > 0 ? "rgba(254, 202, 202, 0.95)" : "rgba(248, 113, 113, 0.78)";
        context.fillStyle = despawnRatio > 0 ? "rgba(248, 113, 113, 0.32)" : "rgba(127, 29, 29, 0.24)";
        context.beginPath();
        context.arc(0, 0, pickup.radius * 1.85, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#f8fafc";
        context.strokeStyle = "#ef4444";
        context.lineWidth = 3;
        roundRectPath(context, -pickup.radius, -pickup.radius, pickup.radius * 2, pickup.radius * 2, 4);
        context.fill();
        context.stroke();
        context.shadowBlur = 0;
        context.globalAlpha = clamp(crossAlpha, 0.22, 1);
        context.fillStyle = despawnRatio > 0 ? "#ef4444" : "#dc2626";
        roundRectPath(context, -3, -pickup.radius * 0.68, 6, pickup.radius * 1.36, 2);
        context.fill();
        roundRectPath(context, -pickup.radius * 0.68, -3, pickup.radius * 1.36, 6, 2);
        context.fill();
        context.restore();
        continue;
      }
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
      const isAcidSpit = projectile.kind === "acid-spit";
      const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
      const dirX = projectile.vx / speed;
      const dirY = projectile.vy / speed;
      const tailScale = isAcidSpit ? projectile.trailScale ?? 6.2 : projectile.trailScale ?? 3.4;
      const tailX = dirX * projectile.radius * tailScale;
      const tailY = dirY * projectile.radius * tailScale;
      context.save();
      context.lineCap = "round";
      context.strokeStyle = isAcidSpit ? "rgba(190, 242, 100, 0.62)" : glowColor;
      context.lineWidth = projectile.radius * (isAcidSpit ? 1.65 : 1.15);
      context.beginPath();
      context.moveTo(projectile.x - tailX, projectile.y - tailY);
      context.lineTo(projectile.x, projectile.y);
      context.stroke();
      if (isAcidSpit) {
        const perpX = -dirY;
        const perpY = dirX;
        context.fillStyle = "rgba(217, 249, 157, 0.75)";
        for (let index = 0; index < 4; index += 1) {
          const offset = (index + 1) * projectile.radius * 1.1;
          const side = index % 2 === 0 ? 1 : -1;
          context.beginPath();
          context.arc(
            projectile.x - dirX * offset + perpX * side * projectile.radius * 0.55,
            projectile.y - dirY * offset + perpY * side * projectile.radius * 0.55,
            Math.max(1.4, projectile.radius * (0.28 - index * 0.035)),
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
      context.shadowBlur = isAcidSpit ? 22 : 16;
      context.shadowColor = isAcidSpit ? "rgba(132, 204, 22, 0.9)" : glowColor;
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

  renderLandmines(context) {
    for (const mine of this.landmines) {
      const armed = mine.armTimeRemaining <= 0;
      const pulse = 1 + Math.sin(this.backgroundTime * (armed ? 14 : 8) + mine.id) * 0.06;
      context.save();
      context.translate(mine.x, mine.y);
      context.scale(pulse, pulse);
      context.shadowBlur = armed ? 18 : 10;
      context.shadowColor = armed ? "rgba(245, 158, 11, 0.82)" : "rgba(148, 163, 184, 0.6)";
      context.fillStyle = armed ? "#f59e0b" : "#64748b";
      roundRectPath(context, -12, -8, 24, 16, 4);
      context.fill();
      context.strokeStyle = armed ? "#fef3c7" : "#cbd5e1";
      context.lineWidth = 3;
      context.stroke();
      context.fillStyle = armed ? "#fef08a" : "#94a3b8";
      context.beginPath();
      context.arc(0, 0, 4, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.save();
      context.globalAlpha = armed ? 0.13 : 0.06;
      context.strokeStyle = armed ? "#f59e0b" : "#94a3b8";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(mine.x, mine.y, mine.blastRadius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  renderDamageZones(context) {
    for (const zone of this.damageZones) {
      const progress = 1 - zone.life / zone.maxLife;
      const isEnemyZone = zone.owner === "enemy";
      context.save();
      const pulse = 0.5 + Math.sin(this.backgroundTime * 12 + zone.x * 0.01) * 0.5;
      const drawRadius = zone.radius * (0.96 + progress * 0.08 + pulse * 0.03);
      context.globalAlpha = isEnemyZone ? 0.34 + pulse * 0.12 : 0.2 + Math.sin(this.backgroundTime * 12) * 0.04;
      if (isEnemyZone) {
        const gradient = context.createRadialGradient(zone.x, zone.y, zone.radius * 0.12, zone.x, zone.y, drawRadius);
        gradient.addColorStop(0, "rgba(217, 249, 157, 0.62)");
        gradient.addColorStop(0.55, "rgba(132, 204, 22, 0.42)");
        gradient.addColorStop(1, "rgba(21, 128, 61, 0.16)");
        context.fillStyle = gradient;
        context.strokeStyle = "rgba(236, 252, 203, 0.84)";
        context.lineWidth = 4;
      } else {
        context.fillStyle = "rgba(239, 68, 68, 0.34)";
        context.strokeStyle = "rgba(254, 202, 202, 0.42)";
        context.lineWidth = 2;
      }
      context.beginPath();
      context.arc(zone.x, zone.y, drawRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      if (isEnemyZone) {
        context.globalAlpha = 0.62 + pulse * 0.18;
        context.setLineDash([9, 8]);
        context.strokeStyle = "rgba(163, 230, 53, 0.9)";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(zone.x, zone.y, zone.radius * (0.72 + pulse * 0.08), 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "rgba(236, 252, 203, 0.76)";
        for (let index = 0; index < 7; index += 1) {
          const angle = index * 1.91 + zone.x * 0.003;
          const distance = zone.radius * (0.18 + ((index * 17) % 49) / 100);
          const bubbleRadius = 2.4 + ((index * 11) % 5) + pulse * 1.2;
          context.beginPath();
          context.arc(zone.x + Math.cos(angle) * distance, zone.y + Math.sin(angle) * distance, bubbleRadius, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.restore();
    }
  }

  renderTurrets(context) {
    for (const turret of this.turrets) {
      const lifeRatio = clamp(turret.life / turret.maxLife, 0, 1);
      const aimAngle = turret.aimAngle ?? -Math.PI / 2;
      const flash = clamp((turret.muzzleFlash ?? 0) / 0.12, 0, 1);
      context.save();
      context.translate(turret.x, turret.y);
      context.shadowBlur = 22;
      context.shadowColor = "rgba(34, 211, 238, 0.72)";
      context.fillStyle = "rgba(34, 211, 238, 0.06)";
      context.strokeStyle = "rgba(34, 211, 238, 0.22)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, turret.range * 0.16 * lifeRatio, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.rotate(aimAngle);
      context.fillStyle = "rgba(15, 23, 42, 0.94)";
      context.strokeStyle = "rgba(251, 191, 36, 0.62)";
      context.lineWidth = 3;
      roundRectPath(context, -12, -7, 32, 14, 5);
      context.fill();
      context.stroke();
      context.fillStyle = "#fef3c7";
      roundRectPath(context, 16, -4, 18, 8, 3);
      context.fill();
      if (flash > 0) {
        context.shadowBlur = 24 * flash;
        context.shadowColor = "rgba(251, 191, 36, 0.95)";
        context.fillStyle = `rgba(251, 191, 36, ${0.35 + flash * 0.45})`;
        context.beginPath();
        context.arc(40, 0, 8 + flash * 8, 0, Math.PI * 2);
        context.fill();
      }
      context.rotate(-aimAngle);
      context.shadowBlur = 16;
      context.shadowColor = "rgba(52, 211, 153, 0.72)";
      context.fillStyle = "rgba(30, 41, 59, 0.95)";
      context.strokeStyle = "#67e8f9";
      context.lineWidth = 3;
      context.beginPath();
      context.arc(0, 0, turret.radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#0f172a";
      context.strokeStyle = "rgba(251, 191, 36, 0.82)";
      context.lineWidth = 2;
      roundRectPath(context, -turret.radius * 0.74, 5, turret.radius * 1.48, 9, 4);
      context.fill();
      context.stroke();
      context.fillStyle = "#22d3ee";
      context.beginPath();
      context.arc(0, 0, 6 + Math.sin(this.backgroundTime * 8 + turret.id) * 1.2, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(251, 191, 36, 0.78)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, turret.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lifeRatio);
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
      } else if (enemy.typeId === "nibbler" || enemy.typeId === "sprinter") {
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
        if (enemy.typeId === "sprinter") {
          context.strokeStyle = "#fecdd3";
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(-enemy.radius * 0.58, -enemy.radius * 0.46);
          context.lineTo(-enemy.radius * 0.88, 0);
          context.lineTo(-enemy.radius * 0.58, enemy.radius * 0.46);
          context.stroke();
        }
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
      } else if (enemy.typeId === "marksman") {
        context.rotate(Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x));
        context.fillStyle = bodyColor;
        roundRectPath(context, -enemy.radius, -enemy.radius * 0.82, enemy.radius * 2, enemy.radius * 1.64, 7);
        context.fill();
        context.stroke();
        context.fillStyle = accentColor;
        roundRectPath(context, -enemy.radius * 0.2, -enemy.radius * 0.26, enemy.radius * 1.18, enemy.radius * 0.52, 4);
        context.fill();
        context.strokeStyle = "#ede9fe";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(enemy.radius * 0.4, 0);
        context.lineTo(enemy.radius * 1.15, 0);
        context.stroke();
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

  renderPlayers(context) {
    const players = this.players?.length ? this.players : [this.player];
    for (const player of players) {
      this.renderPlayer(context, player);
    }
  }

  renderPlayer(context, player = this.player) {
    const previousPlayer = this.player;
    this.player = player;
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
      this.player = previousPlayer;
      return;
    }

    const aim = this.getAimDirection();
    const character = getCharacterById(this.player.characterId);
    context.save();
    context.translate(this.player.x, this.player.y);
    if (this.player.downed) {
      context.globalAlpha = 0.72;
    }
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
    if (this.player.downed) {
      context.save();
      context.translate(this.player.x, this.player.y);
      context.strokeStyle = "rgba(254, 202, 202, 0.95)";
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(-12, -12);
      context.lineTo(12, 12);
      context.moveTo(12, -12);
      context.lineTo(-12, 12);
      context.stroke();
      if (this.player.reviveProgress > 0) {
        context.strokeStyle = "rgba(134, 239, 172, 0.92)";
        context.lineWidth = 4;
        context.beginPath();
        context.arc(0, 0, this.player.radius + 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(this.player.reviveProgress / COOP_CONFIG.reviveSeconds, 0, 1));
        context.stroke();
      }
      context.restore();
    }
    if (this.isCoopRun() && this.player.name) {
      context.save();
      context.font = "700 12px system-ui, sans-serif";
      context.textAlign = "center";
      context.fillStyle = this.player.isLocal ? "#a7f3d0" : "#bfdbfe";
      context.fillText(this.player.name, this.player.x, this.player.y - this.player.radius - 14);
      context.restore();
    }

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
    this.player = previousPlayer;
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



