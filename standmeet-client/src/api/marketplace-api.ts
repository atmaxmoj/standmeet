import { apiRequest } from "./client.js";
import type { Skill } from "../types.js";

// Client-side cache: key -> { data, expiry }
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiry > Date.now()) return entry.data as T;
  cache.delete(key);
  return null;
}

function cacheSet(key: string, data: unknown): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  stars: number;
  category: string;
  version: string;
  marketplace: string;
  source_url: string;
}

interface MarketplaceDetail {
  skill_md: string;
  marketplace: string;
  skill_id: string;
}

interface UpdateInfo {
  skill_id: string;
  name: string;
  installed_version: string;
  latest_version: string;
}

export async function searchMarketplace(
  query: string = "",
  source: string = "all",
): Promise<MarketplaceSkill[]> {
  const key = `search:${query}:${source}`;
  const cached = cacheGet<MarketplaceSkill[]>(key);
  if (cached) return cached;

  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (source !== "all") params.set("source", source);
  const qs = params.toString();
  const result = await apiRequest<MarketplaceSkill[]>(`/api/marketplace/search/${qs ? `?${qs}` : ""}`);
  cacheSet(key, result);
  return result;
}

export async function getMarketplaceDetail(
  marketplace: string,
  skillId: string,
): Promise<MarketplaceDetail> {
  const key = `detail:${marketplace}:${skillId}`;
  const cached = cacheGet<MarketplaceDetail>(key);
  if (cached) return cached;

  const result = await apiRequest<MarketplaceDetail>(`/api/marketplace/${marketplace}/${skillId}/`);
  cacheSet(key, result);
  return result;
}

export async function installFromMarketplace(
  marketplace: string,
  skillId: string,
): Promise<Skill> {
  return apiRequest<Skill>("/api/marketplace/install/", {
    method: "POST",
    body: JSON.stringify({ marketplace, skill_id: skillId }),
  });
}

export async function checkUpdates(): Promise<UpdateInfo[]> {
  return apiRequest<UpdateInfo[]>("/api/marketplace/check-updates/");
}
