// seam_access.go — resolving a seam for the two owner-facing checks that need one.
//
// These replace `Slots.Calendar()` and `Slots.Mail()`. The difference is not the number
// of lines, it is where the seam name lives: an accessor put "calendar" in the TYPE
// SYSTEM, so a third seam needed a third method on a struct in the supplier package
// and every consumer that wanted it had to be given a wider handle. Here the name is an
// argument, and the only reason "calendar" and "mail" appear at all is that these two
// owner operations really are about a calendar and about mail — the owner asked "is my
// calendar still working", not "is seam X still working".
//
// A missing supplier returns the zero handle rather than an error, and each caller
// checks. That reads worse than a helper that returned (T, error), and is deliberate:
// these run inside owner operations that must report a REASON, and the reason for "no
// calendar connected" is not the same sentence as "the calendar refused".

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// seamCalendar —— the owner's active calendar supplier, or a nil handle.
//
// The assertion's ok is read rather than dropped: "nothing supplies calendar" and "something
// does but it does not speak calendar" both end up as a nil handle for the caller, and the
// two-value form says that is a decision rather than an accident.
func seamCalendar(ctx context.Context, d *deps.Runtime, ownerID string) adapters.CalendarProxy {
	sup := activeSupplier(ctx, d, ownerID, "calendar")
	cal, ok := sup.(adapters.CalendarProxy)
	if !ok {
		return nil
	}
	return cal
}

// seamMail —— the owner's active mail supplier, or a nil handle.
func seamMail(ctx context.Context, d *deps.Runtime, ownerID string) adapters.MailProxy {
	sup := activeSupplier(ctx, d, ownerID, "mail")
	m, ok := sup.(adapters.MailProxy)
	if !ok {
		return nil
	}
	return m
}

// seamKind —— which wire the owner's active supplier for a seam speaks.
//
// The owner's mail receipt says "sent via smtp" rather than naming the block, because
// what the owner is checking is that the mailer is kind-agnostic: the same send works
// whether an SMTP server or an HTTP API is behind it.
func seamKind(ctx context.Context, d *deps.Runtime, ownerID, seam string) string {
	sup := activeSupplier(ctx, d, ownerID, seam)
	if sup == nil {
		return ""
	}
	return sup.Kind()
}

// activeSupplier —— resolve, logging a lookup failure rather than propagating it.
//
// A lookup error here means the store could not be read, which is an instance problem
// and not something the owner's answer should carry; it goes to the log and the caller
// sees "nothing connected", which is the truthful thing to tell them either way.
func activeSupplier(
	ctx context.Context, d *deps.Runtime, ownerID, seam string,
) adapters.Supplier {
	sup, err := d.BlockSuppliers.Lookup(ctx, ownerID, seam)
	if err != nil {
		d.Log.Warn("resolve seam supplier", "seam", seam, "err", err)
		return nil
	}
	return sup
}
