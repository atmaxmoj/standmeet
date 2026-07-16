package connector_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

func TestSyncConnector_KindAndConnected(t *testing.T) {
	t.Parallel()
	var called bool
	c := connector.NewSyncConnector("obsidian",
		func(
			_ context.Context, _ string, _ []connector.SyncFile, _ connector.SyncOpts,
		) (connector.SyncResult, error) {
			called = true
			return connector.SyncResult{Created: 1}, nil
		})

	require.Equal(t, "sync", c.Kind())
	ok, err := c.Connected(context.Background(), "owner-1")
	require.NoError(t, err)
	require.True(t, ok, "sync connector is owner-upload-triggered — always available")

	// It carries the SyncIngester capability, and Ingest delegates to the injected port.
	ing, isIngester := c.(connector.SyncIngester)
	require.True(t, isIngester, "a sync connector must expose SyncIngester")
	res, ierr := ing.Ingest(
		context.Background(), "owner-1",
		[]connector.SyncFile{{RelPath: "a.md"}}, connector.SyncOpts{})
	require.NoError(t, ierr)
	require.True(t, called, "Ingest delegates to the injected port")
	require.Equal(t, 1, res.Created)
}

// TestSyncConnector_PassesOptsThrough —— the authoritative flag decides whether the ingest may
// DELETE (F-L-6), so the connector must hand it to the port verbatim; dropping it would silently
// turn an authoritative vault sync back into upsert-only.
func TestSyncConnector_PassesOptsThrough(t *testing.T) {
	t.Parallel()
	var got connector.SyncOpts
	c := connector.NewSyncConnector("obsidian",
		func(
			_ context.Context, _ string, _ []connector.SyncFile, opts connector.SyncOpts,
		) (connector.SyncResult, error) {
			got = opts
			return connector.SyncResult{}, nil
		})
	ing, ok := c.(connector.SyncIngester)
	require.True(t, ok)
	_, err := ing.Ingest(
		context.Background(), "o", nil, connector.SyncOpts{Authoritative: true})
	require.NoError(t, err)
	require.True(t, got.Authoritative, "the authoritative flag must reach the ingest port")
}

func TestSyncConnector_IngestPropagatesError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("ingest boom")
	c := connector.NewSyncConnector("obsidian",
		func(
			_ context.Context, _ string, _ []connector.SyncFile, _ connector.SyncOpts,
		) (connector.SyncResult, error) {
			return connector.SyncResult{}, sentinel
		})
	ing, ok := c.(connector.SyncIngester)
	require.True(t, ok)
	_, err := ing.Ingest(context.Background(), "o", nil, connector.SyncOpts{})
	require.ErrorIs(t, err, sentinel)
}
