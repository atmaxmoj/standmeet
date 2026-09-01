// ed25519keys.go —— shared Ed25519 keypair primitive. Owner keypairs and embed credentials both
// need "generate, keep the public key at rest, hand the private key over exactly once". This is
// that primitive in one place, so the second caller doesn't re-derive PKIX/PKCS8 PEM handling.

package cryptobox

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
)

// Ed25519PEMs —— a fresh keypair as PEM strings (public PKIX, private PKCS8).
type Ed25519PEMs struct {
	PublicPEM  string
	PrivatePEM string
}

// GenerateEd25519PEMs —— mint an Ed25519 keypair, PEM-encoded.
func GenerateEd25519PEMs() (Ed25519PEMs, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Ed25519PEMs{}, fmt.Errorf("generate ed25519: %w", err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return Ed25519PEMs{}, fmt.Errorf("marshal public key: %w", err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return Ed25519PEMs{}, fmt.Errorf("marshal private key: %w", err)
	}
	return Ed25519PEMs{
		PublicPEM:  string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})),
		PrivatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})),
	}, nil
}

// ParseEd25519Public —— decode a PKIX PEM public key.
func ParseEd25519Public(pemStr string) (ed25519.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, errors.New("decode PEM: no block")
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse PKIX: %w", err)
	}
	edPub, ok := pub.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("not an ed25519 public key")
	}
	return edPub, nil
}
