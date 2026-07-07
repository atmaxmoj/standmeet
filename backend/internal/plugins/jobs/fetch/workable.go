// workable.go —— Workable SPI (Server Partner Integration) jobs endpoint。
//
//	GET {base}/spi/v3/accounts/{company}/jobs   Authorization: Bearer {api_token}
//
// 返回 {"name": <account>, "jobs": [...]}。每条 job 有 shortcode / title / full_title /
// department / url / created_at (ISO) / description (HTML) / location.location_str。
// 这是真 jobs 端点(v1 的 widget 端点只返账户元数据) —— 需 owner 的 API token 认证,
// 走连接器框架惯用的 authed 源模式(token 在 per-source config,不出 owner 手)。

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const workableDefaultBase = "https://apply.workable.com"

type workableConfig struct {
	Company  string `json:"company"`
	APIToken string `json:"api_token"`
}

type workableFetcher struct {
	client *http.Client
	base   string
}

func newWorkableFetcher(client *http.Client, envBase string) *workableFetcher {
	return &workableFetcher{
		client: client,
		base:   firstOrDefault(envBase, workableDefaultBase),
	}
}

// Fetch reads {base}/spi/v3/accounts/{company}/jobs with the owner's SPI token.
func (f *workableFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]domain.FetchedJob, error) {
	cfg, err := parseWorkableConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/spi/v3/accounts/%s/jobs", f.base, cfg.Company)
	body, err := getBodyAuth(ctx, f.client, url, cfg.APIToken)
	if err != nil {
		return nil, err
	}
	var payload workableResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]domain.FetchedJob, 0, len(payload.Jobs))
	for i := range payload.Jobs {
		out = append(out, workableToDomain(&payload.Jobs[i], payload.Name))
	}
	return out, nil
}

// parseWorkableConfig unmarshals + validates the per-source config. company + api_token
// are both required (the SPI jobs endpoint is authed — no token, no jobs).
func parseWorkableConfig(raw []byte) (workableConfig, error) {
	var cfg workableConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("workable config decode: %w: %w",
				domain.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("workable missing company: %w", domain.ErrJobSourceConfigInvalid)
	}
	if cfg.APIToken == "" {
		return cfg, fmt.Errorf("workable missing api_token: %w", domain.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

// validateWorkableCfg —— used by configValidators dispatch in jobfetch.go.
func validateWorkableCfg(raw []byte) error {
	_, err := parseWorkableConfig(raw)
	return err
}

type workableResp struct {
	Name string        `json:"name"`
	Jobs []workableJob `json:"jobs"`
}

type workableJob struct {
	Shortcode   string           `json:"shortcode"`
	Title       string           `json:"title"`
	FullTitle   string           `json:"full_title"`
	Department  string           `json:"department"`
	URL         string           `json:"url"`
	CreatedAt   string           `json:"created_at"`
	Description string           `json:"description"`
	Location    workableLocation `json:"location"`
}

type workableLocation struct {
	LocationStr string `json:"location_str"`
}

func workableToDomain(j *workableJob, accountName string) domain.FetchedJob {
	return domain.FetchedJob{
		ExternalID:  j.Shortcode,
		Title:       firstNonEmpty(j.FullTitle, j.Title),
		Company:     accountName,
		Location:    j.Location.LocationStr,
		URL:         j.URL,
		BodyText:    j.Description,
		Tags:        appendIfNonEmpty(nil, j.Department),
		PublishedAt: parseISOTime(j.CreatedAt),
		SourceKind:  KindWorkable,
	}
}
