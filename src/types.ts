/**
 * 共享类型定义
 */

/** 快照中的 App 条目（精简：仅存 app_id，排名由数组索引隐含） */
export interface SnapshotAppEntry {
  app_id: number;
}

/** Sensor Tower app-info 返回的单个 App 详情 */
export interface AppInfo {
  app_id: number;
  app_name: string;
  publisher_name: string;
  publisher_id: number;
  humanized_worldwide_last_month_downloads?: string;
  categories?: Array<{ id: number; name: string; primary: boolean }>;
}

/** 单个地区的榜单快照 */
export interface MarketSnapshot {
  /** app_id 列表，按排名升序（索引 0 = 第 1 名） */
  apps: SnapshotAppEntry[];
}

/** 当日完整快照 */
export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  markets: Record<string, MarketSnapshot>;
}

/** Sensor Tower top-charts CLI 返回 */
export interface TopChartsResponse {
  category: number;
  chart_type: string;
  country: string;
  date: string;
  ranking: number[]; // app_id 数组，按排名排序
}

/** 单个 App 在某个对比窗口的排名变化 */
export interface RankChange {
  windowLabel: string; // "3日前" | "7日前" | "14日前" | "30日前"
  days: number;
  oldRank: number | null; // null = 无历史数据
  change: number | null; // null = 无法计算，正数=上升
  triggered: boolean;
}

/** 触发了异动的 App（元数据待拉取） */
export interface Anomaly {
  country: string;
  countryName: string;
  appId: number;
  appName: string;
  publisherName: string;
  category: string;
  currentRank: number;
  appStoreUrl: string;
  changes: RankChange[];
  emoji: string;
}
