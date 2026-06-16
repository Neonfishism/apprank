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
 * 批量解析游戏名（单 appid 逐个请求，控制并发）
 */
async function resolveNames(appIds: number[]): Promise<Map<number, { name: string; publisher: string }>> {
  const result = new Map<number, { name: string; publisher: string }>();
  const CONCURRENCY = 5;

  for (let i = 0; i < appIds.length; i += CONCURRENCY) {
    const batch = appIds.slice(i, i + CONCURRENCY);
    const tasks = batch.map(async (id) => {
      try {
        const data = await fetchJson<AppDetailResponse>(
          `${STORE_API}/api/appdetails?appids=${id}`
        );
        const info = data[id.toString()];
        if (info?.success && info.data) {
          return { id, name: info.data.name, publisher: info.data.developers?.[0] || "Steam" } as const;
        }
      } catch {
        // 单个失败不中断
      }
      return null;
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      if (r) result.set(r.id, { name: r.name, publisher: r.publisher });
    }

    // 避免频率限制
    if (i + CONCURRENCY < appIds.length) {
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

  // 按昨日峰值在线人数排序取 Top N，比实时人数更稳定
  const sorted = charts.response.ranks
    .sort((a, b) => b.peak_in_game - a.peak_in_game)
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
