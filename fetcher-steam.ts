/**
 * Steam 榜单拉取 — Steam Web API
 *
 * 数据源：ISteamChartsService/GetGamesByConcurrentPlayers (实时并发排行)
 * 游戏名：store.steampowered.com/api/appdetails (批量解析)
 */

import { TOP_N, MAX_RETRIES } from "./config.js";

const STEAM_API = "https://api.steampowered.com";
const STORE_API = "https://store.steampowered.com";

interface SteamRankEntry {
  rank: number;
  appid: number;
  concurrent_in_game: number;
  peak_in_game: number;
}

interface SteamChartsResponse {
  response: {
    last_update: number;
    ranks: SteamRankEntry[];
  };
}

interface AppDetailResponse {
  [appid: string]: {
    success: boolean;
    data?: { name: string; developers?: string[] };
  };
}

async function fetchJson<T>(url: string, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error("unreachable");
}

/**
 * 批量解析游戏名（每批 20 个 appid）
 */
async function resolveNames(appIds: number[]): Promise<Map<number, { name: string; publisher: string }>> {
  const result = new Map<number, { name: string; publisher: string }>();
  const BATCH = 20;

  for (let i = 0; i < appIds.length; i += BATCH) {
    const batch = appIds.slice(i, i + BATCH);
    const ids = batch.join(",");
    try {
      const data = await fetchJson<AppDetailResponse>(
        `${STORE_API}/api/appdetails?appids=${ids}`
      );
      for (const [idStr, info] of Object.entries(data)) {
        if (info.success && info.data) {
          result.set(parseInt(idStr, 10), {
            name: info.data.name,
            publisher: info.data.developers?.[0] || "Steam",
          });
        }
      }
    } catch (err) {
      console.warn(`  [Steam] 游戏名批量解析失败 (batch ${i / BATCH + 1}): ${(err as Error).message}`);
    }

    // 避免频率限制
    if (i + BATCH < appIds.length) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return result;
}

export async function fetchSteamRankings(): Promise<
  Array<{ app_id: number; name: string; publisher: string; category: string; url: string }>
> {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("缺少环境变量 STEAM_API_KEY");

  const charts = await fetchJson<SteamChartsResponse>(
    `${STEAM_API}/ISteamChartsService/GetGamesByConcurrentPlayers/v1/?key=${key}`
  );

  if (!charts?.response?.ranks) throw new Error("Steam API 返回异常");

  // 按 rank 排序取 Top N
  const sorted = charts.response.ranks
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP_N);

  const appIds = sorted.map((r) => r.appid);
  const nameMap = await resolveNames(appIds);

  return sorted.map((r) => {
    const info = nameMap.get(r.appid);
    return {
      app_id: r.appid,
      name: info?.name || `Steam App ${r.appid}`,
      publisher: info?.publisher || "Steam",
      category: "Steam",
      url: `https://store.steampowered.com/app/${r.appid}`,
    };
  });
}
