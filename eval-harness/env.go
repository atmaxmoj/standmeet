package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// loadDotenv makes the harness self-configuring: on startup it reads a .env
// file so cred (EVAL_PROVIDER/ENDPOINT/MODEL/KEY) lives with the stack instead
// of being passed on the command line every time. Search order, first found
// wins: ./.env, then ../.env (repo root when run from eval-harness/), then the
// dir of the executable. Existing process env always takes precedence over the
// file, so an explicit `EVAL_KEY=… make …` still overrides.
func loadDotenv() {
	for _, p := range dotenvCandidates() {
		if applyDotenv(p) {
			return
		}
	}
}

func dotenvCandidates() []string {
	paths := []string{".env", filepath.Join("..", ".env")}
	if exe, err := os.Executable(); err == nil {
		paths = append(paths, filepath.Join(filepath.Dir(exe), ".env"))
	}
	return paths
}

// applyDotenv parses one .env file (KEY=VALUE lines, # comments, optional
// quotes) and sets any var not already present in the environment. Returns
// true if the file existed and was read.
func applyDotenv(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		key, val, ok := parseDotenvLine(sc.Text())
		if !ok {
			continue
		}
		if _, present := os.LookupEnv(key); !present {
			_ = os.Setenv(key, val)
		}
	}
	return true
}

// credDefaults —— resolved LLM cred for flag defaults.
type credDefaults struct {
	Provider, Key, Endpoint, Model string
}

// resolveCredDefaults makes the harness self-configuring about WHICH LLM to
// call, in priority order, so neither the owner nor I pass a key by hand:
//
//  1. EVAL_KEY (+ EVAL_PROVIDER/ENDPOINT/MODEL overrides) — explicit.
//  2. a known provider key already in the env / .env (DEEPSEEK_API_KEY,
//     OPENAI_API_KEY, ANTHROPIC_API_KEY) — picked up automatically with that
//     provider's standard endpoint + a sensible default model.
//  3. nothing set → the deterministic dev mock gateway (no real key, no cost).
//
// The resolved provider+endpoint are logged at startup (never the key) so it's
// obvious whether a run is real or mock.
func resolveCredDefaults() credDefaults {
	if k := os.Getenv("EVAL_KEY"); k != "" {
		return credDefaults{
			Provider: envOr("EVAL_PROVIDER", "deepseek"),
			Key:      k,
			Endpoint: envOr("EVAL_ENDPOINT", "https://api.deepseek.com"),
			Model:    envOr("EVAL_MODEL", "deepseek-chat"),
		}
	}
	if k := os.Getenv("DEEPSEEK_API_KEY"); k != "" {
		return credDefaults{Provider: "deepseek", Key: k, Endpoint: "https://api.deepseek.com", Model: "deepseek-chat"}
	}
	if k := os.Getenv("OPENAI_API_KEY"); k != "" {
		return credDefaults{Provider: "openai", Key: k, Endpoint: "https://api.openai.com/v1", Model: "gpt-4o"}
	}
	if k := os.Getenv("ANTHROPIC_API_KEY"); k != "" {
		return credDefaults{Provider: "anthropic", Key: k, Endpoint: "https://api.anthropic.com", Model: "claude-sonnet-4-6"}
	}
	// Deterministic fallback: the Anthropic-compatible dev mock gateway.
	return credDefaults{Provider: "anthropic", Key: "dev-llm-gateway-dummy-key", Endpoint: "http://localhost:9300", Model: "claude-sonnet-4-6"}
}

func envOr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

func parseDotenvLine(line string) (key, val string, ok bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")
	eq := strings.IndexByte(line, '=')
	if eq <= 0 {
		return "", "", false
	}
	key = strings.TrimSpace(line[:eq])
	val = strings.TrimSpace(line[eq+1:])
	val = strings.Trim(val, `"'`)
	return key, val, true
}
