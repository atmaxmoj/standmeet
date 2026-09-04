// Package dockerstat reads per-container CPU/memory for THIS instance's own compose
// project off the Docker socket, for the admin System panel's "cluster resource usage".
//
// Tenant safety: a self-host box can be shared (the CLAUDE.md notes a multi-tenant Coolify
// host). Listing every container would leak other tenants', so we first read our OWN
// container's `com.docker.compose.project` label and list only containers carrying it.
//
// No Docker SDK (a heavy dep): two plain Docker Engine API calls over the unix socket. The
// http.Client is built through httpx (the one sanctioned place, check-no-raw-http) with a
// unix-socket base transport — the same "pass a Base transport" seam connector egress uses.
package dockerstat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

// Container — one service's live usage, shaped for the panel.
type Container struct {
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpu_percent"`
	MemBytes   int64   `json:"mem_bytes"`
	MemLimit   int64   `json:"mem_limit"`
}

// Reader reads the project's container stats. Zero value is not usable; use New.
type Reader struct {
	client *http.Client
}

const (
	dockerSocket   = "/var/run/docker.sock"
	projectLabel   = "com.docker.compose.project"
	serviceLabel   = "com.docker.compose.service"
	requestTimeout = 4 * time.Second
	pctScale       = 100 // cpu-time fraction → percent
	// dockerAPIBase — host + scheme are ignored (the transport dials the unix socket), but
	// http.NewRequest still needs a syntactically valid URL. http is correct: a unix socket
	// has no TLS.
	dockerAPIBase = "http://docker"
)

// New builds a Reader over the docker socket. socketPath empty → the default
// /var/run/docker.sock.
func New(socketPath string) *Reader {
	if socketPath == "" {
		socketPath = dockerSocket
	}
	dialer := &net.Dialer{}
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "unix", socketPath)
		},
	}
	// NoRetry: a monitoring read is best-effort; the panel degrades gracefully on a miss.
	client := httpx.NewClient(httpx.Options{Base: tr, Timeout: requestTimeout, NoRetry: true})
	return &Reader{client: client}
}

// Snapshot — this project's containers with current CPU%/memory. Best-effort: any single
// container's stats failing is skipped, not fatal. An empty result (socket absent, no
// project label) returns (nil, nil) so the panel simply shows nothing rather than an error.
//
// The per-container `stats?stream=false` call is inherently ~1s (Docker samples CPU twice),
// so the stats are fetched **concurrently** — sequential fan-out made /admin/system take
// 10-20s and time out. Inspect + list run first (they're instant, no sampling).
func (r *Reader) Snapshot(ctx context.Context) ([]Container, error) {
	project, err := r.ownProject(ctx)
	if err != nil || project == "" {
		return []Container{}, err
	}
	refs, err := r.projectContainers(ctx, project)
	if err != nil {
		return []Container{}, err
	}
	results := make([]Container, len(refs))
	var wg sync.WaitGroup
	for i := range refs {
		wg.Go(func() { r.fillStat(ctx, results, i, refs[i]) })
	}
	wg.Wait()
	return present(results), nil
}

// fillStat — writes one container's stats into results[i]; a failed call leaves the slot
// zero (dropped later by present). Extracted from Snapshot's goroutine to keep its cyclo ≤5.
func (r *Reader) fillStat(ctx context.Context, results []Container, i int, ref containerRef) {
	if c, err := r.containerStat(ctx, ref.id, ref.name); err == nil {
		results[i] = c
	}
}

// present — drops the zero-value entries left by containers whose stats call failed
// (a failed slot keeps its empty Name).
func present(in []Container) []Container {
	out := make([]Container, 0, len(in))
	for i := range in {
		if in[i].Name != "" {
			out = append(out, in[i])
		}
	}
	return out
}

// ownProject — the compose project of the container we're running in (inspect self by
// hostname). Empty (not under compose / no label) → the caller shows nothing.
func (r *Reader) ownProject(ctx context.Context) (string, error) {
	self, err := os.Hostname()
	if err != nil {
		return "", fmt.Errorf("hostname: %w", err)
	}
	b, err := r.getBody(ctx, "/containers/"+self+"/json")
	if err != nil {
		return "", err
	}
	var body inspectResp
	if uerr := json.Unmarshal(b, &body); uerr != nil {
		return "", fmt.Errorf("decode inspect: %w", uerr)
	}
	return body.Config.Labels[projectLabel], nil
}

// inspectResp / containerListRow — the slivers of Docker's inspect + list JSON the reader
// reads. Named (not inline anonymous) to satisfy revive's no-nested-structs.
type inspectResp struct {
	Config configLabels `json:"Config"`
}

type configLabels struct {
	Labels map[string]string `json:"Labels"`
}

type containerListRow struct {
	ID     string            `json:"Id"`
	Labels map[string]string `json:"Labels"`
	Names  []string          `json:"Names"`
}

type containerRef struct {
	id   string
	name string
}

// projectContainers — running containers carrying our project label. The name shown is the
// compose SERVICE (backend / db / redis), not the mangled container name.
func (r *Reader) projectContainers(ctx context.Context, project string) ([]containerRef, error) {
	filters := fmt.Sprintf(`{"label":["%s=%s"]}`, projectLabel, project)
	path := "/containers/json?filters=" + url.QueryEscape(filters)
	b, err := r.getBody(ctx, path)
	if err != nil {
		return []containerRef{}, err
	}
	var rows []containerListRow
	if uerr := json.Unmarshal(b, &rows); uerr != nil {
		return []containerRef{}, fmt.Errorf("decode container list: %w", uerr)
	}
	refs := make([]containerRef, 0, len(rows))
	for i := range rows {
		refs = append(refs, containerRef{
			id: rows[i].ID, name: serviceName(rows[i].Labels, rows[i].Names),
		})
	}
	return refs, nil
}

// serviceName — prefer the compose service label; fall back to the first container name
// (leading slash stripped); "?" if neither is present.
func serviceName(labels map[string]string, names []string) string {
	if s := labels[serviceLabel]; s != "" {
		return s
	}
	if len(names) > 0 {
		return trimLeadingSlash(names[0])
	}
	return "?"
}

func trimLeadingSlash(s string) string {
	if s != "" && s[0] == '/' {
		return s[1:]
	}
	return s
}

// dockerStats — only the fields the panel needs from GET /containers/{id}/stats.
// Field order: the pointer-bearing member (Memory, via its map) goes first for govet
// fieldalignment (minimises the GC pointer-scan region).
type dockerStats struct {
	Memory memStats `json:"memory_stats"`
	CPU    cpuStats `json:"cpu_stats"`
	PreCPU cpuStats `json:"precpu_stats"`
}

type memStats struct {
	Stats map[string]int64 `json:"stats"`
	Usage int64            `json:"usage"`
	Limit int64            `json:"limit"`
}

type cpuUsage struct {
	Total int64 `json:"total_usage"`
}

type cpuStats struct {
	CPUUsage    cpuUsage `json:"cpu_usage"`
	SystemUsage int64    `json:"system_cpu_usage"`
	OnlineCPUs  int64    `json:"online_cpus"`
}

func (r *Reader) containerStat(ctx context.Context, id, name string) (Container, error) {
	b, err := r.getBody(ctx, "/containers/"+id+"/stats?stream=false")
	if err != nil {
		return Container{}, err
	}
	var s dockerStats
	if uerr := json.Unmarshal(b, &s); uerr != nil {
		return Container{}, fmt.Errorf("decode stats: %w", uerr)
	}
	return Container{
		Name:       name,
		CPUPercent: cpuPercent(s),
		MemBytes:   memUsed(s),
		MemLimit:   s.Memory.Limit,
	}, nil
}

// cpuPercent — Docker's own formula: the container's cpu-time delta over the system-time
// delta, times the number of cores, as a percent. A single stream=false sample carries both
// the current and the prior reading, so one call is enough.
func cpuPercent(s dockerStats) float64 {
	cpuDelta := float64(s.CPU.CPUUsage.Total - s.PreCPU.CPUUsage.Total)
	sysDelta := float64(s.CPU.SystemUsage - s.PreCPU.SystemUsage)
	if cpuDelta <= 0 || sysDelta <= 0 {
		return 0
	}
	cores := float64(s.CPU.OnlineCPUs)
	if cores <= 0 {
		cores = 1
	}
	return cpuDelta / sysDelta * cores * pctScale
}

// memUsed — usage minus the reclaimable page cache (cgroup v1 'cache' / v2 'inactive_file'),
// matching what `docker stats` reports rather than the raw usage counter.
func memUsed(s dockerStats) int64 {
	used := s.Memory.Usage
	for _, k := range []string{"cache", "inactive_file"} {
		if v, ok := s.Memory.Stats[k]; ok {
			return max(used-v, 0)
		}
	}
	return used
}

// getBody — GET the Docker API path and return the raw JSON body. Returns []byte rather than
// decoding through an `any` target (that keyword is banned in business code); each caller
// unmarshals into its own named type.
func (r *Reader) getBody(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dockerAPIBase+path, http.NoBody)
	if err != nil {
		return []byte{}, fmt.Errorf("build docker request: %w", err)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return []byte{}, fmt.Errorf("docker request %s: %w", path, err)
	}
	defer resp.Body.Close() //nolint:errcheck // best-effort read; close error is irrelevant
	if resp.StatusCode != http.StatusOK {
		return []byte{}, fmt.Errorf("docker %s: status %d", path, resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return []byte{}, fmt.Errorf("read docker response %s: %w", path, err)
	}
	return b, nil
}
