# dsh-update-check-plus

> GitHub: https://github.com/lhh666-6/dsh-update-check
>
> npm: `dsh-update-check-plus`

DeepSeek Harness 更新检查插件：检查 **DSH Desktop 桌面端更新**（dshdesktop.cn 官方安装包通道）与 **GitHub 源码更新**，在会话头部显示状态胶囊，支持一键下载安装包并自动重启完成更新。

## 双通道更新

### 1. 桌面端更新（真实安装包，一键自动更新）⭐
- **版本源**：`https://www.dshdesktop.cn/api/desktop/version`（返回 `{"version":"2.0.0"}`）
- **安装包**：`https://www.dshdesktop.cn/api/downloads/windows` → 302 跳转到 CDN（ModelScope/GitCode）的 NSIS 安装器
- **流程**：检测到新版 → 胶囊显示 `⬆ 新版本` → 点开面板 → **「下载并更新」** → 自动下载安装包（约 160MB，显示进度）→ 以官方同款参数启动安装器（`--updated --force-run`）→ 退出应用让安装器接管 → 安装完成自动重启
- 该通道对应的是 deepseek-harness-desktop 项目（dshdesktop.cn 分发），与你当前安装的桌面端同源

### 2. GitHub 源码更新
- 三级数据源级联：REST API（配额受限时自动降级）→ releases.atom → master 分支版本号兜底
- 可一键下载最新源码 zip（codeload）

## 当前版本检测（多级回退）
1. Host 侧 `@deepseek-ai/dsh` 包版本
2. 桌面端 exe 的 FileVersion（如 `0.1.0-rc.5`）
3. 可选：`deepseek-harness-desktop` 仓库 `upstream.json` 的 `sourceVersion`

## 行为
- 启动 5 秒后首次检查，之后按 `intervalHours`（默认 12h）轮询；失败 1 小时后自动重试
- 状态持久化：`~/.dsh/update-check-plus/state.json`

## 界面
- 会话头部状态胶囊：🟢 `✓ 0.1.0-rc.5` / 🟠 `⬆ 2.0.0`（桌面端）/ 🟠 `⬆ rc.7`（源码）/ ⏳ 下载进度
- 面板：桌面端更新区（版本对比 + 进度 + 更新按钮）＋ 源码更新区（更新日志 + 按钮）

## 设置（设置 → dsh-update-check-plus 分区）
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repo` | `deepseek-ai/deepseek-harness` | GitHub 源码仓库 |
| `intervalHours` | `12` | 检查间隔（小时） |
| `autoDownload` | `false` | 发现源码新版自动下载 zip |
| `downloadDir` | `~/.dsh/update-check-plus/downloads` | 下载目录（安装包与源码共用） |
| `desktopRepoPath` | `` | 可选：desktop 仓库路径（upstream.json 版本） |
| `enableDesktopUpdate` | `true` | 启用桌面端更新通道 |
| `desktopVersionEndpoint` | `https://www.dshdesktop.cn/api/desktop/version` | 版本服务 |
| `desktopDownloadEndpoint` | `https://www.dshdesktop.cn/api/downloads/windows` | 安装包下载 |

## 开发
```sh
pnpm install
pnpm run typecheck
pnpm run build        # -> lib/index.js (host) + lib/client.js (web)
node test-desktop-dl.mjs   # 真实下载链路测试（约160MB，跑完删除）
```

## 安装

```sh
# npm 安装（推荐，预构建）
dsh plugin --profile web add dsh-update-check-plus
dsh plugin --profile desktop add dsh-update-check-plus

# 或直接从 GitHub 安装
dsh plugin --profile web add github:lhh666-6/dsh-update-check
dsh plugin --profile desktop add github:lhh666-6/dsh-update-check
```

安装后重启 DSH（或切换一次 profile）生效。

## 局限与安全
- 「下载并更新」会把当前 DeepSeek Harness 升级到 dshdesktop.cn 分发的最新版（目前为 DSH Desktop 2.0.0，项目改名后的稳定版）；数据（会话/配置在 `~/.dsh`）不受影响
- 安装器由官方通道提供；插件不做任何二进制修改
