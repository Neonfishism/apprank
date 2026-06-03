/**
 * 入口 — 编排榜单拉取 → 快照保存 → 对比 → 拉取元数据 → 推送流程
 *
 * 用法：pnpm start
 *
 * 环境变量：
 *   PIE_TOKEN          — PieBox 认证 Token（必需）
 *   PIE_BASE_URL       — PieBox Gateway 地址（必需）
 *   FEISHU_WEBHOOK_URL  — 飞书机器人 Webhook（必需）
 *   ST_BINARY_PATH      — sensortower CLI 路径（可选）
 *
 * 注意：脚本依赖 sensortower CLI 二进制，仅在 Linux 环境可用。
 *       推荐通过 PieBox Cloud 或 GitHub Actions 部署运行。
 */

import { fetchMarketRankings } from "./fetcher.js";
import {
  saveSnapshot,
  loadSnapshot,
  buildMarketSnapshot,
  getDateBefore,
  getCleanupCutoff,
  cleanOldSnapshots,
} from "./snapshot.js";
import { detectAnomalies } from "./comparator.js";
import {
  resolveAnomalies,
  buildFeishuMessage,
  sendFeishuMessage,
} from "./reporter.js";
import { MARKET_CODES, COMPARISON_WINDOWS } from "./config.js";
import type { DailySnapshot } from "./types.js";

/** 获取今日日期（YYYY-MM-DD） */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 主流程 */
async function main(): Promise<void> {
  const date = today();
  console.log(`\n======== App 排名异动监控 | ${date} ========\n`);

  // ── 步骤1：拉取所有地区榜单（top-charts → app_ids） ──
  console.log("[步骤1] 拉取榜单（sensortower top-charts）...");
  const markets: DailySnapshot["markets"] = {};
  let fetchSuccess = 0;
  let fetchFail = 0;

  for (const country of MARKET_CODES) {
    try {
      console.log(`  拉取 ${country}...`);
      const appIds = await fetchMarketRankings(country, date);
      markets[country] = buildMarketSnapshot(appIds);
      fetchSuccess++;
      console.log(`  ✓ ${country}: ${appIds.length} 个 App`);
    } catch (err) {
      fetchFail++;
      console.error(`  ✗ ${country} 拉取失败: ${(err as Error).message}`);
    }
  }

  console.log(`\n榜单拉取完成: ${fetchSuccess} 成功, ${fetchFail} 失败`);

  if (fetchSuccess === 0) {
    console.error("所有地区拉取失败，终止");
    return;
  }

  // ── 步骤2：保存当日快照 ──
  console.log("\n[步骤2] 保存快照...");
  const snapshot: DailySnapshot = { date, markets };
  saveSnapshot(snapshot);

  // ── 步骤3：加载历史快照 ──
  console.log("\n[步骤3] 加载历史快照...");
  const historySnapshots = new Map<number, DailySnapshot | null>();

  for (const { days, label } of COMPARISON_WINDOWS) {
    const historyDate = getDateBefore(days, date);
    const snap = loadSnapshot(historyDate);
    historySnapshots.set(days, snap);
    console.log(`  ${label} (${historyDate}): ${snap ? "✓" : "✗ 缺失"}`);
  }

  // ── 步骤4：对比并检测异动 ──
  console.log("\n[步骤4] 检测异动...");
  const rawAnomalies = detectAnomalies(snapshot, historySnapshots);
  console.log(`  发现 ${rawAnomalies.length} 个异动 App`);

  // ── 步骤5：拉取元数据 + 组装消息 + 推送 ──
  console.log("\n[步骤5] 拉取元数据并推送飞书...");
  if (rawAnomalies.length > 0) {
    const anomalies = await resolveAnomalies(rawAnomalies);
    const message = buildFeishuMessage(anomalies, date);
    console.log(message);
    await sendFeishuMessage(message);
  } else {
    console.log("  无异动，静默退出");
  }

  // ── 步骤6：清理过期快照 ──
  console.log("\n[步骤6] 清理过期快照...");
  const cutoff = getCleanupCutoff();
  const deleted = cleanOldSnapshots(cutoff);
  console.log(`  清理了 ${deleted} 个旧快照（早于 ${cutoff}）`);

  console.log(`\n======== 完成 ========\n`);
}

main().catch((err) => {
  console.error("\n❌ 执行失败:", err);
  process.exit(1);
});
