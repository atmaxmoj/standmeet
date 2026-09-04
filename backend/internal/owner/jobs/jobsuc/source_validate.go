package jobsuc

import (
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
)

// ValidateSourceConfig — the (kind, config) shape check, exposed so the admin route can
// tell **the caller's mistake (400) from a DB failure (500)** by running it up front,
// before RegisterJobSource's write. Keeps jobsadmin off a direct jobfetch import (the
// layering is admin → usecase → fetch). The error is already owner-readable
// ("greenhouse config: board is required").
func ValidateSourceConfig(kind string, config []byte) error {
	//nolint:wrapcheck // passthrough: the validator's message goes to the owner verbatim (400 body)
	return jobfetch.ValidateKindConfig(kind, config)
}
