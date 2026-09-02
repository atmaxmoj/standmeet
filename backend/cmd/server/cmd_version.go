// cmd_version.go —— `standmeet version` / `--version`: which build this binary is.
//
// Exists so **the release gate can ask**: the version number is burned in at release
// time via `-ldflags -X`, and forgetting to pass that build-arg fails silently — the
// binary still runs, it just reports a number that has nothing to do with the actual
// build from then on. This subcommand lets the release pipeline ask the image itself,
// directly, before pushing (no need to start db/redis/the whole stack).
//
// Also useful for the owner: `docker run --rm <image> --version` tells them exactly
// which image they're holding.

package main

import (
	"os"

	"github.com/atmaxmoj/standmeet/cmd/server/port"
)

// versionSubcommand —— prints the version and returns 0 when argv[1] is
// version / --version / -v; any other argv takes the server path and returns -1
// (same dispatch convention as passwordResetSubcommand).
func versionSubcommand() int {
	if len(os.Args) < 2 {
		return -1
	}
	switch os.Args[1] {
	case "version", "--version", "-v":
		// Goes through writeLines instead of fmt.Println — the output target is
		// an explicit writer (same path as password-reset), and lint also
		// forbids bare prints.
		writeLines(os.Stdout, []string{port.AppVersion()})
		return 0
	default:
		return -1
	}
}
