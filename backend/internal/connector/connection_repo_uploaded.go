// connectors_uploaded.go — #155 storage for uploaded openapi connectors (spec +
// JSONata binding). Connectors an owner pastes into the UI persist in the
// spec/binding/auth_scheme columns of owner_connectors; they get reassembled into the
// Hub on startup. Built-in connectors leave these columns empty (their manifest comes
// from go:embed).

package connector

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/connector/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SaveUploadedInput — storage input for an owner-authored connector (openapi:
// spec/binding; protocol: protocol).
type SaveUploadedInput struct {
	OwnerID            string
	ConnectorID        string
	Category           string
	Kind               string
	AuthScheme         string
	Protocol           string
	Title              string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}

// SaveUploaded — save an owner-authored connector (openapi carries spec/binding;
// protocol carries protocol).
func (r *Repo) SaveUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if _, qerr := db.New(r.pool).InsertUploadedConnector(ctx, db.InsertUploadedConnectorParams{
		OwnerID: ownerUUID, ConnectorID: in.ConnectorID, Category: in.Category,
		Kind: in.Kind, Spec: in.Spec, Binding: in.Binding,
		AuthScheme: in.AuthScheme, Protocol: in.Protocol, Title: in.Title,
		ExposeAsAgentTools: in.ExposeAsAgentTools,
	}); qerr != nil {
		return fmt.Errorf("insert uploaded connector: %w", qerr)
	}
	return nil
}

// UpdateUploaded — edit an existing uploaded connector's spec/binding/auth_scheme/
// category (save after reassembling).
func (r *Repo) UpdateUploaded(ctx context.Context, in *SaveUploadedInput) error {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).UpdateUploadedConnector(ctx, db.UpdateUploadedConnectorParams{
		OwnerID: ownerUUID, ConnectorID: in.ConnectorID, Category: in.Category,
		Spec: in.Spec, Binding: in.Binding, AuthScheme: in.AuthScheme,
		Title: in.Title, ExposeAsAgentTools: in.ExposeAsAgentTools,
	}); qerr != nil {
		return fmt.Errorf("update uploaded connector: %w", qerr)
	}
	return nil
}

// UploadedManifest — the stored manifest for an owner-authored connector (used to
// reassemble it on startup).
type UploadedManifest struct {
	ConnectorID        string
	Category           string
	Kind               string
	AuthScheme         string
	Protocol           string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}

// GetManifest — fetch the manifest fields for a stored connector (for uploaded
// connectors: category/kind/spec/binding/auth_scheme). No row (or a built-in row with
// no spec) → returns the zero value with an empty Spec; callers treat "Spec is empty"
// as "not an uploaded connector".
func (r *Repo) GetManifest(
	ctx context.Context, ownerID, connectorID string,
) (UploadedManifest, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return UploadedManifest{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetConnectorManifest(ctx,
		db.GetConnectorManifestParams{OwnerID: ownerUUID, ConnectorID: connectorID})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return UploadedManifest{}, nil
		}
		return UploadedManifest{}, fmt.Errorf("get connector manifest: %w", qerr)
	}
	return UploadedManifest{
		Spec: row.Spec, Binding: row.Binding, ConnectorID: connectorID,
		Category: row.Category, Kind: row.Kind, AuthScheme: row.AuthScheme,
		Protocol: row.Protocol, ExposeAsAgentTools: row.ExposeAsAgentTools,
	}, nil
}

// DeleteUploaded — delete an owner-authored connector (row delete). The category slot
// it filled goes empty along with it.
func (r *Repo) DeleteUploaded(ctx context.Context, ownerID, connectorID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	if qerr := db.New(r.pool).DeleteUploadedConnector(ctx, db.DeleteUploadedConnectorParams{
		OwnerID: ownerUUID, ConnectorID: connectorID,
	}); qerr != nil {
		return fmt.Errorf("delete uploaded connector: %w", qerr)
	}
	return nil
}

// ListUploaded — all uploaded connectors' manifests (for startup reassembly, across
// owners; v1 is single-owner).
func (r *Repo) ListUploaded(ctx context.Context) ([]UploadedManifest, error) {
	rows, err := db.New(r.pool).ListUploadedConnectors(ctx)
	if err != nil {
		return nil, fmt.Errorf("list uploaded connectors: %w", err)
	}
	out := make([]UploadedManifest, 0, len(rows))
	for i := range rows {
		out = append(out, UploadedManifest{
			Spec: rows[i].Spec, Binding: rows[i].Binding,
			ConnectorID: rows[i].ConnectorID, Category: rows[i].Category,
			Kind: rows[i].Kind, AuthScheme: rows[i].AuthScheme, Protocol: rows[i].Protocol,
			ExposeAsAgentTools: rows[i].ExposeAsAgentTools,
		})
	}
	return out, nil
}
