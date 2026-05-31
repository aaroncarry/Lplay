import type {
  ConversionProgress,
  M3u8DownloadOptions,
  M3u8Progress,
  MagnetDownloadOptions,
  MagnetProgress,
  PreparedMedia,
  PrepareMediaResponse
} from "./types";

export {};

declare global {
  interface Window {
    lplay: {
      pickVideoFiles: () => Promise<string[]>;
      prepareMediaFiles: (filePaths: string[]) => Promise<PrepareMediaResponse>;
      makeMediaCompatible: (filePath: string) => Promise<PreparedMedia>;
      getDroppedFilePaths: (files: File[]) => string[];
      startDroppedFileImport: (fileName: string) => Promise<{ importId: string }>;
      appendDroppedFileChunk: (importId: string, chunk: ArrayBuffer) => Promise<boolean>;
      finishDroppedFileImport: (importId: string) => Promise<string>;
      abortDroppedFileImport: (importId: string) => Promise<boolean>;
      pickM3u8Playlist: () => Promise<string>;
      chooseM3u8Output: (defaultName: string) => Promise<string>;
      downloadM3u8: (options: M3u8DownloadOptions) => Promise<{ outputPath: string }>;
      cancelM3u8: (jobId: string) => Promise<boolean>;
      getMagnetDownloadDir: () => Promise<string>;
      chooseMagnetDownloadDir: () => Promise<string>;
      startMagnetDownload: (options: MagnetDownloadOptions) => Promise<MagnetProgress>;
      cancelMagnetDownload: (jobId: string) => Promise<boolean>;
      revealPath: (filePath: string) => Promise<boolean>;
      onConversionProgress: (callback: (payload: ConversionProgress) => void) => () => void;
      onM3u8Progress: (callback: (payload: M3u8Progress) => void) => () => void;
      onMagnetProgress: (callback: (payload: MagnetProgress) => void) => () => void;
    };
  }
}
