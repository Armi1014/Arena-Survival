import { CHARACTER_IDS } from "./characters.js";

const SHIELD_INTERVALS = [16, 12, 9];
const SHIELD_CAPS = [1, 2, 2];

/** @type {import("../types.js").UpgradeDef[]} */
export const UPGRADE_DEFS = [
  {
    id: "rapid-pop",
    name: "Rapid Fire",
    cap: 5,
    color: "#2563eb",
    accent: "#dbeafe",
    excludeCharacters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: fire ${Math.round((1 - 0.88 ** rank) * 100)}% faster without turning hold-fire on.`,
    apply: (player) => {
      player.fireCooldown = Math.max(0.12, player.fireCooldown * 0.88);
      player.fireCooldownRemaining = Math.min(player.fireCooldownRemaining, player.fireCooldown);
    },
  },
  {
    id: "rocket-fizz",
    name: "High Velocity",
    cap: 4,
    color: "#0f766e",
    accent: "#ccfbf1",
    excludeCharacters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: projectile speed +90 for snappier clicks.`,
    apply: (player) => {
      player.projectileSpeed += 90;
    },
  },
  {
    id: "gumdrop-shells",
    name: "Heavy Rounds",
    cap: 4,
    color: "#b7791f",
    accent: "#fef3c7",
    excludeCharacters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: projectile size +2 and damage +0.15.`,
    apply: (player) => {
      player.projectileRadius += 2;
      player.projectileDamage += 0.15;
    },
  },
  {
    id: "pin-pop",
    name: "Piercing Rounds",
    cap: 4,
    color: "#475569",
    accent: "#e2e8f0",
    excludeCharacters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: bullets pierce +1 target.`,
    apply: (player) => {
      player.pierce += 1;
    },
  },
  {
    id: "confetti-fan",
    name: "Split Shot",
    cap: 3,
    color: "#7c3aed",
    accent: "#ede9fe",
    excludeCharacters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: fire +1 extra pellet per click.`,
    apply: (player) => {
      player.multishot += 1;
    },
  },
  {
    id: "skipping-shoes",
    name: "Running Shoes",
    cap: 4,
    color: "#0f766e",
    accent: "#ccfbf1",
    describe: (rank) => `Rank ${rank}: move speed +26 for tighter kiting.`,
    apply: (player) => {
      player.moveSpeed += 26;
    },
  },
  {
    id: "zip-ribbon",
    name: "Quick Dash",
    cap: 4,
    color: "#b7791f",
    accent: "#fef3c7",
    describe: (rank) => `Rank ${rank}: dash cooldown shrinks by 14%.`,
    apply: (player) => {
      player.dashCooldown = Math.max(0.75, player.dashCooldown * 0.86);
      player.dashCooldownRemaining = Math.min(player.dashCooldownRemaining, player.dashCooldown);
    },
  },
  {
    id: "heart-balloon",
    name: "Med Kit",
    cap: 4,
    color: "#d14343",
    accent: "#fee2e2",
    describe: (rank) => `Rank ${rank}: max health +1.`,
    apply: (player) => {
      player.maxHp += 1;
    },
  },
  {
    id: "glitter-vac",
    name: "Field Magnet",
    cap: 4,
    color: "#2563eb",
    accent: "#dbeafe",
    describe: (rank) => `Rank ${rank}: pickup magnet radius +40.`,
    apply: (player) => {
      player.magnetRadius += 40;
    },
  },
  {
    id: "xp-surge",
    name: "XP Surge",
    cap: 4,
    color: "#22c55e",
    accent: "#dcfce7",
    describe: (rank) => `Rank ${rank}: XP pickups are worth ${Math.round((1.18 ** rank - 1) * 100)}% more.`,
    apply: (player) => {
      player.xpMultiplier *= 1.18;
    },
  },
  {
    id: "bubble-guard",
    name: "Shield Unit",
    cap: 3,
    color: "#475569",
    accent: "#e2e8f0",
    describe: (rank) =>
      `Rank ${rank}: regenerate shields every ${SHIELD_INTERVALS[rank - 1]}s, hold up to ${SHIELD_CAPS[rank - 1]}.`,
    apply: (player, rank) => {
      player.shieldRegenSeconds = SHIELD_INTERVALS[rank - 1];
      player.maxShields = SHIELD_CAPS[rank - 1];
      player.shields = Math.max(player.shields, 1);
      player.shieldRegenTimer = 0;
    },
  },
  {
    id: "shatter-rounds",
    name: "Shatter Rounds",
    cap: 3,
    color: "#38bdf8",
    accent: "#e0f2fe",
    excludeCharacters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: kills split into ${rank + 1} short-range fragments.`,
    apply: (player, rank) => {
      player.shatterFragments = rank + 1;
    },
  },
  {
    id: "ability-reload",
    name: "Ability Reload",
    cap: 3,
    color: "#f59e0b",
    accent: "#fef3c7",
    isAvailable: (player) => Boolean(player.equippedAbilityId),
    describe: (rank) => `Rank ${rank}: equipped ability cooldowns shrink by ${Math.round((1 - 0.86 ** rank) * 100)}%.`,
    apply: (player) => {
      player.grenadeCooldown = Math.max(3.2, player.grenadeCooldown * 0.86);
      player.grenadeCooldownRemaining = Math.min(player.grenadeCooldownRemaining, player.grenadeCooldown);
      player.landmineCooldown = Math.max(4, player.landmineCooldown * 0.86);
      player.landmineCooldownRemaining = Math.min(player.landmineCooldownRemaining, player.landmineCooldown);
    },
  },
  {
    id: "sharpened-edge",
    name: "Sharpened Edge",
    cap: 5,
    color: "#ef4444",
    accent: "#fee2e2",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: katana slash damage +0.55.`,
    apply: (player) => {
      player.slashDamage += 0.55;
    },
  },
  {
    id: "long-blade",
    name: "Long Blade",
    cap: 4,
    color: "#06b6d4",
    accent: "#cffafe",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: katana range +22.`,
    apply: (player) => {
      player.slashRange += 22;
    },
  },
  {
    id: "wide-cut",
    name: "Wide Cut",
    cap: 4,
    color: "#a855f7",
    accent: "#f3e8ff",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: slash arc widens by 12 degrees.`,
    apply: (player) => {
      player.slashArc += Math.PI / 15;
    },
  },
  {
    id: "quick-draw",
    name: "Quick Draw",
    cap: 5,
    color: "#f59e0b",
    accent: "#fef3c7",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: katana slashes 12% faster.`,
    apply: (player) => {
      player.fireCooldown = Math.max(0.18, player.fireCooldown * 0.88);
      player.fireCooldownRemaining = Math.min(player.fireCooldownRemaining, player.fireCooldown);
    },
  },
  {
    id: "flow-strike",
    name: "Flow Strike",
    cap: 3,
    color: "#22c55e",
    accent: "#dcfce7",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: slash can hit +1 enemy.`,
    apply: (player) => {
      player.slashMaxTargets += 1;
    },
  },
  {
    id: "bleeding-cut",
    name: "Bleeding Cut",
    cap: 3,
    color: "#be123c",
    accent: "#ffe4e6",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: katana hits bleed for ${rank + 1}s.`,
    apply: (player, rank) => {
      player.bleedDamagePerSecond = 0.45 + rank * 0.3;
      player.bleedDuration = rank + 1;
    },
  },
  {
    id: "counter-guard",
    name: "Counter Guard",
    cap: 3,
    color: "#475569",
    accent: "#e2e8f0",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: katana hits grant ${Math.round((0.1 + rank * 0.08) * 100) / 100}s of guard.`,
    apply: (player, rank) => {
      player.counterInvulnerability = 0.1 + rank * 0.08;
    },
  },
  {
    id: "dash-slash",
    name: "Dash Slash",
    cap: 3,
    color: "#38bdf8",
    accent: "#e0f2fe",
    characters: [CHARACTER_IDS.katana],
    describe: (rank) => `Rank ${rank}: dashing releases a ${Math.round(rank * 65)}% power slash.`,
    apply: (player, rank) => {
      player.dashSlashDamage = rank * 0.65;
    },
  },
  {
    id: "overheal-shield",
    name: "Overheal Shield",
    cap: 3,
    color: "#fb7185",
    accent: "#ffe4e6",
    describe: (rank) => `Rank ${rank}: Med Kits grant +${rank} shield when already healthy.`,
    apply: (player, rank) => {
      player.overhealShieldBonus = rank;
    },
  },
  {
    id: "grenade-payload",
    name: "Grenade Payload",
    cap: 4,
    color: "#f97316",
    accent: "#ffedd5",
    isAvailable: (player) => player.equippedAbilityId === "grenade",
    describe: (rank) => `Rank ${rank}: grenade damage +3 and blast radius +10.`,
    apply: (player) => {
      player.grenadeDamage += 3;
      player.grenadeRadius += 10;
    },
  },
  {
    id: "grenade-cycler",
    name: "Grenade Cycler",
    cap: 4,
    color: "#06b6d4",
    accent: "#cffafe",
    isAvailable: (player) => player.equippedAbilityId === "grenade",
    describe: (rank) => `Rank ${rank}: grenade cooldown shrinks by 15%.`,
    apply: (player) => {
      player.grenadeCooldown = Math.max(3.2, player.grenadeCooldown * 0.85);
      player.grenadeCooldownRemaining = Math.min(player.grenadeCooldownRemaining, player.grenadeCooldown);
    },
  },
  {
    id: "volatile-grenade",
    name: "Volatile Grenade",
    cap: 3,
    color: "#ef4444",
    accent: "#fee2e2",
    isAvailable: (player) => player.equippedAbilityId === "grenade",
    describe: (rank) => `Rank ${rank}: grenade blasts leave a burning zone for ${rank + 2}s.`,
    apply: (player, rank) => {
      player.grenadeZoneDuration = rank + 2;
      player.grenadeZoneDamage = 0.9 + rank * 0.35;
    },
  },
  {
    id: "blast-plating",
    name: "Blast Plating",
    cap: 4,
    color: "#f59e0b",
    accent: "#fef3c7",
    isAvailable: (player) => player.equippedAbilityId === "landmine",
    describe: (rank) => `Rank ${rank}: landmine damage +3 and blast radius +12.`,
    apply: (player) => {
      player.landmineDamage += 3;
      player.landmineRadius += 12;
    },
  },
  {
    id: "fast-trigger",
    name: "Fast Trigger",
    cap: 4,
    color: "#22d3ee",
    accent: "#cffafe",
    isAvailable: (player) => player.equippedAbilityId === "landmine",
    describe: (rank) => `Rank ${rank}: landmine cooldown shrinks and arm time drops.`,
    apply: (player) => {
      player.landmineCooldown = Math.max(4, player.landmineCooldown * 0.84);
      player.landmineCooldownRemaining = Math.min(player.landmineCooldownRemaining, player.landmineCooldown);
      player.landmineArmTime = Math.max(0.16, player.landmineArmTime - 0.08);
    },
  },
  {
    id: "cluster-charge",
    name: "Cluster Charge",
    cap: 3,
    color: "#ef4444",
    accent: "#fee2e2",
    isAvailable: (player) => player.equippedAbilityId === "landmine",
    describe: (rank) => `Rank ${rank}: mine explosions launch ${rank + 3} piercing fragments.`,
    apply: (player, rank) => {
      player.landmineClusterFragments = rank + 3;
    },
  },
  {
    id: "rapid-assembly",
    name: "Rapid Assembly",
    cap: 4,
    color: "#34d399",
    accent: "#dcfce7",
    characters: [CHARACTER_IDS.engineer],
    describe: (rank) => `Rank ${rank}: turret cooldown shrinks by 18% and lifetime +3s.`,
    apply: (player) => {
      player.turretDeployCooldown = Math.max(2.8, player.turretDeployCooldown * 0.82);
      player.turretDeployCooldownRemaining = Math.min(player.turretDeployCooldownRemaining, player.turretDeployCooldown);
      player.turretLifetime += 3;
    },
  },
  {
    id: "twin-sentries",
    name: "Twin Sentries",
    cap: 2,
    color: "#06b6d4",
    accent: "#cffafe",
    characters: [CHARACTER_IDS.engineer],
    describe: (rank) => `Rank ${rank}: deploy +1 active turret.`,
    apply: (player) => {
      player.maxTurrets += 1;
    },
  },
  {
    id: "calibrated-turret",
    name: "Calibrated Turret",
    cap: 4,
    color: "#a855f7",
    accent: "#f3e8ff",
    characters: [CHARACTER_IDS.engineer],
    describe: (rank) => `Rank ${rank}: turret range +60 and turret damage +0.5.`,
    apply: (player) => {
      player.turretRange += 60;
      player.turretDamageBonus += 0.5;
    },
  },
  {
    id: "overclocked-sentry",
    name: "Overclocked Sentry",
    cap: 4,
    color: "#f97316",
    accent: "#ffedd5",
    characters: [CHARACTER_IDS.engineer],
    describe: (rank) => `Rank ${rank}: turret attack cooldown shrinks by 12%.`,
    apply: (player) => {
      player.turretFireCooldown = Math.max(0.38, player.turretFireCooldown * 0.88);
    },
  },
  {
    id: "piercing-sentry",
    name: "Piercing Sentry",
    cap: 3,
    color: "#64748b",
    accent: "#e2e8f0",
    characters: [CHARACTER_IDS.engineer],
    describe: (rank) => `Rank ${rank}: turret shots pierce +1 target.`,
    apply: (player) => {
      player.turretPierce += 1;
    },
  },
];

export function getUpgradeById(upgradeId) {
  return UPGRADE_DEFS.find((upgrade) => upgrade.id === upgradeId) ?? null;
}
