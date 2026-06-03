/**
 * 榜单拉取模块 — 通过 Apple RSS Feed 获取 iOS 下载榜
 *
 * 数据源：https://rss.applemarketingtools.com
 * 免费、无需 API Key、每日更新
 */

import { TOP_N, MAX_RETRIES } from "./config.js";

/** Apple RSS API 基础地址 */
const RSS_BASE = "https://rss.applemarketingtools.com/api/v2";

/** 国家代码映射：config 中的大写 → RSS 的小写 */
const COUNTRY_MAP: Record<string, string> = {
  CN: "cn", TW: "tw", JP: "jp", KR: "kr",
  SA: "sa", TR: "tr", RU: "ru", DE: "de",
  FR: "fr", IT: "it", US: "us",
};

/** Genre ID → 中文名称 */
const GENRE_NAMES: Record<number, string> = {
  6000: "商务", 6001: "天气", 6002: "工具", 6003: "旅游",
  6004: "体育", 6005: "社交", 6006: "参考", 6007: "效率",
  6008: "摄影与录像", 6009: "新闻", 6010: "导航", 6011: "音乐",
  6012: "生活", 6013: "健康健美", 6014: "游戏", 6015: "财务",
  6016: "娱乐", 6017: "教育", 6018: "图书", 6020: "医疗",
  6021: "报刊杂志", 6022: "商品指南", 6023: "美食佳饮",
};

/** Apple RSS 返回的 App 条目 */
interface RSSApp {
  id: string;
  name: string;
  artistName: string;
  url: string;
  genres: Array<{ genreId: string; name: string; url: string }>;
  artworkUrl100?: string;
}

interface RSSResponse {
  feed: {
    results: RSSApp[];
  };
}

/**
 * 带重试的 HTTP GET
 */
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

/**
 * 解析 genre ID 为分类名称
 */
function resolveCategory(genres: RSSApp["genres"]): string {
  if (!genres || genres.length === 0) return "全部";
  // 取第一个 genre
  const genreId = parseInt(genres[0].genreId, 10);
  return GENRE_NAMES[genreId] || genres[0].name || "全部";
}

/**
 * 拉取单个地区的 Top N 下载榜（返回 app_ids 列表 + 元数据）
 */
export async function fetchMarketRankings(
  country: string
): Promise<Array<{ app_id: number; name: string; publisher: string; category: string; url: string }>> {
  const countryCode = COUNTRY_MAP[country];
  if (!countryCode) throw new Error(`不支持的国家代码: ${country}`);

  const url = `${RSS_BASE}/${countryCode}/apps/top-free/${TOP_N}/apps.json`;
  const raw = await fetchWithRetry(url);
  const data: RSSResponse = JSON.parse(raw);

  if (!data.feed?.results || !Array.isArray(data.feed.results)) {
    throw new Error(`RSS 返回格式异常`);
  }

  return data.feed.results.slice(0, TOP_N).map((app) => ({
    app_id: parseInt(app.id, 10),
    name: app.name,
    publisher: app.artistName,
    category: resolveCategory(app.genres),
    url: app.url,
  }));
}
