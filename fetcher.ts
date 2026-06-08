/**
 * 榜单拉取模块 — iTunes RSS 游戏分类接口
 *
 * 数据源：https://itunes.apple.com/{country}/rss/topfreeapplications/limit={n}/genre=6014/json
 * 免费、无需 API Key、每日更新、仅游戏分类
 */

import { TOP_N, MAX_RETRIES } from "./config.js";

const ITUNES_RSS = "https://itunes.apple.com";

const COUNTRY_MAP: Record<string, string> = {
  CN: "cn", TW: "tw", JP: "jp", KR: "kr",
  SA: "sa", TR: "tr", RU: "ru", DE: "de",
  FR: "fr", IT: "it", US: "us",
};

/** iTunes RSS 返回的条目 */
interface ITunesEntry {
  "im:name": { label: string };
  "im:artist": { label: string };
  id: { label: string; attributes: { "im:id": string } };
  link?: { attributes?: { href?: string } } | Array<{ attributes?: { href?: string } }>;
}

interface ITunesResponse {
  feed: { entry: ITunesEntry[] };
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

/** 从 entry 中提取 App Store 链接 */
function extractUrl(entry: ITunesEntry): string {
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
  for (const l of links) {
    if (l?.attributes?.href) return l.attributes.href;
  }
  return entry.id?.label || "";
}

export async function fetchMarketRankings(
  country: string
): Promise<Array<{ app_id: number; name: string; publisher: string; category: string; url: string }>> {
  const cc = COUNTRY_MAP[country];
  if (!cc) throw new Error(`不支持的国家代码: ${country}`);

  const url = `${ITUNES_RSS}/${cc}/rss/topfreeapplications/limit=${TOP_N}/genre=6014/json`;
  const raw = await fetchWithRetry(url);
  const data: ITunesResponse = JSON.parse(raw);

  if (!data.feed?.entry || !Array.isArray(data.feed.entry)) {
    throw new Error("RSS 返回格式异常");
  }

  return data.feed.entry.slice(0, TOP_N).map((entry) => ({
    app_id: parseInt(entry.id.attributes["im:id"], 10),
    name: entry["im:name"].label,
    publisher: entry["im:artist"].label,
    category: "游戏",
    url: extractUrl(entry),
  }));
}
