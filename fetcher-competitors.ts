/**
 * 竞品榜单抓取 — 16 国 App Store 免费榜 & 畅销榜，Top100
 *
 * 数据源：https://itunes.apple.com/{cc}/rss/{topfreeapplications|topgrossingapplications}/limit=100[/genre=6014]/json
 *
 * 两套榜单按竞品的 App Store 主分类分别使用：
 *   - scope="app"  全品类总榜，用于主分类非 Games 的竞品
 *   - scope="game" 游戏榜（genre=6014），用于主分类为 Games 的竞品
 */

import { TOP_N } from "./config.js";
import { COUNTRY_MAP, fetchWithRetry, qimaiUrl } from "./fetcher.js";
import type { AppMeta } from "./types.js";

export type CompetitorChart = "free" | "gross";
export type CompetitorScope = "app" | "game";

const RSS_CHART: Record<CompetitorChart, string> = {
  free: "topfreeapplications",
  gross: "topgrossingapplications",
};

/** 游戏大类 genre id */
const GAMES_GENRE = 6014;

interface ITunesRssEntry {
  "im:name": { label: string };
  "im:artist": { label: string };
  id: { attributes: { "im:id": string } };
}

interface ITunesRssResponse {
  feed: { entry: ITunesRssEntry[] };
}

/**
 * 抓取指定国家某张榜单的 Top100，返回带元数据的条目（按排名顺序）
 * @param scope "app" = 全品类总榜；"game" = 游戏榜（genre=6014）
 */
export async function fetchCompetitorChart(
  country: string,
  chart: CompetitorChart,
  scope: CompetitorScope = "app"
): Promise<AppMeta[]> {
  const cc = COUNTRY_MAP[country];
  if (!cc) throw new Error(`不支持的国家代码: ${country}`);

  const genre = scope === "game" ? `genre=${GAMES_GENRE}/` : "";
  const url = `https://itunes.apple.com/${cc}/rss/${RSS_CHART[chart]}/limit=${TOP_N}/${genre}json`;
  const raw = await fetchWithRetry(url);
  const data: ITunesRssResponse = JSON.parse(raw);

  if (!data.feed?.entry || !Array.isArray(data.feed.entry)) {
    throw new Error("RSS 返回格式异常");
  }

  return data.feed.entry.slice(0, TOP_N).map((entry) => {
    const appId = parseInt(entry.id.attributes["im:id"], 10);
    return {
      app_id: appId,
      name: entry["im:name"].label,
      publisher: entry["im:artist"].label,
      category: "竞品",
      url: qimaiUrl(appId, cc),
    };
  });
}
