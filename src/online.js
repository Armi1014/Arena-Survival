const LEADERBOARD_API_BASE_URL = "https://arena-survival-leaderboard.onrender.com";
const PLACEHOLDER_API_BASE_URL = "";
const REQUEST_TIMEOUT_MS = 15000;

function getApiBaseUrl() {
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

export async function fetchLeaderboard() {
  return requestJson("/leaderboard");
}

export async function submitScore(runResult) {
  return requestJson("/leaderboard/submit", {
    method: "POST",
    body: JSON.stringify(runResult),
  });
}
