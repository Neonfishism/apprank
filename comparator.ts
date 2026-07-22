/**
 * 对比模块 — 排名变化检测与阈值匹配
 */

import type { DailySnapshot, AppMeta, RankChange, Anomaly } from "./types.js";
import { getThreshold, COMPARISON_WINDOWS, MARKETS, ROBLOX_MARKET, STEAM_MARKET, TOP_N, HIDDEN_WINDOWS } from "./config.js";

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
    // 健康检查标记：如果该市场在旧快照中被标记为不可靠，跳过
    if ((snap as any)._unreliableMarkets?.has(country)) {
      return { windowLabel: label, days, oldRank: null, change: null, triggered: false };
    }
    const oldRank = findRank(snap, country, appId);
    if (oldRank === null) {
      // 新上榜：视为从榜外（TOP_N 之后）进入
      const change = TOP_N + 1 - currentRank;
      return { windowLabel: label, days, oldRank: null, change, triggered: change >= getThreshold(currentRank, country) };
    }
    const change = oldRank - currentRank;
    return { windowLabel: label, days, oldRank, change, triggered: change > 0 && change >= getThreshold(currentRank, country) };
  });
}

export function detectAnomalies(
  today: DailySnapshot,
  historySnapshots: Map<number, DailySnapshot | null>
): RawAnomaly[] {
  // 对每个对比窗口做一次健康检查：如果某市场新旧快照的 app 重叠度 < 20%，
  // 说明旧快照可能损坏（早期工具版本 appId 格式不兼容），打出告警
  for (const [days, snap] of historySnapshots) {
    if (!snap) continue;
    for (const [country, market] of Object.entries(today.markets)) {
      const oldMarket = snap.markets[country];
      if (!oldMarket) continue;
      const oldIds = new Set(oldMarket.apps.map((a) => a.app_id));
      const newIds = new Set(market.apps.map((a) => a.app_id));
      let overlap = 0;
      for (const id of oldIds) if (newIds.has(id)) overlap++;
      const pct = Math.round((overlap / Math.max(oldIds.size, 1)) * 100);
      if (pct < 20) {
        console.warn(`[comparator] ⚠️ 健康检查失败: ${country} ${days}日前 快照重叠度仅 ${pct}%，可能损坏，跳过该窗口`);
        // 将该窗口对该市场标记为"不可用"
        (snap as any)._unreliableMarkets ??= new Set();
        (snap as any)._unreliableMarkets.add(country);
      }
    }
  }

  const anomalies: RawAnomaly[] = [];
  for (const [country, market] of Object.entries(today.markets)) {
    for (let i = 0; i < market.apps.length; i++) {
      const appId = market.apps[i].app_id;
      const changes = computeChanges(appId, i + 1, historySnapshots, country);
      if (changes.some((c) => c.triggered && !HIDDEN_WINDOWS.has(c.days))) {
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
      emoji: "⬆",
    };
  });
}
