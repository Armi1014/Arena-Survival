const LEADERBOARD_API_BASE_URL = "https://arena-survival-leaderboard.onrender.com";
const PLACEHOLDER_API_BASE_URL = "";
const REQUEST_TIMEOUT_MS = 15000;
const API_OVERRIDE_STORAGE_KEY = "arena-survival-api-base-url";

function getApiBaseUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryOverride = params.get("apiBase")?.trim();
  if (queryOverride) {
    try {
      window.localStorage.setItem(API_OVERRIDE_STORAGE_KEY, queryOverride);
    } catch {
      // Storage-disabled browsers can still use the override for the current page.
    }
    return queryOverride.replace(/\/+$/, "");
  }
  try {
    const storedOverride = window.localStorage.getItem(API_OVERRIDE_STORAGE_KEY)?.trim();
    if (storedOverride) {
      return storedOverride.replace(/\/+$/, "");
    }
  } catch {
    // Fall back to the built-in production URL.
  }
  return LEADERBOARD_API_BASE_URL.trim().replace(/\/+$/, "");
}

function isPlaceholderUrl(url) {
  return !url || url === PLACEHOLDER_API_BASE_URL;
}

function normalizeEntries(payload) {
  return Array.isArray(payload?.entries) ? payload.entries : [];
}

async function requestJson(path, options = {}) {
  const baseUrl = getApiBaseUrl();
  if (isPlaceholderUrl(baseUrl)) {
    return { ok: false, disabled: true, entries: [] };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: payload?.error || "Leaderboard request failed.",
        entries: normalizeEntries(payload),
      };
    }
    return {
      ok: true,
      payload,
      entries: normalizeEntries(payload),
    };
  } catch {
    return { ok: false, offline: true, entries: [] };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function isOnlineLeaderboardEnabled() {
  return !isPlaceholderUrl(getApiBaseUrl());
}

export function getMultiplayerWebSocketUrl() {
  const baseUrl = getApiBaseUrl();
  if (isPlaceholderUrl(baseUrl)) {
    return "";
  }
  try {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/multiplayer";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export async function fetchLeaderboard(mode = "solo") {
  const safeMode = mode === "coop" ? "coop" : "solo";
  return requestJson(`/leaderboard?mode=${encodeURIComponent(safeMode)}`);
}

export async function checkLeaderboardHealth() {
  return requestJson("/health");
}

export async function submitScore(runResult) {
  return requestJson("/leaderboard/submit", {
    method: "POST",
    body: JSON.stringify(runResult),
  });
}
