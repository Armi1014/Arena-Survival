const cors = require("cors");
const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 8787;
const maxStoredEntries = 100;
const maxReturnedEntries = 20;
const validCharacters = new Set(["gunner", "katana", "engineer"]);

let leaderboardEntries = [];

app.use(cors());
app.use(express.json({ limit: "16kb" }));

function compareEntries(left, right) {
  return (
    right.score - left.score ||
    right.time - left.time ||
    right.kills - left.kills ||
    right.bosses - left.bosses ||
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function getTopEntries(limit = maxReturnedEntries) {
  return leaderboardEntries
    .slice()
    .sort(compareEntries)
    .slice(0, limit);
}

function readFiniteNumber(body, field, min, max, integer = true) {
  const value = body?.[field];
  if (!Number.isFinite(value)) {
    return { error: `${field} must be a finite number.` };
  }
  if (value < min || value > max) {
    return { error: `${field} must be between ${min} and ${max}.` };
  }
  if (integer && !Number.isInteger(value)) {
    return { error: `${field} must be an integer.` };
  }
  return { value };
}

function validateScorePayload(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 20) {
    return { error: "name must be 1-20 characters." };
  }

  const score = readFiniteNumber(body, "score", 0, 9999999);
  const time = readFiniteNumber(body, "time", 0, 7200, false);
  const kills = readFiniteNumber(body, "kills", 0, 100000);
  const bosses = readFiniteNumber(body, "bosses", 0, 1000);
  const level = readFiniteNumber(body, "level", 1, 999);
  const character = typeof body?.character === "string" ? body.character.trim() : "";

  for (const result of [score, time, kills, bosses, level]) {
    if (result.error) {
      return result;
    }
  }

  if (!validCharacters.has(character)) {
    return { error: "character must be one of: gunner, katana, engineer." };
  }

  return {
    entry: {
      name,
      score: score.value,
      time: time.value,
      kills: kills.value,
      bosses: bosses.value,
      level: level.value,
      character,
      createdAt: new Date().toISOString(),
    },
  };
}

app.get("/health", (request, response) => {
  response.json({ ok: true });
});

app.get("/leaderboard", (request, response) => {
  response.json({ entries: getTopEntries() });
});

app.post("/leaderboard/submit", (request, response) => {
  const validated = validateScorePayload(request.body);
  if (validated.error) {
    response.status(400).json({ ok: false, error: validated.error });
    return;
  }

  leaderboardEntries.push(validated.entry);
  leaderboardEntries = getTopEntries(maxStoredEntries);
  response.status(201).json({
    ok: true,
    entry: validated.entry,
    entries: getTopEntries(),
  });
});

app.use((request, response) => {
  response.status(404).json({ ok: false, error: "Not found." });
});

app.listen(port, () => {
  console.log(`Arena Survival leaderboard API listening on ${port}`);
});
