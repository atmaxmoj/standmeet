// Package credentials is the vault: one supplier's connection state for one owner.
//
// Ciphertext goes in and out of the database here and nowhere else. A Connection handed to a
// caller is already decrypted, and the plaintext lives only in the supplier layer's memory —
// no domain, no route, no block ever holds a token. That boundary is structural, not a
// convention: `check-supplier-boundary` fails the build if anything outside the supplier layer
// and the composition root imports this package.
package credentials
