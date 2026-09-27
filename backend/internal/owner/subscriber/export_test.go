package subscriber

import "net/http"

// SetClient —— tests deliver to an httptest receiver on loopback, which the production client's
// SSRF guard refuses by design.
func (d *Deps) SetClient(c *http.Client) { d.client = c }
