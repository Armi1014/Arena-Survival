export const DIFFICULTY_TABLE = [
  { minute: 0, spawnBudgetPerSecond: 1.45, statScale: 1.0, weights: { nibbler: 2.4, spitter: 0.2, "acid-spitter": 0, bumper: 0, tank: 0 } },
  { minute: 1, spawnBudgetPerSecond: 1.95, statScale: 1.08, weights: { nibbler: 2.1, spitter: 0.55, "acid-spitter": 0.12, bumper: 0.18, tank: 0 } },
  { minute: 2, spawnBudgetPerSecond: 2.25, statScale: 1.16, weights: { nibbler: 1.9, spitter: 0.82, "acid-spitter": 0.3, bumper: 0.38, tank: 0 } },
  { minute: 3, spawnBudgetPerSecond: 2.65, statScale: 1.24, weights: { nibbler: 1.78, spitter: 1.0, "acid-spitter": 0.48, bumper: 0.55, tank: 0.08 } },
  { minute: 4, spawnBudgetPerSecond: 2.95, statScale: 1.33, weights: { nibbler: 1.66, spitter: 1.14, "acid-spitter": 0.66, bumper: 0.74, tank: 0.16 } },
  { minute: 5, spawnBudgetPerSecond: 3.2, statScale: 1.42, weights: { nibbler: 1.52, spitter: 1.28, "acid-spitter": 0.8, bumper: 0.92, tank: 0.24 } },
  { minute: 6, spawnBudgetPerSecond: 3.45, statScale: 1.52, weights: { nibbler: 1.42, spitter: 1.44, "acid-spitter": 0.94, bumper: 1.05, tank: 0.34 } },
  { minute: 7, spawnBudgetPerSecond: 3.7, statScale: 1.62, weights: { nibbler: 1.34, spitter: 1.56, "acid-spitter": 1.06, bumper: 1.14, tank: 0.44 } },
  { minute: 8, spawnBudgetPerSecond: 3.95, statScale: 1.72, weights: { nibbler: 1.24, spitter: 1.7, "acid-spitter": 1.18, bumper: 1.24, tank: 0.54 } },
];

export function getDifficultySnapshot(elapsedSeconds) {
  const minute = Math.floor(elapsedSeconds / 60);
  const lastEntry = DIFFICULTY_TABLE[DIFFICULTY_TABLE.length - 1];
  let entry = DIFFICULTY_TABLE[0];
  for (const candidate of DIFFICULTY_TABLE) {
    if (candidate.minute <= minute) {
      entry = candidate;
    }
  }

  if (minute <= lastEntry.minute) {
    return {
      spawnBudgetPerSecond: entry.spawnBudgetPerSecond,
      statScale: entry.statScale,
      weights: { ...entry.weights },
    };
  }

  const overflowMinutes = minute - lastEntry.minute;
  return {
    spawnBudgetPerSecond: lastEntry.spawnBudgetPerSecond + overflowMinutes * 0.28,
    statScale: lastEntry.statScale + overflowMinutes * 0.1,
    weights: {
      nibbler: Math.max(0.92, lastEntry.weights.nibbler - overflowMinutes * 0.03),
      spitter: lastEntry.weights.spitter + overflowMinutes * 0.08,
      "acid-spitter": lastEntry.weights["acid-spitter"] + overflowMinutes * 0.07,
      bumper: lastEntry.weights.bumper + overflowMinutes * 0.06,
      tank: lastEntry.weights.tank + overflowMinutes * 0.04,
    },
  };
}

export function getBossScale(cycleIndex) {
  return {
    hpMultiplier: 1.35 ** cycleIndex,
    damageMultiplier: 1.15 ** cycleIndex,
  };
}
