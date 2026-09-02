// dial.go —— dials out to an external MCP server. **Two HTTP transports; the owner never
// picks one.**
//
// The MCP spec's streamable HTTP (2025-03-26) superseded the old HTTP+SSE (2024-11-05),
// but plenty of remote servers still expose only the old `/sse` endpoint and never
// migrated. The owner only has one address; which transport it speaks is **a property of
// the other side** —— making him choose on the registration form something he has no way
// to know is offloading our problem onto him.
//
// Before this, the file only had NewStreamableHttpClient, not a single line of SSE
// anywhere in the repo: the owner pastes an old address, the dial fails, and that
// server's tools silently vanish with the UI never saying why.

package mcpclient

import (
	"context"
	"errors"
	"fmt"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgotransport "github.com/mark3labs/mcp-go/client/transport"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// ErrUnreachable —— the dial failed (network / TLS / protocol / Initialize failure).
// It's this error only when **both transports fail** —— a single failure just falls
// back to the other. Callers use it to silently hide that server (without blocking
// chat), so the real cause has to be wrapped inside.
var ErrUnreachable = errors.New("mcp server unreachable")

// ErrAuthRejected —— **the other side answered, it just won't accept this credential**
// (F-D-15).
//
// This is a different case from unreachable, though they used to share `ErrUnreachable`:
// the owner pastes a wrong token and the screen says "no answer — internal error" ——
// there WAS an answer, and it isn't our internal error, two lies in five words. The real
// cause was in the chain the whole time (mcp-go's `ErrAuthorizationRequired` is a typed
// sentinel), just papered over.
//
// The visitor path still treats both the same way (that server's tools silently don't
// appear, chat isn't blocked) —— the split exists so **the owner's side can say what to
// fix**.
var ErrAuthRejected = errors.New("mcp server rejected the auth header")

// Dial establishes the connection + Initialize. headers can carry owner-configured auth
// headers such as Authorization; nil = no auth.
//
// **Two HTTP transports; the owner never picks one.** The MCP spec's streamable HTTP
// (2025-03-26) superseded the old HTTP+SSE (2024-11-05), but plenty of remote servers
// still only expose the old `/sse` endpoint. The owner only has one address; which
// transport it speaks is **a property of the other side** —— making him choose on the
// form something he has no way to know is offloading our problem onto him.
//
// Tries streamable first, falls back to SSE on failure. **No sniffing by error shape**:
// what different servers return for "this isn't my protocol" varies wildly (404 / 405 /
// 406 / empty body / just hangs up), and guessing by shape is far more fragile than
// simply dialing again.
//
// **Both attempts share one httpDialTimeout, not one each.** The first version gave each
// attempt its own budget, so an unreachable address paid double the timeout —— and this
// path sits under session assembly, so a visitor opening a session just had to wait it
// out. The e2e went red on the spot: `/api/v1/sessions` never came back at all. The
// fallback shouldn't be paid for out of the visitor's wait time; sharing one deadline
// keeps the worst case **exactly as long** as before the fallback was added, and a fast
// first failure (connection refused) leaves nearly the whole budget for the second try.
func Dial(ctx context.Context, url string, headers map[string]string) (*Session, error) {
	dctx, cancel := context.WithTimeout(ctx, httpDialTimeout)
	defer cancel()
	sess, err := dialStreamableHTTP(dctx, url, headers)
	if err == nil {
		return sess, nil
	}
	sseSess, sseErr := dialHTTPSSE(dctx, url, headers)
	if sseErr == nil {
		return sseSess, nil
	}
	// Both failed: report **both** reasons. Reporting only one leaves whoever debugs
	// this seeing the SSE error and assuming we only speak SSE, or seeing the
	// streamable error with no way to tell whether the fallback was even tried.
	return nil, fmt.Errorf("%w: streamable: %w; sse: %w", dialClass(err, sseErr), err, sseErr)
}

// dialClass —— what class these two failures amount to together. **Either one saying
// "auth required" means rejected**: that means the other side is there, understood the
// request, and just won't accept this credential; the other reporting 405 or similar
// just means it doesn't speak that protocol.
func dialClass(streamErr, sseErr error) error {
	if authRejected(streamErr) || authRejected(sseErr) {
		return ErrAuthRejected
	}
	return ErrUnreachable
}

// authRejected —— recognizes mcp-go's typed sentinels, not string matching: on that side
// 401 is `*AuthorizationRequiredError` (with Unwrap), the OAuth branch is a different
// one, and both need recognizing.
func authRejected(err error) bool {
	return errors.Is(err, mcpgotransport.ErrAuthorizationRequired) ||
		errors.Is(err, mcpgotransport.ErrOAuthAuthorizationRequired)
}

func dialStreamableHTTP(
	ctx context.Context, url string, headers map[string]string,
) (*Session, error) {
	opts := []mcpgotransport.StreamableHTTPCOption{}
	if len(headers) > 0 {
		opts = append(opts, mcpgotransport.WithHTTPHeaders(headers))
	}
	cli, err := mcpgoclient.NewStreamableHttpClient(url, opts...)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	return initializeOrClose(ctx, cli, url)
}

// dialHTTPSSE —— the old HTTP+SSE transport. Auth headers go through SSE's own option
// (transport.WithHeaders) —— streamable's WithHTTPHeaders doesn't apply on this path;
// pass it there and the connection silently goes out bare.
func dialHTTPSSE(
	ctx context.Context, url string, headers map[string]string,
) (*Session, error) {
	opts := []mcpgotransport.ClientOption{}
	if len(headers) > 0 {
		opts = append(opts, mcpgotransport.WithHeaders(headers))
	}
	cli, err := mcpgoclient.NewSSEMCPClient(url, opts...)
	if err != nil {
		return nil, fmt.Errorf("new sse client: %w", err)
	}
	if serr := startSSEWithin(ctx, cli); serr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("sse start: %w", serr)
	}
	return initializeOrClose(ctx, cli, url)
}

// startSSEWithin —— starts the SSE event stream running. **The handshake is bound by
// the dial budget, the stream itself is not.**
//
// These two things can't both be expressed through one context — got burned twice:
//   - pass the dial deadline into Start → the moment Dial returns and cancel fires, the
//     freshly-established stream gets cut immediately (connecting successfully was
//     pointless)
//   - switch to context.WithoutCancel → strips the deadline along with the
//     cancellation, so against a dead address Start just hangs forever, and session
//     assembly only comes back after 30s (slower than before the fallback was added)
//
// So it's an explicit race instead: the stream gets a ctx that won't be canceled, while
// **the step that waits on it** is bound by ctx's deadline. On timeout, close the
// client —— that goroutine ends on its own, leaving no dangling connection.
func startSSEWithin(ctx context.Context, cli *mcpgoclient.Client) error {
	done := make(chan error, 1) // buffer 1: if the timeout wins, the goroutine still isn't blocked
	go func() { done <- cli.Start(context.WithoutCancel(ctx)) }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("start: %w", err)
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("start: %w", ctx.Err())
	}
}

// initializeOrClose —— the handshake finish shared by both transports: wrap a successful
// Initialize into a Session, or on failure **close the client** first and then return
// the error. Skipping the close would leave a dangling connection behind for every
// unreachable address the fallback tries.
//
// No timeout is started here —— **the deadline is set once, by Dial**, and shared by
// both attempts (see Dial's comment). Starting a separate one here would let the
// fallback double the visitor's wait.
func initializeOrClose(
	ctx context.Context, cli *mcpgoclient.Client, url string,
) (*Session, error) {
	res, ierr := cli.Initialize(ctx, initRequest())
	if ierr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("initialize: %w", ierr)
	}
	return &Session{
		c: cli, url: url, instructions: initInstructions(res),
		closeFn: func() { closeQuietly(cli) },
	}, nil
}

// initInstructions —— pulls server instructions from the initialize response; nil-safe.
func initInstructions(res *mcpgo.InitializeResult) string {
	if res == nil {
		return ""
	}
	return res.Instructions
}
