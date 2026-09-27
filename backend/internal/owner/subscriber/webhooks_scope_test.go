package subscriber_test

import (
	"context"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
)

// projectsOnly — an embed scope port that admits wiki://projects/** of embed "e1" only, whatever
// the publish flags say (the access domain's real predicate is tested there).
func projectsOnly(_ context.Context, _, embedID, uri string, _ bool) (bool, error) {
	return embedID == "e1" && strings.HasPrefix(uri, "wiki://projects/"), nil
}

func TestAnEmbedAttachedEndpointGetsTheEmbedsScopeNotThePublishedSlice(t *testing.T) {
	t.Parallel()
	embedded := ep("hook", note)
	embedded.EmbedID = "e1"
	other := ep("gone", note)
	other.EmbedID = "e2"
	eps := []entity.WebhookEndpoint{embedded, other, ep("standalone", note)}
	const in, out = "wiki://projects/a", "wiki://elsewhere"
	p := projectsOnly
	cases := []struct {
		ev    *events.Event
		admit subscriber.EmbedAdmits
		name  string
		want  string
	}{
		{name: "unpublished, in scope", ev: noteEv(in, false, false), admit: p, want: "hook"},
		{name: "published, in", ev: noteEv(in, true, true), admit: p, want: "hook,standalone"},
		{name: "published, out", ev: noteEv(out, true, true), admit: p, want: "standalone"},
		{name: "raw never leaves", ev: noteEv("raw://projects/a", true, true), admit: p},
		{name: "no scope port: nothing", ev: noteEv(in, false, false)},
	}
	for _, c := range cases {
		got, err := subscriber.Targets(context.Background(), eps, c.ev, c.admit)
		if err != nil || ids(got) != c.want {
			t.Errorf("%s: targets %q (%v), want %q", c.name, ids(got), err, c.want)
		}
	}
}
