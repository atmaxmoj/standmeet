// codes_acl.go — the ACL facet of the codes resource: the per-code denylist + steering
// destinations.
//
// There are **three kinds** of denial (capability / skill / corpus URI) — three dimensions of
// the same thing: this code narrowing the scope the role gave it one layer further. The rules
// live in usecase/code_acl.go; this file only declares and forwards.
//
// Before normalization these were split across two places: MCP's codes.list_denials gave only
// the first two kinds, while the corpus kind was served by a separate admin route that had no
// row in the ledger. So when the owner looked at a code's ACL from Claude Code, they saw an
// **incomplete** picture — missing exactly "which corpus this code can't see". Now all three
// kinds live in the same payload.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

func codeACLOps(deps usecase.CodeACLDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "codes.list_denials",
			Description: "List everything this code is denied: capabilities, skills, and " +
				"corpus URI globs. All three narrow whatever the role granted.",
			InputSchema: codeIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCodeDenials(deps),
		},
		{
			ID: "codes.add_denial",
			Description: "Deny this code one capability, skill, or corpus URI glob. " +
				"Idempotent.",
			InputSchema: codeDenialSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeCodeDenial(deps, usecase.AddCodeDenial),
		},
		{
			ID:          "codes.remove_denial",
			Description: "Lift one denial from this code. Idempotent.",
			InputSchema: codeDenialSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeCodeDenial(deps, usecase.RemoveCodeDenial),
		},
		{
			ID: "codes.set_corpus_denials",
			Description: "Replace the whole list of corpus URI globs this code takes back " +
				"from its role's grant. Pure subtraction: it can never open what the role " +
				"never granted.",
			InputSchema: codeCorpusSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCodeCorpusDenials(deps),
		},
		{
			ID: "codes.waypoints",
			Description: "Read this code's ghost-steering waypoints: what it inherits from " +
				"the role, what it overrides, and the effective merge.",
			InputSchema: codeIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      readCodeWaypoints(deps),
		},
		{
			ID: "codes.set_waypoints",
			Description: "Set this code's waypoint overrides. An empty list clears the " +
				"override and goes back to inheriting the role's.",
			InputSchema: codeWaypointsSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCodeWaypoints(deps),
		},
	}
}

var (
	codeDenialSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"kind":{"type":"string","description":"capability | skill | corpus."},
			"target_id":{"type":"string",
				"description":"Capability id, skill id, or corpus URI glob."}
		},
		"required":["code_id","kind","target_id"]
	}`)

	codeCorpusSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"uris":{"type":"array","items":{"type":"string"},
				"description":"Corpus URI globs this code takes back; empty inherits the role."}
		},
		"required":["code_id","uris"]
	}`)

	codeWaypointsSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"waypoints":{"type":"array","items":{"type":"object"},
				"description":"Override list; empty clears the override."}
		},
		"required":["code_id","waypoints"]
	}`)
)

// codeDenialsOut / codeWaypointsOut — outbound payloads (identical on every facade).
type codeDenialsOut struct {
	CapabilityIDs []string `json:"capability_ids"`
	SkillIDs      []string `json:"skill_ids"`
	CorpusURIs    []string `json:"corpus_uris"`
	CorpusGranted []string `json:"corpus_granted"`
	// CorpusPublishedOnly — the inherited role reads "whatever is published"; it has no
	// positive list, so an empty corpus_granted **does not mean** nothing is readable.
	CorpusPublishedOnly bool `json:"corpus_published_only"`
}

type codeWaypointsOut struct {
	Inherited []entity.Waypoint `json:"inherited"`
	Overrides []entity.Waypoint `json:"overrides"`
	Effective []entity.Waypoint `json:"effective"`
}

func marshalDenials(d *usecase.CodeDenials) (json.RawMessage, error) {
	return json.Marshal(codeDenialsOut{
		CapabilityIDs: nonNilStrings(d.CapabilityIDs),
		SkillIDs:      nonNilStrings(d.SkillIDs),
		CorpusURIs:    nonNilStrings(d.CorpusURIs),
		CorpusGranted: nonNilStrings(d.CorpusGranted),

		CorpusPublishedOnly: d.CorpusPublishedOnly,
	})
}

func marshalWaypoints(w *usecase.CodeWaypointsView) (json.RawMessage, error) {
	return json.Marshal(codeWaypointsOut{
		Inherited: nonNilWaypoints(w.Inherited),
		Overrides: nonNilWaypoints(w.Overrides),
		Effective: nonNilWaypoints(w.Effective),
	})
}

func nonNilWaypoints(in []entity.Waypoint) []entity.Waypoint {
	if in == nil {
		return []entity.Waypoint{}
	}
	return in
}

func listCodeDenials(deps usecase.CodeACLDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		d, err := usecase.ListCodeDenials(ctx, deps, ownerID, id)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalDenials(&d)
	}
}

type denialArgs struct {
	CodeID   string `json:"code_id"`
	Kind     string `json:"kind"`
	TargetID string `json:"target_id"`
}

func parseCodeDenial(raw json.RawMessage) (usecase.CodeDenialRef, error) {
	var in denialArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return usecase.CodeDenialRef{}, fp.BadInput("invalid arguments: " + err.Error())
	}
	ref := usecase.CodeDenialRef{CodeID: in.CodeID, Kind: in.Kind, TargetID: in.TargetID}
	return ref, fp.RequireArgs(
		[2]string{"code_id", in.CodeID}, [2]string{"kind", in.Kind},
		[2]string{"target_id", in.TargetID},
	)
}

// codeDenialWrite — add and remove differ only in which use case gets called; the input and
// response shapes are identical, so what gets passed down is **the action to perform**.
type codeDenialWrite func(
	ctx context.Context, d usecase.CodeACLDeps, in *usecase.CodeDenialRef,
) (usecase.CodeDenials, error)

func writeCodeDenial(deps usecase.CodeACLDeps, apply codeDenialWrite) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseCodeDenial(raw)
		if perr != nil {
			return nil, perr
		}
		in.OwnerID = ownerID
		d, err := apply(ctx, deps, &in)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalDenials(&d)
	}
}

type codeCorpusArgs struct {
	CodeID string   `json:"code_id"`
	URIs   []string `json:"uris"`
}

// setCodeCorpusDenials — a full replace. Corpus takeback is a list the owner edits in one
// text box; adding/removing one item at a time can't express "save this version".
func setCodeCorpusDenials(deps usecase.CodeACLDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeCorpusArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
			return nil, err
		}
		d, err := usecase.SetCodeCorpusDenials(
			ctx, deps, ownerID, in.CodeID, nonNilStrings(in.URIs),
		)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalDenials(&d)
	}
}

func readCodeWaypoints(deps usecase.CodeACLDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		w, err := usecase.CodeWaypoints(ctx, deps, ownerID, id)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalWaypoints(&w)
	}
}

type codeWaypointsArgs struct {
	CodeID    string            `json:"code_id"`
	Waypoints []entity.Waypoint `json:"waypoints"`
}

func setCodeWaypoints(deps usecase.CodeACLDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCodeWaypoints(raw)
		if perr != nil {
			return nil, perr
		}
		w, err := usecase.SetCodeWaypoints(ctx, deps, ownerID, in.CodeID, in.Waypoints)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalWaypoints(&w)
	}
}

func decodeCodeWaypoints(raw json.RawMessage) (codeWaypointsArgs, error) {
	var in codeWaypointsArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("waypoints must be an array of waypoint objects")
	}
	in.Waypoints = nonNilWaypoints(in.Waypoints)
	return in, fp.RequireArgs([2]string{"code_id", in.CodeID})
}
