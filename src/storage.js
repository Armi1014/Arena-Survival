import { DEFAULT_SONGS, SETTINGS_DEFAULTS, STORAGE_KEY } from "./data/constants.js";
import { CHARACTER_IDS, ENGINEER_UNLOCK_KILLS, KATANA_UNLOCK_BOSSES, isCharacterUnlocked } from "./data/characters.js";
import { BOSS_DEF, ENEMY_DEFS } from "./data/enemies.js";

const AUDIO_DB_NAME = "bubble-blitz-forever-audio";
const AUDIO_STORE_NAME = "song-files";
const AUDIO_DB_VERSION = 1;
const songAudioUrls = new Map();
const ENEMY_STAT_IDS = [...Object.keys(ENEMY_DEFS), BOSS_DEF.id];

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

function getEmptySave() {
  const defaultSongId = DEFAULT_SONGS[0]?.id ?? "arcade-pulse";
  return {
    highScore: 0,
    wallet: {
      gold: 0,
    },
    music: {
      selectedSongId: defaultSongId,
      ownedSongIds: [defaultSongId],
      customRequests: [],
      adminSongs: [],
    },
    stats: getEmptyStats(),
    progress: {
      grenadeUnlocked: false,
      grenadeEquipped: false,
      katanaUnlocked: false,
      engineerUnlocked: false,
      selectedCharacterId: CHARACTER_IDS.gunner,
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
    const katanaUnlocked = isCharacterUnlocked(parsed?.progress, stats, CHARACTER_IDS.katana);
    const engineerUnlocked = isCharacterUnlocked(parsed?.progress, stats, CHARACTER_IDS.engineer);
    const selectedCharacterId = [CHARACTER_IDS.katana, CHARACTER_IDS.engineer].includes(parsed?.progress?.selectedCharacterId) &&
      isCharacterUnlocked({ ...parsed?.progress, katanaUnlocked, engineerUnlocked }, stats, parsed.progress.selectedCharacterId)
      ? parsed.progress.selectedCharacterId
      : CHARACTER_IDS.gunner;
    const defaultSongId = DEFAULT_SONGS[0]?.id ?? "arcade-pulse";
    const adminSongs = Array.isArray(parsed?.music?.adminSongs) ? parsed.music.adminSongs.filter((song) => song?.id && song?.title) : [];
    const ownedSongIds = Array.isArray(parsed?.music?.ownedSongIds) ? parsed.music.ownedSongIds : [];
    return {
      highScore: Number.isFinite(parsed?.highScore) ? parsed.highScore : 0,
      wallet: {
        gold: Math.max(0, toFiniteNumber(parsed?.wallet?.gold)),
      },
      music: {
        selectedSongId: parsed?.music?.selectedSongId || defaultSongId,
        ownedSongIds: Array.from(new Set([defaultSongId, ...ownedSongIds])),
        customRequests: Array.isArray(parsed?.music?.customRequests) ? parsed.music.customRequests : [],
        adminSongs,
      },
      stats,
      progress: {
        grenadeUnlocked,
        grenadeEquipped: Boolean(grenadeUnlocked && parsed?.progress?.grenadeEquipped),
        katanaUnlocked,
        engineerUnlocked,
        selectedCharacterId,
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
  const defaultSongId = DEFAULT_SONGS[0]?.id ?? "arcade-pulse";
  const currentMusic = save.music ?? {};
  const next = {
    ...save,
    music: {
      selectedSongId: currentMusic.selectedSongId || defaultSongId,
      ownedSongIds: Array.from(new Set([defaultSongId, ...(currentMusic.ownedSongIds ?? [])])),
      customRequests: currentMusic.customRequests ?? [],
      adminSongs: currentMusic.adminSongs ?? [],
      ...partialMusic,
    },
  };
  next.music.ownedSongIds = Array.from(new Set([defaultSongId, ...(next.music.ownedSongIds ?? [])]));
  next.music.adminSongs = Array.isArray(next.music.adminSongs) ? next.music.adminSongs : [];
  next.music.customRequests = Array.isArray(next.music.customRequests) ? next.music.customRequests : [];
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
      grenadeEquipped: Boolean((save.progress?.grenadeUnlocked || kills >= 250) && save.progress?.grenadeEquipped),
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
  const nextProgress = {
    grenadeUnlocked: Boolean(save.progress?.grenadeUnlocked),
    grenadeEquipped: Boolean(save.progress?.grenadeUnlocked && save.progress?.grenadeEquipped),
    katanaUnlocked: isCharacterUnlocked(save.progress, save.stats, CHARACTER_IDS.katana),
    engineerUnlocked: isCharacterUnlocked(save.progress, save.stats, CHARACTER_IDS.engineer),
    selectedCharacterId: isCharacterUnlocked(save.progress, save.stats, save.progress?.selectedCharacterId)
      ? save.progress.selectedCharacterId
      : CHARACTER_IDS.gunner,
    ...partialProgress,
  };
  nextProgress.grenadeEquipped = Boolean(nextProgress.grenadeUnlocked && nextProgress.grenadeEquipped);
  nextProgress.selectedCharacterId =
    isCharacterUnlocked(nextProgress, save.stats, nextProgress.selectedCharacterId) ? nextProgress.selectedCharacterId : CHARACTER_IDS.gunner;
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
