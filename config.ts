/**
 * 配置模块 — 地区列表、排名阈值、对比窗口
 */

/** 监控地区：国家代码 → 显示名称 */
export const MARKETS: Record<string, string> = {
  CN: "中国大陆",
  TW: "台湾",
  JP: "日本",
  KR: "韩国",
  SA: "沙特阿拉伯",
  TR: "土耳其",
  RU: "俄罗斯",
  DE: "德国",
  FR: "法国",
  IT: "意大利",
  US: "美国",
};

/** 地区代码列表 */
export const MARKET_CODES = Object.keys(MARKETS);

/**
 * 分级阈值：排名区间 → 触发所需的最小上升名次
 * 规则：当前排名在 [min, max] 区间内，上升量 ≥ threshold 则触发
 */
export interface RankThreshold {
  min: number;
  max: number;
  threshold: number;
}

export const THRESHOLDS: RankThreshold[] = [
  { min: 1, max: 10, threshold: 3 },
  { min: 11, max: 50, threshold: 10 },
  { min: 51, max: 100, threshold: 20 },
  { min: 101, max: 200, threshold: 30 },
];

/** 对比窗口：往前推的天数 → 窗口名称 */
export const COMPARISON_WINDOWS: { days: number; label: string }[] = [
  { days: 3, label: "3日前" },
  { days: 7, label: "7日前" },
  { days: 14, label: "14日前" },
  { days: 30, label: "30日前" },
];

/** 快照保留天数（覆盖最长窗口 + 缓冲） */
export const SNAPSHOT_RETENTION_DAYS = 35;

/** 榜单拉取深度 */
export const TOP_N = 200;

/** Sensor Tower 分类 ID（0 = 全部） */
export const CATEGORY_ID = 0;

/** API/CLI 请求最大重试次数 */
export const MAX_RETRIES = 3;

/** 快照存储目录 */
export const SNAPSHOT_DIR = "snapshots";

/**
 * 根据当前排名获取触发阈值
 * @returns 阈值名次，若排名超出监控范围则返回 Infinity（永不触发）
 */
export function getThreshold(rank: number): number {
  for (const t of THRESHOLDS) {
    if (rank >= t.min && rank <= t.max) return t.threshold;
  }
  return Infinity;
}

/**
 * 根据国家代码生成 App Store 链接
 */
export function getAppStoreUrl(appId: number, country: string): string {
  return `https://apps.apple.com/${country.toLowerCase()}/app/id${appId}`;
}
