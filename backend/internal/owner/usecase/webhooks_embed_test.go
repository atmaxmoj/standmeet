package usecase_test

// The endpoint secret is sealed, so these tests set INSTANCE_SECRET; t.Setenv forbids t.Parallel.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const (
	testSecretEnv = "INSTANCE_SECRET"
	// testInstanceSecret — a test fixture, not a real secret.
	testInstanceSecret = "test-instance-secret-at-least-32-bytes-long" //gitleaks:allow
	// Public addresses as IP literals: validated without a DNS lookup.
	hookA = "https://93.184.215.14/hook-a"
	hookB = "https://93.184.215.14/hook-b"
)

// hookFixture — a scratch database with one owner and one embed (on a code, on a role).
type hookFixture struct {
	d            *usecase.WebhooksDeps
	owner, embed string
}

const seedEmbed = `WITH o AS (
		INSERT INTO owners (email, password_hash, handle, full_name)
		VALUES ('o@example.com', 'x', 'o', 'O') RETURNING id),
	r AS (INSERT INTO roles (owner_id, name) SELECT id, 'partner' FROM o
		RETURNING id, owner_id),
	c AS (INSERT INTO access_codes (owner_id, code, label, slug, assumed_role_id)
		SELECT owner_id, 'EMB-1', 'e', 'emb-1', id FROM r RETURNING id, owner_id),
	e AS (INSERT INTO embeds (owner_id, code_id) SELECT owner_id, id FROM c
		RETURNING id, owner_id)
	SELECT owner_id::text, id::text FROM e`

func setupHook(t *testing.T) hookFixture {
	t.Helper()
	pool := scratchDB(t)
	f := hookFixture{d: &usecase.WebhooksDeps{Repo: repo.NewRepo(pool)}}
	if err := pool.QueryRow(context.Background(), seedEmbed).Scan(&f.owner, &f.embed); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return f
}

func (f *hookFixture) set(t *testing.T, url string) usecase.CreatedWebhook {
	t.Helper()
	got, err := usecase.SetEmbedHook(context.Background(), f.d, f.owner, f.embed, url)
	if err != nil {
		t.Fatalf("set hook %q: %v", url, err)
	}
	return got
}

// hookView —— what these tests compare.
type hookView struct{ ID, URL, EmbedID, Types, Secret string }

func view(c *usecase.CreatedWebhook) hookView {
	e := c.Endpoint
	return hookView{e.ID, e.URL, e.EmbedID, strings.Join(e.EventTypes, ","), c.Secret}
}

func TestSettingAnEmbedHookCreatesItsEndpointOnceWithASecret(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	f := setupHook(t)
	first := f.set(t, hookA)
	if first.Secret == "" {
		t.Fatal("create: no secret")
	}
	want := hookView{first.Endpoint.ID, hookA, f.embed, entity.NoteChanged, first.Secret}
	if got := view(&first); got != want {
		t.Fatalf("create: %v, want an endpoint on the embed for note changes", got)
	}
	want.Secret = ""
	if again := f.set(t, hookA); view(&again) != want {
		t.Fatalf("same url: %v, want the same endpoint and no secret", view(&again))
	}
}

func TestANewEmbedHookURLRepointsTheSameEndpoint(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	f := setupHook(t)
	first := f.set(t, hookA)
	moved := f.set(t, hookB)
	want := hookView{first.Endpoint.ID, hookB, f.embed, entity.NoteChanged, ""}
	if view(&moved) != want {
		t.Fatalf("new url: %v, want the same endpoint re-pointed and no secret", view(&moved))
	}
	hooks, err := usecase.EmbedHooks(context.Background(), f.d, f.owner)
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprint(len(hooks), hooks[f.embed].URL); got != fmt.Sprint(1, hookB) {
		t.Fatalf("hooks after the edit: %s, want the one re-pointed endpoint", got)
	}
}

func TestClearingTheEmbedHookURLDeletesTheEndpoint(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	f := setupHook(t)
	first := f.set(t, hookA)
	if cleared := f.set(t, ""); cleared.Endpoint.ID != "" {
		t.Fatalf("clear: %v, want nothing", view(&cleared))
	}
	_, err := f.d.Repo.GetWebhook(context.Background(), f.owner, first.Endpoint.ID)
	if !errors.Is(err, entity.ErrWebhookNotFound) {
		t.Fatalf("after clearing: %v, want the endpoint deleted", err)
	}
}

func TestTheEmbedHookRefusesAPrivateAddress(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	f := setupHook(t)
	_, err := usecase.SetEmbedHook(context.Background(), f.d, f.owner, f.embed, "http://127.0.0.1/")
	if !errors.Is(err, entity.ErrWebhookInput) {
		t.Fatalf("loopback url: %v, want the input error", err)
	}
}
