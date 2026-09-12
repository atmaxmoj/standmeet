// gateway.go —— sandbox-side reach-back client. #135 constrained-reachback: anything mail-sender
// can't reach directly (the owner's active mail supplier) goes through the socket bound into the
// sandbox to call a **fixed vocabulary** of host ops. It can only call these ops, no new op can be
// added — isomorphic to booker. Reuses callHost's (main.go) line-JSON underneath.
//
// Before the migration mail-sender used a **private** "send" host op; it now goes through the
// generic supplier.invoke("mail","send") instead — the host side no longer has a mail-sender-
// specific handler, only the generic reach-back gateway (see the gateway wiring in cmd/server).

package main

import (
	"encoding/json"
	"fmt"
)

type errEnvelope struct {
	Error string `json:"error"`
}

// gwCall —— sends a fixed-vocabulary op, returns raw JSON; a host error envelope becomes an error.
func gwCall(op string, fields map[string]any) (json.RawMessage, error) {
	fields["op"] = op
	resp, err := callHost(fields)
	if err != nil {
		return nil, err
	}
	var e errEnvelope
	if json.Unmarshal(resp, &e) == nil && e.Error != "" {
		return nil, fmt.Errorf("host %s: %s", op, e.Error)
	}
	return json.RawMessage(resp), nil
}

// gwSupplierInvoke —— calls one verb on the owner's active supplier (here, mail) by seam name.
func gwSupplierInvoke(
	ownerID, seam, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	return gwCall("supplier.invoke", map[string]any{
		"owner_id": ownerID, "seam": seam, "verb": verb, "args": args,
	})
}
