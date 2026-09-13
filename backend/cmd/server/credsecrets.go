// credsecrets.go — adapts the credential-manager (credmgr) to the credentials repo's SecretStore
// port. The only impedance is "absent": credmgr.Get returns ErrNotFound, while the repo's port
// treats an empty string as absent (so it can fall back to a legacy block_connections value). This
// adapter maps ErrNotFound → ("", nil); everything else passes through.

package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin/credmgr"
)

type credmgrSecrets struct{ store *credmgr.Store }

// newCredmgrSecrets — wrap credmgr as the credentials repo's SecretStore (returns the concrete
// adapter; the repo takes it as the SecretStore interface).
func newCredmgrSecrets(store *credmgr.Store) credmgrSecrets {
	return credmgrSecrets{store: store}
}

func (a credmgrSecrets) Set(ctx context.Context, owner, name, value string) error {
	if err := a.store.Set(ctx, owner, name, value); err != nil {
		return fmt.Errorf("credmgr set: %w", err)
	}
	return nil
}

func (a credmgrSecrets) Get(ctx context.Context, owner, name string) (string, error) {
	v, err := a.store.Get(ctx, owner, name)
	if errors.Is(err, credmgr.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("credmgr get: %w", err)
	}
	return v, nil
}

func (a credmgrSecrets) Delete(ctx context.Context, owner, name string) error {
	if err := a.store.Delete(ctx, owner, name); err != nil {
		return fmt.Errorf("credmgr delete: %w", err)
	}
	return nil
}
