/**
 * 榜单拉取模块 — 通过 sensortower CLI 二进制拉取数据
 *
 * 环境变量：
 *   PIE_TOKEN      — PieBox 认证 Token
 *   PIE_BASE_URL   — PieBox Gateway 地址
 *   ST_BINARY_PATH — CLI 二进制路径（可选，默认自动查找）
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { TopChartsResponse, AppInfo } from "./types.js";
import { TOP_N, MAX_RETRIES } from "./config.js";

const execFileAsync = promisify(execFile);

/** 查找 sensortower 二进制路径 */
function getBinaryPath(): string {
  // 优先使用环境变量
  if (process.env.ST_BINARY_PATH) {
    return process.env.ST_BINARY_PATH;
  }

  // 在 PieBox skills 目录下查找
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const skillsDir = path.resolve(__dirname, "../../.config/piebox/skills/sensortower-cli");

  if (fs.existsSync(path.join(skillsDir, "sensortower"))) {
    return path.join(skillsDir, "sensortower");
  }

  // 尝试 PATH 中的 sensortower
  return "sensortower";
}

/** 确保环境变量就绪 */
function getEnv(): NodeJS.ProcessEnv {
  const token = process.env.PIE_TOKEN;
  const baseUrl = process.env.PIE_BASE_URL;

  if (!token) throw new Error("缺少环境变量 PIE_TOKEN");
  if (!baseUrl) throw new Error("缺少环境变量 PIE_BASE_URL");

  return {
    ...process.env,
    PIE_TOKEN: token,
    PIE_BASE_URL: baseUrl,
  };
}

/**
 * 调用 sensortower CLI
 */
async function runCLI(args: string[]): Promise<string> {
  const binary = getBinaryPath();
  const env = getEnv();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { stdout, stderr } = await execFileAsync(binary, args, {
        env,
        maxBuffer: 50 * 1024 * 1024, // 50MB
        timeout: 60_000,
      });

      if (stderr) {
        console.warn(`[fetcher] CLI stderr: ${stderr.slice(0, 200)}`);
      }

      return stdout;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException & { stderr?: string };
      if (error.code === "ENOENT") {
        throw new Error(
          `sensortower CLI 二进制未找到: ${binary}\n` +
          `提示: 该工具仅在 Linux 环境中可用。请使用 PieBox Cloud 部署或在 WSL/GitHub Actions 中运行。`
        );
      }

      if (attempt === MAX_RETRIES) {
        const stderrMsg = error.stderr?.slice(0, 300) || error.message;
        throw new Error(`CLI 调用失败 (已重试${MAX_RETRIES}次): ${stderrMsg}`);
      }

      console.warn(
        `[fetcher] CLI 调用失败 (第${attempt}次重试): ${(error as Error).message.slice(0, 200)}`
      );
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  throw new Error("unreachable");
}

/**
 * 拉取单个地区的 Top N 下载榜（返回 app_ids 列表）
 */
export async function fetchMarketRankings(
  country: string,
  date: string
): Promise<number[]> {
  const args = [
    "top-charts",
    "--os", "ios",
    "--country", country,
    "--category", "0", // 全部
    "--date", date,
    "--limit", String(TOP_N),
    "--chart-type", "topfreeapplications",
    "--json",
  ];

  const stdout = await runCLI(args);
  const response: TopChartsResponse = JSON.parse(stdout);

  if (!response.ranking || !Array.isArray(response.ranking)) {
    throw new Error(`top-charts 返回格式异常: ${stdout.slice(0, 200)}`);
  }

  return response.ranking.slice(0, TOP_N);
}

/**
 * 批量获取 App 详情（名称、发行商、分类等）
 */
export async function fetchAppInfoBatch(
  appIds: number[]
): Promise<Map<number, AppInfo>> {
  const result = new Map<number, AppInfo>();

  if (appIds.length === 0) return result;

  // app-info 支持批量查询
  const args = [
    "app-info",
    "--app-ids", appIds.join(","),
    "--json",
  ];

  const stdout = await runCLI(args);

  try {
    const data = JSON.parse(stdout);

    // 响应格式：可能是数组或对象映射
    const items: AppInfo[] = Array.isArray(data) ? data : Object.values(data);

    for (const item of items) {
      if (item.app_id) {
        result.set(item.app_id, item);
      }
    }
  } catch {
    console.warn("[fetcher] app-info 解析失败，返回空结果");
  }

  return result;
}
