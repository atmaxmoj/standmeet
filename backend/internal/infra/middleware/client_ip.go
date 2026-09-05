// client_ip.go — expose the resolved client address to packages that the architecture
// boundary bars from importing internal/infra/clientaddr directly (e.g. adminroutes), through
// the middleware layer they already depend on.

package middleware

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
)

// ClientAddr returns the resolved client address from the request context, or "" if the source
// isn't visible. Unlike login_guard's own clientIP (which substitutes a rate-limit bucket name
// when unknown), this returns "" so the caller — e.g. the active-sessions panel — can show the
// source as unknown rather than as a bucket label.
func ClientAddr(ctx context.Context) string {
	return clientaddr.Of(ctx)
}
