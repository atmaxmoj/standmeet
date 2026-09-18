// blockmarket.go — the dsh BLOCK marketplace (distinct from the skill marketplace in this
// same domain): discovery + download over the npm registry. dsh has no registry of its own;
// its plugins are published to npm as @deepseek-ai/cordis-plugin-* (and community
// koishi-plugin-*), so search is npm's /-/v1/search filtered to that naming, and install
// downloads the package tarball and reads its standmeet manifest + dsh.bundle.patch marker.
//
// The base URL is set from BLOCK_MARKET_NPM_BASE_URL at wireup: empty = real
// registry.npmjs.org; dev/e2e point it at the in-cluster npm mock; the DSH_MARKET_LIVE test
// leaves it empty to hit real npm. httpx (no BlockInternalEgress) reaches both.

package usecase

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	defaultNpmBase   = "https://registry.npmjs.org"
	npmSearchSize    = 25
	npmHTTPTimeout   = 8 * time.Second
	npmMaxBody       = 8 << 20
	npmMaxTarball    = 16 << 20
	npmManifestEntry = "package/standmeet.block.yaml"
	npmPkgJSONEntry  = "package/package.json"
	// dshScopeQuery — the discovery query when none is given: the dsh ecosystem's npm scope.
	dshScopeQuery = "@deepseek-ai/cordis-plugin"
)

// BlockHit — one marketplace search result: the npm package id, its version, description.
type BlockHit struct {
	ID          string `json:"id"`
	Version     string `json:"version"`
	Description string `json:"description"`
}

// FetchedBlock — a downloaded package: its standmeet manifest (empty if absent) and whether
// package.json declared the dsh.bundle.patch mountable marker.
type FetchedBlock struct {
	ManifestYAML string
	IsDshBlock   bool
}

// BlockMarket — the npm-backed dsh block marketplace client.
type BlockMarket struct {
	http *http.Client
	base string
}

// NewBlockMarket — build the client; empty base → real npm.
func NewBlockMarket(base string) *BlockMarket {
	b := strings.TrimRight(base, "/")
	if b == "" {
		b = defaultNpmBase
	}
	return &BlockMarket{http: httpx.NewClient(httpx.Options{Timeout: npmHTTPTimeout}), base: b}
}

// Search — npm search, keeping only dsh/koishi-ecosystem plugin packages.
func (b *BlockMarket) Search(ctx context.Context, query string) ([]BlockHit, error) {
	text := strings.TrimSpace(query)
	if text == "" {
		text = dshScopeQuery
	}
	u := b.base + "/-/v1/search?" + url.Values{
		"text": {text}, "size": {strconv.Itoa(npmSearchSize)},
	}.Encode()
	body, err := b.getBody(ctx, u)
	if err != nil {
		return nil, err
	}
	var resp npmSearchResp
	if derr := json.Unmarshal(body, &resp); derr != nil {
		return nil, fmt.Errorf("decode npm search: %w", derr)
	}
	return dshBlocksFrom(&resp), nil
}

// Fetch — resolve the package on npm, download its tarball, and read the manifest + dsh marker.
func (b *BlockMarket) Fetch(ctx context.Context, id, version string) (FetchedBlock, error) {
	tarURL, err := b.resolveTarball(ctx, id, version)
	if err != nil {
		return FetchedBlock{}, err
	}
	return b.fetchFromTarball(ctx, tarURL)
}

func (b *BlockMarket) resolveTarball(ctx context.Context, id, version string) (string, error) {
	doc, err := b.packageDoc(ctx, id)
	if err != nil {
		return "", err
	}
	v := version
	if v == "" {
		v = doc.DistTags["latest"]
	}
	ver, ok := doc.Versions[v]
	if !ok || ver.Dist.Tarball == "" {
		return "", fmt.Errorf("package %s has no installable version %q", id, v)
	}
	return ver.Dist.Tarball, nil
}

func (b *BlockMarket) packageDoc(ctx context.Context, id string) (npmPackageDoc, error) {
	body, err := b.getBody(ctx, b.base+"/"+id)
	if err != nil {
		return npmPackageDoc{}, err
	}
	var doc npmPackageDoc
	if derr := json.Unmarshal(body, &doc); derr != nil {
		return npmPackageDoc{}, fmt.Errorf("decode npm package doc: %w", derr)
	}
	return doc, nil
}

func (b *BlockMarket) fetchFromTarball(ctx context.Context, tarURL string) (FetchedBlock, error) {
	resp, err := b.do(ctx, tarURL)
	if err != nil {
		return FetchedBlock{}, err
	}
	defer closeBody(resp.Body)
	gz, gerr := gzip.NewReader(io.LimitReader(resp.Body, npmMaxTarball))
	if gerr != nil {
		return FetchedBlock{}, fmt.Errorf("open tarball gzip: %w", gerr)
	}
	return scanTarball(tar.NewReader(gz))
}

func (b *BlockMarket) getBody(ctx context.Context, u string) ([]byte, error) {
	resp, err := b.do(ctx, u)
	if err != nil {
		return nil, err
	}
	defer closeBody(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("npm registry status %d", resp.StatusCode)
	}
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, npmMaxBody))
	if rerr != nil {
		return nil, fmt.Errorf("read npm response: %w", rerr)
	}
	return body, nil
}

func (b *BlockMarket) do(ctx context.Context, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("npm request: %w", err)
	}
	resp, derr := b.http.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("npm fetch: %w", derr)
	}
	return resp, nil
}

// dshBlocksFrom — map the npm hits, dropping anything not in the dsh/koishi naming.
func dshBlocksFrom(resp *npmSearchResp) []BlockHit {
	out := make([]BlockHit, 0, len(resp.Objects))
	for i := range resp.Objects {
		p := resp.Objects[i].Package
		if isDshBlockName(p.Name) {
			out = append(out, BlockHit{ID: p.Name, Version: p.Version, Description: p.Description})
		}
	}
	return out
}

// isDshBlockName — the dsh/koishi ecosystem naming: @deepseek-ai/cordis-plugin-*,
// @cordisjs/plugin-*, or community koishi-plugin-*.
func isDshBlockName(name string) bool {
	n := strings.ToLower(name)
	return strings.Contains(n, "cordis-plugin") ||
		strings.Contains(n, "@cordisjs/plugin-") ||
		strings.HasPrefix(n, "koishi-plugin-") ||
		strings.Contains(n, "/koishi-plugin-")
}

func scanTarball(tr *tar.Reader) (FetchedBlock, error) {
	var blk FetchedBlock
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return blk, nil
		}
		if err != nil {
			return FetchedBlock{}, fmt.Errorf("read tarball: %w", err)
		}
		if aerr := absorbTarEntry(tr, h.Name, &blk); aerr != nil {
			return FetchedBlock{}, aerr
		}
	}
}

// absorbTarEntry — read the two entries we care about (manifest + package.json); ignore the rest.
func absorbTarEntry(tr *tar.Reader, name string, blk *FetchedBlock) error {
	if name != npmManifestEntry && name != npmPkgJSONEntry {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(tr, npmMaxTarball))
	if err != nil {
		return fmt.Errorf("read %s: %w", name, err)
	}
	if name == npmManifestEntry {
		blk.ManifestYAML = string(body)
		return nil
	}
	blk.IsDshBlock = pkgJSONHasDshMarker(body)
	return nil
}

// pkgJSONHasDshMarker — true when package.json declares dsh.bundle.patch (dsh's "this package
// is a mountable block" signal, deepseek-harness project-manager.ts).
func pkgJSONHasDshMarker(body []byte) bool {
	var pj pkgJSON
	if err := json.Unmarshal(body, &pj); err != nil {
		return false
	}
	return pj.Dsh.Bundle.Patch != ""
}

// npm response shapes (named, no nested anonymous structs).
type npmPackage struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
}

type npmSearchObject struct {
	Package npmPackage `json:"package"`
}

type npmSearchResp struct {
	Objects []npmSearchObject `json:"objects"`
}

type npmPackageDoc struct {
	DistTags map[string]string        `json:"dist-tags"`
	Versions map[string]npmVersionDoc `json:"versions"`
}

type npmVersionDoc struct {
	Dist npmDist `json:"dist"`
}

type npmDist struct {
	Tarball string `json:"tarball"`
}

type pkgJSON struct {
	Dsh pkgJSONDsh `json:"dsh"`
}

type pkgJSONDsh struct {
	Bundle pkgJSONBundle `json:"bundle"`
}

type pkgJSONBundle struct {
	Patch string `json:"patch"`
}
