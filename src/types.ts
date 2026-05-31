export type MediaMetadata = {
  duration?: number;
  width?: number;
  height?: number;
  codec?: string;
  profile?: string;
  pixFmt?: string;
  audioCodec?: string;
  audioProfile?: string;
  hasAudio?: boolean;
};

export type PreparedMedia = {
  id: string;
  sourcePath: string;
  preparedPath: string;
  playbackUrl: string;
  displayName: string;
  originalExtension: string;
  converted: boolean;
  cached: boolean;
  metadata?: MediaMetadata;
};

export type PrepareMediaResponse = {
  results: PreparedMedia[];
  errors: Array<{
    filePath: string;
    message: string;
  }>;
};

export type Highlight = {
  id: string;
  start: number;
  end: number;
  note: string;
  createdAt: number;
};

export type PlaybackState = {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  error?: string;
};

export type ConversionProgress = {
  jobId: string;
  filePath: string;
  fileName: string;
  stage: "queued" | "probing" | "converting" | "cached" | "ready" | "error";
  percent?: number;
  outSeconds?: number;
  speed?: string;
  message?: string;
};

export type M3u8Progress = {
  jobId: string;
  status: "idle" | "running" | "done" | "error";
  percent?: number;
  outSeconds?: number;
  speed?: string;
  message?: string;
  outputPath?: string;
};

export type M3u8DownloadOptions = {
  jobId: string;
  source: string;
  outputPath: string;
};

export type MagnetFileProgress = {
  name: string;
  path: string;
  length: number;
  downloaded: number;
  progress: number;
};

export type MagnetProgress = {
  jobId: string;
  magnetUri: string;
  downloadDir: string;
  status: "resolving" | "downloading" | "done" | "error" | "cancelled";
  name?: string;
  infoHash?: string;
  percent?: number;
  downloaded?: number;
  total?: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  peers?: number;
  message?: string;
  files?: MagnetFileProgress[];
  updatedAt?: number;
};

export type MagnetDownloadOptions = {
  jobId: string;
  magnetUri: string;
  downloadDir?: string;
};
