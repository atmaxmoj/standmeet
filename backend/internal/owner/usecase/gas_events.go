// gas_events.go —— gas.exhausted and gas.refilled. A tank has no counter (remaining is derived),
// so "ran dry" is an edge kept on the row: gas_exhausted_at moves once per fill, and the event
// commits with that move. A refill moves gas_filled_at; its event commits with it.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// NoteGasExhausted —— the visitor gate found this tank dry: gas.exhausted, once per fill.
func NoteGasExhausted(ctx context.Context, d ProvidersDeps, ownerID, providerID string) error {
	//nolint:wrapcheck // the repo and Record name their steps
	return pgstore.InTx(ctx, d.Owners.Pool(), func(tx pgstore.Tx) error {
		moved, err := d.Owners.With(tx).MarkGasExhausted(ctx, ownerID, providerID)
		if err != nil || !moved {
			return err
		}
		return recordGas(ctx, d.Events.With(tx), GasExhausted, ownerID, providerID)
	})
}

// GasRefillPeriodicJobs —— the scheduled refill; each bump and its gas.refilled commit together.
func GasRefillPeriodicJobs(owners *repo.Repo, rec events.Recorder) []periodic.Job {
	return repo.GasRefillPeriodicJobs(owners,
		func(ctx context.Context, tx pgstore.Tx, p *repo.RefillProvider) error {
			return recordGas(ctx, rec.With(tx), GasRefilled, p.OwnerID, p.ID)
		})
}

// updateProviderRow —— the provider row. A fill (set_gas with an amount) commits with its
// gas.refilled; any other update is the row alone.
//
//nolint:wrapcheck // the caller names the step
func updateProviderRow(
	ctx context.Context, d ProvidersDeps, in *repo.UpdateProviderInput,
) (repo.ProviderRow, error) {
	if !in.SetGas || in.GasTokens == nil || *in.GasTokens <= 0 {
		return d.Owners.UpdateProvider(ctx, in)
	}
	var row repo.ProviderRow
	err := pgstore.InTx(ctx, d.Owners.Pool(), func(tx pgstore.Tx) error {
		var uerr error
		if row, uerr = d.Owners.With(tx).UpdateProvider(ctx, in); uerr != nil {
			return uerr
		}
		return recordGas(ctx, d.Events.With(tx), GasRefilled, in.OwnerID, row.ID)
	})
	return row, err
}

func recordGas(ctx context.Context, rec events.Recorder, typ, ownerID, providerID string) error {
	data := map[string]string{"provider_id": providerID}
	//nolint:wrapcheck // Record names the type
	return rec.Record(ctx, ownerID, typ, "provider/"+providerID, data)
}
