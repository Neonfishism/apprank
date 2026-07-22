/**
 * App 排名异动监控 — 主入口
 * 平台：iOS（16 国游戏下载榜）+ Roblox（在线人数榜）+ Steam（在线人数榜）+ 愿望单
 */

import { fetchMarketRankings } from "./fetcher.js";
import { fetchRobloxRankings } from "./fetcher-roblox.js";
import { fetchSteamRankings } from "./fetcher-steam.js";
import { fetchWishlistRankings } from "./fetcher-wishlist.js";
import { saveSnapshot, loadSnapshot, buildMarketSnapshot, getDateBefore, getCleanupCutoff, cleanOldSnapshots } from "./snapshot.js";
import { detectAnomalies, resolveAnomalies } from "./comparator.js";
import { buildFeishuMessage, buildIosCollapsibleCards, buildSteamFoldCard, buildWishlistFoldCard, sendFeishuMessage, sendCard } from "./reporter.js";
import { MARKET_CODES, ROBLOX_MARKET, STEAM_MARKET, WISHLIST_MARKET, SILENT_MARKETS, COMPARISON_WINDOWS, SNAPSHOT_DIR } from "./config.js";
import type { DailySnapshot, AppMeta } from "./types.js";
import { existsSync } from "fs";
import { join } from "path";

function today(): string { return new Date().toISOString().slice(0, 10); }

async function main(): Promise<void> {
  const date = today();

  // 非 GitHub Actions：当天已拉取过快照则跳过，避免测试重复推送刷屏
  if (!process.env.GITHUB_ACTIONS && existsSync(join(SNAPSHOT_DIR, `${date}.json`))) {
    console.log(`[跳过] 今日快照已存在，非 Actions 环境跳过重复推送。若需强制推送请删除 snapshots/${date}.json`);
    return;
  }

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

  // ── Steam ──
  console.log("[Steam] 拉取在线人数榜...");
  try {
    const apps = await fetchSteamRankings();
    markets[STEAM_MARKET] = buildMarketSnapshot(apps.map((a) => a.app_id));
    for (const a of apps) metaMap.set(a.app_id, a);
    ok++;
    console.log(`  ✓ Steam: ${apps.length} 款`);
  } catch (err) {
    fail++;
    console.error(`  ✗ Steam: ${(err as Error).message}`);
  }

  // ── 愿望单 ──
  console.log("[愿望单] 拉取 Steam 愿望单 Top 100...");
  try {
    const apps = await fetchWishlistRankings();
    markets[WISHLIST_MARKET] = buildMarketSnapshot(apps.map((a) => a.app_id));
    for (const a of apps) metaMap.set(a.app_id, a);
    ok++;
    console.log(`  ✓ 愿望单: ${apps.length} 款`);
  } catch (err) {
    fail++;
    console.error(`  ✗ 愿望单: ${(err as Error).message}`);
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
    const pushed = rawAnomalies.filter((a) => !SILENT_MARKETS.has(a.country));
    if (pushed.length < rawAnomalies.length) {
      console.log(`  过滤静默市场: ${rawAnomalies.length - pushed.length} 条不推送`);
    }

    // iOS：折叠卡片消息（每个国家一个折叠面板）
    const iosPushed = pushed.filter((a) => a.country !== STEAM_MARKET && a.country !== WISHLIST_MARKET);
    if (iosPushed.length > 0) {
      try {
        const iosAnomalies = resolveAnomalies(iosPushed, metaMap);
        const cards = buildIosCollapsibleCards(iosAnomalies, date);
        console.log(`\n── iOS 消息 (${iosPushed.length} 条, ${cards.length} 张卡片) ──`);
        for (let i = 0; i < cards.length; i++) {
          console.log(`\n  [卡片 ${i+1}/${cards.length}, ${cards[i].elements.length} 个元素]`);
          console.log(JSON.stringify(cards[i], null, 2));
          await sendCard(cards[i].title, cards[i].elements);
        }
      } catch (err) {
        console.error(`[reporter] iOS 飞书推送失败（快照已保存）: ${(err as Error).message}`);
      }
    }

    // Steam：折叠卡片
    const stPushed = pushed.filter((a) => a.country === STEAM_MARKET);
    if (stPushed.length > 0) {
      try {
        const stAnomalies = resolveAnomalies(stPushed, metaMap);
        const stCard = buildSteamFoldCard(stAnomalies, date);
        if (stCard) {
          console.log(`\n── Steam 消息 (${stPushed.length} 条) ──`);
          console.log(JSON.stringify(stCard, null, 2));
          await sendCard(stCard.title, stCard.elements);
        }
      } catch (err) {
        console.error(`[reporter] Steam 飞书推送失败（快照已保存）: ${(err as Error).message}`);
      }
    }

    // 愿望单：折叠卡片
    const wlPushed = pushed.filter((a) => a.country === WISHLIST_MARKET);
    if (wlPushed.length > 0) {
      try {
        const wlAnomalies = resolveAnomalies(wlPushed, metaMap);
        const wlCard = buildWishlistFoldCard(wlAnomalies, date);
        if (wlCard) {
          console.log(`\n── 愿望单消息 (${wlPushed.length} 条) ──`);
          console.log(JSON.stringify(wlCard, null, 2));
          await sendCard(wlCard.title, wlCard.elements);
        }
      } catch (err) {
        console.error(`[reporter] 愿望单飞书推送失败（快照已保存）: ${(err as Error).message}`);
      }
    }
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
  // 本地运行直接退出，GitHub Actions 由 workflow 控制
  if (!process.env.GITHUB_ACTIONS) process.exit(0);
});
