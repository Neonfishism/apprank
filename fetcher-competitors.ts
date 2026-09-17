/**
 * 竞品榜单抓取 — 16 国 App Store 免费榜 & 畅销榜（全品类总榜 Top100）
 *
 * 数据源：https://itunes.apple.com/{cc}/rss/{topfreeapplications|topgrossingapplications}/limit=100/json
 * 与 iOS 游戏榜（genre=6014）不同，这里抓取的是全品类总榜
 */

import { TOP_N } from "./config.js";
import { COUNTRY_MAP, fetchWithRetry, qimaiUrl } from "./fetcher.js";
import type { AppMeta } from "./types.js";

export type CompetitorChart = "free" | "gross";

const RSS_CHART: Record<CompetitorChart, string> = {
  free: "topfreeapplications",
  gross: "topgrossingapplications",
};

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
 */
export async function fetchCompetitorChart(
  country: string,
  chart: CompetitorChart
): Promise<AppMeta[]> {
  const cc = COUNTRY_MAP[country];
  if (!cc) throw new Error(`不支持的国家代码: ${country}`);

  const url = `https://itunes.apple.com/${cc}/rss/${RSS_CHART[chart]}/limit=${TOP_N}/json`;
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
