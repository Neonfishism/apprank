/**
 * Roblox 榜单拉取 — Rolimon's API
 *
 * 数据源：https://api.rolimons.com/games/v1/gamelist
 * 免费、无需认证、返回全量游戏 + 在线人数
 */

import { TOP_N, MAX_RETRIES } from "./config.js";

const ROLIMONS_API = "https://api.rolimons.com/games/v1/gamelist";

interface RolimonResponse {
  success: boolean;
  game_count: number;
  games: Record<string, [string, number, string]>; // [name, playerCount, iconUrl]
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error("unreachable");
}

export async function fetchRobloxRankings(): Promise<
  Array<{ app_id: number; name: string; publisher: string; category: string; url: string }>
> {
  const raw = await fetchWithRetry(ROLIMONS_API);
  const data: RolimonResponse = JSON.parse(raw);

  if (!data.success || !data.games) throw new Error("Rolimon API 返回异常");

  // 按在线人数降序，取 Top N
  const sorted = Object.entries(data.games)
    .sort((a, b) => b[1][1] - a[1][1])
    .slice(0, TOP_N);

  return sorted.map(([placeId, [name]]) => ({
    app_id: parseInt(placeId, 10),
    name,
    publisher: "Roblox",
    category: "Roblox",
    url: `https://www.roblox.com/games/${placeId}`,
  }));
}
