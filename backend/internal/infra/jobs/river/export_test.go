package river

import "github.com/atmaxmoj/standmeet/internal/infra/jobs"

// WaitingOn —— how many Wait calls are parked on this runtime now (tests wait for it instead of
// sleeping).
func WaitingOn(rt jobs.Runtime) int {
	r, ok := rt.(*runtime)
	if !ok {
		return -1
	}
	return r.final.Waiting()
}
