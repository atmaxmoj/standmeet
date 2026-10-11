// strict_content.go —— resume_content as the owner's AI sends it, decoded strictly (job-loop
// roadmap 5.3.a). A key the résumé does not have — `institution` for `school`, `experience` for
// `works` — would decode to nothing and drop that part from the PDF without a word; it is refused
// instead, naming the key.

package jobsmcp

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

type strictContent struct{ jobsmodel.ResumeContent }

func (s *strictContent) UnmarshalJSON(b []byte) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s.ResumeContent); err != nil {
		return fmt.Errorf("resume_content: %w", err)
	}
	return nil
}

// content —— the decoded résumé, nil when the call sent none.
func (s *strictContent) content() *jobsmodel.ResumeContent {
	if s == nil {
		return nil
	}
	return &s.ResumeContent
}
