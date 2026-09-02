// resume_project.go — ResumeEducation + ResumeSkillSet. The STAR project section has
// already been removed from the design (design admin.js's ResumePage only renders
// experience, not projects). This file is kept around so that spreading ResumeContent's
// field definitions across two files stays under the lint line limit; left unrenamed to
// avoid touching imports.

package jobsmodel

// ResumeEducation — one education entry.
type ResumeEducation struct {
	Period ResumePeriod `json:"period"`
	School string       `json:"school"`
	Degree string       `json:"degree"`
}

// ResumeSkillSet — a group of skills sharing one category. Design renders skills in the
// left rail as a single "category: item1, item2" line; Items may be empty (category
// only).
type ResumeSkillSet struct {
	Category string   `json:"category"`
	Items    []string `json:"items"`
}

// ResumeSocial — a public social profile (a recruiter can verify it).
//
// Kind's values are enum-ish but not strictly enforced (the owner can add mastodon /
// bluesky / any platform they like). Label falls back to Kind when unset. Handle can be a
// url or an @handle.
type ResumeSocial struct {
	Kind   string `json:"kind"`
	Label  string `json:"label"`
	Handle string `json:"handle"`
}

// ResumeCustom — a custom field for the left rail (languages / certifications / odds
// and ends like "I read Kafka in German"). Label : Value, rendered below skills.
type ResumeCustom struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
