// stack.ts —— where THIS checkout's stack answers. One home for three facts.
//
// A machine runs several checkouts at once, each with its own compose project and its own
// published ports (`.dev-stack.env`, `make stack-init`). The Makefile derives these three URLs
// from that file and exports them to the suite; nothing here may spell a port itself.
//
// The literal after `??` is the DEFAULT stack's port, and it is a fallback for running a spec
// with no Makefile in front of it — never an address to copy. When these were written out by
// hand instead, an offset checkout reached the checkout that owned the default port: the OAuth
// callback and the email-confirmation link ran against a NEIGHBOUR's instance, which held
// neither the state nor the token, and answered 401. Seven specs red across two families that
// looked unrelated, and the first hour of diagnosis went into the product.
//
// `infra/scripts/check-no-hardcoded-dev-stack.sh` enforces this: a default port may appear only
// as the fallback of an env read.

/** The backend, host-side. Not the address the app uses — inside the container that is the
 *  compose service (`http://backend:8000`); see the Makefile's note on the two meanings. */
export const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

/** The Next.js app: what a visitor types, and what `owners.public_url` must be set to, because
 *  the backend builds its outbound links (QR, OAuth redirect_uri, email confirmation) from it. */
export const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

/** The external mock — job boards, marketplace, the Google OAuth stand-in. */
export const MOCK_BASE = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';
