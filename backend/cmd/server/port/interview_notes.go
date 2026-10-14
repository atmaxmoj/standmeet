// interview_notes.go —— the job loop's narrow port into the corpus for a practice interview
// (docs/design/deepinterview-engine.md): the notes the engine may ask about — the cv, each project
// root note (software/project/<name>), and each note the assessment cited — with their texts.

package port

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// projectRoot —— a project's root note: exactly one level under software/project.
var projectRoot = regexp.MustCompile(`^software/project/[^/]+$`)

// subjectivityScan —— the owner's self-model is short; the cv is found by its slugified title.
const subjectivityScan = 500

// InterviewScopeNotes —— the cv first, then project roots by path, then cited notes in the order
// the assessment cites them; each once.
func InterviewScopeNotes(d *deps.Runtime) jobsuc.ScopeNotesFunc {
	return func(
		ctx context.Context, ownerID string, cited []string,
	) ([]jobsmodel.ScopeNote, error) {
		out, err := cvNote(ctx, d, ownerID)
		if err != nil {
			return nil, err
		}
		wiki, err := wikiScope(ctx, d, ownerID, cited)
		return append(out, wiki...), err
	}
}

func cvNote(ctx context.Context, d *deps.Runtime, ownerID string) ([]jobsmodel.ScopeNote, error) {
	notes, err := d.SubjectivityRepo.ListByOwner(ctx, ownerID, subjectivityScan)
	if err != nil {
		return nil, fmt.Errorf("subjectivity notes: %w", err)
	}
	for i := range notes {
		if corpus.SlugifyTitle(notes[i].Title) == "cv" {
			return []jobsmodel.ScopeNote{{
				URI: "subjectivity://cv", Title: notes[i].Title, Text: notes[i].Body,
			}}, nil
		}
	}
	return []jobsmodel.ScopeNote{}, nil
}

// wikiScope —— project roots by path, then the cited paths ("wiki://x", "wiki/x" and "x" alike).
func wikiScope(
	ctx context.Context, d *deps.Runtime, ownerID string, cited []string,
) ([]jobsmodel.ScopeNote, error) {
	metas, err := d.WikiRepo.ListAllMeta(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("wiki notes: %w", err)
	}
	idByPath := map[string]string{}
	for id, path := range corpus.WikiMetaTreePaths(metas) {
		idByPath[path] = id
	}
	paths := inScope(idByPath, append(projectRoots(idByPath), citedPaths(cited)...))
	out := make([]jobsmodel.ScopeNote, 0, len(paths))
	for _, p := range paths {
		w, gerr := d.WikiRepo.GetByID(ctx, ownerID, idByPath[p])
		if gerr != nil {
			return nil, fmt.Errorf("wiki note %s: %w", p, gerr)
		}
		out = append(out, jobsmodel.ScopeNote{URI: "wiki://" + p, Title: w.Title(), Text: w.Body()})
	}
	return out, nil
}

// inScope —— the paths that name a note, each once, in order.
func inScope(idByPath map[string]string, paths []string) []string {
	out := []string{}
	for _, p := range paths {
		if _, ok := idByPath[p]; ok && !slices.Contains(out, p) {
			out = append(out, p)
		}
	}
	return out
}

func projectRoots(idByPath map[string]string) []string {
	out := []string{}
	for p := range idByPath {
		if projectRoot.MatchString(p) {
			out = append(out, p)
		}
	}
	slices.Sort(out)
	return out
}

func citedPaths(cited []string) []string {
	out := make([]string, 0, len(cited))
	for _, c := range cited {
		out = append(out, strings.TrimPrefix(strings.TrimPrefix(c, "wiki://"), "wiki/"))
	}
	return out
}
