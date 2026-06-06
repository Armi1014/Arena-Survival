import { DEFAULT_SONGS, SETTINGS_DEFAULTS, STORAGE_KEY } from "./data/constants.js";
import { CHARACTER_IDS, ENGINEER_UNLOCK_KILLS, KATANA_UNLOCK_BOSSES, isCharacterUnlocked } from "./data/characters.js";
import { BOSS_DEF, ENEMY_DEFS } from "./data/enemies.js";

const AUDIO_DB_NAME = "bubble-blitz-forever-audio";
const AUDIO_STORE_NAME = "song-files";
const AUDIO_DB_VERSION = 1;
const songAudioUrls = new Map();
const ENEMY_STAT_IDS = [...Object.keys(ENEMY_DEFS), BOSS_DEF.id];
const ABILITY_ACCESSORY_IDS = ["grenade", "landmine"];
const LEGACY_BUILT_IN_SONG_IDS = new Set(["arcade-pulse", "neon-run", "boss-voltage"]);

function openAudioDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = window.indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        database.createObjectStore(AUDIO_STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Could not open audio storage.")));
  });
}

async function withAudioStore(mode, action) {
  const database = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUDIO_STORE_NAME, mode);
    const store = transaction.objectStore(AUDIO_STORE_NAME);
    let request;
    try {
      request = action(store);
    } catch (error) {
      reject(error);
      database.close();
      return;
    }
    transaction.addEventListener("complete", () => {
      resolve(request?.result);
      database.close();
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? request?.error ?? new Error("Audio storage failed."));
      database.close();
    });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("Audio storage was aborted."));
      database.close();
    });
  });
}

export async function saveSongAudio(songId, file) {
  await withAudioStore("readwrite", (store) => store.put(file, songId));
}

export async function deleteSongAudio(songId) {
  const currentUrl = songAudioUrls.get(songId);
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    songAudioUrls.delete(songId);
  }
  await withAudioStore("readwrite", (store) => store.delete(songId));
}

export async function hydrateAdminSongAudio(adminSongs) {
  if (!Array.isArray(adminSongs) || !adminSongs.length || !window.indexedDB) {
    return adminSongs;
  }
  const songs = await Promise.all(
    adminSongs.map(async (song) => {
      if ((song.src && !song.src.startsWith("blob:")) || !song.audioKey) {
        return song;
      }
      const file = await withAudioStore("readonly", (store) => store.get(song.audioKey));
      if (!file) {
        return song;
      }
      const previousUrl = songAudioUrls.get(song.id);
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      const src = URL.createObjectURL(file);
      songAudioUrls.set(song.id, src);
      return { ...song, src };
    }),
  );
  return songs;
}

function getEmptyStats() {
  return {
    best: {
      score: 0,
      time: 0,
      kills: 0,
      bosses: 0,
      level: 0,
    },
    total: {
      runs: 0,
      score: 0,
      time: 0,
      kills: 0,
      bosses: 0,
      shotsFired: 0,
      damageTaken: 0,
    },
    enemy: Object.fromEntries(ENEMY_STAT_IDS.map((enemyId) => [enemyId, { kills: 0, deaths: 0 }])),
  };
}

function getEmptyLoadouts() {
  return Object.fromEntries(Object.values(CHARACTER_IDS).map((characterId) => [characterId, { accessoryIds: [] }]));
}

function normalizeAbilityId(abilityId, grenadeUnlocked, landmineUnlocked) {
  if (abilityId === "grenade" && grenadeUnlocked) {
    return "grenade";
  }
  if (abilityId === "landmine" && landmineUnlocked) {
    return "landmine";
  }
  return "";
}

function normalizeLoadouts(progress, selectedCharacterId, equippedAbilityId, grenadeUnlocked, landmineUnlocked) {
  const loadouts = getEmptyLoadouts();
  const sourceLoadouts = progress?.loadouts && typeof progress.loadouts === "object" ? progress.loadouts : {};
  for (const characterId of Object.values(CHARACTER_IDS)) {
    const rawAccessoryIds = Array.isArray(sourceLoadouts?.[characterId]?.accessoryIds)
      ? sourceLoadouts[characterId].accessoryIds
      : [];
    const accessoryIds = rawAccessoryIds
      .map((abilityId) => normalizeAbilityId(abilityId, grenadeUnlocked, landmineUnlocked))
      .filter(Boolean)
      .slice(0, 1);
    loadouts[characterId] = { accessoryIds };
  }
  if (equippedAbilityId && !loadouts[selectedCharacterId]?.accessoryIds?.length) {
    loadouts[selectedCharacterId] = { accessoryIds: [equippedAbilityId] };
  }
  return loadouts;
}

function getLoadoutAbilityId(loadouts, selectedCharacterId, grenadeUnlocked, landmineUnlocked) {
  const accessoryIds = loadouts?.[selectedCharacterId]?.accessoryIds ?? [];
  for (const accessoryId of accessoryIds) {
    const normalized = normalizeAbilityId(accessoryId, grenadeUnlocked, landmineUnlocked);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeMusicState(music) {
  const adminSongs = Array.isArray(music?.adminSongs) ? music.adminSongs.filter((song) => song?.id && song?.title) : [];
  const catalogIds = new Set([...DEFAULT_SONGS.map((song) => song.id), ...adminSongs.map((song) => song.id)]);
  const ownedSongIds = Array.isArray(music?.ownedSongIds)
    ? music.ownedSongIds.filter((id) => typeof id === "string" && catalogIds.has(id) && !LEGACY_BUILT_IN_SONG_IDS.has(id))
    : [];
  const freeDefaultSongIds = DEFAULT_SONGS.filter((song) => Math.max(0, Number(song.price) || 0) === 0).map((song) => song.id);
  const owned = Array.from(new Set([...freeDefaultSongIds, ...ownedSongIds]));
  const selectedSongId =
    typeof music?.selectedSongId === "string" && owned.includes(music.selectedSongId) && catalogIds.has(music.selectedSongId)
      ? music.selectedSongId
      : "";
  return {
    selectedSongId,
    ownedSongIds: owned,
    customRequests: Array.isArray(music?.customRequests) ? music.customRequests : [],
    adminSongs,
  };
}

function getEmptySave() {
  return {
    highScore: 0,
    wallet: {
      gold: 0,
    },
    music: {
      selectedSongId: "",
      ownedSongIds: [],
      customRequests: [],
      adminSongs: [],
    },
    stats: getEmptyStats(),
    progress: {
      grenadeUnlocked: false,
      grenadeEquipped: false,
      landmineUnlocked: false,
      equippedAbilityId: "",
      katanaUnlocked: false,
      engineerUnlocked: false,
      selectedCharacterId: CHARACTER_IDS.gunner,
      loadouts: getEmptyLoadouts(),
    },
    settings: { ...SETTINGS_DEFAULTS },
  };
}

function toFiniteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeEnemyStats(enemyStats) {
  const normalized = {};
  for (const enemyId of ENEMY_STAT_IDS) {
    const current = enemyStats?.[enemyId] ?? {};
    normalized[enemyId] = {
      kills: Math.max(0, toFiniteNumber(current.kills)),
      deaths: Math.max(0, toFiniteNumber(current.deaths)),
    };
  }
  return normalized;
}

function normalizeStats(stats, highScore = 0) {
  const emptyStats = getEmptyStats();
  const best = stats?.best ?? {};
  const total = stats?.total ?? {};

  return {
    best: {
      score: Math.max(toFiniteNumber(best.score), toFiniteNumber(highScore)),
      time: toFiniteNumber(best.time),
      kills: toFiniteNumber(best.kills),
      bosses: toFiniteNumber(best.bosses),
      level: toFiniteNumber(best.level),
    },
    total: {
      runs: toFiniteNumber(total.runs, emptyStats.total.runs),
      score: toFiniteNumber(total.score, emptyStats.total.score),
      time: toFiniteNumber(total.time, emptyStats.total.time),
      kills: toFiniteNumber(total.kills, emptyStats.total.kills),
      bosses: toFiniteNumber(total.bosses, emptyStats.total.bosses),
      shotsFired: toFiniteNumber(total.shotsFired, emptyStats.total.shotsFired),
      damageTaken: toFiniteNumber(total.damageTaken, emptyStats.total.damageTaken),
    },
    enemy: normalizeEnemyStats(stats?.enemy),
  };
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getEmptySave();
    }

    const parsed = JSON.parse(raw);
    const stats = normalizeStats(parsed?.stats, parsed?.highScore);
    const grenadeUnlocked = Boolean(parsed?.progress?.grenadeUnlocked || stats.best.kills >= 250);
    const landmineUnlocked = Boolean(parsed?.progress?.landmineUnlocked || stats.best.time >= 300);
    const legacyGrenadeEquipped = Boolean(grenadeUnlocked && parsed?.progress?.grenadeEquipped);
    const requestedAbilityId = typeof parsed?.progress?.equippedAbilityId === "string" ? parsed.progress.equippedAbilityId : "";
    const equippedAbilityId =
      requestedAbilityId === "grenade" && grenadeUnlocked
        ? "grenade"
        : requestedAbilityId === "landmine" && landmineUnlocked
          ? "landmine"
          : legacyGrenadeEquipped
            ? "grenade"
            : "";
    const katanaUnlocked = isCharacterUnlocked(parsed?.progress, stats, CHARACTER_IDS.katana);
    const engineerUnlocked = isCharacterUnlocked(parsed?.progress, stats, CHARACTER_IDS.engineer);
    const selectedCharacterId = [CHARACTER_IDS.katana, CHARACTER_IDS.engineer].includes(parsed?.progress?.selectedCharacterId) &&
      isCharacterUnlocked({ ...parsed?.progress, katanaUnlocked, engineerUnlocked }, stats, parsed.progress.selectedCharacterId)
      ? parsed.progress.selectedCharacterId
      : CHARACTER_IDS.gunner;
    const loadouts = normalizeLoadouts(parsed?.progress, selectedCharacterId, equippedAbilityId, grenadeUnlocked, landmineUnlocked);
    const loadoutAbilityId = getLoadoutAbilityId(loadouts, selectedCharacterId, grenadeUnlocked, landmineUnlocked) || equippedAbilityId;
    const music = normalizeMusicState(parsed?.music);
    return {
      highScore: Number.isFinite(parsed?.highScore) ? parsed.highScore : 0,
      wallet: {
        gold: Math.max(0, toFiniteNumber(parsed?.wallet?.gold)),
      },
      music,
      stats,
      progress: {
        grenadeUnlocked,
        grenadeEquipped: loadoutAbilityId === "grenade",
        landmineUnlocked,
        equippedAbilityId: loadoutAbilityId,
        katanaUnlocked,
        engineerUnlocked,
        selectedCharacterId,
        loadouts,
      },
      settings: {
        ...SETTINGS_DEFAULTS,
        ...(parsed?.settings ?? {}),
      },
    };
  } catch {
    return getEmptySave();
  }
}

export function updateWallet(save, partialWallet) {
  const next = {
    ...save,
    wallet: {
      gold: Math.max(0, toFiniteNumber(save.wallet?.gold)),
      ...partialWallet,
    },
  };
  next.wallet.gold = Math.max(0, Math.floor(toFiniteNumber(next.wallet.gold)));
  persistSave(next);
  return next;
}

export function updateMusic(save, partialMusic) {
  const currentMusic = normalizeMusicState(save.music ?? {});
  const next = {
    ...save,
    music: normalizeMusicState({
      ...currentMusic,
      ...partialMusic,
    }),
  };
  persistSave(next);
  return next;
}

export function persistSave(save) {
  const storedSave = {
    ...save,
    music: {
      ...(save.music ?? {}),
      adminSongs: Array.isArray(save.music?.adminSongs)
        ? save.music.adminSongs.map((song) => {
            if (!song?.src || song.builtIn) {
              return song;
            }
            return { ...song, src: "" };
          })
        : [],
    },
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSave));
}

export function updateHighScore(save, score) {
  const nextHighScore = Math.floor(score);
  if (nextHighScore <= save.highScore) {
    return save;
  }

  const next = {
    ...save,
    highScore: nextHighScore,
    stats: {
      ...normalizeStats(save.stats, save.highScore),
      best: {
        ...normalizeStats(save.stats, save.highScore).best,
        score: nextHighScore,
      },
    },
  };
  persistSave(next);
  return next;
}

export function recordRun(save, run) {
  const stats = normalizeStats(save.stats, save.highScore);
  const score = Math.floor(run.score);
  const elapsed = Math.max(0, run.elapsed);
  const kills = Math.max(0, run.kills);
  const bosses = Math.max(0, run.bossKills);
  const level = Math.max(1, run.level);
  const shotsFired = Math.max(0, run.shotsFired);
  const damageTaken = Math.max(0, run.damageTaken);
  const enemy = normalizeEnemyStats(stats.enemy);
  for (const enemyId of ENEMY_STAT_IDS) {
    enemy[enemyId].kills += Math.max(0, toFiniteNumber(run.enemyKills?.[enemyId]));
    enemy[enemyId].deaths += Math.max(0, toFiniteNumber(run.enemyDeaths?.[enemyId]));
  }

  const next = {
    ...save,
    highScore: Math.max(save.highScore, score),
    progress: {
      ...(save.progress ?? {}),
      grenadeUnlocked: Boolean(save.progress?.grenadeUnlocked || kills >= 250),
      grenadeEquipped: Boolean(save.progress?.equippedAbilityId === "grenade" || save.progress?.grenadeEquipped),
      landmineUnlocked: Boolean(save.progress?.landmineUnlocked || elapsed >= 300),
      equippedAbilityId: save.progress?.equippedAbilityId === "landmine" && (save.progress?.landmineUnlocked || elapsed >= 300)
        ? "landmine"
        : (save.progress?.equippedAbilityId === "grenade" || save.progress?.grenadeEquipped) && (save.progress?.grenadeUnlocked || kills >= 250)
          ? "grenade"
          : "",
      katanaUnlocked: Boolean(save.progress?.katanaUnlocked || stats.total.bosses + bosses >= KATANA_UNLOCK_BOSSES),
      engineerUnlocked: Boolean(save.progress?.engineerUnlocked || stats.total.kills + kills >= ENGINEER_UNLOCK_KILLS),
      selectedCharacterId: isCharacterUnlocked(
        {
          ...(save.progress ?? {}),
          katanaUnlocked: Boolean(save.progress?.katanaUnlocked || stats.total.bosses + bosses >= KATANA_UNLOCK_BOSSES),
          engineerUnlocked: Boolean(save.progress?.engineerUnlocked || stats.total.kills + kills >= ENGINEER_UNLOCK_KILLS),
        },
        {
          ...stats,
          total: {
            ...stats.total,
            bosses: stats.total.bosses + bosses,
            kills: stats.total.kills + kills,
          },
        },
        save.progress?.selectedCharacterId,
      )
        ? save.progress.selectedCharacterId
        : CHARACTER_IDS.gunner,
      loadouts: normalizeLoadouts(
        save.progress,
        isCharacterUnlocked(save.progress, save.stats, save.progress?.selectedCharacterId) ? save.progress.selectedCharacterId : CHARACTER_IDS.gunner,
        save.progress?.equippedAbilityId,
        Boolean(save.progress?.grenadeUnlocked || kills >= 250),
        Boolean(save.progress?.landmineUnlocked || elapsed >= 300),
      ),
    },
    stats: {
      best: {
        score: Math.max(stats.best.score, score),
        time: Math.max(stats.best.time, elapsed),
        kills: Math.max(stats.best.kills, kills),
        bosses: Math.max(stats.best.bosses, bosses),
        level: Math.max(stats.best.level, level),
      },
      total: {
        runs: stats.total.runs + 1,
        score: stats.total.score + score,
        time: stats.total.time + elapsed,
        kills: stats.total.kills + kills,
        bosses: stats.total.bosses + bosses,
        shotsFired: stats.total.shotsFired + shotsFired,
        damageTaken: stats.total.damageTaken + damageTaken,
      },
      enemy,
    },
  };
  persistSave(next);
  return next;
}

export function resetStats(save) {
  const next = {
    ...save,
    highScore: 0,
    stats: getEmptyStats(),
  };
  persistSave(next);
  return next;
}

export function updateProgress(save, partialProgress) {
  const baseGrenadeUnlocked = Boolean(save.progress?.grenadeUnlocked);
  const baseLandmineUnlocked = Boolean(save.progress?.landmineUnlocked);
  const baseEquippedAbilityId =
    save.progress?.equippedAbilityId === "landmine" && baseLandmineUnlocked
      ? "landmine"
      : (save.progress?.equippedAbilityId === "grenade" || save.progress?.grenadeEquipped) && baseGrenadeUnlocked
        ? "grenade"
        : "";
  const baseSelectedCharacterId = isCharacterUnlocked(save.progress, save.stats, save.progress?.selectedCharacterId)
    ? save.progress.selectedCharacterId
    : CHARACTER_IDS.gunner;
  const baseLoadouts = normalizeLoadouts(
    save.progress,
    baseSelectedCharacterId,
    baseEquippedAbilityId,
    baseGrenadeUnlocked,
    baseLandmineUnlocked,
  );
  const nextProgress = {
    grenadeUnlocked: baseGrenadeUnlocked,
    grenadeEquipped: baseEquippedAbilityId === "grenade",
    landmineUnlocked: baseLandmineUnlocked,
    equippedAbilityId: baseEquippedAbilityId,
    katanaUnlocked: isCharacterUnlocked(save.progress, save.stats, CHARACTER_IDS.katana),
    engineerUnlocked: isCharacterUnlocked(save.progress, save.stats, CHARACTER_IDS.engineer),
    selectedCharacterId: baseSelectedCharacterId,
    loadouts: baseLoadouts,
    ...partialProgress,
  };
  nextProgress.loadouts = normalizeLoadouts(
    nextProgress,
    nextProgress.selectedCharacterId,
    nextProgress.equippedAbilityId,
    nextProgress.grenadeUnlocked,
    nextProgress.landmineUnlocked,
  );
  nextProgress.equippedAbilityId =
    getLoadoutAbilityId(nextProgress.loadouts, nextProgress.selectedCharacterId, nextProgress.grenadeUnlocked, nextProgress.landmineUnlocked) ||
    normalizeAbilityId(nextProgress.equippedAbilityId, nextProgress.grenadeUnlocked, nextProgress.landmineUnlocked);
  if (nextProgress.equippedAbilityId === "grenade" && !nextProgress.grenadeUnlocked) {
    nextProgress.equippedAbilityId = "";
  }
  if (nextProgress.equippedAbilityId === "landmine" && !nextProgress.landmineUnlocked) {
    nextProgress.equippedAbilityId = "";
  }
  nextProgress.grenadeEquipped = nextProgress.equippedAbilityId === "grenade";
  nextProgress.selectedCharacterId =
    isCharacterUnlocked(nextProgress, save.stats, nextProgress.selectedCharacterId) ? nextProgress.selectedCharacterId : CHARACTER_IDS.gunner;
  nextProgress.loadouts = normalizeLoadouts(
    nextProgress,
    nextProgress.selectedCharacterId,
    nextProgress.equippedAbilityId,
    nextProgress.grenadeUnlocked,
    nextProgress.landmineUnlocked,
  );
  const next = {
    ...save,
    progress: nextProgress,
  };
  persistSave(next);
  return next;
}

export function updateSettings(save, partialSettings) {
  const next = {
    ...save,
    settings: {
      ...save.settings,
      ...partialSettings,
    },
  };
  persistSave(next);
  return next;
}
