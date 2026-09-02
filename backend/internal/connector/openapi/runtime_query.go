// runtime_query.go — renders the binding's query JSONata into a URL query string. Split out
// of runtime.go to stay under max-lines.
//
// Why this segment exists: some SaaS APIs put half of an action in query parameters.
// Google Calendar's "notify attendees" is exactly `?sendUpdates=all` — both creating and
// cancelling an event depend on it, and there's nowhere in the request body to express it.
// The binding language originally had only op/request/response, so this switch silently
// vanished when the connector was externalized (F-B-7).

package openapi

import (
	"net/url"
	"strconv"
)

// requestURL — base + path ({param} substitution) + query string. An operation's target
// address is fully assembled here.
func (r *Runtime) requestURL(bo *boundOp, input any) (string, error) {
	query, err := renderQuery(&bo.binding, input)
	if err != nil {
		return "", err
	}
	return r.baseURL + substitutePath(bo.resolved.Path, input) + query, nil
}

// renderQuery — query JSONata → `?a=1&b=2` (encoded). Empty/none → empty string. A key
// whose value is null or an empty string is dropped outright: a condition like "notify only
// when there's an email" is written as a JSONata ternary, and evaluating to empty just means
// this parameter is omitted.
func renderQuery(ob *opBinding, input any) (string, error) {
	m, err := ob.evalQuery(input)
	if err != nil {
		return "", err
	}
	values := url.Values{}
	for k, v := range m {
		if s := queryValue(v); s != "" {
			values.Set(k, s)
		}
	}
	if len(values) == 0 {
		return "", nil
	}
	return "?" + values.Encode(), nil
}

// float64Bits — a JSON number decodes as float64; formatted back at full precision.
const float64Bits = 64

// queryValue — a query parameter value accepts only scalars; null / object / array → empty
// string (= this key is omitted).
func queryValue(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, float64Bits)
	default:
		return ""
	}
}
