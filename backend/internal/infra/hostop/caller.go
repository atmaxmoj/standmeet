// caller.go — the fiber a reach-back request comes from, as the host proved it.
//
// The socket authenticates each request by the native key the host minted into that sandbox;
// the key resolves to the fiber it was minted for (rule 4). That fiber is the identity a host op
// acts for. It travels on the context, never in the request body: a field the block writes is a
// field the block can forge, so an op that reads identity from the body trusts the block.

package hostop

import "context"

type callerFiberKey struct{}

// WithCallerFiber — ctx carrying the fiber the presented native key resolved to.
func WithCallerFiber(ctx context.Context, fiber string) context.Context {
	return context.WithValue(ctx, callerFiberKey{}, fiber)
}

// CallerFiber — the proven caller fiber; "" when the socket verifies no key (eval's mini-host).
func CallerFiber(ctx context.Context) string {
	f, ok := ctx.Value(callerFiberKey{}).(string)
	if !ok {
		return ""
	}
	return f
}
