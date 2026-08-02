// tls.go —— 这个 mock 的 https 面。
//
// 为什么需要它:后端按 owner 给的地址去取素材,而那一步**只认 https** —— 地址是外面递进来的,
// 明文 http 意味着中间任何人都能换掉那几个字节。守卫是对的,于是"别人家的图床"这个替身也
// 必须真的是 https,不能为了测试把守卫放宽。
//
// 证书在启动时现签(自签、自己当根),然后写两份到 TLS_DIR:
//
//	mock-ca.crt  这张证书本身
//	bundle.crt   系统根 + 这张 —— 消费方 SSL_CERT_FILE 指到它,于是它既信真根也信这个 mock
//
// 现签而不是提交进仓库:仓库里不该躺一把私钥,哪怕它只在 compose 网络里有意义。
// 两份文件在监听**之前**写完 —— healthcheck 一通,消费方就能读到。

package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// systemRoots —— alpine 的系统根证书。bundle 拿它打底,这样消费方指过来之后
// **既信真根也信这个 mock**,而不是只信 mock(那会把别的 https 全断掉)。
const systemRoots = "/etc/ssl/certs/ca-certificates.crt"

// certValidity —— 十年。这是个 compose 里的替身,没人会去续期。
const certValidity = 10 * 365 * 24 * time.Hour

// prepareTLS —— 签证书、把信任材料写到共享目录,返回可用来监听的密钥对。
//
// 这一步**同步做完**再起任何监听:healthcheck 一通就意味着 bundle.crt 已经在那儿了。
// 放进监听的 goroutine 里会留一条缝 —— 消费方启动时读到半份文件,失败得毫无道理可言。
func (s *server) prepareTLS(tlsDir string) (tls.Certificate, error) {
	certPEM, keyPEM, gerr := selfSignedCert()
	if gerr != nil {
		return tls.Certificate{}, gerr
	}
	if werr := writeTrustMaterial(tlsDir, certPEM); werr != nil {
		return tls.Certificate{}, werr
	}
	pair, perr := tls.X509KeyPair(certPEM, keyPEM)
	if perr != nil {
		return tls.Certificate{}, fmt.Errorf("tls keypair: %w", perr)
	}
	return pair, nil
}

// serveTLS —— 在 tlsPort 上起 https。
func (s *server) serveTLS(
	handler http.Handler, tlsPort, tlsDir string, pair tls.Certificate,
) error {
	srv := &http.Server{
		Addr:              ":" + tlsPort,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTime,
		TLSConfig:         &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12},
	}
	s.log.Info("external-mock listening (https)", "addr", srv.Addr, "trust_dir", tlsDir)
	if err := srv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("listen tls: %w", err)
	}
	return nil
}

// selfSignedCert —— 一张自签证书,既当叶子也当根(IsCA)。SAN 覆盖 compose 里的服务名
// 和本机 —— 少一个名字,消费方就会在握手时报 "certificate is not valid for ..."。
func selfSignedCert() (certPEM, keyPEM []byte, err error) {
	key, kerr := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if kerr != nil {
		return nil, nil, fmt.Errorf("generate key: %w", kerr)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "external-mock"},
		DNSNames:              []string{"external-mock", "localhost"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(certValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, cerr := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if cerr != nil {
		return nil, nil, fmt.Errorf("create certificate: %w", cerr)
	}
	keyDER, merr := x509.MarshalECPrivateKey(key)
	if merr != nil {
		return nil, nil, fmt.Errorf("marshal key: %w", merr)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), nil
}

// writeTrustMaterial —— 把证书和"系统根 + 证书"的合并包写到共享目录。
// 0644:消费方容器里跑的是别的用户。
func writeTrustMaterial(dir string, certPEM []byte) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("tls dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "mock-ca.crt"), certPEM, 0o644); err != nil {
		return fmt.Errorf("write cert: %w", err)
	}
	roots, rerr := os.ReadFile(systemRoots)
	if rerr != nil {
		return fmt.Errorf("read system roots: %w", rerr)
	}
	bundle := append(append([]byte{}, roots...), certPEM...)
	if err := os.WriteFile(filepath.Join(dir, "bundle.crt"), bundle, 0o644); err != nil {
		return fmt.Errorf("write bundle: %w", err)
	}
	return nil
}
