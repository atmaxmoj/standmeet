// host_page_store.go —— what a sandboxed block may do with the store of the microsite a turn is
// asked on (docs/design/scenario-s2-collaborative-writing.md, *Agent read* / *Agent write*): read
// it, search it, append to it. The agent is the main way visitors write a shared manuscript.
//
// The page comes from the turn (the session's `page`), never from the model's arguments, and every
// op first checks the session may open that page. A refusal the visitor should hear (full, closed,
// waits for review) is an answer, not an error, so the agent can say it in its own words.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// PageStoreHostOps —— page_store.read / page_store.search / page_store.append.
func PageStoreHostOps(deps *usecase.MicrositeDeps) []hostop.Op {
	if deps == nil {
		return []hostop.Op{}
	}
	return []hostop.Op{
		{
			Name:        "page_store.read",
			Description: "Every published document of the page's collection.",
			Invoke:      onPage(*deps, pageStoreRead),
		},
		{
			Name:        "page_store.search",
			Description: "The published documents whose text matches.",
			Invoke:      onPage(*deps, pageStoreSearch),
		},
		{
			Name:        "page_store.append",
			Description: "Add one document for the visitor.",
			Invoke:      onPage(*deps, pageStoreAppend),
		},
	}
}

// pageStoreArgs —— the tool's own arguments.
type pageStoreArgs struct {
	Collection string `json:"collection"`
	Query      string `json:"query"`
	Text       string `json:"text"`
}

// pageStoreReq —— the session (forwarded off `_meta`) and the tool's arguments.
type pageStoreReq struct {
	OwnerID     string        `json:"owner_id"`
	Page        string        `json:"page"`
	SubjectID   string        `json:"subject_id"`
	VisitorName string        `json:"visitor_name"`
	Args        pageStoreArgs `json:"args"`
}

// pageStoreAnswer —— what the agent reads back.
type pageStoreAnswer struct {
	ID      string            `json:"id,omitempty"`
	Message string            `json:"message,omitempty"`
	Docs    []json.RawMessage `json:"docs,omitempty"`
	OK      bool              `json:"ok"`
	Pending bool              `json:"pending,omitempty"`
}

// pageStoreOp —— one op's work once the session may act on its page.
type pageStoreOp func(
	context.Context, usecase.MicrositeDeps, *pageStoreReq,
) (*pageStoreAnswer, error)

// onPage —— decode the request, check the session may act on its page, then run op. A page the
// session may not reach is an answer for the agent (ok=false with a message), not an op failure.
func onPage(deps usecase.MicrositeDeps, op pageStoreOp) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req pageStoreReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("page_store: decode: %w", err)
		}
		if req.Page == "" {
			return answer(&pageStoreAnswer{Message: "This conversation is not on a page."}, nil)
		}
		if usecase.SessionOpensPage(ctx, deps, req.OwnerID, req.Page, req.SubjectID) != nil {
			return answer(&pageStoreAnswer{Message: "This page is not open to this visitor."}, nil)
		}
		return answer(op(ctx, deps, &req))
	}
}

func pageStoreRead(
	ctx context.Context, deps usecase.MicrositeDeps, req *pageStoreReq,
) (*pageStoreAnswer, error) {
	docs, err := usecase.VisitorQuery(ctx, deps, req.OwnerID,
		usecase.DocQuery{Slug: req.Page, Collection: req.Args.Collection})
	if err != nil {
		return nil, fmt.Errorf("page_store.read: %w", err)
	}
	return &pageStoreAnswer{OK: true, Docs: docs}, nil
}

func pageStoreSearch(
	ctx context.Context, deps usecase.MicrositeDeps, req *pageStoreReq,
) (*pageStoreAnswer, error) {
	docs, err := usecase.SearchDocs(ctx, deps, req.OwnerID, usecase.DocSearch{
		DocQuery: usecase.DocQuery{Slug: req.Page, Collection: req.Args.Collection},
		Query:    req.Args.Query,
	})
	if err != nil {
		return nil, fmt.Errorf("page_store.search: %w", err)
	}
	return &pageStoreAnswer{OK: true, Docs: docs}, nil
}

func pageStoreAppend(
	ctx context.Context, deps usecase.MicrositeDeps, req *pageStoreReq,
) (*pageStoreAnswer, error) {
	doc, merr := json.Marshal(map[string]string{"text": req.Args.Text})
	if merr != nil {
		return nil, fmt.Errorf("page_store.append: %w", merr)
	}
	got, err := usecase.VisitorInsert(ctx, deps, req.OwnerID, &usecase.DocWrite{
		Slug: req.Page, Collection: req.Args.Collection, Doc: doc,
		Author: entity.DocAuthor{Kind: entity.AuthorAgent, Name: req.VisitorName},
	})
	return appendAnswer(got, err)
}

// appendRefusals —— a refused write, in words the visitor can be told. First match wins.
var appendRefusals = []struct {
	err     error
	message string
}{
	{entity.ErrMicrositeStoreQuota, "The page is full: it holds as many documents as allowed."},
	{entity.ErrMicrositeStoreNotWritable, "The owner has not opened this page for writing."},
	{usecase.ErrMicrositeStoreInvalid, "That text could not be saved (empty or too long)."},
}

// appendAnswer —— the receipt, or the refusal in words the visitor can be told.
func appendAnswer(got usecase.InsertedDoc, err error) (*pageStoreAnswer, error) {
	if err == nil {
		return appendReceipt(got), nil
	}
	for _, r := range appendRefusals {
		if errors.Is(err, r.err) {
			return &pageStoreAnswer{Message: r.message}, nil
		}
	}
	return nil, fmt.Errorf("page_store.append: %w", err)
}

func appendReceipt(got usecase.InsertedDoc) *pageStoreAnswer {
	if got.Pending {
		return &pageStoreAnswer{
			OK: true, ID: got.ID, Pending: true,
			Message: "Saved. It waits for the owner's review before others see it.",
		}
	}
	return &pageStoreAnswer{OK: true, ID: got.ID, Message: "Added; everyone on the page sees it."}
}

func answer(a *pageStoreAnswer, err error) (json.RawMessage, error) {
	if err != nil {
		return nil, err
	}
	out, merr := json.Marshal(a)
	if merr != nil {
		return nil, fmt.Errorf("page_store: marshal: %w", merr)
	}
	return out, nil
}
