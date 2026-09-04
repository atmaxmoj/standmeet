// upgrade.go —— "can this instance still upgrade" and "make it upgrade".
//
//	instance.upgrade_check   which version is running / which version was released / can this
//	                         instance actually press the button
//	instance.upgrade         emit the upgrade pulse
//
// The key division of labor: **this instance has no host control** (the backend deliberately
// doesn't mount docker.sock), so it cannot upgrade itself. All it does is write one
// substrate-blind pulse to a shared file; the bundled updater sidecar (the one container with
// docker access) sees it and recreates the stack in place. can_apply is true whenever that
// sidecar shipped (the signal path is set). Without it the button honestly reports it can't —
// offering an action that can't succeed is worse than not offering it at all.
//
// upgrade only reports "the request went out", never "the upgrade succeeded". This very
// process is among the things being replaced, so it won't live to answer that later question;
// the real receipt comes from the browser polling /api/v1/instance's version and measuring it.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// ReleaseSource —— which version is newest in the image registry. The outbound HTTP call
// lives in the composition root; the domain only sees this one port.
type ReleaseSource interface {
	LatestVersion(ctx context.Context) (string, error)
	// Newer —— is candidate newer than current. How version numbers compare is the release
	// channel's rule, not this domain's.
	Newer(current, candidate string) bool
	// Released —— is this string a release version number. "What counts as a release" and
	// "how to compare" are the same rule set, so the same party answers both; the frontend
	// must not write a second regex of its own (that's two copies of a rule going out of sync).
	Released(version string) bool
}

// Redeploy —— ask the orchestrator to redeploy this instance. When Configured is false,
// Trigger is guaranteed to fail; the panel uses that to draw the button as "can't" rather
// than as pressable.
type Redeploy interface {
	Configured() bool
	Trigger(ctx context.Context) error
}

// UpgradeSources —— the two **external** ports upgrade needs. They always show up together,
// so they're passed together: one construction in the composition root, one runtime field.
type UpgradeSources struct {
	Releases ReleaseSource
	Deploy   Redeploy
}

// UpgradeDeps —— the sources this group needs to upgrade: what the process itself knows,
// plus the two external ports.
type UpgradeDeps struct {
	UpgradeSources

	System SystemInfoSource
}

// Upgrade —— two ports: check, and act.
func Upgrade(deps UpgradeDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "instance.upgrade_check",
			Description: "Which version this instance runs, the newest version published to " +
				"the release registry, and whether this instance can apply an upgrade itself " +
				"(it can when the bundled updater sidecar is present).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      upgradeCheck(deps),
		},
		{
			ID: "instance.upgrade",
			Description: "Press the upgrade: write the pulse the updater sidecar applies, which " +
				"recreates the stack on the newest images. Reports only that the request went " +
				"out — the process serving this call is itself being replaced, so it cannot " +
				"report the outcome. Read the version back afterwards to see what happened.",
			InputSchema: noArgs,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      upgradeApply(deps.Deploy),
		},
	}
}

type upgradeCheckOut struct {
	Current string `json:"current"`
	Latest  string `json:"latest"`
	Error   string `json:"error"`
	// Comparable —— is the version currently running a **release version number**. An
	// unstamped build (a self-built "dev") can't be compared — and "can't compare" must
	// never be reported as "you're already up to date". That's exactly the kind of lie just
	// fixed: an answer unrelated to the facts that looks like it knows.
	Comparable bool `json:"comparable"`
	Available  bool `json:"available"`
	CanApply   bool `json:"can_apply"`
}

// upgradeCheck —— failing to reach the image registry isn't a fault: a self-hosted instance
// may have no outbound network at all. In that case `latest` stays empty and `error` explains
// why, while `current` is still returned as usual — losing the remote shouldn't also cost us
// "which version am I running".
func upgradeCheck(deps UpgradeDeps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		out := upgradeCheckOut{
			Current:  deps.System.SystemInfo(ctx).Version,
			CanApply: deps.Deploy.Configured(),
		}
		latest, err := deps.Releases.LatestVersion(ctx)
		if err != nil {
			out.Error = err.Error()
			return json.Marshal(out)
		}
		out.Latest = latest
		out.Comparable = deps.Releases.Released(out.Current)
		out.Available = deps.Releases.Newer(out.Current, latest)
		return json.Marshal(out)
	}
}

type upgradeApplyOut struct {
	Requested bool `json:"requested"`
}

func upgradeApply(deploy Redeploy) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		if err := deploy.Trigger(ctx); err != nil {
			return nil, err
		}
		return json.Marshal(upgradeApplyOut{Requested: true})
	}
}
