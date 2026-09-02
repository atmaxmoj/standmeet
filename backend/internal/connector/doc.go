// Package connector — the consumer-agnostic, assemblable connector layer (#155). Base
// (Hub registry + category-slot dispatch + generic openapi runtime + protocol runtime)
// + assemblers: assemble "an OpenAPI spec + JSONata binding" or "a protocol config" into
// the category contract consumers expect (contract.CalendarProxy / MailProxy). Built-in
// and uploaded connectors share the same shape (only the manifest source differs).
// Credential decryption, auth injection, and retry all live in this package — consumers
// (booker / mailer / future IM) only ever see the category contract, never the provider
// or kind behind it.
package connector
