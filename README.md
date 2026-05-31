# Lplay

**简体中文** | [English](docs/README.en-US.md)

Lplay 是一个 Windows 桌面端多路视频播放器，基于 Electron、React、TypeScript、Vite、FFmpeg 和 WebTorrent 构建。它适合同时查看多个本地视频、标记高光片段、管理视频评分与标签，也支持 M3U8 转 MP4 和磁力链接下载。

## 截图

### 多视频分屏播放

![Lplay 多视频分屏播放](docs/images/lplay-overview.svg)

### 磁力链接下载

![Lplay 磁力链接下载](docs/images/lplay-magnet-download.svg)

### 高光、评分与标签

![Lplay 高光评分标签](docs/images/lplay-highlights-tags.svg)

## 功能特性

- 多个本地视频同时播放，导入多个文件后自动分屏。
- 支持拖拽导入视频文件。
- 支持 MP4、MOV、WebM、AVI、MKV、WMV、FLV 等常见格式。
- 对 Electron/Chromium 无法直接播放的编码，自动转码为兼容的 H.264/AAC MP4 缓存。
- 支持为视频标记高光时间段，并添加注释。
- 支持播放历史记录，保存文件路径、上次播放进度和最后播放时间。
- 支持为视频添加评分和标签，并在右侧侧栏按评分排序或按标签过滤。
- 支持远程或本地 `.m3u8` 下载，并转存为 `.mp4`。
- 支持通过磁力链接下载文件，可预设默认下载文件夹。
- 磁力下载记录支持手动重试和删除，取消后的任务不会自动消失。
- 打包后的 Windows 版本内置 FFmpeg/FFprobe。

## 快速使用

下载并运行便携版：

```text
release/Lplay-0.2.0-portable.exe
```

首次运行如果 Windows SmartScreen 提示安全警告，可以选择“更多信息 -> 仍要运行”。这是因为当前应用没有代码签名证书。

## 使用方法

### 导入和播放视频

1. 点击顶部“添加视频”，或把视频文件直接拖入窗口。
2. 一次选择多个视频时，Lplay 会自动分屏显示。
3. 如果视频编码无法直接播放，Lplay 会使用 FFmpeg 转码为兼容 MP4 缓存后播放。

### 高光片段

1. 选中一个视频。
2. 在右侧“高光”面板设置入点和出点。
3. 添加注释后保存，高光片段会显示在视频底部时间轴上。

### 评分和标签

1. 在视频卡片顶部点击星星设置评分。
2. 在标签输入框中输入标签，例如 `review, scene`。
3. 在右侧“筛选与排序”面板中按评分排序，或点击标签过滤当前视频列表。

### M3U8 转 MP4

1. 在“M3U8 转 MP4”面板中填写远程 M3U8 地址，或选择本地 `.m3u8` 文件。
2. 选择输出 `.mp4` 路径。
3. 点击“转存”，完成后可直接加入播放器。

### 磁力链接下载

1. 在“磁力下载”面板粘贴 `magnet:?xt=urn:btih:...` 链接。
2. 点击文件夹按钮预设默认下载文件夹。
3. 点击“下载”开始任务。
4. 任务取消、失败或完成后会保留记录，可以手动“重试”或“删除记录”。

如果没有预设文件夹，Lplay 默认保存到系统下载目录下的 `Lplay` 文件夹。

## 开发环境

推荐环境：

- Windows 10/11
- Node.js 20+
- npm
- FFmpeg/FFprobe 可选，开发时如果系统 PATH 中存在会优先使用

安装依赖：

```bash
npm install
```

启动开发模式：

```bash
npm run dev
```

开发启动器默认从 `http://127.0.0.1:5173` 开始寻找可用端口。如果端口被占用，会自动尝试后续端口，并把正确地址传给 Electron。

也可以手动指定起始端口：

```powershell
$env:LPLAY_PORT=5180
npm run dev
```

## 构建与打包

构建前端：

```bash
npm run build
```

生成 Windows 便携版：

```bash
npm run dist
```

生成 Windows 安装包：

```bash
npm run dist:installer
```

打包产物位于：

```text
release/
```

当前版本的便携版文件名：

```text
release/Lplay-0.2.0-portable.exe
```

## FFmpeg 打包说明

打包后的应用会优先读取：

```text
resources/bin/ffmpeg.exe
resources/bin/ffprobe.exe
```

开发仓库中对应路径是：

```text
build-resources/bin/ffmpeg.exe
build-resources/bin/ffprobe.exe
```

这两个二进制文件较大。如果要长期维护公开仓库，建议使用 Git LFS 管理，或不提交二进制文件，只在 GitHub Release 中发布已打包的 exe。

## 常见问题

### 打包后打开是黑屏

确认 `vite.config.ts` 中包含：

```ts
base: "./"
```

打包后的应用通过 `file://` 加载 `dist/index.html`，需要使用相对资源路径。

### 拖拽没有反应

不要从“管理员权限”的终端启动 Lplay。Windows 不允许普通资源管理器把文件拖入高权限应用窗口。

### MP4 导入后黑屏或无法播放

MP4 只是封装格式，内部编码可能是 HEVC/H.265、10-bit H.264、AC3 等 Electron 无法直接播放的编码。Lplay 会用 FFmpeg 自动转码为 H.264/AAC MP4 缓存后播放。

### 磁力下载速度为 0

磁力下载依赖可用的 peer、tracker、DHT 和当前网络环境。请确认链接有效，网络允许 P2P 连接，并给任务一些时间解析元数据。

## 项目结构

```text
electron/              Electron 主进程与 preload
src/                   React 渲染层
scripts/dev.cjs        开发启动器
build-resources/bin/   打包时内置的 FFmpeg/FFprobe
docs/images/           README 截图资源
dist/                  Vite 生产构建输出
release/               electron-builder 打包输出
```

## 主要命令

```bash
npm run dev             # 启动开发模式
npm run build           # 构建前端
npm run dist            # 打包 Windows 便携版 exe
npm run dist:installer  # 打包 Windows 安装包
```
