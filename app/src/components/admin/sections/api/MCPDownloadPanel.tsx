// MCPDownloadPanel —— install instructions 占位。link 跳到 /docs/mcp。

const PLATFORMS = [
  { id: 'npm',   label: 'npm', cmd: 'npm install -g @standmeet/mcp-client', size: '482 kB' },
  { id: 'mac',   label: 'macOS · universal', cmd: 'standmeet-mcp_1.0.0_darwin.zip', size: '11 MB' },
  { id: 'linux', label: 'Linux · x64',       cmd: 'standmeet-mcp_1.0.0_linux.tar.gz', size: '12 MB' },
  { id: 'win',   label: 'Windows · x64',     cmd: 'standmeet-mcp_1.0.0_windows.zip',  size: '13 MB' },
] as const;

type Platform = (typeof PLATFORMS)[number];

export function MCPDownloadPanel() {
  return (
    <div>
      <Header />
      <p className="reading-tight text-(--color-muted) text-[14.5px]">
        The MCP client is a thin wrapper around your StandMeet API — talks to your AI tool over stdio,
        talks to your instance over HTTPS. Standalone binaries available for Mac / Linux / Windows.
      </p>
      <Grid />
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-(--color-rule)">
      <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-ink)">install the mcp client</h3>
      <span className="mono text-[10.5px] tracking-[0.06em] text-(--color-faint)">v1.0 · MIT</span>
    </div>
  );
}

function Grid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
      {PLATFORMS.map((p) => <PlatformLink key={p.id} platform={p} />)}
    </div>
  );
}

function PlatformLink({ platform }: { platform: Platform }) {
  return (
    <a
      href="https://github.com/standmeet/mcp-client"
      target="_blank"
      rel="noreferrer"
      className="group border border-(--color-rule) rounded-sm p-3.5 bg-(--color-surface)/30 hover:border-(--color-ink) transition-colors flex items-baseline justify-between gap-4"
    >
      <div className="min-w-0">
        <div className="mono text-[10.5px] tracking-[0.06em] text-(--color-ink) truncate">{platform.cmd}</div>
        <div className="mono text-[9.5px] tracking-[0.12em] uppercase text-(--color-faint) mt-1">
          {platform.label} · {platform.size}
        </div>
      </div>
      <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) group-hover:text-(--color-accent) shrink-0">
        {platform.id === 'npm' ? 'copy ↗' : 'download ↗'}
      </span>
    </a>
  );
}
