// updater — the product-owned upgrade adapter. Watchtower's mechanism, narrowed to a button press
// and to THIS stack.
//
// It talks to nothing but the Docker socket, and it discovers everything it needs from the stack it
// is already part of — it never hardcodes a project name, never fetches a compose file, never reads
// an .env, and knows nothing about how the stack was deployed (bare `docker compose`, Coolify,
// anything). That is the whole point: an earlier version ran `docker compose -p standmeet up` against
// a FETCHED canonical compose, which (a) hardcoded the project name so on any deployment whose real
// project name differed it built a parallel empty stack instead of upgrading the real one, and (b)
// needed the secrets as ${...} from an .env it couldn't reliably get. Both are deployment knowledge
// the product must not have.
//
// Instead: read our OWN container's `com.docker.compose.project` label to learn the real project,
// list the siblings in it, and recreate each one IN PLACE from its own inspected config with the
// image tag bumped — so volumes, networks, env (the secrets!), labels and names are exactly what
// they already were. Nothing is invented; the running containers are the source of truth.
package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"
)

// config — all knobs, discovered or defaulted. Nothing here names the deployment method.
type config struct {
	signalPath  string        // the byte the backend writes on an upgrade press (shared volume)
	imagePrefix string        // only images under this prefix are ours to bump; the rest are left alone
	channel     string        // the tag to move each of our images to (the release channel)
	poll        time.Duration // how often to check the signal file
}

func loadConfig() config {
	return config{
		signalPath:  env("STANDMEET_UPGRADE_SIGNAL", "/run/standmeet/upgrade.signal"),
		imagePrefix: env("STANDMEET_IMAGE_PREFIX", "ghcr.io/atmaxmoj/standmeet-"),
		channel:     env("STANDMEET_CHANNEL", "latest"),
		poll:        time.Duration(envInt("STANDMEET_UPGRADE_POLL_SECONDS", 5)) * time.Second,
	}
}

func main() {
	cfg := loadConfig()
	ctx := context.Background()

	dc, err := newDocker()
	if err != nil {
		log.Fatalf("[updater] docker client: %v", err)
	}
	defer func() { _ = dc.Close() }()

	self, err := dc.selfIdentity(ctx)
	if err != nil {
		log.Fatalf("[updater] cannot identify own container/project (need the docker socket + a compose label): %v", err)
	}
	log.Printf("[updater] watching %s every %s — project=%q self=%q, bumping %s* to :%s",
		cfg.signalPath, cfg.poll, self.project, self.service, cfg.imagePrefix, cfg.channel)

	watch(ctx, cfg, dc, self)
}

// watch — the clock. Acts only when the signal file's content CHANGES (a press writes a fresh
// timestamp), so a restart of this worker never re-runs an upgrade that already happened.
func watch(ctx context.Context, cfg config, dc *docker, self identity) {
	last := readSignal(cfg.signalPath)
	for {
		time.Sleep(cfg.poll)
		cur := readSignal(cfg.signalPath)
		if cur == "" || cur == last {
			continue
		}
		last = cur
		if err := upgrade(ctx, cfg, dc, self); err != nil {
			log.Printf("[updater] upgrade failed — will retry on the next press: %v", err)
		}
	}
}

// upgrade — recreate every sibling in our own project whose image is ours, in place, bumped to the
// channel tag. Excludes THIS container (recreating the process running this code mid-run is fatal;
// a new updater image is picked up on the next full stack restart).
func upgrade(ctx context.Context, cfg config, dc *docker, self identity) error {
	log.Printf("[updater] signal received — recreating project %q in place", self.project)
	siblings, err := dc.projectContainers(ctx, self.project)
	if err != nil {
		return err
	}
	for _, c := range siblings {
		if c.service == self.service {
			continue // never recreate ourselves
		}
		if !strings.HasPrefix(c.image, cfg.imagePrefix) {
			log.Printf("[updater] skip %s (image %s is not ours)", c.service, c.image)
			continue
		}
		newImage := bumpTag(c.image, cfg.channel)
		if err := dc.recreate(ctx, c, newImage); err != nil {
			return err
		}
		log.Printf("[updater] recreated %s -> %s", c.service, newImage)
	}
	log.Printf("[updater] upgrade complete")
	return nil
}

// bumpTag — replace the tag of repo[:tag] with channel. A digest ref (repo@sha256:…) or an
// untagged ref both get ":channel" — we always want the channel image, not the pinned one.
func bumpTag(imageRef, channel string) string {
	ref := imageRef
	if at := strings.IndexByte(ref, '@'); at >= 0 {
		ref = ref[:at] // drop a @digest
	}
	// Strip an existing :tag, but not a registry-host port (a ':' before the last '/').
	if colon := strings.LastIndexByte(ref, ':'); colon > strings.LastIndexByte(ref, '/') {
		ref = ref[:colon]
	}
	return ref + ":" + channel
}

func readSignal(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n := 0
	for _, r := range v {
		if r < '0' || r > '9' {
			return fallback
		}
		n = n*10 + int(r-'0')
	}
	return n
}
