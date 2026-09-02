// Package axisconn —— wiring for the connector axis: built-in and owner-uploaded
// connectors, category operations, the category dependency registry.
//
// The connector's **declaration** doesn't live here — it's in
// backend/connectors/<id>/manifest.yaml. This package only wires the declaration to the
// mechanism: assembling it into the Hub, hooking implementations onto the category
// contract's actions, giving "is this category connected" a place to ask.
package axisconn
