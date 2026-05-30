# Lplay

Lplay is a desktop multi-video player built with Electron, React, TypeScript, Vite, and FFmpeg.

Lplay 是一个桌面端多路视频播放器，基于 Electron、React、TypeScript、Vite 和 FFmpeg 构建。

## 中文说明

### 功能特性

- 同时播放多个本地视频，导入多个文件后自动分屏。
- 支持拖拽导入视频文件。
- 支持 MP4、MOV、WebM、AVI、MKV、WMV、FLV 等常见格式。
- 对 Electron/Chromium 无法直接播放的编码，自动转码为兼容的 H.264/AAC MP4 缓存。
- 支持为每个视频标记高光时间段，并添加注释。
- 支持播放历史记录，保存文件路径、上次播放进度和最后播放时间。
- 右侧侧边栏可隐藏，适合专注观看多路视频。
- 支持远程或本地 `.m3u8` 文件下载，并转存为 `.mp4`。
- 打包后的 Windows 版本内置 FFmpeg/FFprobe，不需要用户额外安装。

### 直接使用

如果你只想使用应用，请下载或运行打包后的便携版：

```text
release/Lplay-0.1.0-portable.exe
```

双击即可运行。首次运行如果 Windows SmartScreen 提示安全警告，可选择“更多信息 -> 仍要运行”。这是因为当前应用没有代码签名证书。

### 开发环境

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

### 构建前端

```bash
npm run build
```

该命令会进行 TypeScript 检查并生成 Vite 生产构建到 `dist/`。

### 打包 Windows 可执行文件

本项目使用 `electron-builder` 打包。

生成便携版 exe：

```bash
npm run dist
```

生成安装包：

```bash
npm run dist:installer
```

产物位置：

```text
release/
```

便携版文件名：

```text
release/Lplay-0.1.0-portable.exe
```

安装包文件名：

```text
release/Lplay-0.1.0-setup.exe
```

### FFmpeg 打包说明

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

如果你克隆仓库后发现这两个文件不存在，需要自行放入 Windows 版 `ffmpeg.exe` 和 `ffprobe.exe`，否则打包后的转码、M3U8 转 MP4 功能不可用。

这两个文件较大。如果要上传到 GitHub，建议使用 Git LFS 管理，或不要提交二进制文件，只在 Release 中提供已打包的 exe。

### 常见问题

#### 打包后打开是黑屏

请确认 `vite.config.ts` 中包含：

```ts
base: "./"
```

否则打包后通过 `file://` 打开页面时，JS/CSS 资源路径可能加载失败。

#### 拖拽没有任何反应

请确认不是从“管理员权限”的终端启动 Lplay。Windows 不允许普通资源管理器把文件拖入高权限应用窗口。

正确方式是使用普通 PowerShell/CMD 运行：

```bash
npm run dev
```

#### MP4 导入后黑屏或无法播放

MP4 只是封装格式，内部编码可能是 HEVC/H.265、10-bit H.264、AC3 等 Electron 无法直接播放的编码。Lplay 会用 FFmpeg 自动转码为 H.264/AAC MP4 缓存后播放。

#### Electron 或打包依赖下载失败

项目脚本已经为打包配置了国内镜像。如果 `npm install` 阶段 Electron 下载失败，可在 PowerShell 中设置：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

### 项目结构

```text
electron/              Electron 主进程与 preload
src/                   React 渲染层
scripts/dev.cjs        开发启动器
build-resources/bin/   打包时内置的 FFmpeg/FFprobe
dist/                  Vite 生产构建输出
release/               electron-builder 打包输出
```

### 主要命令

```bash
npm run dev             # 启动开发模式
npm run build           # 构建前端
npm run dist            # 打包 Windows 便携版 exe
npm run dist:installer  # 打包 Windows 安装包
```

## English

### Features

- Play multiple local videos at the same time with automatic split-screen layout.
- Drag and drop video files into the player.
- Supports common formats such as MP4, MOV, WebM, AVI, MKV, WMV, and FLV.
- Automatically transcodes videos that Chromium cannot decode into H.264/AAC MP4 cache files.
- Add highlight/bookmark time ranges with notes for each video.
- Save playback history, including file path, last position, duration, and last played time.
- Collapsible right sidebar for a cleaner viewing layout.
- Download local or remote `.m3u8` playlists and remux them to `.mp4`.
- Windows packaged builds include FFmpeg/FFprobe.

### Use the Packaged App

Run the portable executable:

```text
release/Lplay-0.1.0-portable.exe
```

If Windows SmartScreen shows a warning, choose "More info" and then "Run anyway". This happens because the app is not code-signed.

### Development

Recommended environment:

- Windows 10/11
- Node.js 20+
- npm
- FFmpeg/FFprobe optional during development

Install dependencies:

```bash
npm install
```

Start the development app:

```bash
npm run dev
```

The development launcher starts Vite from `http://127.0.0.1:5173`. If the port is already in use, it automatically tries the next available port and passes the correct URL to Electron.

Specify a custom starting port:

```powershell
$env:LPLAY_PORT=5180
npm run dev
```

### Build

```bash
npm run build
```

This runs TypeScript checks and builds the renderer into `dist/`.

### Package for Windows

Build a portable executable:

```bash
npm run dist
```

Build an installer:

```bash
npm run dist:installer
```

Output directory:

```text
release/
```

Portable executable:

```text
release/Lplay-0.1.0-portable.exe
```

Installer:

```text
release/Lplay-0.1.0-setup.exe
```

### FFmpeg Bundling

Packaged builds look for FFmpeg binaries at:

```text
resources/bin/ffmpeg.exe
resources/bin/ffprobe.exe
```

In the repository, place them here before packaging:

```text
build-resources/bin/ffmpeg.exe
build-resources/bin/ffprobe.exe
```

These binaries are large. For GitHub, consider using Git LFS or excluding them from the repository and publishing packaged executables through GitHub Releases.

### Troubleshooting

#### Packaged app opens to a black screen

Make sure Vite uses relative asset paths:

```ts
base: "./"
```

This is required because the packaged app loads `dist/index.html` through `file://`.

#### Drag and drop does not work

Do not start Lplay from an administrator terminal. Windows blocks drag-and-drop from normal File Explorer windows into elevated apps.

#### Imported MP4 is black or cannot play

MP4 is a container. The video codec may still be unsupported by Chromium, such as HEVC/H.265, 10-bit H.264, or AC3 audio. Lplay automatically transcodes unsupported files into H.264/AAC MP4 cache files.

### Project Layout

```text
electron/              Electron main process and preload bridge
src/                   React renderer
scripts/dev.cjs        Development launcher
build-resources/bin/   Bundled FFmpeg/FFprobe binaries for packaging
dist/                  Vite production build
release/               electron-builder output
```

### Scripts

```bash
npm run dev             # Start development app
npm run build           # Build renderer
npm run dist            # Build Windows portable executable
npm run dist:installer  # Build Windows installer
```
