// owner_mcp_adapters.go —— thin cmd-layer adapters that let ownercore stay free of
// postgres / connectorsvc / inference (its arch-allowed deps are usecases/domain
// only). Each wraps a concrete repo/service and maps to the ownercore-facing types.

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/owner/ownercore"
)

// ───── connector service adapter ────────────────────────────────

// newConnectorService —— build the connector orchestration service. Shared by the
// admin panel (connectorsAdminDeps) and the owner-MCP connectors capability.
func newConnectorService(d *runtimeDeps) *connector.Service {
	return connector.New(&connector.Deps{
		Repo: d.connectorRepo, Owners: d.ownerRepo, Redis: d.rdb,
		HTTP: connectorEgressClient(), Verifier: d.connectorSlots,
		Installer: uploadedInstaller{
			slots: d.connectorSlots, deps: newAssembleDeps(d.connectorRepo),
		},
		Manifests: loadBuiltinConnectorManifests(d),
	})
}

// connSvcAdapter —— maps the ownercore connector-service surface to *connector.Service,
// translating the owner-MCP DTOs (UploadedSpecArg / SpecVerdict) to/from the svc types.
type connSvcAdapter struct{ svc *connector.Service }

func (a connSvcAdapter) List(
	ctx context.Context, ownerID string,
) ([]connector.Connection, error) {
	out, err := a.svc.List(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("adapter connector list: %w", err)
	}
	return out, nil
}

func (a connSvcAdapter) Catalog() []connector.Connection { return a.svc.Catalog() }

func (a connSvcAdapter) Status(
	ctx context.Context, ownerID, id string,
) (connector.Connection, error) {
	out, err := a.svc.Status(ctx, ownerID, id)
	if err != nil {
		return out, fmt.Errorf("adapter connector status: %w", err)
	}
	return out, nil
}

func (a connSvcAdapter) CreateProtocol(
	ctx context.Context, ownerID, category, protocol string,
) (string, error) {
	out, err := a.svc.CreateProtocol(ctx, ownerID, category, protocol)
	if err != nil {
		return out, fmt.Errorf("adapter connector create protocol: %w", err)
	}
	return out, nil
}

func (a connSvcAdapter) CreateUploaded(
	ctx context.Context, ownerID string, in ownercore.UploadedSpecArg,
) (string, error) {
	out, err := a.svc.CreateUploaded(ctx, ownerID, uploadedSpec(in))
	if err != nil {
		return out, fmt.Errorf("adapter connector create uploaded: %w", err)
	}
	return out, nil
}

func (a connSvcAdapter) UpdateUploaded(
	ctx context.Context, ownerID, id string, in ownercore.UploadedSpecArg,
) error {
	if err := a.svc.UpdateUploaded(ctx, ownerID, id, uploadedSpec(in)); err != nil {
		return fmt.Errorf("adapter connector update uploaded: %w", err)
	}
	return nil
}

func (a connSvcAdapter) Delete(ctx context.Context, ownerID, id string) error {
	if err := a.svc.Delete(ctx, ownerID, id); err != nil {
		return fmt.Errorf("adapter connector delete: %w", err)
	}
	return nil
}

func (a connSvcAdapter) Activate(ctx context.Context, ownerID, id string) error {
	if err := a.svc.Activate(ctx, ownerID, id); err != nil {
		return fmt.Errorf("adapter connector activate: %w", err)
	}
	return nil
}

func (a connSvcAdapter) Disconnect(ctx context.Context, ownerID, id string) error {
	if err := a.svc.Disconnect(ctx, ownerID, id); err != nil {
		return fmt.Errorf("adapter connector disconnect: %w", err)
	}
	return nil
}

func (a connSvcAdapter) ValidateSpec(
	ctx context.Context, spec []byte, url string,
) ownercore.SpecVerdict {
	v := a.svc.ValidateSpec(ctx, spec, url)
	return ownercore.SpecVerdict{OK: v.OK, Title: v.Title, Reason: v.Reason, Auth: v.Auth}
}

func uploadedSpec(in ownercore.UploadedSpecArg) *connector.UploadedSpec {
	return &connector.UploadedSpec{
		AuthScheme: in.AuthScheme, Spec: in.Spec, Binding: in.Binding,
		ExposeAsAgentTools: in.ExposeAsAgentTools,
	}
}
