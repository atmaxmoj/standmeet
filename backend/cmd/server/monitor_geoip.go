// monitor_geoip.go —— wires the bundled geoip database to the monitor recorder, so a self-hosted
// instance with no CDN geo header still records where visitors came from (umami does the same).
//
// The adapter lives here, at the composition root, because it bridges two things a domain must not
// name each other: an infra geoip.Resolver (reads a file) and monitor's LocationResolver port.

package main

import (
	"log/slog"
	"os"

	"github.com/atmaxmoj/standmeet/internal/infra/geoip"
	monitor "github.com/atmaxmoj/standmeet/internal/monitor/facade"
)

// geoEnv / geoDefaultPath —— where the geoip database lives. A path so a self-hoster can point it
// at their own mmdb; the image ships db-ip City Lite at the default.
const (
	geoEnv         = "STANDMEET_GEOIP_DB"
	geoDefaultPath = "/srv/geoip/dbip-city-lite.mmdb"
)

// loadGeoResolver —— open the geoip database and adapt it to monitor's LocationResolver. A missing
// or unreadable database returns nil; monitor then geolocates from headers only (never fatal). The
// interface return is deliberate: a nil interface means "header-only", whereas a typed-nil
// *geoAdapter would be a non-nil interface (the classic nil-interface trap).
//
//nolint:ireturn // nil = header-only geo; a typed-nil concrete would be a non-nil interface
func loadGeoResolver(log *slog.Logger) monitor.LocationResolver {
	path := os.Getenv(geoEnv)
	if path == "" {
		path = geoDefaultPath
	}
	r, err := geoip.Open(path)
	if err != nil {
		if log != nil {
			log.Warn("geoip database unavailable; geolocation falls back to proxy headers",
				"path", path, "err", err)
		}
		return nil
	}
	return &geoAdapter{r: r}
}

// geoAdapter —— an infra geoip.Resolver seen as a monitor.LocationResolver.
type geoAdapter struct {
	r *geoip.Resolver
}

func (g *geoAdapter) Lookup(ip string) monitor.Location {
	p := g.r.Lookup(ip)
	return monitor.Location{Country: p.Country, Region: p.Region, City: p.City}
}
