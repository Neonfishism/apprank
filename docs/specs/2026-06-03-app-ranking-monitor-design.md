# App 下载榜排名异动监控工具 — 设计文档

> 创建日期：2026-06-03 · 状态：待开发

## 一、项目概述

一个定时运行的自动化脚本，每日拉取 iOS App Store 各核心市场的下载榜 Top 200，与多个历史时间窗口对比，发现排名飙升的 App 后通过飞书推送告警。

---

## 二、监控范围

### 地区（11 个）
| 代码 | 地区 |
|------|------|
| CN | 中国大陆 |
| TW | 台湾 |
| JP | 日本 |
| KR | 韩国 |
| SA | 沙特阿拉伯 |
| TR | 土耳其 |
| RU | 俄罗斯 |
| DE | 德国 |
| FR | 法国 |
| IT | 意大利 |
| US | 美国 |

### 榜单
- 仅 iOS App Store 下载榜（free download rankings）
- 深度：每个地区 Top 200

### 对比窗口
- vs 3 日前
- vs 7 日前（上周同天）
- vs 14 日前（双周前）
- vs 30 日前（上月同天）

---

## 三、触发规则

### 分级阈值（上升多少名触发告警）

| 当前排名区间 | 触发阈值（≥ N 名） |
|-------------|-------------------|
| 1 – 10 | 3 |
| 11 – 50 | 10 |
| 51 – 100 | 20 |
| 101 – 200 | 30 |

### 触发逻辑
- 任一对比窗口排名上升量 ≥ 对应区间阈值 → 触发
- 一个 App 可能在多个窗口同时触发，消息中全部展示
- 仅监控**排名上升**，下降不告警

---

## 四、飞书消息格式

### 示例
```
📊 App 下载榜异动警报 | 2026-06-03

🇺🇸 美国 · 游戏
  🚀 蛋仔派对  第 12 名 ↑32  🔗 https://apps.apple.com/us/app/idXXXXXXXXX
     3日前(23)↑11  |  7日前(44)↑32🔥  |  14日前(67)↑55🔥  |  30日前(89)↑77🔥

🇯🇵 日本 · 社交
  🚀 BeReal  第 8 名 ↑5  🔗 https://apps.apple.com/jp/app/idXXXXXXXXX
     3日前(7)↑2  |  7日前(13)↑5🔥  |  14日前(18)↑10🔥  |  30日前(—)—

🇩🇪 德国 · 工具
  ⬆️ Cleaner Pro  第 78 名 ↑45  🔗 https://apps.apple.com/de/app/idXXXXXXXXX
     3日前(—)—  |  7日前(123)↑45🔥  |  14日前(—)—  |  30日前(—)—
```

### 规则
- 按国家+品类分组，升序排列
- 🚀 = 进入 Top 10，⬆️ = 其他
- 每个窗口展示：`N日前(历史排名)↑变化量`，触发阈值的窗口加 🔥 标记
- 缺失历史数据的窗口显示 `—`
- 附 App Store 链接（根据地区拼接 `https://apps.apple.com/{country}/app/id{app_id}`）
- 无异动时静默，不推送

---

## 五、技术架构

### 技术选型
| 层 | 选型 | 理由 |
|----|------|------|
| 运行时 | Node.js + TypeScript | 与项目生态一致 |
| 数据源 | sensortower CLI 二进制（`top-charts` + `app-info`） | 通过 child_process 调用，Latency 优化后批量拉取 |
| 存储 | 本地 JSON 文件（`snapshots/`），仅存 app_id | 精简，零运维 |
| 推送 | 飞书消息 | Webhook POST |
| 调度 | 定时任务（GitHub Actions / PieBox Cloud cron） | 免费，无需服务器 |

> ⚠️ **平台限制**：sensortower CLI 二进制为 Linux ELF，**仅在 Linux 环境可用**（PieBox Cloud 部署、WSL、GitHub Actions）。本地 Windows 开发无法直接运行，建议通过 `pnpm run build` 验证类型后部署到 PieBox Cloud 测试。

### 数据流（优化后）
```
定时触发
  │
  ▼
sensortower top-charts × 11 地区 → app_ids 排名列表
  │
  ▼
写入当日快照 snapshots/YYYY-MM-DD.json（仅存 app_ids）
  │
  ▼
加载 3日/7日/14日/30日前快照
  │
  ▼
逐个 App 对比排名变化 → 匹配分级阈值
  │
  ▼
有异动 → sensortower app-info 批量拉取异动 App 的元数据
  │                ↓
  │        组装飞书消息 → 推送
  │
无异动 → 静默退出
  │
  ▼
清理 35 天前的旧快照
```

> 优化点：快照仅存 app_ids，元数据只在异动时拉取（从 2200 次 app-info 调用降到仅异动 App 的批量调用）。

### 目录结构
```
project/
├── src/
│   ├── index.ts          # 入口：编排流程
│   ├── fetcher.ts        # sensortower CLI 调用（top-charts + app-info）
│   ├── snapshot.ts       # 快照读写、清理
│   ├── comparator.ts     # 排名对比 + 阈值匹配
│   ├── reporter.ts       # 元数据拉取 + 飞书消息组装推送
│   ├── config.ts         # 地区列表、阈值配置
│   └── types.ts          # 类型定义
├── snapshots/            # 历史快照目录（.gitignore）
├── docs/specs/           # 设计文档
└── package.json
```

### 快照文件结构（精简）
```json
{
  "date": "2026-06-03",
  "markets": {
    "US": {
      "apps": [
        { "app_id": 284882215 },
        { "app_id": 835599320 }
      ]
    }
  }
}
```
排名由数组索引隐含（索引 0 = 第 1 名）。

---

## 六、错误处理

| 场景 | 处理方式 |
|------|---------|
| Sensor Tower API 请求失败 | 重试 3 次，仍失败则跳过当天，记录错误日志 |
| 历史快照不存在（如 30 天前的窗口） | 该窗口显示 `—`，不影响其他窗口对比 |
| 部分地区 API 失败 | 有数据的地区正常对比推送，失败地区跳过 |
| 快照数据格式异常 | 校验 schema，异常快照跳过不参与对比 |
| 飞书推送失败 | 重试 3 次，失败则输出到本地日志文件 |

---

## 七、部署与运行

### 环境变量（必需）
| 变量 | 说明 | 来源 |
|------|------|------|
| `PIE_TOKEN` | PieBox 认证 JWT | PieBox Cloud 自动注入 / 本地 `.env.local` |
| `PIE_BASE_URL` | PieBox Gateway 地址 | PieBox Cloud 自动注入 / 本地 `.env.local` |
| `FEISHU_WEBHOOK_URL` | 飞书机器人 Webhook | 需手动配置 |
| `ST_BINARY_PATH` | sensortower CLI 路径（可选） | 默认自动查找 |

### 运行方式
```bash
# 本地开发（仅类型检查）
pnpm run build

# PieBox Cloud 定时任务 或 GitHub Actions
pnpm start
```

### 调度建议
- **PieBox Cloud**：配置 cron 每日执行 `pnpm start`
- **GitHub Actions**：`schedule: cron('0 8 * * *')` 每日 UTC 8:00 执行

---

## 八、非目标（明确排除）

- ❌ 不设 Dashboard 或 Web 界面
- ❌ 不使用数据库
- ❌ 不监控 Google Play
- ❌ 不推送排名下降告警
- ❌ 不提供 App 白名单/黑名单过滤
