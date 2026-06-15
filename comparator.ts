/**
 * 对比模块 — 排名变化检测与阈值匹配
 */

import type { DailySnapshot, AppMeta, RankChange, Anomaly } from "./types.js";
import { getThreshold, COMPARISON_WINDOWS, MARKETS, ROBLOX_MARKET, STEAM_MARKET, TOP_N } from "./config.js";

export interface RawAnomaly {
  country: string;
  appId: number;
  currentRank: number;
  changes: RankChange[];
}

function findRank(snapshot: DailySnapshot, country: string, appId: number): number | null {
  const market = snapshot.markets[country];
  if (!market) return null;
  const idx = market.apps.findIndex((a) => a.app_id === appId);
  return idx === -1 ? null : idx + 1;
}

function computeChanges(
  appId: number, currentRank: number,
  historySnapshots: Map<number, DailySnapshot | null>, country: string
): RankChange[] {
  return COMPARISON_WINDOWS.map(({ days, label }) => {
    const snap = historySnapshots.get(days);
    if (!snap || !snap.markets[country]) return { windowLabel: label, days, oldRank: null, change: null, triggered: false };
    const oldRank = findRank(snap, country, appId);
    if (oldRank === null) {
      // 新上榜：视为从榜外（TOP_N 之后）进入
      const change = TOP_N + 1 - currentRank;
      return { windowLabel: label, days, oldRank: null, change, triggered: change >= getThreshold(currentRank) };
    }
    const change = oldRank - currentRank;
    return { windowLabel: label, days, oldRank, change, triggered: change > 0 && change >= getThreshold(currentRank) };
  });
}

export function detectAnomalies(
  today: DailySnapshot,
  historySnapshots: Map<number, DailySnapshot | null>
): RawAnomaly[] {
  const anomalies: RawAnomaly[] = [];
  for (const [country, market] of Object.entries(today.markets)) {
    for (let i = 0; i < market.apps.length; i++) {
      const appId = market.apps[i].app_id;
      const changes = computeChanges(appId, i + 1, historySnapshots, country);
      if (changes.some((c) => c.triggered)) {
        anomalies.push({ country, appId, currentRank: i + 1, changes });
      }
    }
  }
  return anomalies;
}

export function resolveAnomalies(rawAnomalies: RawAnomaly[], metaMap: Map<number, AppMeta>): Anomaly[] {
  return rawAnomalies.map((raw) => {
    const meta = metaMap.get(raw.appId);
    const isRB = raw.country === ROBLOX_MARKET;
    const isST = raw.country === STEAM_MARKET;
    return {
      country: raw.country,
      countryName: isRB ? "Roblox" : isST ? "Steam" : (MARKETS[raw.country] || raw.country),
      appId: raw.appId,
      appName: meta?.name || `App ${raw.appId}`,
      publisherName: meta?.publisher || "未知",
      category: "游戏",
      currentRank: raw.currentRank,
      // iOS 根据异常国家重新生成七麦链接，避免 metaMap 覆盖导致的串区问题
      appStoreUrl: isRB || isST
        ? (meta?.url || "")
        : `https://www.qimai.cn/app/rank/appid/${raw.appId}/country/${raw.country.toLowerCase()}`,
      changes: raw.changes,
      emoji: raw.currentRank <= 10 ? "🚀" : "⬆️",
    };
  });
}
