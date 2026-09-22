package usecase_test

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// TestDeletePageRefusesReservedHome — the home slug serves `/`; deleting it dropped the site root
// to the fallback and (with the old full unique index) could not be recreated. The guard refuses
// it before any store call, so zero deps is enough — the point is that it never reaches lookupPage.
func TestDeletePageRefusesReservedHome(t *testing.T) {
	t.Parallel()
	err := usecase.DeletePage(
		context.Background(), usecase.MicrositeDeps{}, "owner-1", usecase.HomepageSlug,
	)
	if !errors.Is(err, entity.ErrMicrositeHomeReserved) {
		t.Fatalf("deleting the reserved home slug must be refused, got %v", err)
	}
}
