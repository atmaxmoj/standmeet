// screen_assistant.go —— the cue card's ports into the rest of the server (owner/jobs/cues): the
// role, the notes in its scope (listed the way corpus.list lists them, so the order — and with it
// every tie in the search — is the desktop app's), the phone-screen script and applied jobs, and
// the owner's model.

package port

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

const cuePage = 200

// cueGenres —— the genres a role's scope can reach, in the order the app read them.
var cueGenres = []string{"wiki", "output", "subjectivity"}

// ScreenAssistantPorts —— jobs is the ledger the applied jobs' briefs come from.
func ScreenAssistantPorts(d *deps.Runtime, jobs *jobsuc.JobsDeps) cues.Ports {
	return cues.Ports{
		Role: func(ctx context.Context, ownerID, ref string) (cues.Role, error) {
			return cueRole(ctx, d, ownerID, ref)
		},
		Notes: func(ctx context.Context, ownerID string, globs []string) ([]cues.Note, error) {
			return cueNotes(ctx, d, ownerID, globs)
		},
		Version: d.Corpus.Version,
		Screen: func(ctx context.Context, ownerID string) (cues.Screen, error) {
			return cueScreen(ctx, d, jobs, ownerID)
		},
		Model: cueModelCall(d),
	}
}

func cueRole(ctx context.Context, d *deps.Runtime, ownerID, ref string) (cues.Role, error) {
	var r access.Role
	var err error
	if _, perr := pgstore.ParseUUID(ref); perr == nil {
		r, err = d.RoleRepo.GetByID(ctx, ownerID, ref)
	} else {
		r, err = d.RoleRepo.GetByName(ctx, ownerID, ref)
	}
	if errors.Is(err, access.ErrRoleNotFound) {
		return cues.Role{}, fmt.Errorf("%w: %q", cues.ErrNoRole, ref)
	}
	if err != nil {
		return cues.Role{}, fmt.Errorf("role %q: %w", ref, err)
	}
	return cues.Role{
		ID: r.ID(), Name: r.Name(), Description: r.Description(),
		ProviderID: r.ProviderID(), CorpusURIs: r.CorpusURIs(),
	}, nil
}

// cueNotes —— every note of each genre the globs name, in corpus.list's order, kept when its
// address is inside the scope (the same glob check visitor reads go through).
func cueNotes(
	ctx context.Context, d *deps.Runtime, ownerID string, globs []string,
) ([]cues.Note, error) {
	var out []cues.Note
	for _, genre := range cueGenres {
		if !slices.ContainsFunc(globs, namesGenre(genre)) {
			continue
		}
		notes, err := genreNotes(ctx, d, ownerID, genre)
		if err != nil {
			return nil, err
		}
		out = append(out, slices.DeleteFunc(notes, outside(globs, genre))...)
	}
	return out, nil
}

func namesGenre(genre string) func(string) bool {
	return func(g string) bool { return strings.HasPrefix(g, genre+"://") }
}

func outside(globs []string, genre string) func(cues.Note) bool {
	return func(n cues.Note) bool { return !access.MatchesAnyCorpusGlob(globs, genre+"://"+n.Path) }
}

// genreNotes —— one genre, all pages.
func genreNotes(ctx context.Context, d *deps.Runtime, ownerID, genre string) ([]cues.Note, error) {
	var out []cues.Note
	req := paging.Request{Limit: cuePage}
	for {
		page, err := notesPage(ctx, d, ownerID, genre, req)
		if err != nil {
			return nil, fmt.Errorf("list %s: %w", genre, err)
		}
		out = append(out, page.Items...)
		if page.NextCursor == "" {
			return out, nil
		}
		if req.After, err = paging.Decode(page.NextCursor); err != nil {
			return nil, fmt.Errorf("list %s: %w", genre, err)
		}
	}
}

func notesPage(
	ctx context.Context, d *deps.Runtime, ownerID, genre string, req paging.Request,
) (paging.Page[cues.Note], error) {
	f := corpus.NoteFilter{}
	switch genre {
	case "wiki":
		p, err := d.WikiRepo.ListPage(ctx, ownerID, f, req)
		return paging.Each(p, func(w *corpus.TreeChild[corpus.Wiki]) cues.Note {
			return cues.Note{
				Title: w.Entry.Title(), Body: w.Entry.Body(), Tags: w.Entry.Tags(),
				Path: corpus.PathFromTitles(w.PathTitles), Genre: "wiki",
			}
		}), err
	case "output":
		p, err := d.OutputRepo.ListPage(ctx, ownerID, f, req)
		return paging.Each(p, func(o *corpus.TreeChild[corpus.Output]) cues.Note {
			return cues.Note{
				Title: o.Entry.Title(), Body: o.Entry.Body(), Tags: o.Entry.Tags(),
				Path: corpus.PathFromTitles(o.PathTitles), Genre: "output",
			}
		}), err
	}
	p, err := d.SubjectivityRepo.ListPage(ctx, ownerID, f, req)
	return paging.Each(p, func(n *corpus.TreeChild[corpus.Note]) cues.Note {
		return cues.Note{
			Title: n.Entry.Title, Body: n.Entry.Body, Tags: n.Entry.Tags,
			Path: corpus.PathFromTitles(n.PathTitles), Genre: "subjectivity",
		}
	}), err
}

// cueScreen —— the "Phone screen" subjectivity note and every applied job that has a brief, in
// the ledger's order.
func cueScreen(
	ctx context.Context, d *deps.Runtime, jobs *jobsuc.JobsDeps, ownerID string,
) (cues.Screen, error) {
	self, err := genreNotes(ctx, d, ownerID, "subjectivity")
	if err != nil {
		return cues.Screen{}, err
	}
	f, err := jobsuc.SeenFilterOf("", "", "applied")
	if err != nil {
		return cues.Screen{}, fmt.Errorf("applied filter: %w", err)
	}
	applied, err := appliedJobs(ctx, jobs, ownerID, &f)
	return cues.Screen{Script: cues.ScriptOf(self), Jobs: applied}, err
}

func appliedJobs(
	ctx context.Context, jobs *jobsuc.JobsDeps, ownerID string, f *jobsmodel.SeenFilter,
) ([]cues.Job, error) {
	var out []cues.Job
	req := paging.Request{Limit: cuePage}
	for {
		page, err := jobsuc.History(ctx, jobs, ownerID, f, req)
		if err != nil {
			return nil, fmt.Errorf("applied jobs: %w", err)
		}
		out = append(out, briefed(page.Items)...)
		if page.NextCursor == "" {
			return out, nil
		}
		if req.After, err = paging.Decode(page.NextCursor); err != nil {
			return nil, fmt.Errorf("applied jobs: %w", err)
		}
	}
}

// briefed —— the rows that carry a brief and a company.
func briefed(rows []jobsmodel.SeenRow) []cues.Job {
	var out []cues.Job
	for i := range rows {
		r := &rows[i]
		if r.Annotations.Brief != "" && r.Snapshot.Company != "" {
			out = append(out, cues.Job{
				Company: r.Snapshot.Company, Title: r.Snapshot.Title, Brief: r.Annotations.Brief,
			})
		}
	}
	return out
}
