// resume.go — Resume value object: the structured resume content Claude writes via the
// MCP `resume.draft` tool. **Not part of the owner aggregate** — each resume is bound to
// one application (Phase 3) or one draft (here, Phase 2).
//
// Shape aligns with design/admin.html's ResumePage (a two-column editorial layout):
//   - identity / summary / experience (bullets, no STAR labels)
//   - education / skills (left rail)
//   - social[] / custom[] / cover_letter (fields design added)
//
// json tags are for Redis + jsonb persistence.
//
// Field order follows govet fieldalignment: slices / maps first (incl. ptrs), time / strings after.

package jobsmodel

// ResumeContent — the complete structured content of one resume.
type ResumeContent struct {
	Identity    ResumeIdentity    `json:"identity"`
	Summary     string            `json:"summary"`
	CoverLetter string            `json:"cover_letter,omitempty"`
	Works       []ResumeWork      `json:"works"`
	Educations  []ResumeEducation `json:"educations"`
	Skills      []ResumeSkillSet  `json:"skills"`
	Social      []ResumeSocial    `json:"social,omitempty"`
	Custom      []ResumeCustom    `json:"custom,omitempty"`
}

// ResumeIdentity — the identity block (the identity section barely changes when Claude
// rewrites; when it does change, it's the owner refreshing the corpus themselves).
type ResumeIdentity struct {
	Name         string `json:"name"`
	Email        string `json:"email"`
	Phone        string `json:"phone"`
	LocationLine string `json:"location_line"`
	// Site is the short form of public_url, shown at the end of the header line.
	Site  string       `json:"site,omitempty"`
	Links []ResumeLink `json:"links"`
}

// ResumeLink — an outbound link in the identity section (kept for compat; new data goes
// through Social).
type ResumeLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// ResumePeriod — start/end month (YYYY-MM); "Present" when End is nil.
type ResumePeriod struct {
	End   *string `json:"end,omitempty"`
	Start string  `json:"start"`
}

// ResumeWork — one work-history entry (with bullets ordered against the JD).
type ResumeWork struct {
	Period   ResumePeriod `json:"period"`
	Title    string       `json:"title"`
	Company  string       `json:"company"`
	Location string       `json:"location"`
	Bullets  []string     `json:"bullets"`
}
