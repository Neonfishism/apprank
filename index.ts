/**
 * App 排名异动监控 — 主入口
 * 平台：iOS（16 国游戏下载榜）+ Roblox（在线人数榜）
 */

import { fetchMarketRankings } from "./fetcher.js";
import { fetchRobloxRankings } from "./fetcher-roblox.js";
import { saveSnapshot, loadSnapshot, buildMarketSnapshot, getDateBefore, getCleanupCutoff, cleanOldSnapshots } from "./snapshot.js";
import { detectAnomalies, resolveAnomalies } from "./comparator.js";
import { buildFeishuMessage, sendFeishuMessage } from "./reporter.js";
import { MARKET_CODES, ROBLOX_MARKET, COMPARISON_WINDOWS } from "./config.js";
import type { DailySnapshot, AppMeta } from "./types.js";

function today(): string { return new Date().toISOString().slice(0, 10); }

async function main(): Promise<void> {
  const date = today();
  console.log(`\n======== 游戏异动监控 | ${date} ========\n`);

  const markets: DailySnapshot["markets"] = {};
  const metaMap = new Map<number, AppMeta>();
  let ok = 0, fail = 0;

  // ── iOS 16 国 ──
  console.log("[iOS] 拉取游戏下载榜...");
  for (const country of MARKET_CODES) {
    try {
      const apps = await fetchMarketRankings(country);
      markets[country] = buildMarketSnapshot(apps.map((a) => a.app_id));
      for (const a of apps) metaMap.set(a.app_id, a);
      ok++;
      console.log(`  ✓ ${country}: ${apps.length} 款`);
    } catch (err) {
      fail++;
      console.error(`  ✗ ${country}: ${(err as Error).message}`);
    }
  }

  // ── Roblox ──
  console.log("[Roblox] 拉取在线人数榜...");
  try {
    const apps = await fetchRobloxRankings();
    markets[ROBLOX_MARKET] = buildMarketSnapshot(apps.map((a) => a.app_id));
    for (const a of apps) metaMap.set(a.app_id, a);
    ok++;
    console.log(`  ✓ Roblox: ${apps.length} 款`);
  } catch (err) {
    fail++;
    console.error(`  ✗ Roblox: ${(err as Error).message}`);
  }

  console.log(`\n榜单拉取完成: ${ok} 成功, ${fail} 失败`);
  if (ok === 0) { console.error("全部失败，终止"); return; }

  // ── 保存快照 ──
  console.log("\n[步骤2] 保存快照...");
  const snapshot: DailySnapshot = { date, markets };
  saveSnapshot(snapshot);

  // ── 加载历史 ──
  console.log("\n[步骤3] 加载历史快照...");
  const historySnapshots = new Map<number, DailySnapshot | null>();
  for (const { days, label } of COMPARISON_WINDOWS) {
    const snap = loadSnapshot(getDateBefore(days, date));
    historySnapshots.set(days, snap);
    console.log(`  ${label}: ${snap ? "✓" : "✗ 缺失"}`);
  }

  // ── 检测异动 ──
  console.log("\n[步骤4] 检测异动...");
  const rawAnomalies = detectAnomalies(snapshot, historySnapshots);
  console.log(`  发现 ${rawAnomalies.length} 个异动 App`);

  // ── 推送 ──
  console.log("\n[步骤5] 推送飞书...");
  if (rawAnomalies.length > 0) {
    const anomalies = resolveAnomalies(rawAnomalies, metaMap);
    const message = buildFeishuMessage(anomalies, date);
    console.log(message);
    await sendFeishuMessage(message);
  } else {
    console.log("  无异动，静默退出");
  }

  // ── 清理 ──
  console.log("\n[步骤6] 清理过期快照...");
  const deleted = cleanOldSnapshots(getCleanupCutoff());
  console.log(`  清理了 ${deleted} 个旧快照`);
  console.log(`\n======== 完成 ========\n`);
}

main().catch((err) => { console.error("\n❌ 执行失败:", err); }).finally(() => {
  if (!process.env.CI) setInterval(() => {}, 3600_000);
});
