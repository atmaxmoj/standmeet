// Package sqltext —— the one way a runtime name gets into SQL text.
//
// SQL text is written in the source; values travel as $n parameters. Some statements need a name
// at runtime that a parameter cannot carry — a block's schema, a NOTIFY channel. Format puts each
// one in as a quoted identifier, so whatever the string holds it stays a name and never becomes
// SQL. infra/scripts/check-sql-constant (make lint) keeps SQL out of fmt.Sprintf and `+` everywhere
// else, and keeps Format's template source text.
package sqltext

import (
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Format —— tmpl with each verb replaced by one name, quoted as an identifier. Verbs: %s (the next
// name), %[n]s (the n-th, 1-based), %% (a percent sign). One pass over the template only: an
// inserted name is never scanned again, so a name holding "%s" stays inside its quotes.
//
// A malformed verb or a missing name is written as "%!", which Postgres refuses as a syntax error
// — the statement fails, it does not run with a hole in it.
func Format(tmpl string, names ...string) string {
	var b strings.Builder
	c := verbs{names: names}
	rest := tmpl
	for {
		i := strings.IndexByte(rest, '%')
		if i < 0 {
			b.WriteString(rest)
			return b.String()
		}
		b.WriteString(rest[:i])
		text, width := c.take(rest[i+1:])
		b.WriteString(text)
		rest = rest[i+1+width:]
	}
}

// verbs —— the names and the index the next bare %s takes.
type verbs struct {
	names []string
	next  int
}

// take —— the text for the verb at the start of s (just after '%') and how many bytes it used.
func (c *verbs) take(s string) (string, int) {
	switch {
	case strings.HasPrefix(s, "%"):
		return "%", 1
	case strings.HasPrefix(s, "s"):
		c.next++
		return c.name(c.next), 1
	case strings.HasPrefix(s, "["):
		return c.indexed(s)
	}
	return "%!", 0
}

// indexed —— a "[n]s" verb: the n-th name, and later bare verbs continue after it (as fmt does).
func (c *verbs) indexed(s string) (string, int) {
	end := strings.Index(s, "]s")
	if end < 0 {
		return "%!", 0
	}
	n, err := strconv.Atoi(s[1:end])
	if err != nil {
		return "%!", 0
	}
	c.next = n
	return c.name(n), end + 2
}

// name —— the n-th name (1-based), quoted; "%!" when there is none.
func (c *verbs) name(n int) string {
	if n < 1 || n > len(c.names) {
		return "%!"
	}
	return pgx.Identifier{c.names[n-1]}.Sanitize()
}
