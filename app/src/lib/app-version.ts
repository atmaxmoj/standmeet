// app-version.ts —— the ONE source of truth for the version string shown to the owner.
// Both the auth shell (/login, /setup) and the admin top-bar read this, so the two can never
// drift apart (F-C-4: the banner hardcoded "v0.1 · dev" while /login showed "v1.0.0", and the
// "· dev" was a fake env label shown even on prod). It is a plain version, no env label —
// the badge must not assert an environment it does not actually track.
export const APP_VERSION = 'v1.0.0';
