package ownercore

// cap_corpus_get.go —— corpus.get: fetch one corpus entry (full body) by
// genre + id over owner MCP. Mirrors admin GET /{raw,wiki,output}/{id}.
// Method set of corpusMutationsCapability (shares its *usecases.CorpusDeps);
// split into its own file to keep cap_corpus_mutations.go under the line cap.
// Lookup is by id only — no by-path repo method exists yet (see report).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

var errUnknownGenre = errors.New("unknown genre")

func (c *corpusMutationsCapability) getEntryBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "corpus_get_entry",
		Description: "Fetch one corpus entry with its full body by genre + id. " +
			"genre is 'raw', 'wiki', or 'output'.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"genre":{"type":"string","description":"'raw' | 'wiki' | 'output'"},
				"id":{"type":"string","description":"Entry id (uuid)"}
			},
			"required":["genre","id"]
		}`),
		Handler: c.handleGetEntry,
	}
}

type corpusGetArgsWire struct {
	Genre string `json:"genre"`
	ID    string `json:"id"`
}

func parseCorpusGetArgs(raw json.RawMessage) (corpusGetArgsWire, error) {
	var args corpusGetArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Genre == "" {
		return args, errors.New("genre is required")
	}
	if args.ID == "" {
		return args, errors.New("id is required")
	}
	return args, nil
}

// corpusEntryView —— unified single-entry view across genres. excerpt / source /
// show_as_source / published only apply to some genres (zero elsewhere).
type corpusEntryView struct {
	Genre        string   `json:"genre"`
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	Excerpt      string   `json:"excerpt,omitempty"`
	Source       string   `json:"source,omitempty"`
	CreatedAt    string   `json:"created_at"`
	UpdatedAt    string   `json:"updated_at"`
	Tags         []string `json:"tags"`
	ShowAsSource bool     `json:"show_as_source"`
	Published    bool     `json:"published"`
}

func (c *corpusMutationsCapability) handleGetEntry(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseCorpusGetArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	view, err := c.fetchEntry(ctx, ownerID, args.Genre, args.ID)
	if err != nil {
		return corpusGetErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "corpus.get", view)
}

func (c *corpusMutationsCapability) fetchEntry(
	ctx context.Context, ownerID, genre, id string,
) (*corpusEntryView, error) {
	switch genre {
	case "raw":
		return c.fetchRaw(ctx, ownerID, id)
	case "wiki":
		return c.fetchWiki(ctx, ownerID, id)
	case "output":
		return c.fetchOutput(ctx, ownerID, id)
	default:
		return nil, errUnknownGenre
	}
}

func (c *corpusMutationsCapability) fetchRaw(
	ctx context.Context, ownerID, id string,
) (*corpusEntryView, error) {
	r, err := c.corpus.Raw.GetByID(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("get raw: %w", err)
	}
	return &corpusEntryView{
		Genre: "raw", ID: r.ID(), Title: r.Title(), Body: r.Body(),
		Source: r.Source(), Tags: mcputil.NonNilStrings(r.Tags()),
		CreatedAt: r.CreatedAt().UTC().Format(mcpTimeFmt),
		UpdatedAt: r.UpdatedAt().UTC().Format(mcpTimeFmt),
	}, nil
}

func (c *corpusMutationsCapability) fetchWiki(
	ctx context.Context, ownerID, id string,
) (*corpusEntryView, error) {
	w, err := c.corpus.Wiki.GetByID(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("get wiki: %w", err)
	}
	return &corpusEntryView{
		Genre: "wiki", ID: w.ID(), Title: w.Title(), Body: w.Body(),
		Excerpt: w.Excerpt(), Tags: mcputil.NonNilStrings(w.Tags()),
		ShowAsSource: w.ShowAsSource(), Published: w.Published(),
		CreatedAt: w.CreatedAt().UTC().Format(mcpTimeFmt),
		UpdatedAt: w.UpdatedAt().UTC().Format(mcpTimeFmt),
	}, nil
}

func (c *corpusMutationsCapability) fetchOutput(
	ctx context.Context, ownerID, id string,
) (*corpusEntryView, error) {
	o, err := c.corpus.Output.GetByID(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("get output: %w", err)
	}
	return &corpusEntryView{
		Genre: "output", ID: o.ID(), Title: o.Title(), Body: o.Body(),
		Excerpt: o.Excerpt(), Tags: mcputil.NonNilStrings(o.Tags()),
		ShowAsSource: o.ShowAsSource(), Published: o.Published(),
		CreatedAt: o.CreatedAt().UTC().Format(mcpTimeFmt),
		UpdatedAt: o.UpdatedAt().UTC().Format(mcpTimeFmt),
	}, nil
}

func corpusGetErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	switch {
	case errors.Is(err, errUnknownGenre):
		return capreg.MCPError("genre must be 'raw', 'wiki', or 'output'")
	case errors.Is(err, corpusdomain.ErrRawNotFound),
		errors.Is(err, corpusdomain.ErrWikiNotFound),
		errors.Is(err, corpusdomain.ErrOutputNotFound):
		return capreg.MCPError("corpus entry not found")
	default:
		log.Error("cap corpus.get", "err", err)
		return capreg.MCPError("corpus.get failed")
	}
}
