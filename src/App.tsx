import {
  BookmarkPlus,
  Check,
  Clock3,
  Download,
  Edit3,
  FileDown,
  FileVideo,
  FolderPlus,
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
  Search,
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
import type { ConversionCandidate, ConversionProgress, Highlight, M3u8Progress, MagnetProgress, PlaybackState, PreparedMedia } from "./types";

const HIGHLIGHT_STORAGE_KEY = "lplay.highlights.v1";
const HISTORY_STORAGE_KEY = "lplay.history.v1";
const SNAPSHOT_STORAGE_KEY = "lplay.snapshots.v1";
const UI_STORAGE_KEY = "lplay.ui.v1";
const VIDEO_METADATA_STORAGE_KEY = "lplay.videoMetadata.v1";
const MAGNET_RECORD_STORAGE_KEY = "lplay.magnetRecords.v1";
const VIDEO_RATING_MAX = 10;
const MAX_TAGS_PER_VIDEO = 12;
const MAX_MAGNET_RECORDS = 20;
const MAX_HISTORY_ITEMS = 5000;
const MAX_PLAYBACK_SNAPSHOTS = 30;

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

type PlaybackSnapshotVideo = {
  sourcePath: string;
  displayName: string;
  originalExtension: string;
  currentTime: number;
  duration: number;
};

type PlaybackSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  activeSourcePath: string;
  videos: PlaybackSnapshotVideo[];
};

type MagnetRecord = MagnetProgress & {
  createdAt: number;
  updatedAt: number;
};

const SORT_MODES = ["added", "rating-desc", "rating-asc", "name-asc", "name-desc"] as const;
const RATING_FILTER_MODES = ["all", "unrated", "rated", "at-least"] as const;
const INSPECTOR_TABS = ["library", "highlights", "downloads"] as const;
const LIBRARY_TABS = ["history", "snapshots"] as const;

type SortMode = (typeof SORT_MODES)[number];
type RatingFilterMode = (typeof RATING_FILTER_MODES)[number];
type InspectorTab = (typeof INSPECTOR_TABS)[number];
type LibraryTab = (typeof LIBRARY_TABS)[number];

type VideoMetadata = {
  rating: number;
  tags: string[];
  ratingScale: number;
  updatedAt: number;
};

type VideoMetadataLibrary = Record<string, VideoMetadata>;

type UiState = {
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  libraryTab: LibraryTab;
  sortMode: SortMode;
  ratingFilterMode: RatingFilterMode;
  librarySearchQuery: string;
  tagFilter: string;
  minRatingFilter: number;
};

const defaultUiState: UiState = {
  inspectorOpen: true,
  inspectorTab: "library",
  libraryTab: "history",
  sortMode: "added",
  ratingFilterMode: "all",
  librarySearchQuery: "",
  tagFilter: "",
  minRatingFilter: 0
};

const defaultVideoMetadata: VideoMetadata = {
  rating: 0,
  tags: [],
  ratingScale: VIDEO_RATING_MAX,
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

function normalizeSnapshot(value: unknown): PlaybackSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === "string" ? entry.id : "";
  const name = typeof entry.name === "string" ? entry.name : "";
  const createdAt = Number(entry.createdAt);
  const activeSourcePath = typeof entry.activeSourcePath === "string" ? entry.activeSourcePath : "";
  const rawVideos = Array.isArray(entry.videos) ? entry.videos : [];
  const videos = rawVideos
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const video = item as Record<string, unknown>;
      const sourcePath = typeof video.sourcePath === "string" ? video.sourcePath : "";
      if (!sourcePath) {
        return null;
      }

      const currentTime = Number(video.currentTime);
      const duration = Number(video.duration);
      return {
        sourcePath,
        displayName: typeof video.displayName === "string" ? video.displayName : baseNameFromPath(sourcePath),
        originalExtension: typeof video.originalExtension === "string" ? video.originalExtension : extensionFromPath(sourcePath),
        currentTime: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
        duration: Number.isFinite(duration) ? Math.max(0, duration) : 0
      };
    })
    .filter((item): item is PlaybackSnapshotVideo => Boolean(item));

  if (!id || videos.length === 0) {
    return null;
  }

  return {
    id,
    name: name || `快照 ${videos.length} 路`,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    activeSourcePath,
    videos
  };
}

function loadPlaybackSnapshots(): PlaybackSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizeSnapshot(item))
      .filter((item): item is PlaybackSnapshot => Boolean(item))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_PLAYBACK_SNAPSHOTS);
  } catch {
    return [];
  }
}

function normalizeRating(value: unknown) {
  const rating = Number(value);
  return Number.isFinite(rating) ? Math.max(0, Math.min(VIDEO_RATING_MAX, Math.round(rating))) : 0;
}

function matchesRatingFilter(ratingValue: unknown, mode: RatingFilterMode, minRating: number) {
  const rating = normalizeRating(ratingValue);
  if (mode === "unrated") {
    return rating === 0;
  }

  if (mode === "rated") {
    return rating > 0;
  }

  if (mode === "at-least") {
    return rating >= Math.max(1, normalizeRating(minRating));
  }

  return true;
}

function normalizeSearchTerms(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/[\s,，、#]+/)
    .filter(Boolean);
}

function matchesLibrarySearch(displayName: string, tags: string[], terms: string[]) {
  if (terms.length === 0) {
    return true;
  }

  const normalizedName = displayName.toLowerCase();
  const normalizedTags = tags.join(" ").toLowerCase();
  return terms.every((term) => normalizedName.includes(term) || normalizedTags.includes(term));
}

function normalizeStoredRating(entry: Record<string, unknown>) {
  const rating = Number(entry.rating);
  if (!Number.isFinite(rating) || rating <= 0) {
    return 0;
  }

  if (Number(entry.ratingScale) === VIDEO_RATING_MAX) {
    return normalizeRating(rating);
  }

  return normalizeRating(rating * 2);
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
        rating: normalizeStoredRating(entry),
        tags: normalizeTags(entry.tags),
        ratingScale: VIDEO_RATING_MAX,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
      };
      return library;
    }, {});
  } catch {
    return {};
  }
}

function normalizeMagnetRecord(value: unknown): MagnetRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const jobId = typeof entry.jobId === "string" ? entry.jobId : "";
  const magnetUri = typeof entry.magnetUri === "string" ? entry.magnetUri : "";
  const downloadDir = typeof entry.downloadDir === "string" ? entry.downloadDir : "";
  const status = typeof entry.status === "string" ? entry.status : "error";
  const validStatus = ["resolving", "downloading", "done", "error", "cancelled"].includes(status)
    ? (status as MagnetRecord["status"])
    : "error";
  const createdAt = Number(entry.createdAt);
  const updatedAt = Number(entry.updatedAt);

  if (!jobId || !magnetUri) {
    return null;
  }

  const restoredStatus = validStatus === "resolving" || validStatus === "downloading" ? "cancelled" : validStatus;

  return {
    jobId,
    magnetUri,
    downloadDir,
    status: restoredStatus,
    name: typeof entry.name === "string" ? entry.name : "",
    infoHash: typeof entry.infoHash === "string" ? entry.infoHash : "",
    percent: typeof entry.percent === "number" ? entry.percent : undefined,
    downloaded: typeof entry.downloaded === "number" ? entry.downloaded : undefined,
    total: typeof entry.total === "number" ? entry.total : undefined,
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    message:
      restoredStatus !== validStatus
        ? "应用已关闭，任务已停止，可手动重试。"
        : typeof entry.message === "string"
          ? entry.message
          : undefined,
    files: Array.isArray(entry.files) ? (entry.files as MagnetRecord["files"]) : undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function loadMagnetRecords() {
  try {
    const raw = localStorage.getItem(MAGNET_RECORD_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => normalizeMagnetRecord(item))
      .filter((item): item is MagnetRecord => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_MAGNET_RECORDS);
  } catch {
    return [];
  }
}

function isSortMode(value: unknown): value is SortMode {
  return typeof value === "string" && (SORT_MODES as readonly string[]).includes(value);
}

function isRatingFilterMode(value: unknown): value is RatingFilterMode {
  return typeof value === "string" && (RATING_FILTER_MODES as readonly string[]).includes(value);
}

function isInspectorTab(value: unknown): value is InspectorTab {
  return typeof value === "string" && (INSPECTOR_TABS as readonly string[]).includes(value);
}

function isLibraryTab(value: unknown): value is LibraryTab {
  return typeof value === "string" && (LIBRARY_TABS as readonly string[]).includes(value);
}

function baseNameFromPath(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function extensionFromPath(filePath: string) {
  const baseName = baseNameFromPath(filePath);
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex >= 0 ? baseName.slice(dotIndex + 1).toLowerCase() : "";
}

function loadUiState(): UiState {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) {
      return defaultUiState;
    }

    const parsed = JSON.parse(raw);
    const minRatingFilter = normalizeRating(parsed?.minRatingFilter);
    return {
      inspectorOpen: parsed?.inspectorOpen !== false,
      inspectorTab: isInspectorTab(parsed?.inspectorTab) ? parsed.inspectorTab : defaultUiState.inspectorTab,
      libraryTab: isLibraryTab(parsed?.libraryTab) ? parsed.libraryTab : defaultUiState.libraryTab,
      sortMode: isSortMode(parsed?.sortMode) ? parsed.sortMode : defaultUiState.sortMode,
      ratingFilterMode: isRatingFilterMode(parsed?.ratingFilterMode)
        ? parsed.ratingFilterMode
        : minRatingFilter > 0
          ? "at-least"
          : defaultUiState.ratingFilterMode,
      librarySearchQuery: typeof parsed?.librarySearchQuery === "string" ? parsed.librarySearchQuery : defaultUiState.librarySearchQuery,
      tagFilter: typeof parsed?.tagFilter === "string" ? parsed.tagFilter : defaultUiState.tagFilter,
      minRatingFilter
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

function isMagnetBusy(record?: Pick<MagnetProgress, "status"> | null) {
  return record?.status === "resolving" || record?.status === "downloading";
}

function magnetStatusLabel(status: MagnetProgress["status"]) {
  switch (status) {
    case "resolving":
      return "解析中";
    case "downloading":
      return "下载中";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    case "error":
    default:
      return "错误";
  }
}

export default function App() {
  const [initialUi] = useState(() => loadUiState());
  const [media, setMedia] = useState<PreparedMedia[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [playback, setPlayback] = useState<Record<string, PlaybackState>>({});
  const [highlights, setHighlights] = useState<HighlightLibrary>(() => loadHighlightLibrary());
  const [history, setHistory] = useState<PlaybackHistoryItem[]>(() => loadPlaybackHistory());
  const [snapshots, setSnapshots] = useState<PlaybackSnapshot[]>(() => loadPlaybackSnapshots());
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadataLibrary>(() => loadVideoMetadataLibrary());
  const [inspectorOpen, setInspectorOpen] = useState(initialUi.inspectorOpen);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(initialUi.inspectorTab);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>(initialUi.libraryTab);
  const [sortMode, setSortMode] = useState<SortMode>(initialUi.sortMode);
  const [ratingFilterMode, setRatingFilterMode] = useState<RatingFilterMode>(initialUi.ratingFilterMode);
  const [librarySearchQuery, setLibrarySearchQuery] = useState(initialUi.librarySearchQuery);
  const [tagFilter, setTagFilter] = useState(initialUi.tagFilter);
  const [minRatingFilter, setMinRatingFilter] = useState(initialUi.minRatingFilter);
  const [draft, setDraft] = useState<DraftHighlight>(emptyDraft);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [notice, setNotice] = useState("");
  const [conversionRequests, setConversionRequests] = useState<ConversionCandidate[]>([]);
  const [conversionJobs, setConversionJobs] = useState<Record<string, ConversionProgress>>({});
  const [m3u8Source, setM3u8Source] = useState("");
  const [m3u8Output, setM3u8Output] = useState("");
  const [download, setDownload] = useState<DownloadState | null>(null);
  const [conversionCacheDir, setConversionCacheDir] = useState("");
  const [magnetUri, setMagnetUri] = useState("");
  const [magnetDownloadDir, setMagnetDownloadDir] = useState("");
  const [magnetRecords, setMagnetRecords] = useState<MagnetRecord[]>(() => loadMagnetRecords());
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const decodeWatchers = useRef(new Map<string, number>());
  const pendingSeek = useRef(new Map<string, number>());
  const historyTouchTimes = useRef(new Map<string, number>());

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    const sourcePaths = new Set([...media.map((item) => item.sourcePath), ...history.map((item) => item.sourcePath)]);
    for (const sourcePath of sourcePaths) {
      for (const tag of videoMetadata[sourcePath]?.tags || []) {
        tags.add(tag);
      }
    }

    return Array.from(tags).sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [history, media, videoMetadata]);

  const librarySearchTerms = useMemo(() => normalizeSearchTerms(librarySearchQuery), [librarySearchQuery]);

  const visibleMedia = useMemo(() => {
    const filtered = media.filter((item) => {
      const metadata = videoMetadata[item.sourcePath] || defaultVideoMetadata;
      if (tagFilter && !metadata.tags.includes(tagFilter)) {
        return false;
      }

      if (!matchesLibrarySearch(item.displayName, metadata.tags, librarySearchTerms)) {
        return false;
      }

      return matchesRatingFilter(metadata.rating, ratingFilterMode, minRatingFilter);
    });

    if (sortMode === "added") {
      return filtered;
    }

    const order = new Map(media.map((item, index) => [item.id, index]));
    return [...filtered].sort((left, right) => {
      const leftRating = videoMetadata[left.sourcePath]?.rating || 0;
      const rightRating = videoMetadata[right.sourcePath]?.rating || 0;
      if (sortMode === "rating-desc" || sortMode === "rating-asc") {
        const ratingDelta = sortMode === "rating-desc" ? rightRating - leftRating : leftRating - rightRating;
        return ratingDelta || left.displayName.localeCompare(right.displayName, "zh-CN") || (order.get(left.id) || 0) - (order.get(right.id) || 0);
      }

      const nameDelta = left.displayName.localeCompare(right.displayName, "zh-CN");
      return sortMode === "name-asc" ? nameDelta : -nameDelta;
    });
  }, [librarySearchTerms, media, minRatingFilter, ratingFilterMode, sortMode, tagFilter, videoMetadata]);

  const visibleHistory = useMemo(() => {
    const filtered = history.filter((item) => {
      const metadata = videoMetadata[item.sourcePath] || defaultVideoMetadata;
      if (tagFilter && !metadata.tags.includes(tagFilter)) {
        return false;
      }

      if (!matchesLibrarySearch(item.displayName, metadata.tags, librarySearchTerms)) {
        return false;
      }

      return matchesRatingFilter(metadata.rating, ratingFilterMode, minRatingFilter);
    });

    if (sortMode === "added") {
      return filtered;
    }

    return [...filtered].sort((left, right) => {
      const leftRating = videoMetadata[left.sourcePath]?.rating || 0;
      const rightRating = videoMetadata[right.sourcePath]?.rating || 0;
      if (sortMode === "rating-desc" || sortMode === "rating-asc") {
        const ratingDelta = sortMode === "rating-desc" ? rightRating - leftRating : leftRating - rightRating;
        return ratingDelta || left.displayName.localeCompare(right.displayName, "zh-CN") || right.lastPlayedAt - left.lastPlayedAt;
      }

      const nameDelta = left.displayName.localeCompare(right.displayName, "zh-CN");
      return sortMode === "name-asc" ? nameDelta : -nameDelta;
    });
  }, [history, librarySearchTerms, minRatingFilter, ratingFilterMode, sortMode, tagFilter, videoMetadata]);

  const filtersActive = Boolean(tagFilter || ratingFilterMode !== "all" || librarySearchTerms.length > 0);

  const activeMedia = media.find((item) => item.id === activeId) || media[0];
  const activeMagnetRecord = magnetRecords.find((record) => isMagnetBusy(record));
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
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots.slice(0, MAX_PLAYBACK_SNAPSHOTS)));
  }, [snapshots]);

  useEffect(() => {
    localStorage.setItem(VIDEO_METADATA_STORAGE_KEY, JSON.stringify(videoMetadata));
  }, [videoMetadata]);

  useEffect(() => {
    localStorage.setItem(MAGNET_RECORD_STORAGE_KEY, JSON.stringify(magnetRecords.slice(0, MAX_MAGNET_RECORDS)));
  }, [magnetRecords]);

  useEffect(() => {
    localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({ inspectorOpen, inspectorTab, libraryTab, sortMode, ratingFilterMode, librarySearchQuery, tagFilter, minRatingFilter })
    );
  }, [inspectorOpen, inspectorTab, librarySearchQuery, libraryTab, minRatingFilter, ratingFilterMode, sortMode, tagFilter]);

  useEffect(() => {
    const unsubscribeConversion = window.lplay.onConversionProgress((payload) => {
      setConversionJobs((current) => ({
        ...current,
        [payload.jobId]: payload
      }));

      if (payload.stage === "ready" || payload.stage === "cached" || payload.stage === "error") {
        window.setTimeout(() => {
          setConversionJobs((current) => {
            const next = { ...current };
            delete next[payload.jobId];
            return next;
          });
        }, 5000);
      }
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
      upsertMagnetRecord(payload);
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
    if (!notice || isPreparing) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [isPreparing, notice]);

  useEffect(() => {
    void window.lplay.getMagnetDownloadDir().then((downloadDir) => {
      if (downloadDir) {
        setMagnetDownloadDir(downloadDir);
      }
    });
  }, []);

  useEffect(() => {
    void window.lplay.getConversionCacheDir().then((cacheDir) => {
      if (cacheDir) {
        setConversionCacheDir(cacheDir);
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
        ratingScale: VIDEO_RATING_MAX,
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

  function upsertConversionRequests(requests: ConversionCandidate[]) {
    if (requests.length === 0) {
      return;
    }

    setConversionRequests((current) => {
      const byPath = new Map(current.map((item) => [item.filePath, item]));
      for (const request of requests) {
        byPath.set(request.filePath, request);
      }
      return Array.from(byPath.values());
    });
  }

  function requestConversionForItem(item: PreparedMedia, reason = "播放失败，需要转为兼容 MP4。") {
    if (item.converted) {
      updatePlayback(item.id, { error: "兼容 MP4 仍无法播放" });
      return;
    }

    upsertConversionRequests([
      {
        filePath: item.sourcePath,
        fileName: item.displayName,
        extension: item.originalExtension,
        reason,
        metadata: item.metadata
      }
    ]);
    updatePlayback(item.id, { error: "需要转码后播放，请在右侧“下载”中确认。" });
    setInspectorOpen(true);
    setInspectorTab("downloads");
    setNotice(`${item.displayName} 需要转码，等待确认`);
  }

  async function chooseConversionCacheDir() {
    const picked = await window.lplay.chooseConversionCacheDir();
    if (picked) {
      setConversionCacheDir(picked);
    }
  }

  async function approveConversion(request: ConversionCandidate) {
    setIsPreparing(true);
    setNotice(`正在转码 ${request.fileName}`);

    try {
      const compatible = await window.lplay.makeMediaCompatible(request.filePath);
      setMedia((current) => {
        const existing = current.find((item) => item.sourcePath === request.filePath);
        if (!existing) {
          return [...current, compatible];
        }

        return current.map((item) => (item.sourcePath === request.filePath ? { ...compatible, id: item.id } : item));
      });

      const existing = media.find((item) => item.sourcePath === request.filePath);
      upsertHistory(compatible, {
        duration: compatible.metadata?.duration || 0,
        currentTime: 0,
        lastOpenedAt: Date.now(),
        lastPlayedAt: Date.now()
      });
      setConversionRequests((current) => current.filter((item) => item.filePath !== request.filePath));
      if (!activeId || existing?.id === activeId) {
        setActiveId(existing?.id || compatible.id);
      }
      updatePlayback(existing?.id || compatible.id, { error: undefined, currentTime: 0, paused: true });
      setNotice(`${request.fileName} 转码完成`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "转码失败");
    } finally {
      setIsPreparing(false);
    }
  }

  async function approveAllConversions() {
    for (const request of conversionRequests) {
      await approveConversion(request);
    }
  }

  function removeConversionRequest(filePath: string) {
    setConversionRequests((current) => current.filter((item) => item.filePath !== filePath));
  }

  function upsertMagnetRecord(payload: MagnetProgress) {
    setMagnetRecords((current) => {
      const now = Date.now();
      const existing = current.find((record) => record.jobId === payload.jobId);
      const nextRecord: MagnetRecord = {
        ...existing,
        ...payload,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };

      return [nextRecord, ...current.filter((record) => record.jobId !== payload.jobId)]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_MAGNET_RECORDS);
    });
  }

  function removeMagnetRecord(jobId: string) {
    const record = magnetRecords.find((item) => item.jobId === jobId);
    if (isMagnetBusy(record)) {
      void window.lplay.cancelMagnetDownload(jobId);
    }

    setMagnetRecords((current) => current.filter((item) => item.jobId !== jobId));
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
        requestConversionForItem(item, "当前编码无法解码，需要确认转为兼容 MP4 后播放。");
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
        .slice(0, MAX_HISTORY_ITEMS);
    });
  }

  function importHistoryRecords(filePaths: string[]) {
    const now = Date.now();
    const distinctPaths = Array.from(new Set(filePaths.filter(Boolean)));
    const knownPaths = new Set(history.map((item) => item.sourcePath));
    const newPaths = distinctPaths.filter((filePath) => !knownPaths.has(filePath));
    const additions = newPaths
      .slice(0, MAX_HISTORY_ITEMS)
      .map<PlaybackHistoryItem>((filePath, index) => ({
        sourcePath: filePath,
        displayName: baseNameFromPath(filePath),
        originalExtension: extensionFromPath(filePath),
        duration: 0,
        currentTime: 0,
        lastOpenedAt: now - index,
        lastPlayedAt: now - index
      }));

    if (additions.length > 0) {
      setHistory((current) => [...additions, ...current].slice(0, MAX_HISTORY_ITEMS));
    }

    const duplicateCount = distinctPaths.length - newPaths.length;
    const skippedByLimit = Math.max(0, newPaths.length - additions.length);
    setNotice(
      additions.length > 0
        ? `已导入 ${additions.length} 个视频记录${duplicateCount > 0 ? `，跳过 ${duplicateCount} 个重复记录` : ""}${skippedByLimit > 0 ? `，达到记录上限跳过 ${skippedByLimit} 个` : ""}`
        : duplicateCount > 0
          ? "选择的文件夹没有新的可导入视频记录"
          : "没有找到可导入的视频文件"
    );
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

  function savePlaybackSnapshot() {
    const sourceItems = media;
    if (sourceItems.length === 0) {
      setNotice("当前没有可保存的视频画面");
      return;
    }

    const now = Date.now();
    const videos = sourceItems.map<PlaybackSnapshotVideo>((item) => {
      const video = videoRefs.current.get(item.id);
      const state = playback[item.id];
      const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : state?.currentTime || 0;
      const duration =
        video && Number.isFinite(video.duration)
          ? video.duration
          : state?.duration || item.metadata?.duration || 0;

      return {
        sourcePath: item.sourcePath,
        displayName: item.displayName,
        originalExtension: item.originalExtension,
        currentTime,
        duration
      };
    });

    const snapshot: PlaybackSnapshot = {
      id: randomId(),
      name: `${videos.length} 路视频 · ${formatDateTime(now)}`,
      createdAt: now,
      activeSourcePath: activeMedia?.sourcePath || videos[0]?.sourcePath || "",
      videos
    };

    setSnapshots((current) => [snapshot, ...current].slice(0, MAX_PLAYBACK_SNAPSHOTS));
    setInspectorOpen(true);
    setInspectorTab("library");
    setLibraryTab("snapshots");
    setNotice(`已保存快照：${snapshot.name}`);
  }

  async function openPlaybackSnapshot(snapshot: PlaybackSnapshot) {
    if (snapshot.videos.length === 0) {
      setNotice("这个快照没有可打开的视频");
      return;
    }

    for (const item of snapshot.videos) {
      pendingSeek.current.set(item.sourcePath, item.currentTime || 0);
    }

    const added = await addFiles(
      snapshot.videos.map((item) => item.sourcePath),
      { replace: true }
    );
    const active = added.find((item) => item.sourcePath === snapshot.activeSourcePath) || added[0];
    if (active) {
      setActiveId(active.id);
    }
    setNotice(`已打开快照：${snapshot.name}`);
  }

  function deletePlaybackSnapshot(snapshotId: string) {
    setSnapshots((current) => current.filter((snapshot) => snapshot.id !== snapshotId));
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

  async function addFiles(filePaths: string[], options: { allowConversion?: boolean; replace?: boolean } = {}) {
    const distinctPaths = Array.from(new Set(filePaths.filter(Boolean)));
    if (distinctPaths.length === 0) {
      return [];
    }

    if (options.replace) {
      for (const id of media.map((item) => item.id)) {
        clearDecodeWatcher(id);
      }
      setPlayback({});
      setActiveId("");
    }

    setIsPreparing(true);
    setNotice("正在准备视频");

    try {
      const response = await window.lplay.prepareMediaFiles(distinctPaths, { allowConversion: Boolean(options.allowConversion) });
      const conversions = response.conversions || [];
      const errors = response.errors || [];

      setMedia((current) => {
        if (options.replace) {
          return response.results;
        }

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
        setActiveId((current) => (options.replace ? response.results[0].id : current || response.results[0].id));
      }

      if (conversions.length > 0) {
        upsertConversionRequests(conversions);
        setInspectorOpen(true);
        setInspectorTab("downloads");
      }

      const messages: string[] = [];
      if (response.results.length > 0) {
        messages.push(`已加入 ${response.results.length} 个视频`);
      }
      if (conversions.length > 0) {
        messages.push(`${conversions.length} 个视频需要确认转码`);
      }
      if (errors.length > 0) {
        messages.push(errors.map((error) => error.message).join("；"));
      }

      setNotice(messages.join("；") || "没有可导入的视频");
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

  async function handlePickFolderRecords() {
    setIsPreparing(true);
    setNotice("正在扫描文件夹");

    try {
      const paths = await window.lplay.pickVideoFolderFiles();
      importHistoryRecords(paths);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件夹导入失败");
    } finally {
      setIsPreparing(false);
    }
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

  function clearPlaybackWindows() {
    for (const id of media.map((item) => item.id)) {
      clearDecodeWatcher(id);
    }
    setMedia([]);
    setPlayback({});
    setActiveId("");
    setNotice("已关闭当前所有播放窗口，播放记录已保留");
  }

  function playAll() {
    for (const item of media) {
      const video = videoRefs.current.get(item.id);
      if (video) {
        void video.play().catch(() => requestConversionForItem(item, "播放启动失败，需要确认转为兼容 MP4。"));
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

  async function startMagnetDownload(sourceValue = magnetUri, downloadDirValue = magnetDownloadDir) {
    const source = sourceValue.trim();
    const jobId = randomId();

    if (!isMagnetLink(source)) {
      upsertMagnetRecord({
        jobId,
        magnetUri: source,
        downloadDir: downloadDirValue,
        status: "error",
        message: "请输入有效的磁力链接。"
      });
      return;
    }

    setMagnetUri(source);
    upsertMagnetRecord({
      jobId,
      magnetUri: source,
      downloadDir: downloadDirValue,
      status: "resolving",
      percent: 0,
      message: "正在解析磁力链接"
    });

    try {
      const started = await window.lplay.startMagnetDownload({
        jobId,
        magnetUri: source,
        downloadDir: downloadDirValue
      });
      upsertMagnetRecord(started);
      if (started.downloadDir) {
        setMagnetDownloadDir(started.downloadDir);
      }
    } catch (error) {
      upsertMagnetRecord({
        jobId,
        magnetUri: source,
        downloadDir: downloadDirValue,
        status: "error",
        message: error instanceof Error ? error.message : "磁力下载启动失败"
      });
    }
  }

  async function cancelMagnetDownload(jobId = activeMagnetRecord?.jobId) {
    if (!jobId) {
      return;
    }

    await window.lplay.cancelMagnetDownload(jobId);
    setMagnetRecords((current) =>
      current.map((record) =>
        record.jobId === jobId
          ? {
              ...record,
              status: "cancelled",
              message: "已取消",
              updatedAt: Date.now()
            }
          : record
      )
    );
  }

  const activeDuration = activeState?.duration || activeMedia?.metadata?.duration || 0;
  const canDownload = Boolean(m3u8Source.trim() && m3u8Output.trim() && download?.status !== "running");
  const magnetBusy = Boolean(activeMagnetRecord);
  const canStartMagnetDownload = isMagnetLink(magnetUri) && !magnetBusy;
  const latestConversion = Object.values(conversionJobs)
    .filter((job) => !["cached", "ready", "error"].includes(job.stage))
    .slice(-3)
    .reverse();
  const videoCountText = filtersActive ? `${media.length} 路视频 · 筛选匹配 ${visibleMedia.length}` : `${media.length} 路视频`;

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand">
          <Video size={23} />
          <div>
            <strong>Lplay</strong>
            <span>{media.length > 0 ? videoCountText : "多路视频播放器"}</span>
          </div>
        </div>

        <div className="toolbar">
          <button className="primaryButton" type="button" onClick={handlePickFiles}>
            <FolderOpen size={18} />
            添加视频
          </button>
          <button type="button" onClick={() => void handlePickFolderRecords()} title="选择文件夹，批量导入到播放记录">
            <FolderPlus size={18} />
          </button>
          <button
            className="toolbarTextButton"
            type="button"
            onClick={savePlaybackSnapshot}
            disabled={media.length === 0}
            title="保存当前多路视频为快照"
          >
            <Save size={18} />
            保存快照
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
          <button
            className="toolbarTextButton"
            type="button"
            onClick={clearPlaybackWindows}
            disabled={media.length === 0}
            title="关闭当前所有播放窗口，不删除播放记录"
          >
            <X size={18} />
            清空窗口
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
              <button type="button" onClick={() => void handlePickFolderRecords()}>
                <FolderPlus size={18} />
                导入文件夹记录
              </button>
            </div>
          ) : (
            <div className="videoGrid" style={{ gridTemplateColumns: gridColumns(media.length) }}>
              {media.map((item) => {
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
                        <div className="ratingEditor">
                          <div className="ratingControl" aria-label={`${item.displayName} 评分`}>
                            {Array.from({ length: VIDEO_RATING_MAX }, (_unused, index) => index + 1).map((score) => (
                              <button
                                className={score <= itemMetadata.rating ? "isRated" : ""}
                                key={score}
                                type="button"
                                title={`${score}/${VIDEO_RATING_MAX} 分`}
                                aria-pressed={score <= itemMetadata.rating}
                                onClick={() => setVideoRating(item.sourcePath, score)}
                              >
                                <Star size={12} fill={score <= itemMetadata.rating ? "currentColor" : "none"} />
                              </button>
                            ))}
                          </div>
                          <span className="ratingScore">{itemMetadata.rating > 0 ? `${itemMetadata.rating}/${VIDEO_RATING_MAX}` : "未评分"}</span>
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
                      onError={() => requestConversionForItem(item, "播放失败，需要确认转为兼容 MP4。")}
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
              <span className="statusStripText">{notice || "准备媒体"}</span>
              {latestConversion.map((job) => (
                <span className={`jobPill ${job.stage}`} key={job.jobId}>
                  {job.fileName}: {job.percent ? `${Math.round(job.percent)}%` : job.message}
                </span>
              ))}
              {notice && !isPreparing && (
                <button className="statusDismiss" type="button" onClick={() => setNotice("")} title="关闭提示">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
        </section>

        {inspectorOpen && (
          <aside className="inspector">
            <div className="inspectorTabs" role="tablist" aria-label="侧边栏功能区域">
              <button
                className={`inspectorTabButton ${inspectorTab === "library" ? "isActive" : ""}`}
                type="button"
                role="tab"
                aria-selected={inspectorTab === "library"}
                onClick={() => setInspectorTab("library")}
              >
                <ListFilter size={16} />
                播放库
              </button>
              <button
                className={`inspectorTabButton ${inspectorTab === "highlights" ? "isActive" : ""}`}
                type="button"
                role="tab"
                aria-selected={inspectorTab === "highlights"}
                onClick={() => setInspectorTab("highlights")}
              >
                <Highlighter size={16} />
                高光
              </button>
              <button
                className={`inspectorTabButton ${inspectorTab === "downloads" ? "isActive" : ""}`}
                type="button"
                role="tab"
                aria-selected={inspectorTab === "downloads"}
                onClick={() => setInspectorTab("downloads")}
              >
                <Download size={16} />
                下载
              </button>
            </div>

            <div className="inspectorContent">
              {inspectorTab === "library" && (
                <section className="panel libraryPanel">
                  <div className="filterControls">
                    <label className="compactFilterField searchFilterField">
                      <span>
                        <Search size={15} />
                        搜索
                      </span>
                      <input
                        className="selectInput"
                        value={librarySearchQuery}
                        onChange={(event) => setLibrarySearchQuery(event.target.value)}
                        placeholder="按名称或标签搜索"
                      />
                    </label>

                    <label className="compactFilterField">
                      <span>
                        <Star size={15} />
                        排序
                      </span>
                      <select className="selectInput" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                        <option value="added">记录顺序</option>
                        <option value="rating-desc">评分高到低</option>
                        <option value="rating-asc">评分低到高</option>
                        <option value="name-asc">名称 A-Z</option>
                        <option value="name-desc">名称 Z-A</option>
                      </select>
                    </label>

                    <label className="compactFilterField">
                      <span>
                        <Gauge size={15} />
                        评分过滤
                      </span>
                      <select
                        className="selectInput"
                        value={ratingFilterMode}
                        onChange={(event) => {
                          const nextMode = event.target.value as RatingFilterMode;
                          setRatingFilterMode(nextMode);
                          if (nextMode === "at-least" && minRatingFilter <= 0) {
                            setMinRatingFilter(1);
                          }
                        }}
                      >
                        <option value="all">全部评分</option>
                        <option value="unrated">未评分</option>
                        <option value="rated">已评分</option>
                        <option value="at-least">至少 N 分</option>
                      </select>
                    </label>

                    {ratingFilterMode === "at-least" && (
                      <div className="ratingFilterRow">
                        <input
                          className="ratingRange"
                          type="range"
                          min="0"
                          max={VIDEO_RATING_MAX}
                          step="1"
                          value={minRatingFilter}
                          onChange={(event) => setMinRatingFilter(normalizeRating(event.target.value))}
                        />
                        <strong>{minRatingFilter > 0 ? `${minRatingFilter}/${VIDEO_RATING_MAX}` : "全部"}</strong>
                      </div>
                    )}

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
                      {allTags.length === 0 && <span className="emptyTagHint">暂无标签</span>}
                    </div>

                    {filtersActive && (
                      <button
                        className="clearFilterButton"
                        type="button"
                        onClick={() => {
                          setLibrarySearchQuery("");
                          setTagFilter("");
                          setRatingFilterMode("all");
                          setMinRatingFilter(0);
                        }}
                      >
                        <X size={15} />
                        清除过滤
                      </button>
                    )}

                  </div>

                  <div className="librarySubTabs" role="tablist" aria-label="播放库内容">
                    <button
                      className={`librarySubTabButton ${libraryTab === "history" ? "isActive" : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={libraryTab === "history"}
                      onClick={() => setLibraryTab("history")}
                    >
                      播放记录
                      <small>{filtersActive ? `${visibleHistory.length}/${history.length}` : history.length}</small>
                    </button>
                    <button
                      className={`librarySubTabButton ${libraryTab === "snapshots" ? "isActive" : ""}`}
                      type="button"
                      role="tab"
                      aria-selected={libraryTab === "snapshots"}
                      onClick={() => setLibraryTab("snapshots")}
                    >
                      快照
                      <small>{snapshots.length}</small>
                    </button>
                  </div>

                  {libraryTab === "history" && (
                    <div className="libraryTabPanel">
                      <div className="libraryRecordsHeader">
                        <span>
                          播放记录
                          <small>
                            {filtersActive
                              ? `匹配 ${visibleMedia.length}/${media.length} · 记录 ${visibleHistory.length}/${history.length}`
                              : `${media.length} 个画面 · ${history.length} 条记录`}
                          </small>
                        </span>
                        <button type="button" onClick={() => void handlePickFolderRecords()}>
                          <FolderPlus size={15} />
                          导入文件夹
                        </button>
                      </div>

                      {history.length === 0 ? (
                        <p className="mutedText">播放过或从文件夹导入的视频会显示在这里。</p>
                      ) : visibleHistory.length === 0 ? (
                        <p className="mutedText">当前筛选条件下没有匹配记录。</p>
                      ) : (
                        <div className="historyList">
                          {visibleHistory.map((item) => {
                            const metadata = getVideoMetadata(item.sourcePath);
                            return (
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
                                <div className="historyMeta">
                                  <span>{metadata.rating > 0 ? `${metadata.rating}/${VIDEO_RATING_MAX}` : "未评分"}</span>
                                  {metadata.tags.slice(0, 3).map((tag) => (
                                    <button type="button" key={tag} onClick={() => setTagFilter(tag)}>
                                      #{tag}
                                    </button>
                                  ))}
                                </div>
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
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {libraryTab === "snapshots" && (
                    <div className="libraryTabPanel">
                      <div className="snapshotHint">
                        <span>从顶部工具栏保存当前多路视频组合。</span>
                      </div>
                      {snapshots.length === 0 ? (
                        <p className="mutedText">还没有保存的快照。</p>
                      ) : (
                        <div className="snapshotList">
                          {snapshots.map((snapshot) => (
                            <article className="snapshotItem" key={snapshot.id}>
                              <button className="snapshotMain" type="button" onClick={() => void openPlaybackSnapshot(snapshot)}>
                                <Play size={15} />
                                <span>
                                  <strong>{snapshot.name}</strong>
                                  <small>
                                    {snapshot.videos.length} 路 · {snapshot.videos.slice(0, 2).map((item) => item.displayName).join("、")}
                                    {snapshot.videos.length > 2 ? ` 等 ${snapshot.videos.length} 个` : ""}
                                  </small>
                                </span>
                              </button>
                              <div className="rowActions">
                                <button type="button" onClick={() => deletePlaybackSnapshot(snapshot.id)} title="删除快照">
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {inspectorTab === "highlights" && (
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
              )}

              {inspectorTab === "downloads" && (
                <>
                  <section className="panel">
                    <div className="panelTitle">
                      <ScissorsLineDashed size={18} />
                      <h2>兼容转码</h2>
                    </div>

                    <div className="downloadForm">
                      <label>
                        MP4 缓存目录
                        <div className="inputWithButton">
                          <input value={conversionCacheDir} readOnly placeholder="默认保存到应用数据目录 / converted" />
                          <button type="button" onClick={() => void chooseConversionCacheDir()} title="修改缓存目录">
                            <FolderOpen size={16} />
                          </button>
                        </div>
                      </label>

                      <div className="buttonCluster">
                        <button
                          className="iconTextButton"
                          type="button"
                          onClick={() => conversionCacheDir && window.lplay.revealPath(conversionCacheDir)}
                          disabled={!conversionCacheDir}
                        >
                          <FolderOpen size={16} />
                          打开缓存目录
                        </button>
                        {conversionRequests.length > 1 && (
                          <button className="primaryButton" type="button" onClick={() => void approveAllConversions()} disabled={isPreparing}>
                            <FileDown size={16} />
                            全部转码
                          </button>
                        )}
                      </div>

                      {conversionRequests.length === 0 ? (
                        <p className="mutedText">需要转码的视频会先显示在这里，确认后才会生成 MP4 缓存。</p>
                      ) : (
                        <div className="conversionRequestList">
                          {conversionRequests.map((request) => (
                            <article className="conversionRequestItem" key={request.filePath}>
                              <div className="conversionRequestHeader">
                                <strong>{request.fileName}</strong>
                                <span>{request.extension.toUpperCase()}</span>
                              </div>
                              <p>{request.reason}</p>
                              <small>{shortPath(request.filePath)}</small>
                              <div className="buttonCluster conversionRequestActions">
                                <button className="primaryButton" type="button" onClick={() => void approveConversion(request)} disabled={isPreparing}>
                                  <FileDown size={15} />
                                  转码
                                </button>
                                <button type="button" onClick={() => window.lplay.revealPath(request.filePath)} title="打开所在位置">
                                  <FolderOpen size={15} />
                                </button>
                                <button className="iconButton" type="button" onClick={() => removeConversionRequest(request.filePath)} title="忽略">
                                  <X size={15} />
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </div>
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
                        <button className="primaryButton" type="button" onClick={() => void startMagnetDownload()} disabled={!canStartMagnetDownload}>
                          <Download size={17} />
                          下载
                        </button>
                        <button className="iconButton" type="button" onClick={() => void cancelMagnetDownload()} disabled={!magnetBusy} title="取消下载">
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

                      {magnetRecords.length === 0 ? (
                        <p className="mutedText">下载记录会显示在这里；取消、失败或完成后可手动重试或删除。</p>
                      ) : (
                        <div className="magnetRecordList">
                          {magnetRecords.map((record) => {
                            const recordBusy = isMagnetBusy(record);
                            return (
                              <div className={`downloadStatus magnetRecord ${record.status}`} key={record.jobId}>
                                <div className="magnetRecordHeader">
                                  <strong>{record.name || record.message || "磁力任务"}</strong>
                                  <span>{magnetStatusLabel(record.status)}</span>
                                </div>
                                <div className="progressBar">
                                  <span style={{ width: `${record.percent ?? (recordBusy ? 12 : 0)}%` }} />
                                </div>
                                <div className="downloadMeta">
                                  <span>
                                    {formatBytes(record.downloaded)} / {formatBytes(record.total)}
                                  </span>
                                  <span>
                                    {formatBytes(record.downloadSpeed)}/s · {record.peers || 0} peers
                                  </span>
                                </div>
                                {record.message && <p className="downloadMessage">{record.message}</p>}
                                <div className="buttonCluster magnetRecordActions">
                                  <button
                                    type="button"
                                    onClick={() => void startMagnetDownload(record.magnetUri, record.downloadDir)}
                                    disabled={magnetBusy || !isMagnetLink(record.magnetUri)}
                                    title="重试"
                                  >
                                    <RotateCcw size={15} />
                                    重试
                                  </button>
                                  <button
                                    className="iconButton"
                                    type="button"
                                    onClick={() => record.downloadDir && window.lplay.revealPath(record.downloadDir)}
                                    disabled={!record.downloadDir}
                                    title="打开下载文件夹"
                                  >
                                    <FolderOpen size={15} />
                                  </button>
                                  <button
                                    className="iconButton"
                                    type="button"
                                    onClick={() => (recordBusy ? void cancelMagnetDownload(record.jobId) : removeMagnetRecord(record.jobId))}
                                    title={recordBusy ? "取消" : "删除记录"}
                                  >
                                    {recordBusy ? <X size={15} /> : <Trash2 size={15} />}
                                  </button>
                                </div>
                                {record.files && record.files.length > 0 && (
                                  <div className="magnetFileList">
                                    {record.files.slice(0, 5).map((file) => (
                                      <div className="magnetFileItem" key={file.path}>
                                        <span>{file.name}</span>
                                        <small>
                                          {Math.round(file.progress)}% · {formatBytes(file.downloaded)} / {formatBytes(file.length)}
                                        </small>
                                      </div>
                                    ))}
                                    {record.files.length > 5 && <small className="mutedText">还有 {record.files.length - 5} 个文件</small>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}
