/**
 * 快照存储模块 — 读写 JSON 快照文件，清理过期数据
 *
 * 快照格式精简：仅存每个地区的 app_id 列表（排名由数组索引隐含）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { DailySnapshot, MarketSnapshot, SnapshotAppEntry } from "./types.js";
import { SNAPSHOT_DIR } from "./config.js";

/** 确保快照目录存在 */
function ensureDir(): string {
  const dir = path.resolve(SNAPSHOT_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** 生成快照文件路径 */
function snapshotPath(date: string): string {
  return path.join(ensureDir(), `${date}.json`);
}

/**
 * 根据 app_ids 列表构建 MarketSnapshot
 */
export function buildMarketSnapshot(appIds: number[]): MarketSnapshot {
  return {
    apps: appIds.map((app_id) => ({ app_id })),
  };
}

/**
 * 保存当日快照
 */
export function saveSnapshot(snapshot: DailySnapshot): void {
  const filePath = snapshotPath(snapshot.date);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`[snapshot] 已保存: ${filePath}`);
}

/**
 * 加载指定日期的快照
 * @returns 快照数据，不存在则返回 null
 */
export function loadSnapshot(date: string): DailySnapshot | null {
  const filePath = snapshotPath(date);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DailySnapshot;
  } catch (err) {
    console.warn(
      `[snapshot] 快照读取失败: ${filePath} — ${(err as Error).message}`
    );
    return null;
  }
}

/**
 * 获取指定天数前的日期字符串
 */
export function getDateBefore(days: number, fromDate?: string): string {
  const d = fromDate ? new Date(fromDate) : new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * 清理超过保留天数的旧快照
 */
export function cleanOldSnapshots(beforeDate: string): number {
  const dir = ensureDir();
  const files = fs.readdirSync(dir);
  let deleted = 0;

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const dateStr = file.replace(".json", "");
    if (dateStr < beforeDate) {
      fs.unlinkSync(path.join(dir, file));
      deleted++;
      console.log(`[snapshot] 清理过期快照: ${file}`);
    }
  }

  return deleted;
}

/**
 * 计算需要清理的截止日期
 */
export function getCleanupCutoff(): string {
  return getDateBefore(35); // SNAPSHOT_RETENTION_DAYS
}
