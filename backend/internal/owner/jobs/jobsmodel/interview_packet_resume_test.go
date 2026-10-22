// interview_packet_resume_test.go —— cue-resume-binding R1: the interview packet carries the
// tailored résumé of the bound application, and changes its fingerprint when it does (R3's
// fingerprint-over-bytes discipline).

package jobsmodel_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

func TestPacketCarriesResume(t *testing.T) {
	t.Parallel()
	row := jobsmodel.SeenRow{
		ID:       "11111111-1111-1111-1111-111111111111",
		Snapshot: jobsmodel.FetchedJob{Company: "Acme", Title: "Platform Engineer", BodyText: "JD"},
	}
	none := mustPacket(t, &row, nil)
	resume := &jobsmodel.PacketResume{
		Source: "application", Content: json.RawMessage(`{"summary":"takes models to prod"}`),
	}
	with := mustPacket(t, &row, resume)

	requireContains(t, none.Body, `"resume":null`)
	requireContains(t, with.Body, `"resume":{`)
	requireContains(t, with.Body, `"resume_source":"application"`)
	requireContains(t, with.Body, "takes models to prod")
	if with.Fingerprint == none.Fingerprint {
		t.Fatal("adding the résumé must change the packet fingerprint (R3 discipline)")
	}
}

func mustPacket(t *testing.T, row *jobsmodel.SeenRow, r *jobsmodel.PacketResume) jobsmodel.Packet {
	t.Helper()
	p, err := jobsmodel.PacketOf(row, nil, r)
	if err != nil {
		t.Fatalf("PacketOf: %v", err)
	}
	return p
}

func requireContains(t *testing.T, body, want string) {
	t.Helper()
	if !strings.Contains(body, want) {
		t.Fatalf("packet body missing %q; body=%s", want, body)
	}
}
