// connection_repo_uploaded.go — #155 storage for owner-uploaded openapi blocks (spec +
// JSONata binding). A block an owner pastes into the UI persists in the
// spec/binding/auth_scheme columns of block_connections; it gets reassembled into the
// supplier table on startup. A built-in block leaves these columns empty, because its
// manifest is embedded in the image instead.
//
// (That last sentence used to end with the embed directive's own spelling. A comment line
// whose text begins with that word and a space is a malformed directive, not prose —
// staticcheck SA9009 is the only thing that would have said so.)

package credentials

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials/db"
)

// SaveUploadedInput — storage input for an owner-authored block (openapi:
// spec/binding; protocol: protocol).
type SaveUploadedInput struct {
	OwnerID            string
	BlockID            string
	Seam               string
	Kind               string
	AuthScheme         string
	Protocol           string
	Title              string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}

// SaveUploaded — save an owner-authored block (openapi carries spec/binding;
// protocol carries protocol).
func (r *Repo) SaveUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if _, qerr := db.New(r.pool).InsertUploadedBlock(ctx, db.InsertUploadedBlockParams{
		OwnerID: ownerUUID, BlockID: in.BlockID, Seam: in.Seam,
		Kind: in.Kind, Spec: in.Spec, Binding: in.Binding,
		AuthScheme: in.AuthScheme, Protocol: in.Protocol, Title: in.Title,
		ExposeAsAgentTools: in.ExposeAsAgentTools,
	}); qerr != nil {
		return fmt.Errorf("insert uploaded block: %w", qerr)
	}
	return nil
}

// UpdateUploaded — edit an existing uploaded block's spec/binding/auth_scheme/
// seam (save after reassembling).
func (r *Repo) UpdateUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).UpdateUploadedBlock(ctx, db.UpdateUploadedBlockParams{
		OwnerID: ownerUUID, BlockID: in.BlockID, Seam: in.Seam,
		Spec: in.Spec, Binding: in.Binding, AuthScheme: in.AuthScheme,
		Title: in.Title, ExposeAsAgentTools: in.ExposeAsAgentTools,
	}); qerr != nil {
		return fmt.Errorf("update uploaded block: %w", qerr)
	}
	return nil
}

// UploadedManifest — the stored manifest for an owner-authored block (used to
// reassemble it on startup).
type UploadedManifest struct {
	BlockID            string
	Seam               string
	Kind               string
	AuthScheme         string
	Protocol           string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}

// GetManifest — fetch the manifest fields for a stored block (for an uploaded one:
// seam/kind/spec/binding/auth_scheme). No row (or a built-in row with no spec) →
// returns the zero value with an empty Spec; callers treat "Spec is empty" as
// "not an uploaded block".
func (r *Repo) GetManifest(
	ctx context.Context, ownerID, blockID string,
) (UploadedManifest, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return UploadedManifest{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetBlockManifest(ctx,
		db.GetBlockManifestParams{OwnerID: ownerUUID, BlockID: blockID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return UploadedManifest{}, nil
		}
		return UploadedManifest{}, fmt.Errorf("get block manifest: %w", qerr)
	}
	return UploadedManifest{
		Spec: row.Spec, Binding: row.Binding, BlockID: blockID,
		Seam: row.Seam, Kind: row.Kind, AuthScheme: row.AuthScheme,
		Protocol: row.Protocol, ExposeAsAgentTools: row.ExposeAsAgentTools,
	}, nil
}

// DeleteUploaded — delete an owner-authored block (row delete). The seam slot
// it filled goes empty along with it.
func (r *Repo) DeleteUploaded(ctx context.Context, ownerID, blockID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).DeleteUploadedBlock(ctx, db.DeleteUploadedBlockParams{
		OwnerID: ownerUUID, BlockID: blockID,
	}); qerr != nil {
		return fmt.Errorf("delete uploaded block: %w", qerr)
	}
	return nil
}

// ListUploaded — all uploaded blocks' manifests (for startup reassembly, across
// owners; v1 is single-owner).
func (r *Repo) ListUploaded(ctx context.Context) ([]UploadedManifest, error) {
	rows, err := db.New(r.pool).ListUploadedBlocks(ctx)
	if err != nil {
		return nil, fmt.Errorf("list uploaded blocks: %w", err)
	}
	out := make([]UploadedManifest, 0, len(rows))
	for i := range rows {
		out = append(out, UploadedManifest{
			Spec: rows[i].Spec, Binding: rows[i].Binding,
			BlockID: rows[i].BlockID, Seam: rows[i].Seam,
			Kind: rows[i].Kind, AuthScheme: rows[i].AuthScheme, Protocol: rows[i].Protocol,
			ExposeAsAgentTools: rows[i].ExposeAsAgentTools,
		})
	}
	return out, nil
}
