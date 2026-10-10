// seen_row.go —— a ledger row as the owner's surfaces show it (MCP jobs.history, the admin history
// view): one shape for both faces, its assessment inline.

package jobsmodel

import "time"

// SeenWire —— one ledger row on the wire.
type SeenWire struct {
	*Annotations

	ApplicationID *string `json:"application_id"`
	ID            string  `json:"job_seen_id"`
	FirstSeenAt   string  `json:"first_seen_at"`
	LastSeenAt    string  `json:"last_seen_at"`
	Status        string  `json:"status"`
	Title         string  `json:"title"`
	Company       string  `json:"company"`
	Location      string  `json:"location"`
	URL           string  `json:"url"`
	Source        string  `json:"source"`
}

// SeenWireOf —— the row's wire shape; times in UTC.
func SeenWireOf(r *SeenRow) SeenWire {
	return SeenWire{
		Annotations: &r.Annotations, ApplicationID: r.ApplicationID, ID: r.ID,
		FirstSeenAt: r.FirstSeenAt.UTC().Format(time.RFC3339Nano),
		LastSeenAt:  r.LastSeenAt.UTC().Format(time.RFC3339Nano),
		Status:      r.Status, Title: r.Snapshot.Title, Company: r.Snapshot.Company,
		Location: r.Snapshot.Location, URL: r.Snapshot.URL, Source: r.Source,
	}
}
