import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { StandMeetConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".standmeet");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): StandMeetConfig | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }
  const raw = readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as StandMeetConfig;
}

export function saveConfig(config: StandMeetConfig): void {
  const dir = dirname(CONFIG_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function isConfigured(): boolean {
  const config = loadConfig();
  return config !== null && !!config.server?.url && !!config.server?.token;
}
