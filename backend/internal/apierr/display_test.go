package apierr_test

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/apierr"
)

func TestClassifyRendersDisplayError(t *testing.T) {
	t.Parallel()
	msg := "This connector is built-in and can’t be edited."
	env := apierr.Classify(apierr.Display(http.StatusConflict, "builtin_readonly", msg), nil)
	if env.Status != http.StatusConflict || env.Code != "builtin_readonly" {
		t.Fatalf("display error not rendered: %+v", env)
	}
	if env.Message != msg {
		t.Fatalf("user message not carried through: %q", env.Message)
	}
}

func TestClassifyUnwrapsWrappedDisplayError(t *testing.T) {
	t.Parallel()
	// A mid-layer fmt.Errorf("...: %w", de) must not bury the display info — errors.As unwraps.
	de := apierr.Display(http.StatusBadRequest, "bad_spec", "The spec is invalid.")
	env := apierr.Classify(fmt.Errorf("save connector: %w", de), nil)
	if env.Status != http.StatusBadRequest || env.Code != "bad_spec" {
		t.Fatalf("wrapped display error not rendered: %+v", env)
	}
	if env.Message != "The spec is invalid." {
		t.Fatalf("wrapped message not carried: %q", env.Message)
	}
}

func TestClassifyDoesNotLeakNonDisplayError(t *testing.T) {
	t.Parallel()
	// A plain error (not displayable) → 500 fallback; its detail must NOT reach the client.
	env := apierr.Classify(errors.New("boom: internal db dsn leaked"), nil)
	if env.Status != http.StatusInternalServerError {
		t.Fatalf("non-display error should be 500, got %d", env.Status)
	}
	if env.Message == "boom: internal db dsn leaked" {
		t.Fatalf("internal detail must not leak into the envelope: %q", env.Message)
	}
}

func TestDisplayWrapSendsMessageButLogsCause(t *testing.T) {
	t.Parallel()
	// DisplayWrap 的分离：客户端只见 friendly message；日志（Error）+ errors.Is 能拿到底层 cause。
	cause := errors.New("dial tcp 10.0.0.5:443: connect: connection refused")
	de := apierr.DisplayWrap(
		http.StatusBadGateway, "provider_unreachable", "Couldn't reach the provider.", cause)

	env := apierr.Classify(de, nil)
	if env.Message != "Couldn't reach the provider." {
		t.Fatalf("client must see only the friendly message, got %q", env.Message)
	}
	if !errors.Is(de, cause) {
		t.Fatal("Unwrap must expose the cause for logging/errors.Is")
	}
	if !strings.Contains(de.Error(), "connection refused") {
		t.Fatalf("Error() (goes to the log) must include the raw cause, got %q", de.Error())
	}
}

func TestClassifyDisplayErrorBeatsCaseTable(t *testing.T) {
	t.Parallel()
	// A self-describing DisplayError wins over the sentinel Case table.
	de := apierr.Display(http.StatusForbidden, "forbidden_x", "Not allowed.")
	cases := []apierr.Case{{
		Match: errors.New("x"), Envelope: apierr.Envelope{Status: http.StatusInternalServerError},
	}}
	if env := apierr.Classify(de, cases); env.Status != http.StatusForbidden {
		t.Fatalf("DisplayError should win over the case table, got %d", env.Status)
	}
}
