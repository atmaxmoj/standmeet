// page.go —— the page resource: this instance's two outward addresses (handle, public URL).
//
// The owner's public homepage is now a custom page (the reserved `home` slug served at /),
// not built-in page content — so page.get/put/pin/unpin and the pinned insights/projects
// are gone. What remains here is the pair of address-changing ops.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// PageOpsDeps —— the two address-changing ops (handle, public URL).
type PageOpsDeps struct {
	Handle    usecase.HandleDeps
	PublicURL usecase.PublicURLDeps
}

// Page —— outward addresses (handle/public URL).
func Page(d PageOpsDeps) []fp.Op {
	return pageAddressOps(d)
}

func pageAddressOps(d PageOpsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "page.set_handle",
			Description: "Change the owner's public handle (the URL prefix). The old handle " +
				"stays as an alias, so codes and QR links already handed out keep working.",
			InputSchema: pageHandleSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setHandle(d.Handle),
		},
		{
			ID: "page.set_public_url",
			Description: "Set this deployment's canonical public URL, used for QR codes and " +
				"canonical links. Must be http(s):// with a host.",
			InputSchema: pagePublicURLSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setPublicURL(d.PublicURL),
		},
	}
}

var (
	pageHandleSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"handle":{"type":"string",
			"description":"New handle, 2-64 chars of a-z0-9-."}},
		"required":["handle"]
	}`)

	pagePublicURLSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"public_url":{"type":"string",
			"description":"Canonical public URL, e.g. https://me.example.com."}},
		"required":["public_url"]
	}`)
)

// ownerAddressOut —— outward addresses: handle is the path prefix, public URL is for QR/links.
type ownerAddressOut struct {
	OwnerID   string `json:"owner_id"`
	Handle    string `json:"handle"`
	PublicURL string `json:"public_url"`
}

type pageHandleArgs struct {
	Handle string `json:"handle"`
}

func setHandle(deps usecase.HandleDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in pageHandleArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		updated, err := usecase.UpdateOwnerHandle(ctx, deps, ownerID, in.Handle)
		if err != nil {
			return nil, pageErr(err)
		}
		return json.Marshal(toOwnerAddressOut(&updated))
	}
}

type pagePublicURLArgs struct {
	PublicURL string `json:"public_url"`
}

func setPublicURL(deps usecase.PublicURLDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in pagePublicURLArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		updated, err := usecase.UpdateOwnerPublicURL(ctx, deps, ownerID, in.PublicURL)
		if err != nil {
			return nil, pageErr(err)
		}
		return json.Marshal(toOwnerAddressOut(&updated))
	}
}

func toOwnerAddressOut(o *entity.Owner) ownerAddressOut {
	return ownerAddressOut{OwnerID: o.ID, Handle: o.Handle, PublicURL: o.PublicURL}
}

// pageErr —— domain sentinels to protocol-agnostic categories; code is a published contract.
func pageErr(err error) error {
	for _, c := range pageErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	// Validation failure: domain already wrote the human-readable message (e.g. handle's
	// allowed chars); pass through unchanged, not a second copy of the wording.
	if errors.Is(err, apierr.ErrEmptyField) {
		return fp.BadInput(err.Error())
	}
	return fp.OpErr("page op", err)
}

var pageErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrHandleTaken, func() error {
		return fp.Coded(fp.Conflict("handle already taken"), "handle_taken")
	}},
	{usecase.ErrPublicURLInvalid, func() error {
		return fp.Coded(fp.BadInput(
			"public_url must be http(s):// with a non-empty host",
		), "public_url_invalid")
	}},
}
