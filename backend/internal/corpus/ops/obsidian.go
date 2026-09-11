// obsidian.go — the vault sync as an owner MCP op, not only the admin multipart route.
//
// Parity: the owner MCP is the owner's admin surface — whatever the admin HTTP has, the MCP has.
// The vault sync's *transport* differs by facade (the browser uploads multipart; an AI client can
// only send JSON), but the operation is the same: hand a batch of files to the vault ingester. So
// obsidian.import is an fp.Op carrying the files as a JSON array and feeding the very same ingest
// port the admin route feeds. Without it the owner cannot sync from their AI client, which is the
// whole point of the owner MCP.
//
// The ingest port (VaultIngest) is declared here as a domain port: the composition root adapts the
// connector-layer IngestFunc to it (the dispatcher may not import connector — arch boundary).

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// VaultFile — one vault file for the sync op: a path relative to the vault (top folder = genre)
// plus its markdown content.
type VaultFile struct {
	Path    string
	Content string
}

// VaultSyncResult — owner-facing counts from a sync (+ tolerant per-file errors).
type VaultSyncResult struct {
	Errors  []string
	Created int
	Updated int
	Skipped int
	Deleted int
}

// VaultIngest — the injected vault-sync port. The composition root adapts the connector-layer
// IngestFunc to this (the dispatcher may not import connector — arch boundary).
type VaultIngest func(
	ctx context.Context, ownerID string, files []VaultFile, authoritative bool,
) (VaultSyncResult, error)

// ObsidianSync — the vault-sync ops on the owner surface. A nil ingest (the domain was not wired)
// yields an empty slice, never nil.
func ObsidianSync(ingest VaultIngest) []fp.Op {
	if ingest == nil {
		return []fp.Op{}
	}
	return []fp.Op{
		{
			ID: "obsidian.import",
			Description: "Sync a vault into the corpus: pass its files (each a path + markdown " +
				"content); they reconcile into raw/wiki/subjectivity/writings by top folder, the " +
				"same ingest the admin upload runs, as JSON so it works from your AI client. " +
				"authoritative=true prunes notes absent from the set; default is a partial upsert.",
			InputSchema: obsidianImportSchema,
			Kind:        fp.Action,
			// MCP-owned: the admin surface is the bespoke multipart vault upload (a browser folder
			// picker, not a dispatched op); this is its MCP twin, same SyncIngester, files as JSON.
			Reach:  fp.Only("admin twin is the multipart upload route", "mcp"),
			Invoke: importVault(ingest),
		},
	}
}

var obsidianImportSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"files":{
			"type":"array",
			"description":"The vault files: each a path + its markdown content.",
			"items":{
				"type":"object",
				"properties":{
					"path":{"type":"string","description":"Vault path (top folder=genre)."},
					"content":{"type":"string","description":"The file's markdown content."}
				},
				"required":["path","content"]
			}
		},
		"authoritative":{"type":"boolean","description":"true = prune absent; default = upsert."}
	},
	"required":["files"]
}`)

type obsidianImportFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type obsidianImportArgs struct {
	Files         []obsidianImportFile `json:"files"`
	Authoritative bool                 `json:"authoritative"`
}

// decodeVaultArgs — decode + validate the import arguments.
func decodeVaultArgs(raw json.RawMessage) (obsidianImportArgs, error) {
	var args obsidianImportArgs
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fp.BadInput("invalid arguments: " + err.Error())
	}
	if len(args.Files) == 0 {
		return args, fp.BadInput("files: at least one file is required")
	}
	return args, nil
}

// toVaultFiles — args → the ingest port shape.
func toVaultFiles(in []obsidianImportFile) []VaultFile {
	out := make([]VaultFile, len(in))
	for i := range in {
		out[i] = VaultFile{Path: in[i].Path, Content: in[i].Content}
	}
	return out
}

// obsidianImportOut — owner-facing sync counts (json-tagged for the wire).
type obsidianImportOut struct {
	Errors  []string `json:"errors"`
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Skipped int      `json:"skipped"`
	Deleted int      `json:"deleted"`
}

func importVault(ingest VaultIngest) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		args, derr := decodeVaultArgs(raw)
		if derr != nil {
			return nil, derr
		}
		res, err := ingest(ctx, ownerID, toVaultFiles(args.Files), args.Authoritative)
		if err != nil {
			return nil, fp.OpErr("obsidian import", err)
		}
		return json.Marshal(obsidianImportOut(res))
	}
}
