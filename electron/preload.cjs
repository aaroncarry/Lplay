const { contextBridge, ipcRenderer, webUtils } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function getDroppedFilePaths(files) {
  return files
    .map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

contextBridge.exposeInMainWorld("lplay", {
  pickVideoFiles: () => ipcRenderer.invoke("media:pick-files"),
  pickVideoFolderFiles: () => ipcRenderer.invoke("media:pick-folder-files"),
  prepareMediaFiles: (filePaths, options) => ipcRenderer.invoke("media:prepare-files", { filePaths, ...options }),
  makeMediaCompatible: (filePath) => ipcRenderer.invoke("media:make-compatible", filePath),
  getConversionCacheDir: () => ipcRenderer.invoke("conversion:get-cache-dir"),
  chooseConversionCacheDir: () => ipcRenderer.invoke("conversion:choose-cache-dir"),
  getDroppedFilePaths: (files) => getDroppedFilePaths(files),
  startDroppedFileImport: (fileName) => ipcRenderer.invoke("media:drop-import-start", fileName),
  appendDroppedFileChunk: (importId, chunk) => ipcRenderer.invoke("media:drop-import-append", { importId, chunk }),
  finishDroppedFileImport: (importId) => ipcRenderer.invoke("media:drop-import-finish", importId),
  abortDroppedFileImport: (importId) => ipcRenderer.invoke("media:drop-import-abort", importId),
  pickM3u8Playlist: () => ipcRenderer.invoke("m3u8:pick-playlist"),
  chooseM3u8Output: (defaultName) => ipcRenderer.invoke("m3u8:choose-output", defaultName),
  downloadM3u8: (options) => ipcRenderer.invoke("m3u8:download", options),
  cancelM3u8: (jobId) => ipcRenderer.invoke("m3u8:cancel", jobId),
  getMagnetDownloadDir: () => ipcRenderer.invoke("magnet:get-download-dir"),
  chooseMagnetDownloadDir: () => ipcRenderer.invoke("magnet:choose-download-dir"),
  startMagnetDownload: (options) => ipcRenderer.invoke("magnet:start", options),
  cancelMagnetDownload: (jobId) => ipcRenderer.invoke("magnet:cancel", jobId),
  revealPath: (filePath) => ipcRenderer.invoke("shell:show-path", filePath),
  onConversionProgress: (callback) => subscribe("media:conversion-progress", callback),
  onM3u8Progress: (callback) => subscribe("m3u8:progress", callback),
  onMagnetProgress: (callback) => subscribe("magnet:progress", callback)
});
