// Package adapters — the consumer-agnostic, assemblable supplier layer (#155). Base
// (seam dispatch + generic openapi runtime + protocol runtime) + assemblers: assemble
// "an OpenAPI spec + JSONata binding" or "a protocol config" into the seam contract
// consumers expect (CalendarProxy / MailProxy). Built-in and uploaded suppliers share
// the same shape (only the manifest source differs).
// Credential decryption, auth injection, and retry all live in this package — consumers
// (booker / mailer / future IM) only ever see the seam contract, never the provider
// or kind behind it.
package adapters
