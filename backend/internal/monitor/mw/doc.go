// Package mw records visitor traffic by observing the public router.
//
// It is mounted once, at the composition root, and no other domain calls it, imports it, or
// knows it exists. routes.go holds the whole instrumentation plan as a table of route patterns;
// middleware.go reads a request's pattern, method and response status and turns it into a row.
package mw
