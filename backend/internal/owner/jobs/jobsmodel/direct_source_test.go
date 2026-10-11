package jobsmodel_test

import (
	"reflect"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

func TestSuggestDirectSources(t *testing.T) {
	t.Parallel()
	got := jobsmodel.SuggestDirectSources([]string{
		"https://boards.greenhouse.io/Acme/jobs/1",
		"https://job-boards.greenhouse.io/acme/jobs/2",
		"https://jobs.lever.co/foo/abc",
		"https://jobs.ashbyhq.com/registered/x",
		"https://remoteok.com/remote-jobs/123",
	}, map[string]bool{"ashby/registered": true})
	want := []jobsmodel.DirectSource{
		{Kind: "greenhouse", Company: "acme", Postings: 2},
		{Kind: "lever", Company: "foo", Postings: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}
