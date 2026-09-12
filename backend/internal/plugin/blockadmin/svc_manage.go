// svc_manage.go — orchestration for a supplier's "owner self-creates/edits": uploading openapi,
// creating a protocol supplier, editing a spec, deriving a credential form. Shares Service
// with service.go, split out to keep under max-lines.

package blockadmin

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/credform"
	"github.com/atmaxmoj/standmeet/internal/infra/openapi"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// CreateUploaded — build an openapi supplier from the spec + JSONata binding the owner pasted
// in: assembly-time validation (bad spec/binding/jsonata → ErrInvalidManifest) → register into
// the live supplier table → persist (for reload on boot). Returns the id.
func (s *Service) CreateUploaded(
	ctx context.Context, ownerID string, in *UploadedSpec,
) (string, error) {
	norm, nerr := s.resolveSpec(ctx, in)
	if nerr != nil {
		return "", nerr
	}
	in = norm
	id, err := randomState()
	if err != nil {
		return "", err
	}
	m := openapiManifest("up-"+id, in)
	seam, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf(wrapSentinel, ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.SaveUploaded(ctx, uploadedSaveInput(ownerID, m.ID, seam, in)); serr != nil {
		return "", fmt.Errorf("persist uploaded supplier: %w", serr)
	}
	return m.ID, nil
}

// isBuiltin — whether this id is a built-in supplier (present in the embedded manifests).
// Built-ins can't be changed/deleted.
func (s *Service) isBuiltin(id string) bool { return s.Manifest(id) != nil }

// Delete — deletes an owner-created supplier (row delete). A built-in (embedded manifest)
// can't be deleted → ErrBuiltinReadonly. After deletion, the seam slot it filled goes empty
// (the slot store can't find it → blocks depending on it re-gate).
func (s *Service) Delete(ctx context.Context, ownerID, id string) error {
	if s.isBuiltin(id) {
		return ErrBuiltinReadonly
	}
	if err := s.d.Repo.DeleteUploaded(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete supplier: %w", err)
	}
	return nil
}

// resolveSpec — turns whatever the owner submitted into **a spec ready to save as-is**: no body
// present → fetch it from the source URL (F-C-25), then merge in the base URL (F-C-22). Returns
// a copy, never mutates the caller's input.
//
// Both Create and Update go through this, so "the spec being saved is already complete" is a
// shared precondition for both paths, not something one of them has to remember to do. Neither
// given → zero change, passed straight through (rejected downstream by the ingestion gate if
// invalid).
func (s *Service) resolveSpec(ctx context.Context, in *UploadedSpec) (*UploadedSpec, error) {
	body := in.Spec
	if len(body) == 0 && in.URL != "" {
		fetched, ferr := s.fetchSpec(ctx, in.URL)
		if ferr != nil {
			return nil, fmt.Errorf(wrapSentinel, ErrInvalidManifest, ferr)
		}
		body = fetched
	}
	raw, err := openapi.ApplyBaseURL(body, in.BaseURL)
	if err != nil {
		return nil, fmt.Errorf(wrapSentinel, ErrInvalidManifest, err)
	}
	out := *in
	out.Spec = raw
	return &out, nil
}

// bytesOrEmpty — nil → empty bytea (the column is NOT NULL). An agent-only supplier has no
// binding (nil); store it as empty, not NULL.
func bytesOrEmpty(b []byte) []byte {
	if b == nil {
		return []byte{}
	}
	return b
}

// openapiManifest — builds an openapi manifest from the owner-pasted UploadedSpec. Create and
// Update share this one field mapping, pulled out as a single source of truth (otherwise adding
// a manifest field means changing both create and edit, easy to miss one).
func openapiManifest(id string, in *UploadedSpec) *adapters.Manifest {
	return &adapters.Manifest{
		ID: id, Kind: "openapi", AuthScheme: in.AuthScheme,
		Spec: in.Spec, Binding: in.Binding, ExposeAsAgentTools: in.ExposeAsAgentTools,
	}
}

// uploadedSaveInput — the persistence input for an openapi uploaded supplier. Create/Update
// share this one mapping (nil binding → empty bytea, the column is NOT NULL), a single source
// of truth.
func uploadedSaveInput(ownerID, id, seam string, in *UploadedSpec) *credentials.SaveUploadedInput {
	return &credentials.SaveUploadedInput{
		OwnerID: ownerID, BlockID: id, Seam: seam, Kind: "openapi",
		Spec: bytesOrEmpty(in.Spec), Binding: bytesOrEmpty(in.Binding),
		AuthScheme: in.AuthScheme, ExposeAsAgentTools: in.ExposeAsAgentTools,
		// The vendor's own name, captured once and stored. A supplier with no
		// seam-contract binding has an empty-string seam, and the card name renders
		// off the seam — so it ended up nameless in the list (F-C-56).
		Title: openapi.SpecTitle(in.Spec),
	}
}

// CreateProtocol — an owner self-creating a protocol supplier (caldav/smtp…, no spec): assemble
// (NewXxxSupplier) + register into the live supplier table + persist. Credentials get filled in
// afterward via SaveCredentials.
func (s *Service) CreateProtocol(
	ctx context.Context, ownerID, seam, protocol string,
) (string, error) {
	id, err := randomState()
	if err != nil {
		return "", err
	}
	m := &adapters.Manifest{
		ID: "up-" + id, Kind: "protocol", Protocol: protocol, Seam: seam,
	}
	installed, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return "", fmt.Errorf(wrapSentinel, ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.SaveUploaded(ctx, &credentials.SaveUploadedInput{
		OwnerID: ownerID, BlockID: m.ID, Seam: installed, Kind: "protocol", Protocol: protocol,
		// protocol has no spec/binding, given empty bytea (column is NOT NULL)
		Spec: []byte{}, Binding: []byte{},
	}); serr != nil {
		return "", fmt.Errorf("persist protocol supplier: %w", serr)
	}
	return m.ID, nil
}

// UpdateUploaded — edit an already-created uploaded supplier's spec/binding (change auth type,
// etc.) → reassemble (validate+SSRF) + re-register + persist. A built-in supplier
// can't be edited (its spec comes from embedded data) → ErrBuiltinReadonly.
func (s *Service) UpdateUploaded(
	ctx context.Context, ownerID, id string, in *UploadedSpec,
) error {
	if s.isBuiltin(id) {
		return ErrBuiltinReadonly
	}
	norm, nerr := s.resolveSpec(ctx, in)
	if nerr != nil {
		return nerr
	}
	in = norm
	m := openapiManifest(id, in)
	seam, ierr := s.d.Installer.Install(m)
	if ierr != nil {
		return fmt.Errorf(wrapSentinel, ErrInvalidManifest, ierr)
	}
	if serr := s.d.Repo.UpdateUploaded(ctx, uploadedSaveInput(ownerID, id, seam, in)); serr != nil {
		return fmt.Errorf("persist updated supplier: %w", serr)
	}
	return nil
}

// CredentialForm — derive the credential form this supplier asks the owner to fill in (per the
// spec's securityScheme). CredentialForm is an alias of credform's type of the same name, so
// the derived result is returned directly, no field-by-field copy.
func (s *Service) CredentialForm(
	ctx context.Context, ownerID, id string,
) (credform.CredentialForm, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return credform.CredentialForm{}, merr
	}
	form, derr := credform.DeriveCredentialForm(&credform.Source{
		ID: m.ID, Kind: m.Kind, Protocol: m.Protocol, Spec: m.Spec, AuthScheme: m.AuthScheme,
	})
	if derr != nil {
		return credform.CredentialForm{}, fmt.Errorf(wrapSentinel, ErrInvalidManifest, derr)
	}
	form.Granted = s.grantedScopes(ctx, ownerID, id)
	form.Shortfall = shortfallFor(m, form.Granted)
	return form, nil
}

// shortfallFor — which actions this grant can't perform (F-B-8). **Only asked once something
// has actually been granted**: a not-yet-connected connection "can do nothing" is a truism, the
// card should say "go connect it", not list a pile of missing scopes. A spec that can't be
// parsed (a protocol supplier has none) → empty: that class has no notion of scope at all.
func shortfallFor(m *adapters.Manifest, granted []string) []credform.ScopeShortfall {
	if len(granted) == 0 {
		return []credform.ScopeShortfall{}
	}
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return []credform.ScopeShortfall{}
	}
	return credform.ScopeShortfallFor(spec, granted)
}

// grantedScopes — the scope this connection **was actually granted at the time**. A different
// thing from form.Scopes (the spec-derived **selectable list**): one is "what this supplier
// supports", the other is "what I granted". The panel needs to show the latter, and it used to
// have nowhere to get it — storage always had it (`decodeConnection` already decodes it),
// nothing was reporting it outward (F-C-33).
//
// Empty when it can't be retrieved: not connected, or a read failure, both just mean "no
// granted scope to show", and shouldn't 500 the whole credential form.
func (s *Service) grantedScopes(ctx context.Context, ownerID, id string) []string {
	conn, err := s.d.Repo.Get(ctx, ownerID, id)
	if err != nil {
		return []string{}
	}
	return conn.Scopes
}
