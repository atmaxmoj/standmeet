// mcp_server.go —— external MCP servers registered by the owner. An InviteCode can bind a
// set of mcp_server_ids; during visitor chat the backend acts as an MCP client connecting to
// the external server, pulling its tools into the visitor-callable tool list (prefixed
// `ext_<server>_<tool>`).
//
// Design derives from legacy standmeet-server/backend/domain/iam/entities.py:McpServer, but
// lands owner_id to get multi-tenant for free; auth_header_value is encrypted into cryptobox,
// the same pattern as the BYOAI key (avoids plaintext tokens landing on disk).
//
// AuthHeaderValueEnc is ciphertext bytes before cryptobox.Decrypt; empty = no auth.

package entity

import (
	"errors"
	"time"
)

// MCPServerConfig —— value object for a mcp_servers row.
type MCPServerConfig struct {
	CreatedAt          time.Time
	ID                 string
	OwnerID            string
	Name               string
	URL                string
	AuthHeaderName     string
	AuthHeaderValueEnc []byte
	// GrantedDeps —— connector dependency names ("calendar"/"smtp"…) the owner explicitly
	// authorized this ext-mcp server to reach. ext-mcp gets least trust: a tool's declared
	// Requires does not inject a handle by default; only a dep listed here — owner's explicit
	// consent — gets resolved and exposed. Empty = deny everything by default.
	GrantedDeps []string
}

// DialableMCPServer —— the same external server in its **ready-to-dial** shape: the auth
// header is already decrypted plaintext.
//
// It's a second face of MCPServerConfig; the difference is **trust level, carried by the
// type**:
//
//	MCPServerConfig    the stored shape, auth header is ciphertext. The inside (domain,
//	                    assembly, routing) only ever sees this one.
//	DialableMCPServer  the dial-ready shape, auth header already decrypted. Only the
//	                    outbound side can construct it.
//
// Two types instead of one type with an extra field: with a field, "decrypted or not" relies
// on the caller remembering to check, and the failure direction of forgetting is **dialing
// with ciphertext** — the other side just answers with a 401, telling you nothing about why.
// (Same rule as splitting owner key / visitor BYOAI key into two types.).
type DialableMCPServer struct {
	ID          string
	OwnerID     string
	Name        string
	URL         string
	AuthHeader  MCPAuthHeader
	GrantedDeps []string
}

// MCPAuthHeader —— the header pair carried when dialing. Name empty = this server needs no
// auth. Value is **plaintext** — this type exists only after decryption (see DialableMCPServer).
type MCPAuthHeader struct {
	Name  string
	Value string
}

// Headers —— the map shape the dialer wants. No auth means an empty map, not nil.
func (h MCPAuthHeader) Headers() map[string]string {
	if h.Name == "" || h.Value == "" {
		return map[string]string{}
	}
	return map[string]string{h.Name: h.Value}
}

// ErrMCPServerNotFound —— server id doesn't exist or doesn't belong to this owner.
var ErrMCPServerNotFound = errors.New("mcp server not found")

// ErrMCPServerNameTaken —— name already duplicated under the same owner (unique constraint).
var ErrMCPServerNameTaken = errors.New("mcp server name already taken in this owner")
