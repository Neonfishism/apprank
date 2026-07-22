/**
 * 配置模块
 */

export const MARKETS: Record<string, string> = {
  CN: "中国大陆", TW: "台湾", JP: "日本", KR: "韩国",
  SA: "沙特阿拉伯", TR: "土耳其", RU: "俄罗斯", DE: "德国",
  FR: "法国", IT: "意大利", US: "美国",
  BR: "巴西", HK: "香港", ID: "印尼", TH: "泰国", PH: "菲律宾",
};

/** Roblox 作为特殊市场 */
export const ROBLOX_MARKET = "RB";

/** Steam 作为特殊市场 */
export const STEAM_MARKET = "ST";

/** 愿望单作为特殊市场 */
export const WISHLIST_MARKET = "WL";

export const MARKET_CODES = Object.keys(MARKETS);

export interface RankThreshold { min: number; max: number; threshold: number; }
export const THRESHOLDS: RankThreshold[] = [
  { min: 1, max: 10, threshold: 5 },
  { min: 11, max: 30, threshold: 15 },
  { min: 31, max: 60, threshold: 25 },
  { min: 61, max: 100, threshold: 35 },
];

/** 愿望单专属阈值（变化更灵敏） */
export const WISHLIST_THRESHOLDS: RankThreshold[] = [
  { min: 1, max: 30, threshold: 10 },
  { min: 31, max: 60, threshold: 20 },
  { min: 61, max: 100, threshold: 30 },
];

export const COMPARISON_WINDOWS: { days: number; label: string }[] = [
  { days: 3, label: "3日前" },
  { days: 7, label: "7日前" },
  { days: 14, label: "14日前" },
  { days: 30, label: "30日前" },
];

/** 不推送的对比窗口天数（数据仍采集，只在消息中隐藏） */
export const HIDDEN_WINDOWS = new Set([30]);

export const TOP_N = 100;
export const SNAPSHOT_RETENTION_DAYS = 100;
export const MAX_RETRIES = 3;
export const SNAPSHOT_DIR = "snapshots";

/** 不推送的市场（数据仍采集）。RB = Roblox */
export const SILENT_MARKETS = new Set(["ID", "HK", "PH", "RB"]);

export function getThreshold(rank: number, market?: string): number {
  const thresholds = market === WISHLIST_MARKET ? WISHLIST_THRESHOLDS : THRESHOLDS;
  for (const t of thresholds) if (rank >= t.min && rank <= t.max) return t.threshold;
  return Infinity;
}
