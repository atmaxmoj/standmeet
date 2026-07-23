package usecases

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// steerWps —— shared fixture: one no-evidence steering waypoint, one evidenced steering waypoint,
// one terminal (booking) waypoint. Terminal completes via a tool, so it legitimately has no
// corpus evidence and must survive the evidence filter.
func steerWps() []domain.Waypoint {
	return []domain.Waypoint{
		{WaypointID: "steer-no-refs", IsTerminal: false},
		{WaypointID: "steer-with-refs", EvidenceRefs: []string{"wiki://x"}},
		{WaypointID: "book", IsTerminal: true},
	}
}

// TestFilterSteeringByEvidence —— F-A-10: the evidence filter drops a NON-terminal waypoint with
// empty evidence_refs (prompt rule 6 "no refs → not proposable" becomes real), while an evidenced
// steering waypoint and a TERMINAL / tool waypoint (booking) are always kept.
func TestFilterSteeringByEvidence(t *testing.T) {
	t.Parallel()
	got := filterSteeringByEvidence(steerWps())
	require.Equal(t, []string{"steer-with-refs", "book"}, waypointIDs(got),
		"drops only the no-evidence non-terminal; terminal + evidenced steering survive")
}

// TestSteeringCandidates —— the snapshot toggle drives filtering: require=false keeps all
// unvisited; require=true drops the no-evidence steering waypoint. Visited waypoints are
// excluded either way.
func TestSteeringCandidates(t *testing.T) {
	t.Parallel()
	lax := domain.NewRoleSnapshot(&domain.RoleSnapshotInit{Waypoints: steerWps()})
	require.Equal(t, []string{"steer-no-refs", "steer-with-refs", "book"},
		waypointIDs(SteeringCandidates(&lax, nil)),
		"require=false is the default — no evidence filtering")

	strict := domain.NewRoleSnapshot(&domain.RoleSnapshotInit{
		Waypoints: steerWps(), RequireGhostEvidence: true,
	})
	require.Equal(t, []string{"steer-with-refs", "book"},
		waypointIDs(SteeringCandidates(&strict, nil)),
		"require=true drops the no-evidence non-terminal steering waypoint")

	require.Equal(t, []string{"steer-with-refs"},
		waypointIDs(SteeringCandidates(&strict, []string{"book"})),
		"visited waypoints are excluded before the evidence filter")
}

func waypointIDs(wps []domain.Waypoint) []string {
	out := make([]string, 0, len(wps))
	for i := range wps {
		out = append(out, wps[i].WaypointID)
	}
	return out
}
