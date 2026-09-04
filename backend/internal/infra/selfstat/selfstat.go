// Package selfstat reads THIS container's OWN resource usage straight from the cgroup v2
// pseudo-filesystem — no docker socket, no host privilege.
//
// The old reader (dockerstat) talked to the Docker Engine API over /var/run/docker.sock. That
// needs the socket mounted into the app — the very privilege the architecture refuses (the backend
// must stay docker.sock-free), so the panel was always empty. But a process can always read its
// OWN cgroup: /sys/fs/cgroup is mounted, namespaced to itself. So each service reports its own
// numbers over its own endpoint and the admin System panel gathers them — the way Zabbix / cAdvisor
// read the kernel instead of asking Docker.
//
// cgroup v2 only (the shipped hosts are v2 — cgroup.controllers is present). On a v1 host, or when
// the files aren't there, Read returns an error and the panel shows nothing for this service.
package selfstat

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultRoot   = "/sys/fs/cgroup"
	defaultSample = 500 * time.Millisecond
	pctScale      = 100
)

// Stat — this service's own live usage, shaped for the System panel's per-service row.
type Stat struct {
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpu_percent"`
	MemBytes   int64   `json:"mem_bytes"`
	MemLimit   int64   `json:"mem_limit"` // 0 = no limit set (cgroup "max")
}

// Reader reads one container's own cgroup. Zero value is unusable; use New.
type Reader struct {
	root   string
	name   string
	sample time.Duration
}

// New — root defaults to /sys/fs/cgroup; name defaults to $STANDMEET_SERVICE_NAME then the
// hostname (compose sets the hostname to the container name). Both overridable, for tests.
func New(root, name string) *Reader {
	if root == "" {
		root = defaultRoot
	}
	if name == "" {
		name = serviceName()
	}
	return &Reader{root: root, name: name, sample: defaultSample}
}

func serviceName() string {
	if s := os.Getenv("STANDMEET_SERVICE_NAME"); s != "" {
		return s
	}
	if h, err := os.Hostname(); err == nil {
		return h
	}
	return "self"
}

// Read — one snapshot: memory now + a CPU% sampled over r.sample. Respects ctx during the wait.
// A missing/unreadable cgroup (v1 host, not mounted) returns an error, not a zero-value lie.
func (r *Reader) Read(ctx context.Context) (Stat, error) {
	memBytes, err := readInt(r.path("memory.current"))
	if err != nil {
		return Stat{}, err
	}
	limit, err := readMemMax(r.path("memory.max"))
	if err != nil {
		return Stat{}, err
	}
	cpu, err := r.cpuPercent(ctx)
	if err != nil {
		return Stat{}, err
	}
	return Stat{Name: r.name, CPUPercent: cpu, MemBytes: memBytes, MemLimit: limit}, nil
}

func (r *Reader) path(f string) string { return r.root + "/" + f }

// cpuPercent — usage_usec is the container's total CPU time across all cores. Sample it twice,
// r.sample apart; the delta over the wall-clock delta as a percent is CPU relative to ONE core
// (a busy multi-core service can read above 100 — the same convention as `docker stats`).
func (r *Reader) cpuPercent(ctx context.Context) (float64, error) {
	u1, err := readCPUUsageUsec(r.path("cpu.stat"))
	if err != nil {
		return 0, err
	}
	start := time.Now()
	if werr := wait(ctx, r.sample); werr != nil {
		return 0, werr
	}
	u2, err := readCPUUsageUsec(r.path("cpu.stat"))
	if err != nil {
		return 0, err
	}
	return cpuPct(u2-u1, time.Since(start)), nil
}

// cpuPct — pure: microseconds of CPU used over a wall window → percent of one core. Guards the
// degenerate cases (no movement, zero window) to 0 rather than a negative or NaN.
func cpuPct(deltaUsec int64, wall time.Duration) float64 {
	wallUsec := wall.Microseconds()
	if deltaUsec <= 0 || wallUsec <= 0 {
		return 0
	}
	return float64(deltaUsec) / float64(wallUsec) * pctScale
}

func wait(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return fmt.Errorf("selfstat sampling wait: %w", ctx.Err())
	case <-t.C:
		return nil
	}
}

// readCPUUsageUsec — the `usage_usec N` value (microseconds of CPU time) from cpu.stat.
func readCPUUsageUsec(path string) (int64, error) {
	s, err := readTrimmed(path)
	if err != nil {
		return 0, err
	}
	return usageUsecFrom(s, path)
}

// usageUsecFrom — pure: pull the usage_usec value out of cpu.stat's `key value` lines.
func usageUsecFrom(content, path string) (int64, error) {
	for line := range strings.SplitSeq(content, "\n") {
		k, v, ok := strings.Cut(line, " ")
		if ok && k == "usage_usec" {
			return parseInt(path, strings.TrimSpace(v))
		}
	}
	return 0, fmt.Errorf("cpu.stat %s: no usage_usec line", path)
}

// readMemMax — memory.max is "max" (no limit) → 0, else the byte count.
func readMemMax(path string) (int64, error) {
	s, err := readTrimmed(path)
	if err != nil {
		return 0, err
	}
	if s == "max" {
		return 0, nil
	}
	return parseInt(path, s)
}

func readInt(path string) (int64, error) {
	s, err := readTrimmed(path)
	if err != nil {
		return 0, err
	}
	return parseInt(path, s)
}

// parseInt — Atoi (no base/bitsize literals); int is 64-bit on the linux/amd64|arm64 we ship.
func parseInt(path, s string) (int64, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("parse %s %q: %w", path, s, err)
	}
	return int64(n), nil
}

func readTrimmed(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	return strings.TrimSpace(string(b)), nil
}
