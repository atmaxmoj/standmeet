// registry_visitor_bundle_test.go —— when a session opens, capability
// instantiation must happen **concurrently**.
//
// `/api/v1/sessions` needs every capability's tool spec, so there's no avoiding
// "dial each one" — but there's no reason to dial them one at a time. Each
// externalized capability instantiation spawns a bwrap sandbox (~1s cold start),
// so serial dialing means N seconds just to start; measured under load,
// `/api/v1/sessions` took 13.9 seconds while the visitor side gives up at 15 —
// a close call that shows up as "the session occasionally fails to open".
//
// (#17 addressed the **single tool call** path — dial only the one that serves
// that tool. Session-open needs all of them, so that approach doesn't apply
// here; the only thing left to save is how the wait is spent.)
//
// **The assertion is structural, not a stopwatch**: a stopwatch drifts with the
// machine, and "faster" doesn't prove "concurrent". The test is **peak
// in-flight**: serial is always 1 (one in, one out), only concurrent reaches n.
//
// My first version used "all four reached the barrier" as the test, and it
// **passed** — even though assembly was actually serial: under serial execution
// the last one to arrive still makes "all four reached it" true. That's an
// assertion that can never go red (see [[assertion-that-cannot-fail]]), and I
// also got the duration threshold wrong in the same pass (serial is
// (n-1)×timeout, not n×). Kept here as a counterexample: **"all happened" and
// "happened at the same time" are different things**, and only the latter is
// concurrency.

package capreg_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// inFlight —— tracks "how many capabilities are inside VisitorBinding right
// now" and its peak.
//
// **The peak is the test**: serial is always 1 (one in, one out), only
// concurrent goes above 1. My first version used "all four reached the
// barrier" as the test, which is **an assertion that can never go red** —
// under serial execution the last one to arrive still satisfies it.
type inFlight struct {
	mu   sync.Mutex
	now  int
	peak int
}

func (f *inFlight) enter() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now++
	if f.now > f.peak {
		f.peak = f.now
	}
}

func (f *inFlight) leave() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now--
}

func (f *inFlight) max() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.peak
}

// barrierCap —— checks in and blocks as soon as it enters VisitorBinding,
// waiting for everyone else to arrive (or a timeout). It blocks so that "in
// flight at the same time" is observable: with an immediate in-and-out, the
// peak would always be 1 and concurrency would be invisible.
type barrierCap struct {
	flight  *inFlight
	arrived *sync.WaitGroup
	allHere chan struct{}
	once    *sync.Once
	id      string
	timeout time.Duration
}

func (c *barrierCap) ID() string        { return c.id }
func (*barrierCap) Shape() capreg.Shape { return capreg.ShapeVisitorOnly }

func (c *barrierCap) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	c.flight.enter()
	defer c.flight.leave()
	c.arrived.Done()
	c.once.Do(func() {
		go func() { c.arrived.Wait(); close(c.allHere) }()
	})
	select {
	case <-c.allHere: // everyone is in — concurrent
	case <-time.After(c.timeout): // serial: nobody else will show up, time out and leave
	}
	return &capreg.Binding{
		Tools: []capreg.BindingTool{capreg.NewTool(c.id+"_tool", c.id, "", nil, nil)},
		State: capreg.CapabilityState{ID: c.id, Enabled: true},
	}, nil
}

func (*barrierCap) OwnerMCPBindings() []*capreg.MCPBinding { return []*capreg.MCPBinding{} }
func (*barrierCap) SystemPromptFragment(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func (*barrierCap) SystemPromptFragmentID(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

const barrierWait = 300 * time.Millisecond

// The four capabilities must be in flight **at the same time**. The test is
// peak in-flight: serial is always 1, only concurrent reaches 4.
func TestAssembleVisitorBundle_DialsCapabilitiesConcurrently(t *testing.T) {
	t.Parallel()
	ids := []string{"cap.a", "cap.b", "cap.c", "cap.d"}
	reg, flight := barrierRegistry(ids)

	bundle := reg.AssembleVisitorBundle(context.Background(), &capreg.AssembleInput{
		OwnerID: "owner-1", Mode: "code",
	})

	require.Len(t, bundle.States, len(ids))
	require.Equal(t, len(ids), flight.max(),
		"capabilities were instantiated one at a time (peak in-flight 1) — "+
			"opening one session pays N sandbox cold starts back to back")
}

// barrierRegistry —— n fake capabilities that wait on each other, plus the
// in-flight counter they share.
func barrierRegistry(ids []string) (*capreg.Registry, *inFlight) {
	reg := capreg.NewRegistry()
	flight := &inFlight{}
	var arrived sync.WaitGroup
	arrived.Add(len(ids))
	allHere := make(chan struct{})
	var once sync.Once
	for _, id := range ids {
		reg.MustRegister(&barrierCap{
			id: id, flight: flight, arrived: &arrived, allHere: allHere,
			once: &once, timeout: barrierWait,
		})
	}
	return reg, flight
}

// Order is part of the contract: AssembleVisitor's doc comment says "return
// order matches Register order", and both the frontend's capability list and
// the prompt part splice order depend on it. It's the thing concurrency most
// easily loses.
func TestAssembleVisitorBundle_KeepsRegistrationOrder(t *testing.T) {
	t.Parallel()
	ids := []string{"cap.a", "cap.b", "cap.c", "cap.d"}
	reg, _ := barrierRegistry(ids)

	bundle := reg.AssembleVisitorBundle(context.Background(), &capreg.AssembleInput{
		OwnerID: "owner-1", Mode: "code",
	})

	gotStates := make([]string, 0, len(ids))
	for i := range bundle.States {
		gotStates = append(gotStates, bundle.States[i].ID)
	}
	require.Equal(t, ids, gotStates, "states must come back in registration order")

	gotTools := make([]string, 0, len(ids))
	for i := range bundle.ToolSpecs {
		gotTools = append(gotTools, bundle.ToolSpecs[i].Name)
	}
	require.Equal(t,
		[]string{"cap.a_tool", "cap.b_tool", "cap.c_tool", "cap.d_tool"}, gotTools,
		"tool specs must come back in registration order too")
}
