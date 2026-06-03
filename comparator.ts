/**
 * 对比模块 — 排名变化检测与阈值匹配
 */

import type { DailySnapshot, RankChange } from "./types.js";
import {
  getThreshold,
  getAppStoreUrl,
  COMPARISON_WINDOWS,
  MARKETS,
} from "./config.js";

/**
 * 在历史快照中查找 app_id 的排名
 * @returns 排名（1-based），未找到返回 null
 */
function findRankInSnapshot(
  snapshot: DailySnapshot,
  country: string,
  appId: number
): number | null {
  const market = snapshot.markets[country];
  if (!market) return null;

  const index = market.apps.findIndex((a) => a.app_id === appId);
  return index === -1 ? null : index + 1; // 排名 = 索引 + 1
}

/**
 * 对单个 App 计算所有对比窗口的排名变化
 */
function computeChanges(
  appId: number,
  currentRank: number,
  historySnapshots: Map<number, DailySnapshot | null>,
  country: string
): RankChange[] {
  return COMPARISON_WINDOWS.map(({ days, label }) => {
    const oldSnapshot = historySnapshots.get(days);
    if (!oldSnapshot) {
      return { windowLabel: label, days, oldRank: null, change: null, triggered: false };
    }

    const oldRank = findRankInSnapshot(oldSnapshot, country, appId);
    if (oldRank === null) {
      return { windowLabel: label, days, oldRank: null, change: null, triggered: false };
    }

    const change = oldRank - currentRank; // 正数 = 上升
    const threshold = getThreshold(currentRank);
    const triggered = change > 0 && change >= threshold;

    return { windowLabel: label, days, oldRank, change, triggered };
  });
}

/** 异常 App 原始数据（元数据待拉取） */
export interface RawAnomaly {
  country: string;
  appId: number;
  currentRank: number;
  changes: RankChange[];
}

/**
 * 对比今日快照与历史快照，返回所有触发异动的 App（不含元数据）
 */
export function detectAnomalies(
  today: DailySnapshot,
  historySnapshots: Map<number, DailySnapshot | null>
): RawAnomaly[] {
  const anomalies: RawAnomaly[] = [];

  for (const [country, market] of Object.entries(today.markets)) {
    for (let i = 0; i < market.apps.length; i++) {
      const appId = market.apps[i].app_id;
      const currentRank = i + 1;

      const changes = computeChanges(appId, currentRank, historySnapshots, country);

      if (!changes.some((c) => c.triggered)) continue;

      anomalies.push({ country, appId, currentRank, changes });
    }
  }

  return anomalies;
}

/**
 * 按国家+分类分组排序
 */
export function groupAndSortAnomalies(
  anomalies: Array<{
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
  }>
): Map<string, typeof anomalies> {
  const groups = new Map<string, typeof anomalies>();

  for (const a of anomalies) {
    const key = `${a.country}::${a.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  for (const apps of groups.values()) {
    apps.sort((a, b) => a.currentRank - b.currentRank);
  }

  return groups;
}
