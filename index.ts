/**
 * App 排名异动监控 — 主入口
 *
 * 数据源：Apple RSS Feed（免费，无需 API Key）
 * 推送：飞书 Webhook
 */

import { fetchMarketRankings } from "./fetcher.js";
import { saveSnapshot, loadSnapshot, buildMarketSnapshot, getDateBefore, getCleanupCutoff, cleanOldSnapshots } from "./snapshot.js";
import { detectAnomalies, resolveAnomalies } from "./comparator.js";
import { buildFeishuMessage, sendFeishuMessage } from "./reporter.js";
import { MARKET_CODES, COMPARISON_WINDOWS } from "./config.js";
import type { DailySnapshot, AppMeta } from "./types.js";

function today(): string { return new Date().toISOString().slice(0, 10); }

async function main(): Promise<void> {
  const date = today();
  console.log(`\n======== App 排名异动监控 | ${date} ========\n`);

  // 1. 拉取榜单（Apple RSS，自带元数据）
  console.log("[步骤1] 拉取榜单...");
  const markets: DailySnapshot["markets"] = {};
  const metaMap = new Map<number, AppMeta>();
  let ok = 0, fail = 0;

  for (const country of MARKET_CODES) {
    try {
      console.log(`  拉取 ${country}...`);
      const apps = await fetchMarketRankings(country);
      markets[country] = buildMarketSnapshot(apps.map((a) => a.app_id));
      for (const app of apps) metaMap.set(app.app_id, app);
      ok++;
      console.log(`  ✓ ${country}: ${apps.length} 个 App`);
    } catch (err) {
      fail++;
      console.error(`  ✗ ${country}: ${(err as Error).message}`);
    }
  }
  console.log(`\n榜单拉取完成: ${ok} 成功, ${fail} 失败`);
  if (ok === 0) { console.error("全部失败，终止"); return; }

  // 2. 保存快照
  console.log("\n[步骤2] 保存快照...");
  const snapshot: DailySnapshot = { date, markets };
  saveSnapshot(snapshot);

  // 3. 加载历史快照
  console.log("\n[步骤3] 加载历史快照...");
  const historySnapshots = new Map<number, DailySnapshot | null>();
  for (const { days, label } of COMPARISON_WINDOWS) {
    const snap = loadSnapshot(getDateBefore(days, date));
    historySnapshots.set(days, snap);
    console.log(`  ${label}: ${snap ? "✓" : "✗ 缺失"}`);
  }

  // 4. 检测异动
  console.log("\n[步骤4] 检测异动...");
  const rawAnomalies = detectAnomalies(snapshot, historySnapshots);
  console.log(`  发现 ${rawAnomalies.length} 个异动 App`);

  // 5. 填充元数据 + 推送
  console.log("\n[步骤5] 推送飞书...");
  if (rawAnomalies.length > 0) {
    const anomalies = resolveAnomalies(rawAnomalies, metaMap);
    const message = buildFeishuMessage(anomalies, date);
    console.log(message);
    await sendFeishuMessage(message);
  } else {
    console.log("  无异动，静默退出");
  }

  // 6. 清理
  console.log("\n[步骤6] 清理过期快照...");
  const deleted = cleanOldSnapshots(getCleanupCutoff());
  console.log(`  清理了 ${deleted} 个旧快照`);
  console.log(`\n======== 完成 ========\n`);
}

main().catch((err) => { console.error("\n❌ 执行失败:", err); }).finally(() => {
  // GitHub Actions 中正常退出；PieBox Preview 中保持进程不退出，防止反复重启
  if (!process.env.CI) {
    console.log("[预览模式] 保持进程运行，防止重复执行...");
    setInterval(() => {}, 3600_000);
  }
});
