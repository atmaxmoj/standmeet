// paged.go — the REST face of a paged list op (docs/design/paging.md): the query string
// ?cursor=&limit= plus the list's own filters become the op's args. The op answers the page
// envelope {items, next_cursor} on REST and MCP alike.

package admin

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// pagedQueryArgs — ?cursor= and each filter as strings, ?limit= as a number. A missing
// filter is "" (no filter); a missing or unparsable limit is left out (the op's default).
func pagedQueryArgs(filters ...string) argsFrom {
	return pagedArgs(nil, filters)
}

// pagedWithURLParam — a paged list under one resource: the path parameter (e.g. code_id) plus
// the paged query string.
func pagedWithURLParam(param string, filters ...string) argsFrom {
	return pagedArgs([]string{param}, filters)
}

func pagedArgs(params, filters []string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		fields := map[string]json.RawMessage{}
		addQuoted(fields, append(filters, "cursor"), r.URL.Query().Get)
		addQuoted(fields, params, func(p string) string { return chi.URLParam(r, p) })
		addNumericQuery(fields, r.URL.Query(), []string{"limit"})
		out, err := json.Marshal(fields)
		if err != nil {
			return nil, dispatcher.BadInput("invalid query parameters")
		}
		return out, nil
	}
}

// addQuoted —— each name's value, read by get, as a JSON string field.
func addQuoted(fields map[string]json.RawMessage, names []string, get func(string) string) {
	for _, n := range names {
		fields[n] = json.RawMessage(strconv.Quote(get(n)))
	}
}
