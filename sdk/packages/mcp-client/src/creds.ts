// creds.ts —— load Ed25519 credentials from JSON file pointed to by
// $STANDMEET_CREDS_PATH. Same shape as youteacher:
//   {
//     "keyId": "<uuid>",
//     "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
//   }

import { readFile } from 'node:fs/promises';

export interface Creds {
  keyId: string;
  privateKeyPem: string;
}

export async function loadCreds(path: string): Promise<Creds> {
  const expanded = expandHome(path);
  const raw = await readFile(expanded, 'utf8');
  const parsed = JSON.parse(raw) as Partial<Creds>;
  if (!parsed.keyId || !parsed.privateKeyPem) {
    throw new Error(
      `credentials at ${expanded} missing keyId or privateKeyPem`,
    );
  }
  return { keyId: parsed.keyId, privateKeyPem: parsed.privateKeyPem };
}

function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  const home = process.env['HOME'] ?? process.env['USERPROFILE'];
  if (!home) throw new Error(`cannot expand ~ in ${p}: no HOME env`);
  return home + p.slice(1);
}
