// Lightweight client-side auth helper for the demo app.
// This module provides a tiny API to persist a demo authentication state
// (role + authenticated flag) in localStorage so UI components (Menu, Login)
// can determine whether the user is "signed in" and route accordingly.
//
// Important: This is intentionally simple for the demo. In a real app you
// should use secure HttpOnly cookies or a proper auth solution (NextAuth,
// Passport, JWT with refresh tokens, server-side sessions, etc.).

export const AUTH_KEY = "sma_auth";

export type DemoAuth = {
  // user's role string (admin|teacher|student|parent)
  role?: string;
  // whether the user is considered authenticated in this demo
  authenticated: boolean;
};

// return the current auth state from localStorage (synchronous)
export function getAuth(): DemoAuth {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(AUTH_KEY) : null;
    if (!raw) return { authenticated: false };
    return JSON.parse(raw) as DemoAuth;
  } catch (err) {
    // if parsing fails, fall back to unauthenticated
    return { authenticated: false };
  }
}

// Persist an authenticated role in localStorage. This is used by the demo
// login flow to remember who is signed in across page refreshes.
export function setAuth(role: string) {
  const payload: DemoAuth = { role, authenticated: true };
  try {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
    // notify same-tab listeners about the change (storage events don't fire
    // in the same tab that performed the write)
    window.dispatchEvent(new Event("sma_auth_change"));
  } catch (err) {
    // noop - localStorage failures should not crash the UI in the demo
  }
}

// Clear demo auth (used for logout)
export function clearAuth() {
  try {
    window.localStorage.removeItem(AUTH_KEY);
    window.dispatchEvent(new Event("sma_auth_change"));
  } catch (err) {
    // noop
  }
}

// Convenience helpers
export function isAuthenticated(): boolean {
  return getAuth().authenticated === true;
}

export function getRole(): string | null {
  return getAuth().role ?? null;
}
