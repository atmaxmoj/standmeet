// sign-out —— POST /api/admin/me/logout: revoke the server-side session, clear the cookies,
// then redirect to /login.
//
// This used to POST /api/admin/sessions/signout — an endpoint that was never implemented — and
// swallow the 404, so "sign out" only navigated away: the Redis session stayed alive and the
// cookie was never cleared, leaving a captured token usable after logout. /me/logout is the real
// endpoint (auth.go): it revokes the session in Redis and clears the session + csrf cookies.

import { adminAPI } from '@/lib/api/admin';

export async function signOut(): Promise<void> {
  try {
    await adminAPI.postVoid('/me/logout', {});
  } catch {
    // Network failure: the redirect below still drops the SPA to /login. The session may
    // survive server-side in that case, but a reachable server always revokes it above.
  }
  redirectToLogin();
}

function redirectToLogin(): void {
  typeof window !== 'undefined' && (window.location.href = '/login');
}
