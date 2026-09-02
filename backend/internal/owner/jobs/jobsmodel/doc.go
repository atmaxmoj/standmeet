// Package jobsmodel — outbound job-loop domain value objects: fetched job (1d TTL,
// ephemeral), job source, application (persisted snapshot), resume content/draft. Cut out
// of the internal/domain god-package; the jobs plugin (fetch/cache/dedup/usecase/mcp/admin)
// and the core repo share this one set of types. CommittedApplication embeds access.Code
// (the invitation code issued synchronously at commit), so this leaf depends on domain.
package jobsmodel
