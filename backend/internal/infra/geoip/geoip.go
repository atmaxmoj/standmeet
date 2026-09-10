// Package geoip resolves an IP to a country/region/city against a bundled geoip database, so a
// self-hosted instance behind a bare proxy (no CDN geo header) still knows where a visitor came
// from — the approach umami takes. Pure infrastructure: it returns plain strings and depends on no
// domain, so the composition root adapts it to whatever a domain's location shape is.
//
// The database is db-ip's free City Lite (CC-BY), bundled into the image. The IP is resolved and
// discarded by the caller; this package never stores anything.
package geoip

import (
	"fmt"
	"net"

	"github.com/oschwald/geoip2-golang"
)

// Place —— a resolved location. All fields empty on a miss.
type Place struct {
	Country string // ISO 3166-1 alpha-2, e.g. "US"
	Region  string // subdivision ISO code, e.g. "CA" (unqualified)
	City    string // English city name
}

// Resolver —— an open geoip database.
type Resolver struct {
	db *geoip2.Reader
}

// Open —— load the mmdb at path.
func Open(path string) (*Resolver, error) {
	db, err := geoip2.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open geoip db %q: %w", path, err)
	}
	return &Resolver{db: db}, nil
}

// Lookup —— the location for an IP. Empty Place on any miss: an unparseable, private, or not-found
// IP resolves to nothing rather than an error, because instrumentation must never fail a request.
func (r *Resolver) Lookup(ip string) Place {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return Place{}
	}
	rec, err := r.db.City(parsed)
	if err != nil {
		return Place{}
	}
	region := ""
	if len(rec.Subdivisions) > 0 {
		region = rec.Subdivisions[0].IsoCode
	}
	return Place{
		Country: rec.Country.IsoCode,
		Region:  region,
		City:    rec.City.Names["en"],
	}
}

// Close —— release the database's mmap.
func (r *Resolver) Close() error {
	if err := r.db.Close(); err != nil {
		return fmt.Errorf("geoip: close: %w", err)
	}
	return nil
}
