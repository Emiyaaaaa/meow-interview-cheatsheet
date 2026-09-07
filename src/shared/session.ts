const TOKEN_KEY = "auth_token";

export function getSessionToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearSessionToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function authHeaders(token = getSessionToken()): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function withAuthQuery(url: string, token = getSessionToken()) {
  if (!token) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("token", token);
  return parsed.toString();
}
