// settings_deps.go — one field of the convergence point's Deps, lifted out of BuildDispatcher.
//
// BuildDispatcher is at its length limit, and its own comment says the list is meant to shrink
// as domains take their declarations home. Pulling a multi-line literal into a named helper is
// how that shrinking happens.

package wire

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

func settingsDepsOf(d *deps.Runtime) owner.SettingsDeps {
	return owner.SettingsDeps{
		BYOAI:      owner.BYOAIDeps{Owners: d.OwnerRepo},
		Monitoring: owner.MonitoringDeps{Owners: d.OwnerRepo},
		// Providers must not be left out: the domain uses it to validate provider names.
		// Omitting it compiles fine but nil-dereferences on first write — an assembly trap.
		AI: owner.AIProviderDeps{
			Owners: d.OwnerRepo, Providers: port.InferenceProviders{},
		},
		Presets: port.AiPresets(),
	}
}
