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
	Identity    ResumeIdentity `json:"identity"`
	Summary     string         `json:"summary"`
	CoverLetter string         `json:"cover_letter,omitempty"`
	// Accent — owner-chosen accent colour (#RRGGBB); empty → template default. In resume_content
	// JSONB, so no schema change; it snapshots into the committed application.
	Accent     string            `json:"accent,omitempty"`
	Works      []ResumeWork      `json:"works"`
	Educations []ResumeEducation `json:"educations"`
	Skills     []ResumeSkillSet  `json:"skills"`
	Social     []ResumeSocial    `json:"social,omitempty"`
	Custom     []ResumeCustom    `json:"custom,omitempty"`
	// LeftOrder — left-rail section order (skills/education/custom); empty → template default.
	LeftOrder []string `json:"left_order,omitempty"`
	// FontScale — owner-chosen font-size multiplier for the whole résumé (1 = template default).
	// Like Accent it lives in resume_content JSONB (no schema change) and snapshots into the app.
	FontScale float64 `json:"font_scale,omitempty"`
	// LeftWidth — left-column width in fr (main column is fixed 2fr); 0 → template default.
	LeftWidth float64 `json:"left_width,omitempty"`
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
