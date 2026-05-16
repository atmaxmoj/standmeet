export interface ImPlatformConfig {
  enabled: boolean;
  bot_token?: string;
  application_id?: string;  // Discord
  app_token?: string;       // Slack
  bot_username?: string;    // Telegram: cached from getMe
}

export interface ImIntegrations {
  telegram?: ImPlatformConfig;
  discord?: ImPlatformConfig;
  slack?: ImPlatformConfig;
}

export interface BridgeConfig {
  djangoUrl: string;
  gatewayUrl: string;
  ownerToken: string;
  webUrl: string;
  integrations: ImIntegrations;
}

export async function loadConfig(): Promise<BridgeConfig> {
  const djangoUrl = process.env.DJANGO_URL ?? "http://localhost:8000";
  const gatewayUrl = process.env.GATEWAY_URL ?? "ws://localhost:8001";
  const ownerToken = process.env.OWNER_TOKEN ?? "";
  const webUrl = process.env.WEB_URL ?? "http://localhost:3000";

  if (!ownerToken) {
    throw new Error("OWNER_TOKEN is required");
  }

  // Fetch IM integrations config from Django settings API
  const res = await fetch(`${djangoUrl}/api/settings/`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch settings: ${res.status} ${res.statusText}`);
  }

  const settings = await res.json();
  const integrations: ImIntegrations = settings.im_integrations ?? {};

  return { djangoUrl, gatewayUrl, ownerToken, webUrl, integrations };
}
