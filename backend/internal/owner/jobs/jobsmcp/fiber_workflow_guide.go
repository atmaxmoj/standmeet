// fiber_workflow_guide.go —— workflow.guide (job-loop roadmap 6.1): the job loop's workflows as
// the instance ships them — tailoring a résumé, reading a posting, preparing an interview, filling
// a form, what to do after applying. Embedded, so they upgrade with the binary and every owner's AI
// reads the same version (as microsite.guide does for page authoring). The MCP server instructions
// name this tool; the guides cost context only when a workflow starts.

package jobsmcp

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

//go:embed workflowguide/*.md
var workflowGuides embed.FS

// guideNames —— the guides, in the order a job search meets them.
var guideNames = []string{
	"job-description-reading", "resume-tailoring", "application-forms", "interview-prep",
	"after-applying",
}

var guideSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"name":{"type":"string","enum":["job-description-reading","resume-tailoring",` +
	`"application-forms","interview-prep","after-applying"],
		"description":"omit to list the guides"}}
}`)

// GuideOps —— workflow.guide and workflow.doctor.
func GuideOps(apps *jobsuc.ApplicationsDeps) []fp.Op {
	return []fp.Op{{
		ID: "workflow.doctor", Kind: fp.Read,
		Reach:       fp.Only("an owner-AI setup read", "mcp"),
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Description: "What the job search is missing on this instance: the cv note, a résumé " +
			"master, the \"Looking for\" note. Each comes with how to supply it.",
		Invoke: doctorInvoke(apps),
	}, {
		ID: "workflow.guide", Kind: fp.Read,
		Reach:       fp.Only("guidance for the owner's AI client", "mcp"),
		InputSchema: guideSchema,
		Description: "The job-loop workflows this instance ships: how to read a posting, tailor " +
			"a résumé, fill a form, prepare an interview, and follow up after applying. Call it " +
			"with no name to list them, then with a name before that workflow starts.",
		Invoke: guideInvoke,
	}}
}

func doctorInvoke(apps *jobsuc.ApplicationsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		report, err := jobsuc.Doctor(ctx, apps, ownerID)
		if err != nil {
			return nil, errors.New("workflow.doctor failed")
		}
		out, err := json.Marshal(report)
		if err != nil {
			return nil, fmt.Errorf("encode report: %w", err)
		}
		return out, nil
	}
}

type guideEntry struct {
	Name    string `json:"name"`
	Title   string `json:"title"`
	UseWhen string `json:"use_when"`
}

func guideInvoke(_ context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
	var args struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, errors.New("invalid arguments: " + err.Error())
	}
	var out []byte
	var err error
	if args.Name == "" {
		out, err = json.Marshal(map[string][]guideEntry{"guides": listGuides()})
	} else {
		out, err = guideJSON(args.Name)
	}
	if err != nil {
		return nil, fmt.Errorf("workflow.guide: %w", err)
	}
	return out, nil
}

func guideJSON(name string) ([]byte, error) {
	body, err := workflowGuides.ReadFile("workflowguide/" + name + ".md")
	if err != nil {
		return nil, errors.New("no guide named " + name + "; call workflow.guide to list them")
	}
	out, err := json.Marshal(map[string]string{"name": name, "guide": string(body)})
	if err != nil {
		return nil, fmt.Errorf("encode guide: %w", err)
	}
	return out, nil
}

func listGuides() []guideEntry {
	out := make([]guideEntry, 0, len(guideNames))
	for _, name := range guideNames {
		body, err := workflowGuides.ReadFile("workflowguide/" + name + ".md")
		if err != nil {
			continue
		}
		lines := strings.Split(string(body), "\n")
		out = append(out, guideEntry{
			Name: name, Title: strings.TrimPrefix(lines[0], "# "),
			UseWhen: firstParagraph(lines[1:]),
		})
	}
	return out
}

func firstParagraph(lines []string) string {
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			return l
		}
	}
	return ""
}
