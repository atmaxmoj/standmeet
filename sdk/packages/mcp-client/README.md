# @standmeet/mcp-client

MCP client for StandMeet. Spawned by Claude Desktop / Cursor / any MCP client;
bridges stdio JSON-RPC to the StandMeet backend's streamable HTTP `/mcp`
endpoint. Authenticates each request with an Ed25519 sigv1 signature — no
session cookie, no token cache.

## Install

```sh
npm i -g @standmeet/mcp-client
```

## Onboard (one-time)

1. Sign in to your StandMeet instance → `/admin/api-mcp` → **Generate** →
   download `standmeet-key-<…>.pem`.

2. Save credentials at `~/.standmeet/credentials.json` (mode `0600`):

   ```json
   {
     "keyId": "<the key id shown in the modal>",
     "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
   }
   ```

3. Wire into Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "standmeet": {
         "command": "npx",
         "args": ["-y", "@standmeet/mcp-client@latest"],
         "env": {
           "STANDMEET_HOST": "https://your-standmeet-host",
           "STANDMEET_CREDS_PATH": "~/.standmeet/credentials.json"
         }
       }
     }
   }
   ```

## How auth works

- Each outbound HTTP signs a fresh `Authorization: Sigv1 keyId=X,ts=N,sig=base64`
  header (ed25519 over `standmeet-sigv1\n<keyId>\n<ts>`).
- Server verifies in a 5-minute clock-skew window. No replay protection beyond
  that — keep credentials.json mode `0600` and don't ship the PEM off-machine.
- Revoke from the admin UI → next request from this device returns 401.
