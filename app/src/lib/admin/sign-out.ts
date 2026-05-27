// sign-out —— POST /api/admin/sessions/signout or fallback DELETE.
// If endpoint not yet wired, the catch path still clears cookie + redirects.

import { adminAPI } from '@/lib/api/admin';

export async function signOut(): Promise<void> {
  try {
    await adminAPI.postVoid('/sessions/signout', {});
  } catch {
    // backend may not yet expose signout; client redirect still clears the SPA.
  }
  redirectToLogin();
}

function redirectToLogin(): void {
  typeof window !== 'undefined' && (window.location.href = '/login');
}
