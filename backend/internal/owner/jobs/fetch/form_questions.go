// form_questions.go —— a posting's application form (job-loop roadmap 5.4.a). Only Greenhouse
// publishes it on its public API:
//
//	GET {base}/v1/boards/{company}/jobs/{id}?questions=true
//
// The other kinds have no form to read; a closed or form-less posting answers 404, which reads as
// "no questions", never as a failure of the posting.

package fetch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// FormQuestioner —— an adapter that can read a posting's form.
type FormQuestioner interface {
	Questions(
		ctx context.Context, cfgRaw []byte, externalID string,
	) ([]jobsmodel.FormQuestion, error)
}

// Questions —— the form of one posting of kind; none for a kind without forms.
func (r *Registry) Questions(
	ctx context.Context, kind string, cfgRaw []byte, externalID string,
) ([]jobsmodel.FormQuestion, error) {
	q, ok := r.fetchers[kind].(FormQuestioner)
	if !ok {
		return []jobsmodel.FormQuestion{}, nil
	}
	return q.Questions(ctx, cfgRaw, externalID)
}

// Livenesser —— an adapter that can say whether a posting is still open.
type Livenesser interface {
	Liveness(ctx context.Context, cfgRaw []byte, externalID string) string
}

// Liveness —— open, closed, or unknown (a kind that cannot say, or a board that did not answer).
// Asked before drafting (job-loop roadmap 4.2.b).
func (r *Registry) Liveness(
	ctx context.Context, kind string, cfgRaw []byte, externalID string,
) string {
	l, ok := r.fetchers[kind].(Livenesser)
	if !ok {
		return jobsmodel.LivenessUnknown
	}
	return l.Liveness(ctx, cfgRaw, externalID)
}

// Liveness —— the Greenhouse posting is open while its board serves it.
func (f *greenhouseFetcher) Liveness(ctx context.Context, cfgRaw []byte, externalID string) string {
	cfg, err := parseGreenhouseConfig(cfgRaw)
	if err != nil {
		return jobsmodel.LivenessUnknown
	}
	url := fmt.Sprintf("%s/v1/boards/%s/jobs/%s", f.base, cfg.Company, externalID)
	_, err = getBody(ctx, f.client, url)
	switch {
	case err == nil:
		return jobsmodel.LivenessOpen
	case errors.Is(err, ErrUpstreamNoBoard):
		return jobsmodel.LivenessClosed
	}
	return jobsmodel.LivenessUnknown
}

type greenhouseForm struct {
	Questions []greenhouseQuestion `json:"questions"`
}

type greenhouseQuestion struct {
	Label    string            `json:"label"`
	Fields   []greenhouseField `json:"fields"`
	Required bool              `json:"required"`
}

type greenhouseField struct {
	Name   string             `json:"name"`
	Type   string             `json:"type"`
	Values []greenhouseOption `json:"values"`
}

type greenhouseOption struct {
	Label string `json:"label"`
}

// Questions —— the Greenhouse posting's form.
func (f *greenhouseFetcher) Questions(
	ctx context.Context, cfgRaw []byte, externalID string,
) ([]jobsmodel.FormQuestion, error) {
	cfg, err := parseGreenhouseConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/v1/boards/%s/jobs/%s?questions=true", f.base, cfg.Company, externalID)
	body, err := getBody(ctx, f.client, url)
	if errors.Is(err, ErrUpstreamNoBoard) {
		return []jobsmodel.FormQuestion{}, nil
	}
	if err != nil {
		return nil, err
	}
	return decodeGreenhouseForm(url, body)
}

func decodeGreenhouseForm(url string, body []byte) ([]jobsmodel.FormQuestion, error) {
	var form greenhouseForm
	if err := json.Unmarshal(body, &form); err != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, err)
	}
	out := make([]jobsmodel.FormQuestion, 0, len(form.Questions))
	for i := range form.Questions {
		out = append(out, greenhouseQuestionOf(&form.Questions[i]))
	}
	return out, nil
}

func greenhouseQuestionOf(q *greenhouseQuestion) jobsmodel.FormQuestion {
	fields := make([]jobsmodel.FormField, 0, len(q.Fields))
	for _, fl := range q.Fields {
		opts := make([]string, 0, len(fl.Values))
		for _, v := range fl.Values {
			opts = append(opts, v.Label)
		}
		fields = append(fields, jobsmodel.FormField{Name: fl.Name, Type: fl.Type, Options: opts})
	}
	return jobsmodel.FormQuestion{
		Label: q.Label, Required: q.Required, Fields: fields,
		Confirm: jobsmodel.NeedsConfirm(q.Label),
	}
}
