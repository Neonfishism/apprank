/**
 * 共享类型定义
 */

/** 快照中的 App 条目 */
export interface SnapshotAppEntry {
  app_id: number;
}

/** 单个地区的榜单快照 */
export interface MarketSnapshot {
  apps: SnapshotAppEntry[];
}

/** 当日完整快照 */
export interface DailySnapshot {
  date: string;
  markets: Record<string, MarketSnapshot>;
}

/** 榜单拉取返回的完整元数据（内存中使用，不存入快照） */
export interface AppMeta {
  app_id: number;
  name: string;
  publisher: string;
  category: string;
  url: string;
}

/** 单个 App 在某个对比窗口的排名变化 */
export interface RankChange {
  windowLabel: string;
  days: number;
  oldRank: number | null;
  change: number | null;
  triggered: boolean;
}

/** 触发了异动的 App */
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
