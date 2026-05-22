export const CHARACTER_IDS = {
  gunner: "gunner",
  katana: "katana",
};

export const KATANA_UNLOCK_BOSSES = 3;

/** @type {Record<string, import("../types.js").CharacterDef>} */
export const CHARACTER_DEFS = {
  [CHARACTER_IDS.gunner]: {
    id: CHARACTER_IDS.gunner,
    name: "Gunner",
    description: "Auto-targets enemies with ranged shots.",
    attackType: "ranged",
    unlockedByDefault: true,
    color: "#22d3ee",
    accent: "#0f766e",
  },
  [CHARACTER_IDS.katana]: {
    id: CHARACTER_IDS.katana,
    name: "Katana",
    description: "Auto-slashes nearby enemies with a close-range blade.",
    attackType: "melee",
    unlockBossKills: KATANA_UNLOCK_BOSSES,
    color: "#f8fafc",
    accent: "#ef4444",
    slash: {
      damage: 2.2,
      range: 104,
      arc: Math.PI * 0.72,
      cooldown: 0.42,
      maxTargets: 2,
      bleedDamagePerSecond: 0,
      bleedDuration: 0,
      counterInvulnerability: 0,
      dashSlashDamage: 0,
    },
  },
};

export function getCharacterById(characterId) {
  return CHARACTER_DEFS[characterId] ?? CHARACTER_DEFS[CHARACTER_IDS.gunner];
}

export function isCharacterUnlocked(progress, stats, characterId) {
  if (characterId === CHARACTER_IDS.gunner) {
    return true;
  }
  if (characterId === CHARACTER_IDS.katana) {
    return Boolean(progress?.katanaUnlocked || (stats?.total?.bosses ?? 0) >= KATANA_UNLOCK_BOSSES);
  }
  return false;
}
