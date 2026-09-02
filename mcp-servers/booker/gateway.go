// gateway.go —— the sandbox-side reach-back client. #135 constrained-reachback: booker's business logic
// lives in this sandbox, and anything outside its reach (calendar connector / its own isolated storage /
// owner metadata) is reached only through the **fixed vocabulary** of host ops, over the socket bound
// into the sandbox. It can only call these ops, and cannot add a new one.
//
// The underlying layer reuses callHost's (main.go) line-JSON single-request/single-response. If the host
// replies with a capsocket {"error":...} envelope, this turns it into a Go error (the tool layer then
// folds it into {ok:false} for the agent).

package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

type errEnvelope struct {
	Error string `json:"error"`
	// Code —— the **category** of failure. Without it, this side only has one sentence to show, so
	// "owner never configured this" and "configured but unreachable right now" collapse into the same
	// sentence —— and one of those sentences is false for the visitor (F-C-42).
	// The vocabulary lives in the host's internal/infra/hostop/fault.go; constants can't be shared
	// across modules, so alignment is guarded by e2e (the visitor-facing wording must differ between
	// the two cases), not by someone remembering to change both places.
	Code string `json:"code"`
}

// hostFault —— a host error carrying a category.
type hostFault struct {
	Op   string
	Msg  string
	Code string
}

func (f *hostFault) Error() string { return "host " + f.Op + ": " + f.Msg }

// faultCode —— extracts the category; returns an empty string when it isn't a host error (or the host gave no category).
func faultCode(err error) string {
	var f *hostFault
	if errors.As(err, &f) {
		return f.Code
	}
	return ""
}

// One-to-one with the host's hostop.Fault*.
const (
	faultNotConfigured = "not_configured"
	faultUnavailable   = "unavailable"
)

// gwCall —— sends one fixed-vocabulary op, returns the raw JSON; a host error envelope becomes an error.
func gwCall(op string, fields map[string]any) (json.RawMessage, error) {
	fields["op"] = op
	resp, err := callHost(fields)
	if err != nil {
		return nil, err
	}
	var e errEnvelope
	if json.Unmarshal(resp, &e) == nil && e.Error != "" {
		return nil, &hostFault{Op: op, Msg: e.Error, Code: e.Code}
	}
	return json.RawMessage(resp), nil
}

// gwConnectorInvoke —— calls one verb on the owner's active connector (calendar/mail) by name.
func gwConnectorInvoke(
	ownerID, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	return gwCall("connector.invoke", map[string]any{
		"owner_id": ownerID, "category": category, "verb": verb, "args": args,
	})
}

// gwConnectorInvokeBackground —— hands off to the host to run in the background (with retries), without
// waiting for the result. Used for calls where "the result shouldn't block the caller": a booking
// confirmation notice. **Cannot** be replaced by spawning a goroutine in this process —— the sandbox
// only lives for this one turn; the process may be reclaimed the moment the tool call returns, and a
// retry backoff that hasn't fired yet would just die.
func gwConnectorInvokeBackground(
	ownerID, category, verb string, args json.RawMessage,
) error {
	_, err := gwCall("connector.invoke", map[string]any{
		"owner_id": ownerID, "category": category, "verb": verb, "args": args,
		"background": true,
	})
	return err
}

// gwCapstoreInsert —— inserts a document into this cap's isolated storage, returns the record id.
func gwCapstoreInsert(collection string, doc json.RawMessage) (string, error) {
	resp, err := gwCall("capstore.insert", map[string]any{
		"collection": collection, "doc": doc,
	})
	if err != nil {
		return "", err
	}
	var r struct {
		ID string `json:"id"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return "", fmt.Errorf("capstore.insert decode: %w", uerr)
	}
	return r.ID, nil
}

// gwCapstoreClaim —— claims a key; only one caller gets it (the host guarantees this via a primary-key
// conflict).
//
// Booking is "check busy times first → then insert"; when a second request squeezes into that window,
// both requests see the same "free" slot —— this really happened in prod: two simultaneous requests
// produced two side-by-side meetings on the real calendar (F-B-15). The claim covers exactly that window.
// Failing to claim isn't an error: losing the race to someone else is a normal outcome, and the caller
// answers with a different message based on it.
func gwCapstoreClaim(collection, key string, ttlSeconds int) bool {
	resp, err := gwCall("capstore.claim", map[string]any{
		"collection": collection, "key": key, "ttl_seconds": ttlSeconds,
	})
	if err != nil {
		// **Allow through** when the host fails to answer: a claim mechanism shouldn't be able to take
		// booking down entirely. The risk of one extra double-booking is traded against "one host
		// hiccup and nobody can book" —— the latter is worse, and worse still, it's not obvious why.
		return true
	}
	var r struct {
		Claimed bool `json:"claimed"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return true
	}
	return r.Claimed
}

// gwCapstoreRelease —— releases the slot this caller claimed (done, or failed). Not releasing is fine too; the TTL expires it.
func gwCapstoreRelease(collection, key string) {
	_, _ = gwCall("capstore.release", map[string]any{"collection": collection, "key": key})
}

// gwCapstoreQuery —— fetches documents in this cap's collection whose doc matches the filter.
func gwCapstoreQuery(collection string, filter json.RawMessage) ([]json.RawMessage, error) {
	resp, err := gwCall("capstore.query", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return nil, err
	}
	var r struct {
		Records []json.RawMessage `json:"records"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return nil, fmt.Errorf("capstore.query decode: %w", uerr)
	}
	return r.Records, nil
}

// gwCapstoreCount —— counts documents in this cap's collection matching the filter (a quota gate).
func gwCapstoreCount(collection string, filter json.RawMessage) (int64, error) {
	resp, err := gwCall("capstore.count", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return 0, err
	}
	var r struct {
		Count int64 `json:"count"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return 0, fmt.Errorf("capstore.count decode: %w", uerr)
	}
	return r.Count, nil
}

// gwCapstoreDelete —— deletes records in this cap's collection matching the filter, returns the deleted row count.
func gwCapstoreDelete(collection string, filter json.RawMessage) (int64, error) {
	resp, err := gwCall("capstore.delete", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return 0, err
	}
	var r struct {
		Deleted int64 `json:"deleted"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return 0, fmt.Errorf("capstore.delete decode: %w", uerr)
	}
	return r.Deleted, nil
}

// gwOwnerMeta —— reads one whitelisted owner field (e.g. timezone).
func gwOwnerMeta(ownerID, field string) (string, error) {
	resp, err := gwCall("owner.meta", map[string]any{
		"owner_id": ownerID, "field": field,
	})
	if err != nil {
		return "", err
	}
	var r struct {
		Value string `json:"value"`
	}
	if uerr := json.Unmarshal(resp, &r); uerr != nil {
		return "", fmt.Errorf("owner.meta decode: %w", uerr)
	}
	return r.Value, nil
}

// gwCapConfig —— asks the host for **this capability's own configuration**.
//
// Why not query that document from capstore directly: **the defaults live in the declaration** (the
// host's manifest ConfigField), and the sandbox can't see the declaration. Querying storage directly
// would read nothing when the owner never set a value, forcing us to write a second copy of the
// defaults here —— that's exactly the root cause of host/sandbox policy drifting apart before (the host
// said 18:00 with a 15-minute buffer, this side used 17:00 with a 0-minute buffer).
//
// What this op returns is **the final value, already backfilled from the declaration**; use it as-is.
func gwCapConfig(ownerID string) (map[string]json.RawMessage, error) {
	resp, err := gwCall("capconfig.get", map[string]any{"owner_id": ownerID})
	if err != nil {
		return nil, err
	}
	var out map[string]json.RawMessage
	if uerr := json.Unmarshal(resp, &out); uerr != nil {
		return nil, fmt.Errorf("capconfig decode: %w", uerr)
	}
	return out, nil
}

// capRecord —— one of our own records: id + document.
type capRecord struct {
	ID  string          `json:"id"`
	Doc json.RawMessage `json:"doc"`
}

// gwCapstoreQueryRecords —— a query that includes the id. Canceling a booking by id first requires being able to see the id.
func gwCapstoreQueryRecords(collection string, filter json.RawMessage) ([]capRecord, error) {
	resp, err := gwCall("capstore.query_records", map[string]any{
		"collection": collection, "filter": filter,
	})
	if err != nil {
		return nil, err
	}
	var out struct {
		Records []capRecord `json:"records"`
	}
	if uerr := json.Unmarshal(resp, &out); uerr != nil {
		return nil, fmt.Errorf("capstore query_records decode: %w", uerr)
	}
	return out.Records, nil
}

// gwCapstoreDeleteByID —— deletes one of our own records by its record id.
func gwCapstoreDeleteByID(collection, recordID string) (int64, error) {
	resp, err := gwCall("capstore.delete_by_id", map[string]any{
		"collection": collection, "record_id": recordID,
	})
	if err != nil {
		return 0, err
	}
	var out struct {
		Deleted int64 `json:"deleted"`
	}
	if uerr := json.Unmarshal(resp, &out); uerr != nil {
		return 0, fmt.Errorf("capstore delete_by_id decode: %w", uerr)
	}
	return out.Deleted, nil
}
