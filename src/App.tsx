import {
  BookmarkPlus,
  Check,
  Clock3,
  Download,
  Edit3,
  FileDown,
  FileVideo,
  FolderOpen,
  Gauge,
  Highlighter,
  ListFilter,
  Loader2,
  Magnet,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Save,
  ScissorsLineDashed,
  SkipBack,
  SkipForward,
  Star,
  Tags,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversionProgress, Highlight, M3u8Progress, MagnetProgress, PlaybackState, PreparedMedia } from "./types";

const HIGHLIGHT_STORAGE_KEY = "lplay.highlights.v1";
const HISTORY_STORAGE_KEY = "lplay.history.v1";
const UI_STORAGE_KEY = "lplay.ui.v1";
const VIDEO_METADATA_STORAGE_KEY = "lplay.videoMetadata.v1";
const MAX_TAGS_PER_VIDEO = 12;

type HighlightLibrary = Record<string, Highlight[]>;

type DraftHighlight = {
  id?: string;
  start: string;
  end: string;
  note: string;
};

type DownloadState = {
  jobId: string;
  source: string;
  outputPath: string;
  status: "idle" | "running" | "done" | "error";
  percent?: number;
  outSeconds?: number;
  speed?: string;
  message?: string;
};

type PlaybackHistoryItem = {
  sourcePath: string;
  displayName: string;
  originalExtension: string;
  duration: number;
  currentTime: number;
  lastOpenedAt: number;
  lastPlayedAt: number;
};

const SORT_MODES = ["added", "rating-desc", "rating-asc"] as const;

type SortMode = (typeof SORT_MODES)[number];

type VideoMetadata = {
  rating: number;
  tags: string[];
  updatedAt: number;
};

type VideoMetadataLibrary = Record<string, VideoMetadata>;

type UiState = {
  inspectorOpen: boolean;
  sortMode: SortMode;
  tagFilter: string;
};

const defaultUiState: UiState = {
  inspectorOpen: true,
  sortMode: "added",
  tagFilter: ""
};

const defaultVideoMetadata: VideoMetadata = {
  rating: 0,
  tags: [],
  updatedAt: 0
};

const emptyDraft: DraftHighlight = {
  start: "00:00",
  end: "00:05",
  note: ""
};

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadHighlightLibrary(): HighlightLibrary {
  try {
    const raw = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadPlaybackHistory(): PlaybackHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeRating(value: unknown) {
  const rating = Number(value);
  return Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0;
}

function normalizeTags(value: unknown) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s，、#]+/) : [];
  const tags: string[] = [];

  for (const item of source) {
    const tag = String(item).trim().replace(/^#+/, "").slice(0, 32);
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }

    if (tags.length >= MAX_TAGS_PER_VIDEO) {
      break;
    }
  }

  return tags;
}

function parseTags(value: string) {
  return normalizeTags(value);
}

function loadVideoMetadataLibrary(): VideoMetadataLibrary {
  try {
    const raw = localStorage.getItem(VIDEO_METADATA_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<VideoMetadataLibrary>((library, [sourcePath, value]) => {
      if (!sourcePath || !value || typeof value !== "object" || Array.isArray(value)) {
        return library;
      }

      const entry = value as Record<string, unknown>;
      const updatedAt = Number(entry.updatedAt);
      library[sourcePath] = {
        rating: normalizeRating(entry.rating),
        tags: normalizeTags(entry.tags),
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
      };
      return library;
    }, {});
  } catch {
    return {};
  }
}

function isSortMode(value: unknown): value is SortMode {
  return typeof value === "string" && (SORT_MODES as readonly string[]).includes(value);
}

function loadUiState(): UiState {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) {
      return defaultUiState;
    }

    const parsed = JSON.parse(raw);
    return {
      inspectorOpen: parsed?.inspectorOpen !== false,
      sortMode: isSortMode(parsed?.sortMode) ? parsed.sortMode : defaultUiState.sortMode,
      tagFilter: typeof parsed?.tagFilter === "string" ? parsed.tagFilter : defaultUiState.tagFilter
    };
  } catch {
    return defaultUiState;
  }
}

function formatTime(value?: number) {
  const total = Math.max(0, Number.isFinite(value || 0) ? Math.floor(value || 0) : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function parseTime(value: string) {
  const text = value.trim();
  if (!text) {
    return 0;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }

  const parts = text.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return 0;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] || 0;
}

function clampTime(value: number, duration?: number) {
  if (!duration || duration <= 0) {
    return Math.max(0, value);
  }

  return Math.min(Math.max(0, value), duration);
}

function shortPath(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  if (parts.length <= 3) {
    return filePath;
  }

  return `${parts[0]}\\...\\${parts.slice(-2).join("\\")}`;
}

function gridColumns(count: number) {
  if (count <= 1) {
    return "1fr";
  }

  if (count === 2) {
    return "repeat(2, minmax(0, 1fr))";
  }

  if (count <= 4) {
    return "repeat(2, minmax(0, 1fr))";
  }

  if (count <= 9) {
    return "repeat(3, minmax(0, 1fr))";
  }

  return "repeat(auto-fit, minmax(320px, 1fr))";
}

function defaultOutputName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `lplay-${stamp}.mp4`;
}

function formatDateTime(value: number) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function isMagnetLink(value: string) {
  return /^magnet:\?xt=urn:btih:/i.test(value.trim());
}

export default function App() {
  const [initialUi] = useState(() => loadUiState());
  const [media, setMedia] = useState<PreparedMedia[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [playback, setPlayback] = useState<Record<string, PlaybackState>>({});
  const [highlights, setHighlights] = useState<HighlightLibrary>(() => loadHighlightLibrary());
  const [history, setHistory] = useState<PlaybackHistoryItem[]>(() => loadPlaybackHistory());
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadataLibrary>(() => loadVideoMetadataLibrary());
  const [inspectorOpen, setInspectorOpen] = useState(initialUi.inspectorOpen);
  const [sortMode, setSortMode] = useState<SortMode>(initialUi.sortMode);
  const [tagFilter, setTagFilter] = useState(initialUi.tagFilter);
  const [draft, setDraft] = useState<DraftHighlight>(emptyDraft);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [notice, setNotice] = useState("");
  const [conversionJobs, setConversionJobs] = useState<Record<string, ConversionProgress>>({});
  const [m3u8Source, setM3u8Source] = useState("");
  const [m3u8Output, setM3u8Output] = useState("");
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [magnetUri, setMagnetUri] = useState("");
  const [magnetDownloadDir, setMagnetDownloadDir] = useState("");
  const [magnetDownload, setMagnetDownload] = useState<MagnetProgress | null>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const compatibilityRetries = useRef(new Set<string>());
  const decodeWatchers = useRef(new Map<string, number>());
  const pendingSeek = useRef(new Map<string, number>());
  const historyTouchTimes = useRef(new Map<string, number>());

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const item of media) {
      for (const tag of videoMetadata[item.sourcePath]?.tags || []) {
        tags.add(tag);
      }
    }

    return Array.from(tags).sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [media, videoMetadata]);

  const visibleMedia = useMemo(() => {
    const filtered = tagFilter
      ? media.filter((item) => videoMetadata[item.sourcePath]?.tags.includes(tagFilter))
      : [...media];

    if (sortMode === "added") {
      return filtered;
    }

    const order = new Map(media.map((item, index) => [item.id, index]));
    return [...filtered].sort((left, right) => {
      const leftRating = videoMetadata[left.sourcePath]?.rating || 0;
      const rightRating = videoMetadata[right.sourcePath]?.rating || 0;
      const ratingDelta = sortMode === "rating-desc" ? rightRating - leftRating : leftRating - rightRating;

      return ratingDelta || (order.get(left.id) || 0) - (order.get(right.id) || 0);
    });
  }, [media, sortMode, tagFilter, videoMetadata]);

  const activeMedia = media.find((item) => item.id === activeId) || visibleMedia[0] || media[0];
  const activeState = activeMedia ? playback[activeMedia.id] : undefined;
  const activeHighlights = activeMedia ? highlights[activeMedia.sourcePath] || [] : [];
  const sortedActiveHighlights = useMemo(
    () => [...activeHighlights].sort((left, right) => left.start - right.start),
    [activeHighlights]
  );

  useEffect(() => {
    localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify(highlights));
  }, [highlights]);

  useEffect(() => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 40)));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(VIDEO_METADATA_STORAGE_KEY, JSON.stringify(videoMetadata));
  }, [videoMetadata]);

  useEffect(() => {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ inspectorOpen, sortMode, tagFilter }));
  }, [inspectorOpen, sortMode, tagFilter]);

  useEffect(() => {
    const unsubscribeConversion = window.lplay.onConversionProgress((payload) => {
      setConversionJobs((current) => ({
        ...current,
        [payload.jobId]: payload
      }));
    });

    const unsubscribeM3u8 = window.lplay.onM3u8Progress((payload: M3u8Progress) => {
      setDownload((current) => {
        if (!current || current.jobId !== payload.jobId) {
          return current;
        }

        return {
          ...current,
          status: payload.status,
          percent: payload.percent,
          outSeconds: payload.outSeconds,
          speed: payload.speed,
          message: payload.message,
          outputPath: payload.outputPath || current.outputPath
        };
      });
    });

    const unsubscribeMagnet = window.lplay.onMagnetProgress((payload: MagnetProgress) => {
      setMagnetDownload((current) => (!current || current.jobId === payload.jobId ? payload : current));
      if (payload.downloadDir) {
        setMagnetDownloadDir(payload.downloadDir);
      }
    });

    return () => {
      unsubscribeConversion();
      unsubscribeM3u8();
      unsubscribeMagnet();
    };
  }, []);

  useEffect(() => {
    void window.lplay.getMagnetDownloadDir().then((downloadDir) => {
      if (downloadDir) {
        setMagnetDownloadDir(downloadDir);
      }
    });
  }, []);

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");

    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }

      event.preventDefault();
      setIsDragging(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setIsDragging(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setIsDragging(false);
      }
    };

    const handleDocumentDrop = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }

      event.preventDefault();
      setIsDragging(false);
      void handleDroppedFiles(Array.from(event.dataTransfer?.files || []));
    };

    window.addEventListener("dragenter", handleDragEnter, true);
    window.addEventListener("dragover", handleDragOver, true);
    window.addEventListener("dragleave", handleDragLeave, true);
    window.addEventListener("drop", handleDocumentDrop, true);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter, true);
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("dragleave", handleDragLeave, true);
      window.removeEventListener("drop", handleDocumentDrop, true);
    };
  }, []);

  useEffect(() => {
    if (!activeMedia && media.length > 0) {
      setActiveId(media[0].id);
    }
  }, [activeMedia, media]);

  function getVideoMetadata(sourcePath: string) {
    return videoMetadata[sourcePath] || defaultVideoMetadata;
  }

  function updateVideoMetadata(sourcePath: string, patch: Partial<Omit<VideoMetadata, "updatedAt">>) {
    setVideoMetadata((current) => {
      const existing = current[sourcePath] || defaultVideoMetadata;
      const nextEntry: VideoMetadata = {
        ...existing,
        ...patch,
        rating: normalizeRating(patch.rating ?? existing.rating),
        tags: patch.tags ? normalizeTags(patch.tags) : existing.tags,
        updatedAt: Date.now()
      };
      const next = { ...current };

      if (nextEntry.rating === 0 && nextEntry.tags.length === 0) {
        delete next[sourcePath];
      } else {
        next[sourcePath] = nextEntry;
      }

      return next;
    });
  }

  function setVideoRating(sourcePath: string, rating: number) {
    const currentRating = getVideoMetadata(sourcePath).rating;
    updateVideoMetadata(sourcePath, { rating: currentRating === rating ? 0 : rating });
  }

  function setVideoTags(sourcePath: string, value: string) {
    updateVideoMetadata(sourcePath, { tags: parseTags(value) });
  }

  function registerVideoRef(id: string) {
    return (element: HTMLVideoElement | null) => {
      if (element) {
        videoRefs.current.set(id, element);
      } else {
        videoRefs.current.delete(id);
      }
    };
  }

  function updatePlayback(id: string, patch: Partial<PlaybackState>) {
    setPlayback((current) => ({
      ...current,
      [id]: {
        currentTime: current[id]?.currentTime || 0,
        duration: current[id]?.duration || 0,
        paused: current[id]?.paused ?? true,
        muted: current[id]?.muted ?? false,
        ...patch
      }
    }));
  }

  function watchDecodeReadiness(item: PreparedMedia, video: HTMLVideoElement) {
    const existingWatcher = decodeWatchers.current.get(item.id);
    if (existingWatcher) {
      window.clearTimeout(existingWatcher);
    }

    const watcher = window.setTimeout(() => {
      decodeWatchers.current.delete(item.id);
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !item.converted) {
        void repairPlaybackCompatibility(item);
      }
    }, 1800);

    decodeWatchers.current.set(item.id, watcher);
  }

  function clearDecodeWatcher(id: string) {
    const watcher = decodeWatchers.current.get(id);
    if (watcher) {
      window.clearTimeout(watcher);
      decodeWatchers.current.delete(id);
    }
  }

  function upsertHistory(item: PreparedMedia, patch: Partial<PlaybackHistoryItem> = {}) {
    const now = Date.now();
    setHistory((current) => {
      const existing = current.find((entry) => entry.sourcePath === item.sourcePath);
      const nextItem: PlaybackHistoryItem = {
        sourcePath: item.sourcePath,
        displayName: item.displayName,
        originalExtension: item.originalExtension,
        duration: item.metadata?.duration || existing?.duration || 0,
        currentTime: existing?.currentTime || 0,
        lastOpenedAt: existing?.lastOpenedAt || now,
        lastPlayedAt: now,
        ...patch
      };

      return [nextItem, ...current.filter((entry) => entry.sourcePath !== item.sourcePath)]
        .sort((left, right) => right.lastPlayedAt - left.lastPlayedAt)
        .slice(0, 40);
    });
  }

  function recordPlaybackProgress(item: PreparedMedia, video: HTMLVideoElement, force = false) {
    const now = Date.now();
    const lastTouched = historyTouchTimes.current.get(item.sourcePath) || 0;
    if (!force && now - lastTouched < 4000) {
      return;
    }

    historyTouchTimes.current.set(item.sourcePath, now);
    upsertHistory(item, {
      duration: Number.isFinite(video.duration) ? video.duration : item.metadata?.duration || 0,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      lastPlayedAt: now
    });
  }

  async function openHistoryItem(item: PlaybackHistoryItem) {
    pendingSeek.current.set(item.sourcePath, item.currentTime || 0);
    const existing = media.find((mediaItem) => mediaItem.sourcePath === item.sourcePath);
    if (existing) {
      setActiveId(existing.id);
      const video = videoRefs.current.get(existing.id);
      if (video && item.currentTime > 0) {
        video.currentTime = clampTime(item.currentTime, video.duration);
      }
      return;
    }

    const added = await addFiles([item.sourcePath]);
    const next = added.find((mediaItem) => mediaItem.sourcePath === item.sourcePath);
    if (next) {
      setActiveId(next.id);
    }
  }

  async function addFiles(filePaths: string[]) {
    const distinctPaths = Array.from(new Set(filePaths.filter(Boolean)));
    if (distinctPaths.length === 0) {
      return [];
    }

    setIsPreparing(true);
    setNotice("正在准备视频");

    try {
      const response = await window.lplay.prepareMediaFiles(distinctPaths);

      setMedia((current) => {
        const known = new Set(current.map((item) => item.sourcePath));
        const additions = response.results.filter((item) => !known.has(item.sourcePath));
        return [...current, ...additions];
      });

      if (response.results.length > 0) {
        for (const item of response.results) {
          upsertHistory(item, {
            duration: item.metadata?.duration || 0,
            currentTime: 0,
            lastOpenedAt: Date.now(),
            lastPlayedAt: Date.now()
          });
        }
        setActiveId((current) => current || response.results[0].id);
      }

      if (response.results.length > 0) {
        setNotice(`已加入 ${response.results.length} 个视频`);
      }

      if (response.errors.length > 0) {
        setNotice(response.errors.map((error) => error.message).join("；"));
      }
      return response.results;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入失败");
      return [];
    } finally {
      setIsPreparing(false);
    }
  }

  async function handlePickFiles() {
    const paths = await window.lplay.pickVideoFiles();
    await addFiles(paths);
  }

  async function copyDroppedFileToTemp(file: File) {
    const { importId } = await window.lplay.startDroppedFileImport(file.name || "dropped-video");
    const reader = file.stream().getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        await window.lplay.appendDroppedFileChunk(importId, chunk);
      }

      return await window.lplay.finishDroppedFileImport(importId);
    } catch (error) {
      await window.lplay.abortDroppedFileImport(importId);
      throw error;
    }
  }

  async function handleDroppedFiles(files: File[]) {
    if (files.length === 0) {
      setNotice("没有读取到拖拽文件");
      return;
    }

    let paths: string[] = [];
    try {
      paths = window.lplay.getDroppedFilePaths(files);
    } catch {
      paths = [];
    }

    if (paths.length > 0) {
      await addFiles(paths);
      return;
    }

    setIsPreparing(true);
    setNotice("正在复制拖入文件");

    try {
      const copiedPaths: string[] = [];
      for (const file of files) {
        setNotice(`正在导入 ${file.name || "拖入的视频"}`);
        copiedPaths.push(await copyDroppedFileToTemp(file));
      }

      await addFiles(copiedPaths);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "拖拽导入失败");
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
  }

  async function repairPlaybackCompatibility(item: PreparedMedia) {
    if (compatibilityRetries.current.has(item.sourcePath)) {
      updatePlayback(item.id, { error: "播放失败，兼容转码后仍无法播放" });
      return;
    }

    compatibilityRetries.current.add(item.sourcePath);
    updatePlayback(item.id, { error: "正在转为兼容格式" });

    try {
      const compatible = await window.lplay.makeMediaCompatible(item.sourcePath);
      setMedia((current) =>
        current.map((mediaItem) =>
          mediaItem.id === item.id
            ? {
                ...compatible,
                id: item.id
              }
            : mediaItem
        )
      );
      updatePlayback(item.id, { error: undefined, currentTime: 0, paused: true });
      setNotice(`${item.displayName} 已转为兼容格式`);
    } catch (error) {
      updatePlayback(item.id, {
        error: error instanceof Error ? error.message : "兼容转码失败"
      });
    }
  }

  function removeMedia(id: string) {
    clearDecodeWatcher(id);
    setMedia((current) => current.filter((item) => item.id !== id));
    setPlayback((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    if (activeId === id) {
      const next = media.find((item) => item.id !== id);
      setActiveId(next?.id || "");
    }
  }

  function clearMedia() {
    for (const id of media.map((item) => item.id)) {
      clearDecodeWatcher(id);
    }
    setMedia([]);
    setPlayback({});
    setActiveId("");
  }

  function playAll() {
    for (const item of media) {
      const video = videoRefs.current.get(item.id);
      if (video) {
        void video.play().catch(() => repairPlaybackCompatibility(item));
      }
    }
  }

  function pauseAll() {
    for (const video of videoRefs.current.values()) {
      video.pause();
    }
  }

  function toggleMuteAll() {
    const everyMuted = Array.from(videoRefs.current.values()).every((video) => video.muted);
    for (const [id, video] of videoRefs.current.entries()) {
      video.muted = !everyMuted;
      updatePlayback(id, { muted: video.muted });
    }
  }

  function seekActive(seconds: number) {
    if (!activeMedia) {
      return;
    }

    const video = videoRefs.current.get(activeMedia.id);
    if (!video) {
      return;
    }

    video.currentTime = clampTime(video.currentTime + seconds, video.duration);
  }

  function setDraftPoint(point: "start" | "end") {
    if (!activeMedia) {
      return;
    }

    const current = playback[activeMedia.id]?.currentTime || videoRefs.current.get(activeMedia.id)?.currentTime || 0;
    setDraft((state) => ({
      ...state,
      [point]: formatTime(current)
    }));
  }

  function editHighlight(highlight: Highlight) {
    setDraft({
      id: highlight.id,
      start: formatTime(highlight.start),
      end: formatTime(highlight.end),
      note: highlight.note
    });
    seekToHighlight(highlight);
  }

  function saveHighlight() {
    if (!activeMedia) {
      return;
    }

    const duration = activeState?.duration || activeMedia.metadata?.duration || 0;
    const start = clampTime(parseTime(draft.start), duration);
    let end = clampTime(parseTime(draft.end), duration);

    if (end <= start) {
      end = clampTime(start + 5, duration);
    }

    const nextHighlight: Highlight = {
      id: draft.id || randomId(),
      start,
      end,
      note: draft.note.trim(),
      createdAt: Date.now()
    };

    setHighlights((current) => {
      const list = current[activeMedia.sourcePath] || [];
      const nextList = list.some((item) => item.id === nextHighlight.id)
        ? list.map((item) => (item.id === nextHighlight.id ? nextHighlight : item))
        : [...list, nextHighlight];

      return {
        ...current,
        [activeMedia.sourcePath]: nextList.sort((left, right) => left.start - right.start)
      };
    });

    setDraft({
      ...emptyDraft,
      start: formatTime(end),
      end: formatTime(end + 5)
    });
  }

  function deleteHighlight(highlightId: string) {
    if (!activeMedia) {
      return;
    }

    setHighlights((current) => ({
      ...current,
      [activeMedia.sourcePath]: (current[activeMedia.sourcePath] || []).filter((item) => item.id !== highlightId)
    }));

    if (draft.id === highlightId) {
      setDraft(emptyDraft);
    }
  }

  function seekToHighlight(highlight: Highlight) {
    if (!activeMedia) {
      return;
    }

    const video = videoRefs.current.get(activeMedia.id);
    if (video) {
      video.currentTime = highlight.start;
      void video.play();
    }
  }

  async function pickM3u8Playlist() {
    const picked = await window.lplay.pickM3u8Playlist();
    if (picked) {
      setM3u8Source(picked);
    }
  }

  async function chooseM3u8Output() {
    const picked = await window.lplay.chooseM3u8Output(defaultOutputName());
    if (picked) {
      setM3u8Output(picked);
    }
  }

  async function startM3u8Download() {
    const jobId = randomId();
    const outputPath = m3u8Output;
    setDownload({
      jobId,
      source: m3u8Source,
      outputPath,
      status: "running",
      percent: 0,
      message: "准备转存"
    });

    try {
      const result = await window.lplay.downloadM3u8({
        jobId,
        source: m3u8Source,
        outputPath
      });
      setM3u8Output(result.outputPath);
      await addFiles([result.outputPath]);
    } catch (error) {
      setDownload((current) =>
        current?.jobId === jobId
          ? {
              ...current,
              status: "error",
              message: error instanceof Error ? error.message : "转存失败"
            }
          : current
      );
    }
  }

  async function cancelM3u8Download() {
    if (!download || download.status !== "running") {
      return;
    }

    await window.lplay.cancelM3u8(download.jobId);
    setDownload((current) =>
      current
        ? {
            ...current,
            status: "error",
            message: "已取消"
          }
        : current
    );
  }

  async function chooseMagnetDownloadDir() {
    const picked = await window.lplay.chooseMagnetDownloadDir();
    if (picked) {
      setMagnetDownloadDir(picked);
    }
  }

  async function startMagnetDownload() {
    const source = magnetUri.trim();
    const jobId = randomId();

    if (!isMagnetLink(source)) {
      setMagnetDownload({
        jobId,
        magnetUri: source,
        downloadDir: magnetDownloadDir,
        status: "error",
        message: "请输入有效的磁力链接。"
      });
      return;
    }

    setMagnetDownload({
      jobId,
      magnetUri: source,
      downloadDir: magnetDownloadDir,
      status: "resolving",
      percent: 0,
      message: "正在解析磁力链接"
    });

    try {
      const started = await window.lplay.startMagnetDownload({
        jobId,
        magnetUri: source,
        downloadDir: magnetDownloadDir
      });
      setMagnetDownload(started);
      if (started.downloadDir) {
        setMagnetDownloadDir(started.downloadDir);
      }
    } catch (error) {
      setMagnetDownload((current) =>
        current?.jobId === jobId
          ? {
              ...current,
              status: "error",
              message: error instanceof Error ? error.message : "磁力下载启动失败"
            }
          : current
      );
    }
  }

  async function cancelMagnetDownload() {
    if (!magnetDownload || !["resolving", "downloading"].includes(magnetDownload.status)) {
      return;
    }

    await window.lplay.cancelMagnetDownload(magnetDownload.jobId);
    setMagnetDownload((current) =>
      current
        ? {
            ...current,
            status: "cancelled",
            message: "已取消"
          }
        : current
    );
  }

  const activeDuration = activeState?.duration || activeMedia?.metadata?.duration || 0;
  const canDownload = Boolean(m3u8Source.trim() && m3u8Output.trim() && download?.status !== "running");
  const magnetBusy = magnetDownload?.status === "resolving" || magnetDownload?.status === "downloading";
  const canStartMagnetDownload = isMagnetLink(magnetUri) && !magnetBusy;
  const latestConversion = Object.values(conversionJobs).slice(-3).reverse();
  const videoCountText = tagFilter ? `${visibleMedia.length}/${media.length}` : `${media.length}`;

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand">
          <Video size={23} />
          <div>
            <strong>Lplay</strong>
            <span>{media.length > 0 ? `${videoCountText} 路视频` : "多路视频播放器"}</span>
          </div>
        </div>

        <div className="toolbar">
          <button className="primaryButton" type="button" onClick={handlePickFiles}>
            <FolderOpen size={18} />
            添加视频
          </button>
          <button type="button" onClick={playAll} disabled={media.length === 0} title="全部播放">
            <Play size={18} />
          </button>
          <button type="button" onClick={pauseAll} disabled={media.length === 0} title="全部暂停">
            <Pause size={18} />
          </button>
          <button type="button" onClick={toggleMuteAll} disabled={media.length === 0} title="全部静音切换">
            <VolumeX size={18} />
          </button>
          <button type="button" onClick={clearMedia} disabled={media.length === 0} title="清空画面">
            <X size={18} />
          </button>
          <button type="button" onClick={() => setInspectorOpen((open) => !open)} title={inspectorOpen ? "隐藏侧边栏" : "显示侧边栏"}>
            {inspectorOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </header>

      <main className={`workspace ${inspectorOpen ? "" : "inspectorClosed"}`}>
        <section
          className={`stage ${isDragging ? "isDragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="dropOverlay">
              <FileVideo size={44} />
              <strong>释放以导入视频</strong>
              <span>如果无法读取真实路径，Lplay 会复制文件后再播放。</span>
            </div>
          )}

          {media.length === 0 ? (
            <div className="emptyStage">
              <FileVideo size={52} />
              <h1>拖入视频开始播放</h1>
              <p>支持多选和自动分屏；AVI、MKV 等文件会通过 FFmpeg 转为 MP4 缓存后播放。</p>
              <button className="primaryButton" type="button" onClick={handlePickFiles}>
                <FolderOpen size={18} />
                选择视频
              </button>
            </div>
          ) : visibleMedia.length === 0 ? (
            <div className="filteredEmpty">
              <ListFilter size={42} />
              <strong>没有匹配的视频</strong>
              <span>当前标签过滤为 #{tagFilter}，可以在右侧切回全部。</span>
            </div>
          ) : (
            <div className="videoGrid" style={{ gridTemplateColumns: gridColumns(visibleMedia.length) }}>
              {visibleMedia.map((item) => {
                const state = playback[item.id];
                const itemHighlights = highlights[item.sourcePath] || [];
                const itemMetadata = getVideoMetadata(item.sourcePath);
                const duration = state?.duration || item.metadata?.duration || 0;
                const isActive = activeMedia?.id === item.id;

                return (
                  <article
                    className={`videoTile ${isActive ? "isActive" : ""}`}
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                  >
                    <div className="tileHeader">
                      <button className="fileButton" type="button" onClick={() => setActiveId(item.id)}>
                        <FileVideo size={17} />
                        <span>{item.displayName}</span>
                      </button>
                      <div className="tileActions">
                        <span className="chip">{item.converted ? "MP4 缓存" : item.originalExtension.toUpperCase()}</span>
                        <button type="button" onClick={() => removeMedia(item.id)} title="移除">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="videoMetaEditor" onClick={(event) => event.stopPropagation()}>
                        <div className="ratingControl" aria-label={`${item.displayName} 评分`}>
                          {[1, 2, 3, 4, 5].map((score) => (
                            <button
                              className={score <= itemMetadata.rating ? "isRated" : ""}
                              key={score}
                              type="button"
                              title={`${score} 分`}
                              aria-pressed={score <= itemMetadata.rating}
                              onClick={() => setVideoRating(item.sourcePath, score)}
                            >
                              <Star size={14} fill={score <= itemMetadata.rating ? "currentColor" : "none"} />
                            </button>
                          ))}
                        </div>
                        <label className="tagEditor">
                          <Tags size={15} />
                          <input
                            className="tagInput"
                            key={`${item.sourcePath}:${itemMetadata.tags.join("|")}`}
                            defaultValue={itemMetadata.tags.join(", ")}
                            placeholder="标签：剪辑, 参考"
                            onBlur={(event) => setVideoTags(item.sourcePath, event.currentTarget.value)}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <video
                      ref={registerVideoRef(item.id)}
                      src={item.playbackUrl}
                      controls
                      autoPlay
                      playsInline
                      onLoadedMetadata={(event) => {
                        const pendingTime = pendingSeek.current.get(item.sourcePath);
                        if (pendingTime !== undefined) {
                          event.currentTarget.currentTime = clampTime(pendingTime, event.currentTarget.duration);
                          pendingSeek.current.delete(item.sourcePath);
                        }
                        updatePlayback(item.id, {
                          duration: event.currentTarget.duration,
                          currentTime: event.currentTarget.currentTime,
                          paused: event.currentTarget.paused,
                          muted: event.currentTarget.muted
                        });
                        recordPlaybackProgress(item, event.currentTarget, true);
                        watchDecodeReadiness(item, event.currentTarget);
                      }}
                      onCanPlay={() => clearDecodeWatcher(item.id)}
                      onLoadedData={() => clearDecodeWatcher(item.id)}
                      onTimeUpdate={(event) =>
                        {
                          updatePlayback(item.id, {
                            currentTime: event.currentTarget.currentTime,
                            duration: event.currentTarget.duration
                          });
                          recordPlaybackProgress(item, event.currentTarget);
                        }
                      }
                      onPlay={(event) => {
                        updatePlayback(item.id, { paused: event.currentTarget.paused });
                        recordPlaybackProgress(item, event.currentTarget, true);
                      }}
                      onPause={(event) => {
                        updatePlayback(item.id, { paused: event.currentTarget.paused });
                        recordPlaybackProgress(item, event.currentTarget, true);
                      }}
                      onVolumeChange={(event) => updatePlayback(item.id, { muted: event.currentTarget.muted })}
                      onError={() => void repairPlaybackCompatibility(item)}
                    />

                    {state?.error && <div className="videoError">{state.error}</div>}

                    <div className="tileFooter">
                      <span>{formatTime(state?.currentTime)} / {formatTime(duration)}</span>
                      <span>{itemHighlights.length} 个高光</span>
                    </div>

                    <div className="highlightRail" aria-label="高光时间轴">
                      {itemHighlights.map((highlight) => {
                        const left = duration ? (highlight.start / duration) * 100 : 0;
                        const width = duration ? ((highlight.end - highlight.start) / duration) * 100 : 0;
                        return (
                          <button
                            key={highlight.id}
                            type="button"
                            title={`${formatTime(highlight.start)} - ${formatTime(highlight.end)} ${highlight.note}`}
                            style={{
                              left: `${Math.max(0, Math.min(100, left))}%`,
                              width: `${Math.max(1.5, Math.min(100, width))}%`
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveId(item.id);
                              const video = videoRefs.current.get(item.id);
                              if (video) {
                                video.currentTime = highlight.start;
                                void video.play();
                              }
                            }}
                          />
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {(notice || isPreparing || latestConversion.length > 0) && (
            <div className="statusStrip">
              {isPreparing && <Loader2 className="spin" size={17} />}
              <span>{notice || "准备媒体"}</span>
              {latestConversion.map((job) => (
                <span className={`jobPill ${job.stage}`} key={job.jobId}>
                  {job.fileName}: {job.percent ? `${Math.round(job.percent)}%` : job.message}
                </span>
              ))}
            </div>
          )}
        </section>

        {inspectorOpen && (
        <aside className="inspector">
          <section className="panel compactPanel">
            <div className="panelTitle">
              <ListFilter size={18} />
              <h2>筛选与排序</h2>
            </div>

            <div className="filterControls">
              <label>
                <span>
                  <Star size={15} />
                  评分排序
                </span>
                <select className="selectInput" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                  <option value="added">导入顺序</option>
                  <option value="rating-desc">评分高到低</option>
                  <option value="rating-asc">评分低到高</option>
                </select>
              </label>

              <div className="tagFilterHeader">
                <span>
                  <Tags size={15} />
                  标签过滤
                </span>
                <small>{tagFilter ? `显示 ${visibleMedia.length}/${media.length}` : `${media.length} 个视频`}</small>
              </div>

              <div className="tagFilterList">
                <button
                  className={`tagFilterButton ${tagFilter === "" ? "isActive" : ""}`}
                  type="button"
                  aria-pressed={tagFilter === ""}
                  onClick={() => setTagFilter("")}
                >
                  全部
                </button>
                {allTags.map((tag) => (
                  <button
                    className={`tagFilterButton ${tagFilter === tag ? "isActive" : ""}`}
                    key={tag}
                    type="button"
                    aria-pressed={tagFilter === tag}
                    onClick={() => setTagFilter(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>

              {allTags.length === 0 && <p className="mutedText">给视频添加标签后，这里会出现可点击的过滤项。</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panelTitle">
              <Highlighter size={18} />
              <h2>高光</h2>
            </div>

            {activeMedia ? (
              <>
                <div className="activeFile">
                  <strong>{activeMedia.displayName}</strong>
                  <span>{shortPath(activeMedia.sourcePath)}</span>
                </div>

                <div className="timeReadout">
                  <Gauge size={17} />
                  <span>{formatTime(activeState?.currentTime)} / {formatTime(activeDuration)}</span>
                </div>

                <div className="buttonCluster">
                  <button className="iconButton" type="button" onClick={() => seekActive(-5)} title="后退 5 秒">
                    <SkipBack size={17} />
                  </button>
                  <button className="iconButton" type="button" onClick={() => seekActive(5)} title="前进 5 秒">
                    <SkipForward size={17} />
                  </button>
                  <button type="button" onClick={() => setDraftPoint("start")}>
                    <ScissorsLineDashed size={17} />
                    入点
                  </button>
                  <button type="button" onClick={() => setDraftPoint("end")}>
                    <Check size={17} />
                    出点
                  </button>
                </div>

                <div className="markForm">
                  <label>
                    开始
                    <input value={draft.start} onChange={(event) => setDraft((state) => ({ ...state, start: event.target.value }))} />
                  </label>
                  <label>
                    结束
                    <input value={draft.end} onChange={(event) => setDraft((state) => ({ ...state, end: event.target.value }))} />
                  </label>
                  <label className="noteField">
                    注释
                    <textarea
                      value={draft.note}
                      onChange={(event) => setDraft((state) => ({ ...state, note: event.target.value }))}
                      placeholder="例如：关键镜头、异常片段、精彩段落"
                    />
                  </label>
                  <button className="primaryButton fullWidth" type="button" onClick={saveHighlight}>
                    <BookmarkPlus size={18} />
                    {draft.id ? "更新高光" : "保存高光"}
                  </button>
                </div>

                <div className="highlightList">
                  {sortedActiveHighlights.length === 0 ? (
                    <p className="mutedText">当前视频还没有高光。</p>
                  ) : (
                    sortedActiveHighlights.map((highlight) => (
                      <article className="highlightItem" key={highlight.id}>
                        <button className="highlightJump" type="button" onClick={() => seekToHighlight(highlight)}>
                          <Play size={15} />
                          {formatTime(highlight.start)} - {formatTime(highlight.end)}
                        </button>
                        <p>{highlight.note || "无注释"}</p>
                        <div className="rowActions">
                          <button type="button" onClick={() => editHighlight(highlight)} title="编辑">
                            <Edit3 size={15} />
                          </button>
                          <button type="button" onClick={() => deleteHighlight(highlight.id)} title="删除">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <p className="mutedText">选择或拖入视频后，可以在这里标记时间段。</p>
            )}
          </section>

          <section className="panel">
            <div className="panelTitle">
              <Download size={18} />
              <h2>M3U8 转 MP4</h2>
            </div>

            <div className="downloadForm">
              <label>
                M3U8
                <div className="inputWithButton">
                  <input
                    value={m3u8Source}
                    onChange={(event) => setM3u8Source(event.target.value)}
                    placeholder="https://.../index.m3u8 或本地路径"
                  />
                  <button type="button" onClick={pickM3u8Playlist} title="选择本地 M3U8">
                    <FolderOpen size={16} />
                  </button>
                </div>
              </label>

              <label>
                输出
                <div className="inputWithButton">
                  <input value={m3u8Output} onChange={(event) => setM3u8Output(event.target.value)} placeholder="保存为 .mp4" />
                  <button type="button" onClick={chooseM3u8Output} title="选择输出位置">
                    <Save size={16} />
                  </button>
                </div>
              </label>

              <div className="buttonCluster">
                <button className="primaryButton" type="button" onClick={startM3u8Download} disabled={!canDownload}>
                  <FileDown size={17} />
                  转存
                </button>
                <button className="iconButton" type="button" onClick={cancelM3u8Download} disabled={download?.status !== "running"}>
                  <X size={17} />
                </button>
                <button
                  className="iconButton"
                  type="button"
                  onClick={() => download?.outputPath && window.lplay.revealPath(download.outputPath)}
                  disabled={!download?.outputPath}
                  title="打开所在位置"
                >
                  <FolderOpen size={17} />
                </button>
              </div>

              {download && (
                <div className={`downloadStatus ${download.status}`}>
                  <div className="progressBar">
                    <span style={{ width: `${download.percent ?? 12}%` }} />
                  </div>
                  <div className="downloadMeta">
                    <span>{download.message || download.status}</span>
                    <span>
                      {download.percent !== undefined ? `${Math.round(download.percent)}%` : formatTime(download.outSeconds)}
                      {download.speed ? ` · ${download.speed}` : ""}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panelTitle">
              <Magnet size={18} />
              <h2>磁力下载</h2>
            </div>

            <div className="downloadForm">
              <label>
                磁力链接
                <textarea
                  className="magnetInput"
                  value={magnetUri}
                  onChange={(event) => setMagnetUri(event.target.value)}
                  placeholder="magnet:?xt=urn:btih:..."
                />
              </label>

              <label>
                默认下载文件夹
                <div className="inputWithButton">
                  <input value={magnetDownloadDir} readOnly placeholder="默认保存到系统下载目录 / Lplay" />
                  <button type="button" onClick={chooseMagnetDownloadDir} title="预设下载文件夹">
                    <FolderOpen size={16} />
                  </button>
                </div>
              </label>

              <div className="buttonCluster">
                <button className="primaryButton" type="button" onClick={startMagnetDownload} disabled={!canStartMagnetDownload}>
                  <Download size={17} />
                  下载
                </button>
                <button className="iconButton" type="button" onClick={cancelMagnetDownload} disabled={!magnetBusy} title="取消下载">
                  <X size={17} />
                </button>
                <button
                  className="iconButton"
                  type="button"
                  onClick={() => magnetDownloadDir && window.lplay.revealPath(magnetDownloadDir)}
                  disabled={!magnetDownloadDir}
                  title="打开下载文件夹"
                >
                  <FolderOpen size={17} />
                </button>
              </div>

              {magnetDownload && (
                <div className={`downloadStatus ${magnetDownload.status}`}>
                  <div className="progressBar">
                    <span style={{ width: `${magnetDownload.percent ?? (magnetBusy ? 12 : 0)}%` }} />
                  </div>
                  <div className="downloadMeta">
                    <span>{magnetDownload.name || magnetDownload.message || magnetDownload.status}</span>
                    <span>
                      {magnetDownload.percent !== undefined ? `${Math.round(magnetDownload.percent)}%` : magnetDownload.status}
                    </span>
                  </div>
                  <div className="downloadMeta">
                    <span>
                      {formatBytes(magnetDownload.downloaded)} / {formatBytes(magnetDownload.total)}
                    </span>
                    <span>
                      {formatBytes(magnetDownload.downloadSpeed)}/s · {magnetDownload.peers || 0} peers
                    </span>
                  </div>
                  {magnetDownload.message && <p className="downloadMessage">{magnetDownload.message}</p>}
                  {magnetDownload.files && magnetDownload.files.length > 0 && (
                    <div className="magnetFileList">
                      {magnetDownload.files.slice(0, 5).map((file) => (
                        <div className="magnetFileItem" key={file.path}>
                          <span>{file.name}</span>
                          <small>
                            {Math.round(file.progress)}% · {formatBytes(file.downloaded)} / {formatBytes(file.length)}
                          </small>
                        </div>
                      ))}
                      {magnetDownload.files.length > 5 && <small className="mutedText">还有 {magnetDownload.files.length - 5} 个文件</small>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="panel compactPanel">
            <div className="panelTitle">
              <Clock3 size={18} />
              <h2>播放历史</h2>
            </div>

            {history.length === 0 ? (
              <p className="mutedText">播放过的视频会显示在这里。</p>
            ) : (
              <div className="historyList">
                {history.slice(0, 8).map((item) => (
                  <article className="historyItem" key={item.sourcePath}>
                    <button className="historyMain" type="button" onClick={() => void openHistoryItem(item)}>
                      <RotateCcw size={15} />
                      <span>
                        <strong>{item.displayName}</strong>
                        <small>
                          {formatTime(item.currentTime)} / {formatTime(item.duration)} · {formatDateTime(item.lastPlayedAt)}
                        </small>
                      </span>
                    </button>
                    <div className="rowActions">
                      <button type="button" onClick={() => window.lplay.revealPath(item.sourcePath)} title="打开所在位置">
                        <FolderOpen size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistory((current) => current.filter((entry) => entry.sourcePath !== item.sourcePath))}
                        title="删除记录"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel compactPanel">
            <div className="panelTitle">
              <Volume2 size={18} />
              <h2>当前会话</h2>
            </div>
            <div className="sessionStats">
              <span>视频：{videoCountText}</span>
              <span>标签：{allTags.length}</span>
              <span>高光：{Object.values(highlights).reduce((total, list) => total + list.length, 0)}</span>
              <span>转码任务：{Object.keys(conversionJobs).length}</span>
            </div>
          </section>
        </aside>
        )}
      </main>
    </div>
  );
}
