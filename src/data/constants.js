export const LOGICAL_WIDTH = 1280;
export const LOGICAL_HEIGHT = 720;
export const CAMERA_CONFIG = {
  defaultZoom: 0.72,
  minZoom: 0.5,
  maxZoom: 1.2,
  keyboardStep: 0.1,
  wheelSensitivity: 0.0014,
};
export const STORAGE_KEY = "bubble-blitz-forever-save";

export const SETTINGS_DEFAULTS = {
  muted: false,
  musicVolume: 0.45,
  adminModeEnabled: false,
};

export const ADMIN_PASSWORD_DIGEST = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";

export const DEFAULT_SONGS = [];

export const PLAYER_BASE = {
  radius: 18,
  maxHp: 5,
  moveSpeed: 320,
  fireCooldown: 0.34,
  projectileSpeed: 760,
  projectileRadius: 8,
  projectileDamage: 1,
  projectileLifetime: 1.45,
  pierce: 0,
  multishot: 1,
  spreadAngle: 0.18,
  dashSpeed: 980,
  dashDuration: 0.18,
  dashCooldown: 2.4,
  dashInvulnerability: 0.15,
  magnetRadius: 90,
  maxShields: 0,
  shieldRegenSeconds: 18,
  xpMultiplier: 1,
  grenadeCooldown: 7.5,
  grenadeDamage: 8,
  grenadeRadius: 96,
  grenadeProjectileSpeed: 890,
  grenadeFuse: 0.78,
  landmineCooldown: 9,
  landmineDamage: 10,
  landmineRadius: 120,
  landmineArmTime: 0.5,
  landmineTriggerRadius: 34,
  maxLandmines: 4,
};

export const SCORE_CONFIG = {
  survivalPerSecond: 12,
  killUnit: 42,
  bossBonus: 1200,
};

export const GOLD_CONFIG = {
  normalKill: 1,
  bossKill: 25,
  doubleChance: 0.01,
  enemyKills: {
    nibbler: 2,
    sprinter: 1,
    spitter: 5,
    marksman: 6,
    "acid-spitter": 7,
    bumper: 8,
    tank: 15,
    sentinel: 3,
  },
};

export const XP_CONFIG = {
  base: 38,
  growth: 22,
};

export const GAME_CONFIG = {
  maxDeltaSeconds: 1 / 30,
  padding: 28,
  spawnPadding: 70,
  pickupLifetime: 18,
  bossInterval: 180,
  bossWarningLead: 8,
  maxEnemies: 90,
  enemyRecycleMargin: 900,
  enemyRecycleSeconds: 4,
};

export function getXpThreshold(level) {
  return XP_CONFIG.base + (level - 1) * XP_CONFIG.growth;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

export function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}
