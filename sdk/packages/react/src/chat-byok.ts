// chat-byok.ts —— the embedded chat on the visitor's own key. When the owner's public quota can't
// serve (spent, or the provider rate-limits), the visitor can bring a key: it is saved encrypted in
// this browser (sdk-core byoai.ts — the same store /gate uses, same origin), the session is issued
// in byoai mode (public slice only, never billed to the owner), and every turn carries the key
// sealed for that session in the X-BYOAI-* headers.

import {
  keyStorageAvailable, readBYOAICredFull, readBYOAIVaultMeta, wrapBYOAIKey,
  type BYOAIHeaders, type IssueSessionInput, type PublicSessionResponse, type StandMeetClient,
} from '@standmeet/sdk-core';

// savedKeyInUse —— a key is saved in this browser and this page can use it.
export function savedKeyInUse(): boolean {
  return keyStorageAvailable() && readBYOAIVaultMeta() !== null;
}

// issueChatSession —— a byoai session when the visitor's key is in use, else the caller's input.
export async function issueChatSession(
  client: StandMeetClient, input: IssueSessionInput, byok: boolean,
): Promise<PublicSessionResponse> {
  const meta = byok ? readBYOAIVaultMeta() : null;
  return meta === null
    ? client.issueSession(input)
    : client.issueSession({ ...input, mode: 'byoai', byoai_provider: meta.provider });
}

// byoaiHeaders —— this turn's X-BYOAI-* headers, the key sealed for this session. undefined when
// the session isn't a byoai one or the key can't be read (the backend then refuses cleanly).
export async function byoaiHeaders(byoai: boolean, sessionToken: string): Promise<BYOAIHeaders | undefined> {
  if (!byoai) return undefined;
  const cred = await readBYOAICredFull();
  if (cred === null) return undefined;
  return {
    provider: cred.provider, endpoint: cred.endpoint, model: cred.model,
    wrappedKey: await wrapBYOAIKey(cred.key, sessionToken),
  };
}
