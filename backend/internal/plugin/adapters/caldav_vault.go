// caldav_vault.go — the credential-vault contract for the CalDAV block.
//
// CalDAV is no longer an in-host protocol supplier (protocol_caldav.go + caldav_client.go, ~400
// lines of WebDAV/iCalendar Go, are gone). It is a block: a Koishi plugin (infra/plugins/caldav)
// that composes the http hand and parses iCalendar with ical.js. The substrate dials that block
// and serves the calendar seam through it (cmd/server/blockwire.blockCalendarProxy).
//
// What still lives in-host is only the credential shape: the owner's url/username/password, read
// back per (block, owner) and handed to the block as the per-call tool args the proxy injects.
// The block holds no credentials.

package adapters

import "context"

// CalDAVConfig — the decrypted configuration for a CalDAV connection.
type CalDAVConfig struct {
	URL      string
	Username string
	Password string
}

// Configured — whether the minimum connectable configuration is filled in (has a collection URL).
func (c *CalDAVConfig) Configured() bool { return c.URL != "" }

// CalDAVVault — the connection source for the CalDAV block: connection state + decrypted config.
type CalDAVVault interface {
	Connected(ctx context.Context, blockID, ownerID string) (bool, error)
	CalDAVConfig(ctx context.Context, blockID, ownerID string) (CalDAVConfig, error)
}
