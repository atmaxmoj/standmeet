package usecase_test

import (
	"net/url"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

// assetTestNow — a fixed wall clock for the token tests (2023-11-14T22:13:20Z).
const assetTestNow = 1_700_000_000

// sigParam — the query key SignAssetURL puts the signature under. Referenced here (rather than
// imported) so this test stays a black-box against the usecase package.
const sigParam = "s"

// signedQuery — sign an asset URL, then parse the resulting string back to url.Values, exactly the
// way the serve route reads r.URL.Query(). Proves the sign→(encode)→(decode)→verify round-trip, not
// just the two functions in isolation.
func signedQuery(t *testing.T, key, id string, now time.Time) url.Values {
	t.Helper()
	u, err := url.Parse(usecase.SignAssetURL(key, id, now))
	if err != nil {
		t.Fatalf("parse signed url: %v", err)
	}
	return u.Query()
}

func TestVerifyAssetURL(t *testing.T) {
	t.Parallel()
	const key, id = "instance-session-key", "11111111-2222-3333-4444-555555555555"
	const otherID = "99999999-2222-3333-4444-555555555555"
	base := time.Unix(assetTestNow, 0)

	valid := signedQuery(t, key, id, base)
	tampered := signedQuery(t, key, id, base)
	tampered.Set(sigParam, tampered.Get(sigParam)+"x")
	insideTTL := base.Add(usecase.AssetURLTTL - time.Second)
	pastTTL := base.Add(usecase.AssetURLTTL + time.Second)

	check := func(name, vkey, vid string, q url.Values, at time.Time, want bool) {
		if got := usecase.VerifyAssetURL(vkey, vid, q, at); got != want {
			t.Errorf("%s: VerifyAssetURL = %v, want %v", name, got, want)
		}
	}

	check("fresh signature verifies (allow)", key, id, valid, base, true)
	check("still valid just inside TTL", key, id, valid, insideTTL, true)
	check("expired rejects", key, id, valid, pastTTL, false)
	// a signature minted for one asset must not fetch another (the side door 74 guards).
	check("wrong id rejects", key, otherID, valid, base, false)
	check("wrong key rejects", "other-key", id, valid, base, false)
	check("tampered signature rejects", key, id, tampered, base, false)
	check("bare url (no signature) rejects", key, id, url.Values{}, base, false)
}
