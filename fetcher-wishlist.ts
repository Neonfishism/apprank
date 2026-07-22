/**
 * 愿望单排名抓取 — games-popularity.com
 * 抓取前 4 页（Top 100），提取 Steam appId、游戏名、开发商/发行商
 */
import { TOP_N } from "./config.js";

const BASE = "https://games-popularity.com/steam/top-wishlist";
const PAGES = Math.ceil(TOP_N / 25); // 4 页 = 100 款

export interface WishlistEntry {
  app_id: number;
  name: string;
  publisher: string;
  category: string;
  url: string;
}

/** 从 HTML 行中提取 Steam appId（优先 onerror 中的数字，兜底从图片 URL 解析） */
function extractAppId(row: string): number | null {
  // onerror="fallbackSteamLogo(this, 1422450)"
  const onErr = row.match(/fallbackSteamLogo\(this,\s*(\d+)\)/);
  if (onErr) return parseInt(onErr[1]);
  // 兜底：从 img src 中提取 /apps/1422450/
  const imgSrc = row.match(/steam\/apps\/(\d+)\//);
  if (imgSrc) return parseInt(imgSrc[1]);
  return null;
}

/** 从 HTML 行中提取游戏名 */
function extractName(row: string): string {
  // <a ...href="/overview/711881/deadlock">Deadlock</a>
  const m = row.match(/<a[^>]*href="\/overview\/\d+\/[^"]*"[^>]*>([^<]+)<\/a>/);
  if (m) return m[1].trim();
  // 备用：从 img alt 属性提取
  const alt = row.match(/alt="([^"]+)"/);
  return alt ? alt[1].trim() : "";
}

/** 从 HTML 行中提取开发商/发行商 */
function extractPublisher(row: string): string {
  const m = row.match(/<td class="devs">([\s\S]*?)<\/td>/);
  if (!m) return "未知";
  // 去掉 HTML 标签，保留纯文本
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "未知";
}

/** 从 HTML 行中提取排名变化值 */
function extractChange(row: string): { d1: number | null; d7: number | null; d30: number | null } {
  const spans = row.match(/<span>([^<]*)<\/span>/g);
  const vals = (spans || []).map((s) => {
    const text = s.replace(/<[^>]+>/g, "").trim();
    if (text === "-") return null;
    const n = parseInt(text);
    return isNaN(n) ? null : n;
  });
  return { d1: vals[0] ?? null, d7: vals[1] ?? null, d30: vals[2] ?? null };
}

/** 抓取单页，返回游戏列表 */
async function fetchPage(page: number): Promise<WishlistEntry[]> {
  const url = `${BASE}?page=${page}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`games-popularity 返回 HTTP ${res.status}`);
  const html = await res.text();

  // 按 <tr> 分割，保留包含游戏图片的行
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!rows) throw new Error("未找到表格行");

  const entries: WishlistEntry[] = [];
  for (const row of rows) {
    // 必须包含游戏图片才认为是数据行（跳过表头等）
    if (!row.includes("fallbackSteamLogo")) continue;

    const appId = extractAppId(row);
    if (!appId) continue;

    const name = extractName(row);
    if (!name) continue;

    const publisher = extractPublisher(row);

    entries.push({
      app_id: appId,
      name,
      publisher,
      category: "游戏",
      url: `https://store.steampowered.com/app/${appId}`,
    });
  }
  return entries;
}

/** 抓取 Top N 愿望单游戏 */
export async function fetchWishlistRankings(): Promise<WishlistEntry[]> {
  const all: WishlistEntry[] = [];
  for (let p = 1; p <= PAGES; p++) {
    const entries = await fetchPage(p);
    all.push(...entries);
    // 去重（同一 appId 可能出现多次？）
  }
  // 去重并截取 TOP_N
  const seen = new Set<number>();
  const unique: WishlistEntry[] = [];
  for (const e of all) {
    if (!seen.has(e.app_id)) {
      seen.add(e.app_id);
      unique.push(e);
    }
    if (unique.length >= TOP_N) break;
  }
  return unique.slice(0, TOP_N);
}
