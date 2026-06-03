/**
 * 配置模块
 */

export const MARKETS: Record<string, string> = {
  CN: "中国大陆", TW: "台湾", JP: "日本", KR: "韩国",
  SA: "沙特阿拉伯", TR: "土耳其", RU: "俄罗斯", DE: "德国",
  FR: "法国", IT: "意大利", US: "美国",
};

export const MARKET_CODES = Object.keys(MARKETS);

export interface RankThreshold { min: number; max: number; threshold: number; }
export const THRESHOLDS: RankThreshold[] = [
  { min: 1, max: 10, threshold: 3 },
  { min: 11, max: 50, threshold: 10 },
  { min: 51, max: 100, threshold: 20 },
];

export const COMPARISON_WINDOWS: { days: number; label: string }[] = [
  { days: 3, label: "3日前" },
  { days: 7, label: "7日前" },
  { days: 14, label: "14日前" },
  { days: 30, label: "30日前" },
];

export const TOP_N = 100;
export const MAX_RETRIES = 3;
export const SNAPSHOT_DIR = "snapshots";

export function getThreshold(rank: number): number {
  for (const t of THRESHOLDS) if (rank >= t.min && rank <= t.max) return t.threshold;
  return Infinity;
}
