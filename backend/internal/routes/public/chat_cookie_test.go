package public

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestSetVisitorSessionCookie_HonorsSecure —— the visitor session cookie must carry Secure on an
// HTTPS deploy (SECURE_COOKIE=true), matching the admin cookies. Regression guard for the defect
// where it was hardcoded insecure and ignored the flag (the bearer cookie could ride plain HTTP).
func TestSetVisitorSessionCookie_HonorsSecure(t *testing.T) {
	t.Parallel()
	for _, secure := range []bool{true, false} {
		w := httptest.NewRecorder()
		setVisitorSessionCookie(w, "smv_tok", time.Now().Add(time.Hour), secure)
		cookies := w.Result().Cookies()
		require.Len(t, cookies, 1, "secure=%v", secure)
		require.Equal(t, secure, cookies[0].Secure, "cookie.Secure must honor the flag")
		require.True(t, cookies[0].HttpOnly, "cookie must stay HttpOnly")
	}
}
