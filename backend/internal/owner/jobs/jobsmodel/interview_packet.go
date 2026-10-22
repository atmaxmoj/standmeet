// interview_packet.go —— the one self-contained input of a practice interview
// (docs/design/deepinterview-engine.md, "Contracts between the two repos"): a posting's ledger row
// and the owner's notes the engine may ask about, as a JSON body fingerprinted over its bytes.

package jobsmodel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// ErrEmptyReport —— jobs.add_interview_report needs a report.
var ErrEmptyReport = errors.New("report is empty")

// ScopeNote —— one note the engine may ask about.
type ScopeNote struct {
	URI   string `json:"uri"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

// Packet —— what jobs.interview_packet returns. Fingerprint is the sha256 hex of Body's exact
// UTF-8 bytes, so neither side agrees on a JSON canonical form.
type Packet struct {
	Fingerprint string `json:"fingerprint"`
	Body        string `json:"body"`
}

type packetSource struct {
	ApplicationID *string `json:"application_id"`
	JobSeenID     string  `json:"job_seen_id"`
}

// PacketResume —— the tailored résumé actually bound to this posting's application
// (cue-resume-binding R1): the résumé content the owner submitted, plus which application and code
// it belongs to. Source is "application" for a real submission, or
// "master-tailored-for-practice" when a master was tailored on the fly for an unapplied practice
// gig. A posting with no application carries resume: null (the engine degrades and says so).
type PacketResume struct {
	ApplicationID *string         `json:"application_id"`
	Code          *string         `json:"code"`
	Source        string          `json:"resume_source"`
	Content       json.RawMessage `json:"content"`
}

type corpusScope struct {
	URIs  []string    `json:"uris"`
	Notes []ScopeNote `json:"notes"`
}

// scaleEstimate —— the Fermi chain (anchor, chain, source_tier); no field holds one yet, so it is
// always null.
type scaleEstimate struct{}

// packetBody —— field order is the wire order; scale_estimate stays null until there is a field
// for it (the engine then degrades and says so).
type packetBody struct {
	ScaleEstimate     *scaleEstimate `json:"scale_estimate"`
	Source            packetSource   `json:"source"`
	Resume            *PacketResume  `json:"resume"`
	Company           string         `json:"company"`
	Title             string         `json:"title"`
	JDText            string         `json:"jd_text"`
	ActualWorkProfile string         `json:"actual_work_profile"`
	Homework          string         `json:"homework"`
	Flags             []string       `json:"flags"`
	Deductions        []Deduction    `json:"deductions"`
	CitedNotes        []string       `json:"cited_notes"`
	CorpusScope       corpusScope    `json:"corpus_scope"`
	Version           int            `json:"version"`
}

// PacketOf —— the row, its scope notes, and the bound application's tailored résumé (nil when the
// posting has no application) as a packet.
func PacketOf(row *SeenRow, notes []ScopeNote, resume *PacketResume) (Packet, error) {
	a := &row.Annotations
	b := packetBody{
		Version: 1,
		Source:  packetSource{JobSeenID: row.ID, ApplicationID: row.ApplicationID},
		Resume:  resume,
		Company: row.Snapshot.Company, Title: row.Snapshot.Title, JDText: row.Snapshot.BodyText,
		ActualWorkProfile: a.Brief, Homework: a.Homework,
		Flags: orEmpty(a.Flags), Deductions: orEmpty(a.Deductions),
		CitedNotes:  orEmpty(a.CitedNotes),
		CorpusScope: corpusScope{URIs: make([]string, 0, len(notes)), Notes: orEmpty(notes)},
	}
	for _, n := range notes {
		b.CorpusScope.URIs = append(b.CorpusScope.URIs, n.URI)
	}
	body, err := json.Marshal(b)
	if err != nil {
		return Packet{}, fmt.Errorf("encode packet: %w", err)
	}
	sum := sha256.Sum256(body)
	return Packet{Fingerprint: hex.EncodeToString(sum[:]), Body: string(body)}, nil
}

// orEmpty —— a nil slice as [], never null ([[empty-is-not-json-null]]).
func orEmpty[T comparable](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
