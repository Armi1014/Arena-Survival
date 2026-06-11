# AGENTS.md

Project-specific instructions for Codex and other agents working in this repo.

## Project Basics

- This is a static browser game. `index.html` loads `src/bundle.js` directly.
- Edit source modules first, then sync `src/bundle.js`.
- Do not upload or commit secrets. `.env.local` is intentionally ignored.
- Keep the optional leaderboard backend in `server/` separate from the static itch.io build.

## Important Files

- `index.html`: browser entry point and menu markup.
- `styles.css`: all frontend styling.
- `src/game.js`: core gameplay, menus, rendering, upgrades, shop, quests.
- `src/main.js`: DOM wiring and browser self-test.
- `src/storage.js`: save migration and persistence.
- `src/audio.js`: audio system.
- `src/data/`: constants, enemies, upgrades, characters, difficulty.
- `src/multiplayer.js`: browser WebSocket room client for 2-4 player co-op.
- `src/bundle.js`: generated browser bundle loaded by `index.html`.
- `server/`: optional online leaderboard API, not part of itch.io HTML5 upload.

## Syncing `src/bundle.js`

After changing source modules, regenerate `src/bundle.js` from the current source files:

```sh
node --input-type=module <<'NODE'
import fs from "node:fs";

const files = [
  "src/data/constants.js",
  "src/data/characters.js",
  "src/data/difficulty.js",
  "src/data/enemies.js",
  "src/data/upgrades.js",
  "src/storage.js",
  "src/audio.js",
  "src/online.js",
  "src/multiplayer.js",
  "src/game.js",
  "src/main.js",
];

const stripModuleSyntax = (source) =>
  source
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];\s*\r?\n/gm, "")
    .replace(/^\s*export\s+/gm, "")
    .trimEnd();

const output = files
  .map((file) => `// ${file}\n${stripModuleSyntax(fs.readFileSync(file, "utf8"))}\n`)
  .join("\n");

fs.writeFileSync("src/bundle.js", output);
NODE
```

If the bundle changes, update the query string in `index.html` so browsers do not keep a stale cached bundle.

## Checks

Run the smallest relevant checks after edits. For gameplay/menu work, run:

```sh
node --check src/game.js
node --check src/main.js
node --check src/storage.js
node --check src/audio.js
node --check src/data/constants.js
node --check src/data/enemies.js
node --check src/data/upgrades.js
node --check src/bundle.js
```

Then start or reuse the static server:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8000/?selfTest=1
```

Expected result:

- `document.body.dataset.selfTest === "pass"`
- No application runtime exceptions.

Chrome/WSL may print DBus, Crashpad, NSS, or profile noise to stderr; do not treat that as an app failure unless the page self-test fails or the browser console has app errors.

## Itch.io Deploy

Target:

```text
digicsoport/arena:html5
```

Use butler from:

```sh
/home/ardai/bin/butler
```

Secrets:

- API key should be loaded from `.env.local` as `BUTLER_API_KEY`.
- Never print the key.
- `.env.local` must stay ignored by git.

Verify the key without printing it:

```sh
set -a
. ./.env.local
set +a
if [ -n "$BUTLER_API_KEY" ]; then echo BUTLER_API_KEY=set; else echo BUTLER_API_KEY=missing; fi
```

Create a clean static staging directory. Do not upload `.env.local`, `.git`, `server/`, or local tool/cache folders.

```sh
STAGE_DIR="$(mktemp -d /tmp/arena-survival-itch.XXXXXX)"
cp -R index.html styles.css src sounds docs "$STAGE_DIR/"
/home/ardai/bin/butler validate "$STAGE_DIR"
```

Push:

```sh
set -a
. ./.env.local
set +a
/home/ardai/bin/butler push "$STAGE_DIR" digicsoport/arena:html5 --userversion YYYY-MM-DD-short-description
```

Check status:

```sh
set -a
. ./.env.local
set +a
/home/ardai/bin/butler status digicsoport/arena:html5
```

Recent successful deploy:

```text
html5 | upload #17825049 | build #1711790 | version 2026-06-07-coop-polish-boss-arena-v2
```

## Current Gameplay Notes

- Built-in/default songs are removed. The game runs silent unless custom/admin songs are available and selected.
- Grenade and landmine are accessories in a single active ability slot.
- Character loadouts live under `progress.loadouts[characterId].accessoryIds`.
- The visible Characters tab is now Inventory; internal tab id remains `characters`.
- The canvas stays 1280x720, but active runs use an infinite world with camera follow.
- Default camera zoom is pulled back; mouse wheel, `+`, `-`, and `0` adjust/reset zoom.
- Death screens show a final-hit cause card while preserving high-score/unlock titles.
- The online leaderboard uses the Render URL in `src/online.js`, retries online submission after local fallback, and needs persistent Render storage for `server/data` if scores should survive restarts.
- Engineer turret balance and medkit/drop behavior are covered by self-test assertions in `src/main.js`.

## Safety Rules

- Do not print `.env.local` or API keys.
- Do not include `server/` in itch.io HTML5 uploads unless explicitly requested.
- Do not hand-edit only `src/bundle.js`; edit source modules and regenerate the bundle.
- Avoid broad refactors unless they directly serve the requested change.
