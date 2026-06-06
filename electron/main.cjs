const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const DIRECT_PLAYABLE_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".ogv", ".ogg"]);
const DIRECT_MP4_EXTENSIONS = new Set([".mp4", ".m4v", ".mov"]);
const DIRECT_WEBM_EXTENSIONS = new Set([".webm", ".ogv", ".ogg"]);
const CHROMIUM_MP4_VIDEO_CODECS = new Set(["h264"]);
const CHROMIUM_MP4_AUDIO_CODECS = new Set(["aac", "mp3"]);
const CHROMIUM_WEBM_VIDEO_CODECS = new Set(["vp8", "vp9", "av1"]);
const CHROMIUM_WEBM_AUDIO_CODECS = new Set(["opus", "vorbis"]);
const KNOWN_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".ogv",
  ".ogg",
  ".avi",
  ".mkv",
  ".wmv",
  ".flv",
  ".mpg",
  ".mpeg",
  ".ts",
  ".mts",
  ".m2ts",
  ".3gp",
  ".vob",
  ".m3u8"
]);
const FOLDER_IMPORT_LIMIT = 5000;

const runningM3u8Jobs = new Map();
const runningMagnetJobs = new Map();
const dropImports = new Map();
const mediaFiles = new Map();
let webTorrentConstructorPromise;
let magnetClientPromise;
let mediaServerPort = 0;
let mediaServer;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function resolveBinaryPath(name) {
  const executableName = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [
    path.join(process.resourcesPath || "", "bin", executableName),
    path.join(__dirname, "..", "build-resources", "bin", executableName),
    executableName
  ];

  return candidates.find((candidate) => candidate === executableName || fileExists(candidate)) || executableName;
}

function resolveAppIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(__dirname, "..", "build-resources", "icon.ico")
  ];

  return candidates.find((candidate) => fileExists(candidate));
}

function mediaContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
    case ".m4v":
    case ".mov":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogv":
    case ".ogg":
      return "video/ogg";
    default:
      return "application/octet-stream";
  }
}

function streamMediaFile(request, response, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }

    const contentType = mediaContentType(filePath);
    const range = request.headers.range;
    const commonHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Type": contentType
    };

    if (!range) {
      response.writeHead(200, {
        ...commonHeaders,
        "Content-Length": stat.size
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      fs.createReadStream(filePath).pipe(response);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, {
        ...commonHeaders,
        "Content-Range": `bytes */${stat.size}`
      });
      response.end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      response.writeHead(416, {
        ...commonHeaders,
        "Content-Range": `bytes */${stat.size}`
      });
      response.end();
      return;
    }

    response.writeHead(206, {
      ...commonHeaders,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(filePath, { start, end }).pipe(response);
  });
}

function startMediaServer() {
  return new Promise((resolve, reject) => {
    mediaServer = http.createServer((request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Range");

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }

      let requestUrl;
      try {
        requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }

      const segments = requestUrl.pathname.split("/").filter(Boolean);
      if (segments[0] !== "media" || !segments[1]) {
        response.writeHead(404);
        response.end();
        return;
      }

      const filePath = mediaFiles.get(segments[1]);
      if (!filePath) {
        response.writeHead(404);
        response.end();
        return;
      }

      streamMediaFile(request, response, filePath);
    });

    mediaServer.once("error", reject);
    mediaServer.listen(0, "127.0.0.1", () => {
      mediaServerPort = mediaServer.address().port;
      resolve();
    });
  });
}

function playbackUrlFor(filePath) {
  const token = crypto.randomUUID();
  mediaFiles.set(token, filePath);
  return `http://127.0.0.1:${mediaServerPort}/media/${token}/${encodeURIComponent(path.basename(filePath))}`;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#11100f",
    title: "Lplay",
    icon: resolveAppIconPath(),
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#161411",
      symbolColor: "#e9ded0",
      height: 48
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await startMediaServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (mediaServer) {
    mediaServer.close();
  }
  void destroyMagnetClient();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function sendToRenderer(sender, channel, payload) {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload);
  }
}

function safeBaseName(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .slice(0, 72);
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function pathKey(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function stripM3u8QueryAndHash(uri) {
  return String(uri || "").trim().split(/[?#]/)[0].trim();
}

function resolveLocalPlaylistUri(playlistPath, uri) {
  const cleanUri = stripM3u8QueryAndHash(uri).replace(/^["']|["']$/g, "");
  if (!cleanUri || cleanUri.startsWith("//")) {
    return "";
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(cleanUri) && !/^[a-zA-Z]:[\\/]/.test(cleanUri)) {
    return "";
  }

  let decodedUri = cleanUri;
  try {
    decodedUri = decodeURIComponent(cleanUri);
  } catch {
    // Keep the original URI when it contains literal percent characters.
  }

  return path.resolve(path.dirname(playlistPath), decodedUri);
}

function parseM3u8LocalReferences(playlistPath, contents) {
  const references = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("#")) {
      for (const match of line.matchAll(/\bURI=(?:"([^"]+)"|([^,\s]+))/gi)) {
        const resolved = resolveLocalPlaylistUri(playlistPath, match[1] || match[2]);
        if (resolved) {
          references.push(resolved);
        }
      }
      continue;
    }

    const resolved = resolveLocalPlaylistUri(playlistPath, line);
    if (resolved) {
      references.push(resolved);
    }
  }

  return references;
}

async function collectM3u8SegmentPaths(rootDir) {
  const segmentPaths = new Set();
  const playlists = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".m3u8") {
        playlists.push(entryPath);
      }
    }
  }

  for (const playlistPath of playlists) {
    try {
      const contents = await fs.promises.readFile(playlistPath, "utf8");
      for (const referencedPath of parseM3u8LocalReferences(playlistPath, contents)) {
        segmentPaths.add(pathKey(referencedPath));
      }
    } catch {
      // Broken playlists should not block folder import.
    }
  }

  return segmentPaths;
}

async function collectVideoFiles(rootDir, limit = FOLDER_IMPORT_LIMIT) {
  const playlistSegmentPaths = await collectM3u8SegmentPaths(rootDir);
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0 && results.length < limit) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (
        entry.isFile() &&
        KNOWN_VIDEO_EXTENSIONS.has(extension) &&
        (extension === ".m3u8" || !playlistSegmentPaths.has(pathKey(entryPath)))
      ) {
        results.push(entryPath);
        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function safeImportedFileName(fileName) {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const baseName = safeBaseName(fileName) || "dropped-video";
  return `${baseName}${extension}`;
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveSettings(patch) {
  const next = {
    ...loadSettings(),
    ...patch
  };
  await fs.promises.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.promises.writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function defaultMagnetDownloadDir() {
  return path.join(app.getPath("downloads"), "Lplay");
}

function defaultConversionCacheDir() {
  return path.join(app.getPath("userData"), "converted");
}

function getConversionCacheDir() {
  const settings = loadSettings();
  return settings.conversionCacheDir || defaultConversionCacheDir();
}

async function setConversionCacheDir(cacheDir) {
  const resolved = path.resolve(String(cacheDir || "").trim() || defaultConversionCacheDir());
  await fs.promises.mkdir(resolved, { recursive: true });
  await saveSettings({ conversionCacheDir: resolved });
  return resolved;
}

function getMagnetDownloadDir() {
  const settings = loadSettings();
  return settings.magnetDownloadDir || defaultMagnetDownloadDir();
}

async function setMagnetDownloadDir(downloadDir) {
  const resolved = path.resolve(String(downloadDir || "").trim() || defaultMagnetDownloadDir());
  await fs.promises.mkdir(resolved, { recursive: true });
  await saveSettings({ magnetDownloadDir: resolved });
  return resolved;
}

function normalizeMagnetUri(value) {
  const magnetUri = String(value || "").trim();
  if (!/^magnet:\?xt=urn:btih:/i.test(magnetUri)) {
    throw new Error("Invalid magnet link.");
  }
  return magnetUri;
}

function safeTorrentOutputPath(downloadDir, relativePath) {
  const root = path.resolve(downloadDir);
  const candidate = path.resolve(root, path.normalize(String(relativePath || "")));
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : root;
}

function formatMagnetFiles(job) {
  const torrent = job.torrent;
  return (torrent.files || []).map((file) => ({
    name: file.name,
    path: safeTorrentOutputPath(job.downloadDir, file.path),
    length: file.length || 0,
    downloaded: file.downloaded || 0,
    progress: Number.isFinite(file.progress) ? file.progress * 100 : 0
  }));
}

function createMagnetSnapshot(job, status = job.status, message = job.message) {
  const torrent = job.torrent;
  const total = torrent.length || 0;
  const downloaded = torrent.downloaded || 0;

  return {
    jobId: job.jobId,
    magnetUri: job.magnetUri,
    downloadDir: job.downloadDir,
    status,
    name: torrent.name || job.name || "",
    infoHash: torrent.infoHash || "",
    percent: total > 0 ? Math.max(0, Math.min(100, (torrent.progress || 0) * 100)) : undefined,
    downloaded,
    total,
    downloadSpeed: torrent.downloadSpeed || 0,
    uploadSpeed: torrent.uploadSpeed || 0,
    peers: torrent.numPeers || 0,
    message,
    files: formatMagnetFiles(job),
    updatedAt: Date.now()
  };
}

function emitMagnetProgress(job, status = job.status, message = job.message) {
  job.status = status;
  job.message = message;
  sendToRenderer(job.sender, "magnet:progress", createMagnetSnapshot(job, status, message));
}

function clearMagnetTimer(job) {
  if (job.timer) {
    clearInterval(job.timer);
    job.timer = undefined;
  }
}

async function stopMagnetJob(jobId, status = "cancelled", message = "Download stopped") {
  const job = runningMagnetJobs.get(jobId);
  if (!job) {
    return false;
  }

  clearMagnetTimer(job);
  emitMagnetProgress(job, status, message);
  runningMagnetJobs.delete(jobId);

  try {
    const client = await getMagnetClient();
    await new Promise((resolve) => client.remove(job.torrent, { destroyStore: false }, () => resolve()));
  } catch {
    try {
      if (!job.torrent.destroyed) {
        await new Promise((resolve) => job.torrent.destroy({ destroyStore: false }, () => resolve()));
      }
    } catch {
      // Ignore shutdown errors from already-destroyed torrents.
    }
  }

  return true;
}

async function loadWebTorrentConstructor() {
  if (!webTorrentConstructorPromise) {
    webTorrentConstructorPromise = import("webtorrent").then((module) => module.default || module.WebTorrent || module);
  }
  return webTorrentConstructorPromise;
}

async function getMagnetClient() {
  if (!magnetClientPromise) {
    magnetClientPromise = loadWebTorrentConstructor().then((WebTorrent) => {
      const client = new WebTorrent();
      client.on("error", (error) => {
        console.error("[magnet]", error);
      });
      return client;
    });
  }
  return magnetClientPromise;
}

async function destroyMagnetClient() {
  for (const job of runningMagnetJobs.values()) {
    clearMagnetTimer(job);
  }
  runningMagnetJobs.clear();

  if (!magnetClientPromise) {
    return;
  }

  try {
    const client = await magnetClientPromise;
    await new Promise((resolve) => client.destroy(() => resolve()));
  } catch {
    // App shutdown should continue even if the torrent client is already closed.
  } finally {
    magnetClientPromise = undefined;
  }
}

function normalizePossibleFileUrl(value) {
  const text = String(value || "").trim();
  if (text.startsWith("file://")) {
    try {
      return fileURLToPath(text);
    } catch {
      return text;
    }
  }
  return text;
}

function probeMedia(filePathOrUrl) {
  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=index,codec_type,codec_name,profile,width,height,pix_fmt",
      "-of",
      "json",
      filePathOrUrl
    ];

    const child = spawn(resolveBinaryPath("ffprobe"), args, { windowsHide: true });
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.on("error", () => resolve({}));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout);
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        const video = streams.find((stream) => stream.codec_type === "video") || {};
        const audio = streams.find((stream) => stream.codec_type === "audio") || {};
        resolve({
          duration: Number.parseFloat(parsed.format?.duration || "0") || 0,
          width: Number(video.width) || 0,
          height: Number(video.height) || 0,
          codec: video.codec_name || "",
          profile: video.profile || "",
          pixFmt: video.pix_fmt || "",
          audioCodec: audio.codec_name || "",
          audioProfile: audio.profile || "",
          hasAudio: Boolean(audio.codec_name)
        });
      } catch {
        resolve({});
      }
    });
  });
}

function canPlayDirectly(extension, metadata) {
  const videoCodec = String(metadata.codec || "").toLowerCase();
  const audioCodec = String(metadata.audioCodec || "").toLowerCase();
  const pixFmt = String(metadata.pixFmt || "").toLowerCase();

  if (!videoCodec) {
    return false;
  }

  if (DIRECT_MP4_EXTENSIONS.has(extension)) {
    const videoOk =
      CHROMIUM_MP4_VIDEO_CODECS.has(videoCodec) &&
      (!pixFmt || ["yuv420p", "nv12"].includes(pixFmt));
    const audioOk = !metadata.hasAudio || CHROMIUM_MP4_AUDIO_CODECS.has(audioCodec);
    return videoOk && audioOk;
  }

  if (DIRECT_WEBM_EXTENSIONS.has(extension)) {
    const videoOk = CHROMIUM_WEBM_VIDEO_CODECS.has(videoCodec);
    const audioOk = !metadata.hasAudio || CHROMIUM_WEBM_AUDIO_CODECS.has(audioCodec);
    return videoOk && audioOk;
  }

  return false;
}

function parseProgressLineMap(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index > 0) {
      result[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return result;
}

function runFfmpeg({ args, sender, progressChannel, basePayload, durationSeconds, onStarted }) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBinaryPath("ffmpeg"), args, { windowsHide: true });
    let stderr = "";
    let stdoutBuffer = "";

    onStarted?.(child);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const parts = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = parts.pop() || "";
      const map = parseProgressLineMap(parts.join("\n"));
      if (Object.keys(map).length > 0) {
        const outTimeMs = Number(map.out_time_ms || 0);
        const outSeconds = outTimeMs > 0 ? outTimeMs / 1000000 : undefined;
        const percent =
          durationSeconds && outSeconds ? Math.min(99, Math.max(0, (outSeconds / durationSeconds) * 100)) : undefined;
        sendToRenderer(sender, progressChannel, {
          ...basePayload,
          percent,
          outSeconds,
          speed: map.speed,
          rawProgress: map.progress
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
      reject(new Error(tail || `FFmpeg exited with code ${code}`));
    });
  });
}

async function convertToMp4(sender, filePath, jobId) {
  const stat = await fs.promises.stat(filePath);
  const hash = crypto
    .createHash("sha1")
    .update(`${filePath}:${stat.mtimeMs}:${stat.size}`)
    .digest("hex")
    .slice(0, 16);
  const outputDir = await setConversionCacheDir(getConversionCacheDir());
  await fs.promises.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${safeBaseName(filePath)}-${hash}.mp4`);
  if (fileExists(outputPath)) {
    const outputStat = await fs.promises.stat(outputPath).catch(() => undefined);
    if (outputStat?.size > 0) {
      sendToRenderer(sender, "media:conversion-progress", {
        jobId,
        filePath,
        fileName: path.basename(filePath),
        stage: "cached",
        percent: 100,
        message: "使用已缓存的 MP4"
      });
      return { outputPath, cached: true };
    }

    await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
  }

  sendToRenderer(sender, "media:conversion-progress", {
    jobId,
    filePath,
    fileName: path.basename(filePath),
    stage: "probing",
    percent: 0,
    message: "读取媒体信息"
  });

  const metadata = await probeMedia(filePath);
  const durationSeconds = Number(metadata.duration) || 0;

  sendToRenderer(sender, "media:conversion-progress", {
    jobId,
    filePath,
    fileName: path.basename(filePath),
    stage: "converting",
    percent: 0,
    message: "转码为 MP4"
  });

  const args = [
    "-hide_banner",
    "-y",
    "-progress",
    "pipe:1",
    "-nostats",
    "-i",
    filePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath
  ];

  try {
    await runFfmpeg({
      args,
      sender,
      progressChannel: "media:conversion-progress",
      basePayload: {
        jobId,
        filePath,
        fileName: path.basename(filePath),
        stage: "converting",
        message: "转码为 MP4"
      },
      durationSeconds
    });
  } catch (error) {
    if (fileExists(outputPath)) {
      await fs.promises.rm(outputPath, { force: true });
    }
    sendToRenderer(sender, "media:conversion-progress", {
      jobId,
      filePath,
      fileName: path.basename(filePath),
      stage: "error",
      message: error.message
    });
    throw error;
  }

  sendToRenderer(sender, "media:conversion-progress", {
    jobId,
    filePath,
    fileName: path.basename(filePath),
    stage: "ready",
    percent: 100,
    message: "转码完成"
  });

  return { outputPath, cached: false };
}

async function prepareOneMedia(sender, filePath, options = {}) {
  const normalizedPath = normalizePossibleFileUrl(filePath);
  const stat = await fs.promises.stat(normalizedPath);
  if (!stat.isFile()) {
    throw new Error(`${normalizedPath} 不是文件`);
  }

  const extension = path.extname(normalizedPath).toLowerCase();
  if (!KNOWN_VIDEO_EXTENSIONS.has(extension)) {
    throw new Error(`${path.basename(normalizedPath)} 不是支持的视频文件`);
  }

  const metadata = DIRECT_PLAYABLE_EXTENSIONS.has(extension) ? await probeMedia(normalizedPath) : {};

  if (DIRECT_PLAYABLE_EXTENSIONS.has(extension) && canPlayDirectly(extension, metadata)) {
    return {
      id: crypto.randomUUID(),
      sourcePath: normalizedPath,
      preparedPath: normalizedPath,
      playbackUrl: playbackUrlFor(normalizedPath),
      displayName: path.basename(normalizedPath),
      originalExtension: extension.replace(".", ""),
      converted: false,
      cached: false,
      metadata
    };
  }

  if (!options.allowConversion) {
    return {
      needsConversion: true,
      filePath: normalizedPath,
      fileName: path.basename(normalizedPath),
      extension: extension.replace(".", ""),
      reason: DIRECT_PLAYABLE_EXTENSIONS.has(extension)
        ? "这个 MP4/MOV 文件的内部编码当前无法直接播放，需要转为兼容 MP4。"
        : "这个格式需要转为兼容 MP4 后播放。",
      metadata
    };
  }

  const jobId = crypto.randomUUID();
  sendToRenderer(sender, "media:conversion-progress", {
    jobId,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    stage: "queued",
    percent: 0,
    message: DIRECT_PLAYABLE_EXTENSIONS.has(extension) ? "转为兼容 MP4" : "等待转码"
  });

  const conversion = await convertToMp4(sender, normalizedPath, jobId);
  const convertedMetadata = await probeMedia(conversion.outputPath);

  return {
    id: crypto.randomUUID(),
    sourcePath: normalizedPath,
    preparedPath: conversion.outputPath,
    playbackUrl: playbackUrlFor(conversion.outputPath),
    displayName: path.basename(normalizedPath),
    originalExtension: extension.replace(".", ""),
    converted: true,
    cached: conversion.cached,
    metadata: convertedMetadata
  };
}

async function forceCompatibleMedia(sender, filePath) {
  const normalizedPath = normalizePossibleFileUrl(filePath);
  const stat = await fs.promises.stat(normalizedPath);
  if (!stat.isFile()) {
    throw new Error(`${normalizedPath} 不是文件`);
  }

  const extension = path.extname(normalizedPath).toLowerCase();
  if (!KNOWN_VIDEO_EXTENSIONS.has(extension)) {
    throw new Error(`${path.basename(normalizedPath)} 不是支持的视频文件`);
  }

  const jobId = crypto.randomUUID();
  sendToRenderer(sender, "media:conversion-progress", {
    jobId,
    filePath: normalizedPath,
    fileName: path.basename(normalizedPath),
    stage: "queued",
    percent: 0,
    message: "等待用户确认后的兼容转码"
  });

  const conversion = await convertToMp4(sender, normalizedPath, jobId);
  const convertedMetadata = await probeMedia(conversion.outputPath);

  return {
    id: crypto.randomUUID(),
    sourcePath: normalizedPath,
    preparedPath: conversion.outputPath,
    playbackUrl: playbackUrlFor(conversion.outputPath),
    displayName: path.basename(normalizedPath),
    originalExtension: extension.replace(".", ""),
    converted: true,
    cached: conversion.cached,
    metadata: convertedMetadata
  };
}

ipcMain.handle("media:pick-files", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择视频文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Video files",
        extensions: Array.from(KNOWN_VIDEO_EXTENSIONS).map((extension) => extension.slice(1))
      },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("media:pick-folder-files", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择视频文件夹",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return [];
  }

  return collectVideoFiles(result.filePaths[0]);
});

ipcMain.handle("media:prepare-files", async (event, payload) => {
  const filePaths = Array.isArray(payload) ? payload : payload?.filePaths;
  const allowConversion = !Array.isArray(payload) && Boolean(payload?.allowConversion);

  if (!Array.isArray(filePaths)) {
    throw new Error("filePaths must be an array");
  }

  const results = [];
  const conversions = [];
  const errors = [];

  for (const filePath of filePaths) {
    try {
      const prepared = await prepareOneMedia(event.sender, filePath, { allowConversion });
      if (prepared?.needsConversion) {
        conversions.push(prepared);
      } else {
        results.push(prepared);
      }
    } catch (error) {
      errors.push({
        filePath: String(filePath || ""),
        message: error.message
      });
    }
  }

  return { results, conversions, errors };
});

ipcMain.handle("media:make-compatible", async (event, filePath) => {
  return forceCompatibleMedia(event.sender, filePath);
});

ipcMain.handle("conversion:get-cache-dir", async () => {
  return setConversionCacheDir(getConversionCacheDir());
});

ipcMain.handle("conversion:choose-cache-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择转码缓存目录",
    defaultPath: getConversionCacheDir(),
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return "";
  }

  return setConversionCacheDir(result.filePaths[0]);
});

ipcMain.handle("media:drop-import-start", async (_event, fileName) => {
  const importId = crypto.randomUUID();
  const importDir = path.join(app.getPath("temp"), "lplay-dropped");
  await fs.promises.mkdir(importDir, { recursive: true });

  const outputPath = path.join(importDir, `${Date.now()}-${importId.slice(0, 8)}-${safeImportedFileName(fileName)}`);
  const stream = fs.createWriteStream(outputPath, { flags: "wx" });
  dropImports.set(importId, { outputPath, stream });

  return { importId };
});

ipcMain.handle("media:drop-import-append", async (_event, payload) => {
  const entry = dropImports.get(payload?.importId);
  if (!entry) {
    throw new Error("拖拽导入任务不存在");
  }

  const buffer = Buffer.from(payload.chunk);
  await new Promise((resolve, reject) => {
    entry.stream.write(buffer, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return true;
});

ipcMain.handle("media:drop-import-finish", async (_event, importId) => {
  const entry = dropImports.get(importId);
  if (!entry) {
    throw new Error("拖拽导入任务不存在");
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      entry.stream.off("finish", onFinish);
      reject(error);
    };
    const onFinish = () => {
      entry.stream.off("error", onError);
      resolve();
    };

    entry.stream.once("error", onError);
    entry.stream.once("finish", onFinish);
    entry.stream.end();
  });

  dropImports.delete(importId);
  return entry.outputPath;
});

ipcMain.handle("media:drop-import-abort", async (_event, importId) => {
  const entry = dropImports.get(importId);
  if (!entry) {
    return false;
  }

  dropImports.delete(importId);
  entry.stream.destroy();
  await fs.promises.rm(entry.outputPath, { force: true }).catch(() => undefined);
  return true;
});

ipcMain.handle("m3u8:pick-playlist", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择 M3U8 文件",
    properties: ["openFile"],
    filters: [
      { name: "M3U8 playlist", extensions: ["m3u8"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? "" : result.filePaths[0];
});

ipcMain.handle("m3u8:choose-output", async (_event, defaultName) => {
  const result = await dialog.showSaveDialog({
    title: "保存为 MP4",
    defaultPath: defaultName || `lplay-${Date.now()}.mp4`,
    filters: [{ name: "MP4 video", extensions: ["mp4"] }]
  });

  return result.canceled ? "" : result.filePath;
});

ipcMain.handle("m3u8:download", async (event, options) => {
  const jobId = options?.jobId || crypto.randomUUID();
  const source = String(options?.source || "").trim();
  let outputPath = String(options?.outputPath || "").trim();

  if (!source) {
    throw new Error("请填写 M3U8 地址或本地文件路径");
  }

  if (!outputPath) {
    throw new Error("请选择输出 MP4 路径");
  }

  if (path.extname(outputPath).toLowerCase() !== ".mp4") {
    outputPath += ".mp4";
  }

  const input = /^https?:\/\//i.test(source) ? source : normalizePossibleFileUrl(source);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const metadata = /^https?:\/\//i.test(input) || fileExists(input) ? await probeMedia(input) : {};
  const durationSeconds = Number(metadata.duration) || 0;

  sendToRenderer(event.sender, "m3u8:progress", {
    jobId,
    status: "running",
    percent: durationSeconds ? 0 : undefined,
    message: "开始转存"
  });

  const args = [
    "-hide_banner",
    "-y",
    "-progress",
    "pipe:1",
    "-nostats",
    "-protocol_whitelist",
    "file,http,https,tcp,tls,crypto",
    "-allowed_extensions",
    "ALL",
    "-i",
    input,
    "-map",
    "0",
    "-c",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    "-movflags",
    "+faststart",
    outputPath
  ];

  try {
    await runFfmpeg({
      args,
      sender: event.sender,
      progressChannel: "m3u8:progress",
      basePayload: {
        jobId,
        status: "running",
        message: "正在转存"
      },
      durationSeconds,
      onStarted: (child) => runningM3u8Jobs.set(jobId, child)
    });
  } catch (error) {
    runningM3u8Jobs.delete(jobId);
    sendToRenderer(event.sender, "m3u8:progress", {
      jobId,
      status: "error",
      message: error.message
    });
    throw error;
  }

  runningM3u8Jobs.delete(jobId);
  sendToRenderer(event.sender, "m3u8:progress", {
    jobId,
    status: "done",
    percent: 100,
    message: "转存完成",
    outputPath
  });

  return { outputPath };
});

ipcMain.handle("m3u8:cancel", async (_event, jobId) => {
  const child = runningM3u8Jobs.get(jobId);
  if (child) {
    child.kill("SIGTERM");
    runningM3u8Jobs.delete(jobId);
    return true;
  }
  return false;
});

ipcMain.handle("magnet:get-download-dir", async () => {
  return setMagnetDownloadDir(getMagnetDownloadDir());
});

ipcMain.handle("magnet:choose-download-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择默认下载文件夹",
    defaultPath: getMagnetDownloadDir(),
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return "";
  }

  return setMagnetDownloadDir(result.filePaths[0]);
});

ipcMain.handle("magnet:start", async (event, options) => {
  const jobId = options?.jobId || crypto.randomUUID();
  const magnetUri = normalizeMagnetUri(options?.magnetUri);
  const downloadDir = await setMagnetDownloadDir(options?.downloadDir || getMagnetDownloadDir());
  const client = await getMagnetClient();

  const torrent = client.add(magnetUri, {
    path: downloadDir
  });

  const job = {
    jobId,
    magnetUri,
    downloadDir,
    sender: event.sender,
    torrent,
    status: "resolving",
    message: "Resolving magnet metadata"
  };

  runningMagnetJobs.set(jobId, job);
  emitMagnetProgress(job, "resolving", "Resolving magnet metadata");

  job.timer = setInterval(() => {
    if (!torrent.destroyed) {
      emitMagnetProgress(job, torrent.done ? "done" : "downloading", torrent.done ? "Download complete" : "Downloading");
    }
  }, 1000);

  torrent.on("infoHash", () => {
    emitMagnetProgress(job, "resolving", "Looking for peers");
  });

  torrent.on("metadata", () => {
    emitMagnetProgress(job, "downloading", "Metadata loaded");
  });

  torrent.on("ready", () => {
    emitMagnetProgress(job, "downloading", "Downloading");
  });

  torrent.on("download", () => {
    const now = Date.now();
    if (!job.lastDownloadEmit || now - job.lastDownloadEmit > 650) {
      job.lastDownloadEmit = now;
      emitMagnetProgress(job, "downloading", "Downloading");
    }
  });

  torrent.on("noPeers", (source) => {
    emitMagnetProgress(job, "resolving", `No peers from ${source}`);
  });

  torrent.on("warning", (error) => {
    emitMagnetProgress(job, job.status, error.message);
  });

  torrent.on("error", (error) => {
    void stopMagnetJob(jobId, "error", error.message);
  });

  torrent.on("done", () => {
    emitMagnetProgress(job, "done", "Download complete");
    void stopMagnetJob(jobId, "done", "Download complete");
  });

  return createMagnetSnapshot(job, "resolving", "Resolving magnet metadata");
});

ipcMain.handle("magnet:cancel", async (_event, jobId) => {
  return stopMagnetJob(jobId, "cancelled", "Download cancelled");
});

ipcMain.handle("shell:show-path", async (_event, filePath) => {
  if (filePath && fileExists(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});
