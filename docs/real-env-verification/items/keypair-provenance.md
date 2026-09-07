# keypair-provenance — an owner-MCP key says where it was last used

- **Module:** Each owner-MCP keypair records the address and the client that last signed with it, and the panel shows them on the key's row. A key the owner does not recognise can be told apart from the one they are using before either is revoked.
- **Surface:** `/admin/api-mcp` — the keypair list and each row's last-used line.
- **Real dep:** The shipped stdio MCP client with a real keypair, making a genuinely signed request against the instance. A second client or host, so two rows differ.
- **Exclusive:** none
- **Backing e2e:** `keypair-last-used` · `c1-keypair-auth` · `c2-keypair-ui`.

## Checks

### 1 — A signed request stamps the key it signed with ⭐
- **Steps:** Note a freshly minted key's row. Make one real MCP call with it. Read the row again.
- **Expected:** The row now names the address and the client the call came from, and the time. Before the call it said the key had not been used rather than showing an empty pair of fields.
- **Mock gap:** The stamp is written by the signature-verification path; a fixture that writes the row directly proves nothing about which requests reach it.
- **Backing test:** `keypair-last-used.spec.ts`

### 2 — Two keys used from different places are distinguishable ⭐
- **Steps:** Use a second key from a different client or host. Read both rows.
- **Expected:** They differ in the line that is meant to distinguish them. Neither shows the other's address.
- **Backing test:** `keypair-last-used.spec.ts`

### 3 — A revoked key stops working and says so
- **Steps:** Revoke a key from the panel, then make an MCP call with it.
- **Expected:** The call is refused. The row reads as revoked rather than disappearing without explanation.
- **Backing test:** `c2-keypair-ui.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The last-used line is a claim about a real request: a row that shows an address the owner has never connected from is either the finding or the reason to rotate — say which.

The panel's row and the instance's log of that call are two views of one event; a call that reaches the instance and leaves the row unchanged is the defect.

Every control on a key row must act on that key: revoking one and finding another dead, or a download that hands back nothing, are both dead affordances with different symptoms.
