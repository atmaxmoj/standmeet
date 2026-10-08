# standmeet-mcp

MCP client for StandMeet. Spawned by Claude Desktop / Cursor / any MCP client;
bridges stdio JSON-RPC to the StandMeet backend's streamable HTTP `/mcp`
endpoint. Authenticates each request with an Ed25519 sigv1 signature bound to
that request (method, path and body) — no session cookie, no token cache, and a
captured header is useless on any other request.

## Install

```sh
npm i -g standmeet-mcp
```

or let the MCP client run it with `npx` (below).

## Onboard (one-time)

1. Sign in to your StandMeet instance → `/admin/api-mcp` → **Generate** →
   download `standmeet-key-<…>.pem`. Pick what the key may do (everything,
   read only, or read + write content).

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
         "args": ["-y", "standmeet-mcp@latest"],
         "env": {
           "STANDMEET_HOST": "https://your-standmeet-host",
           "STANDMEET_CREDS_PATH": "~/.standmeet/credentials.json"
         }
       }
     }
   }
   ```

## How auth works

- Each outbound HTTP request carries a fresh
  `Authorization: Sigv1 keyId=X,ts=N,nonce=…,v=2,sig=base64` header: Ed25519 over
  the key id, timestamp, nonce, method, path and the SHA-256 of the body.
- The server accepts a 5-minute clock-skew window and each nonce once.
- The key's scopes decide which tools it lists and may call.
- Revoke from the admin UI → the next request from this device returns 401.
