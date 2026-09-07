// version-skew.ts —— does the MCP client's version still match the instance it's talking to?
// The client is a thin signed forwarder (tools come from the server), so being a bit behind is
// harmless — UNTIL the transport/signing floor moves, at which point an old client can't talk to the
// new server. This classifier turns a would-be silent auth break into a clear advisory that names
// `update_self`. See docs/design/mcp-self-update.md (Q5). Pure — no I/O.

export type SkewVerdict = 'ok' | 'warn' | 'incompatible';

export interface SkewResult {
  verdict: SkewVerdict;
  message: string; // empty when ok
}

interface SemVer { major: number; minor: number; patch: number }

// parseSemVer —— "v0.1.24" / "0.1.24" → {0,1,24}. Unknown/garbage → null (treated as unknown).
function parseSemVer(v: string): SemVer | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

// cmp —— -1 / 0 / 1 by major, then minor, then patch.
function cmp(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

// classifySkew —— compare the client's version to the instance's, against a minimum-compatible client
// floor the server advertises. Unknown/unparseable versions → 'ok' (never nag on missing data).
//   - client below the floor → 'incompatible' (the auth/transport contract may have moved; must update)
//   - versions differ but client is at/above the floor → 'warn' (usually fine; offer update)
//   - equal → 'ok'
export function classifySkew(
  clientVersion: string, serverVersion: string, minCompatibleClient = '',
): SkewResult {
  const client = parseSemVer(clientVersion);
  const server = parseSemVer(serverVersion);
  if (client === null || server === null) return { verdict: 'ok', message: '' };

  const floor = parseSemVer(minCompatibleClient);
  if (floor !== null && cmp(client, floor) < 0) {
    return {
      verdict: 'incompatible',
      message: `This StandMeet MCP client (v${clientVersion}) is too old for the instance `
        + `(v${serverVersion}, needs ≥ v${minCompatibleClient}). Run the update_self tool to upgrade.`,
    };
  }
  if (cmp(client, server) !== 0) {
    return {
      verdict: 'warn',
      message: `This StandMeet MCP client is v${clientVersion}; the instance is v${serverVersion}. `
        + `Run the update_self tool to match it.`,
    };
  }
  return { verdict: 'ok', message: '' };
}
