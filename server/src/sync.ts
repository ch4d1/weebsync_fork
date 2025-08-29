import fs, { Stats } from "fs";
import { getFTPClient, FTP } from "./ftp";
import Handlebars from "handlebars";
import ErrnoException = NodeJS.ErrnoException;
import { match, P } from "ts-pattern";
import { Communication } from "./communication";
import { FileInfo } from "basic-ftp";
import { ApplicationState } from "./index";
import { Config, SyncMap } from "@shared/types";
import { pluginApis } from "./plugin-system";

let currentWriteStream: fs.WriteStream | null = null;
let currentTransformStream: any = null;

export type SyncResult =
  | { type: "FilesDownloaded" }
  | { type: "NoDownloadsDetected" }
  | { type: "Aborted" }
  | { type: "Error"; error: Error };

interface RemoteFileMatching {
  path: string;
  listingElement: FileInfo;
}

interface FileMatchesMapEntry {
  fileStatOnDisk: Stats | null;
  remoteFilesMatching: RemoteFileMatching[];
}

interface FileMatchesMap {
  [localFile: string]: FileMatchesMapEntry;
}

export async function syncFiles(
  applicationState: ApplicationState,
): Promise<void> {
  if (applicationState.syncInProgress) {
    applicationState.communication.logWarning(
      "Tried to start another sync while sync was still in progress!",
    );
    return;
  }

  updateSyncStatus(applicationState, true);
  updateSyncPauseStatus(applicationState, false);

  // Track when sync started for auto-sync timer
  applicationState.lastSyncStartTime = Date.now();

  const ftpClient = match(
    await getFTPClient(applicationState.config, applicationState.communication),
  )
    .with({ type: "Ok", data: P.select() }, (res) => res)
    .with({ type: "ConnectionError", message: P.select() }, (err) => {
      applicationState.communication.logError(`FTP Connection error: ${err}"`);
      updateSyncStatus(applicationState, false);
      return null;
    })
    .exhaustive();

  if (ftpClient === null) {
    updateSyncStatus(applicationState, false);
    applicationState.communication.logError(`Could not sync.`);
    return;
  }

  applicationState.communication.logInfo(`Attempting to sync.`);
  let filesDownloaded = false;

  for (const syncMap of applicationState.config.syncMaps) {
    const syncResult = await sync(syncMap, ftpClient, applicationState);
    const abortSync = match(syncResult)
      .with({ type: "FilesDownloaded" }, () => {
        filesDownloaded = true;
        return false;
      })
      .with({ type: "NoDownloadsDetected" }, () => false)
      .with({ type: "Aborted" }, () => true)
      .with({ type: "Error" }, () => false)
      .exhaustive();
    if (abortSync) {
      break;
    }
  }

  updateSyncStatus(applicationState, false);
  updateSyncPauseStatus(applicationState, false);
  applicationState.communication.logInfo(`Sync done!`);

  if (filesDownloaded) {
    for (const plugin of applicationState.plugins) {
      if (plugin.onFilesDownloadSuccess) {
        await plugin.onFilesDownloadSuccess(
          pluginApis[plugin.name],
          plugin.config,
        );
      }
    }
  }

  ftpClient.free();
}

function updateSyncStatus(applicationState: ApplicationState, status: boolean) {
  applicationState.syncInProgress = status;
  applicationState.communication.sendSyncStatus(status);
}

function updateSyncPauseStatus(
  applicationState: ApplicationState,
  paused: boolean,
) {
  applicationState.syncPaused = paused;
  applicationState.communication.sendSyncPauseStatus(paused);
}

export function toggleAutoSync(
  applicationState: ApplicationState,
  enabled: boolean,
): void {
  if (applicationState.autoSyncIntervalHandler) {
    clearInterval(applicationState.autoSyncIntervalHandler);
    delete applicationState.autoSyncIntervalHandler;
  }

  if (applicationState.autoSyncTimerBroadcastHandler) {
    clearInterval(applicationState.autoSyncTimerBroadcastHandler);
    delete applicationState.autoSyncTimerBroadcastHandler;
  }

  if (enabled) {
    const interval = Math.max(
      applicationState.config.autoSyncIntervalInMinutes
        ? applicationState.config.autoSyncIntervalInMinutes
        : 30,
      5,
    );

    applicationState.communication.logInfo(
      `AutoSync enabled! Interval is ${interval} minutes.`,
    );

    applicationState.autoSyncIntervalHandler = setInterval(
      () => syncFiles(applicationState),
      interval * 60 * 1000,
    );

    // Start timer broadcast - update every second
    startAutoSyncTimerBroadcast(applicationState, interval);
  } else {
    applicationState.communication.logInfo("AutoSync disabled!");
    // Broadcast that auto-sync is disabled
    applicationState.communication.io.emit("autoSyncTimer", null);
  }
}

function startAutoSyncTimerBroadcast(
  applicationState: ApplicationState,
  intervalMinutes: number,
): void {
  const intervalMs = intervalMinutes * 60 * 1000;

  applicationState.autoSyncTimerBroadcastHandler = setInterval(() => {
    if (applicationState.syncInProgress) {
      // Don't show timer during sync
      applicationState.communication.io.emit("autoSyncTimer", null);
      return;
    }

    const now = Date.now();
    const lastSync = applicationState.lastSyncStartTime || now;
    const timeSinceLastSync = now - lastSync;
    const timeUntilNext = intervalMs - timeSinceLastSync;

    if (timeUntilNext <= 0) {
      applicationState.communication.io.emit("autoSyncTimer", "Now");
    } else {
      const minutesRemaining = Math.floor(timeUntilNext / (60 * 1000));
      const secondsRemaining = Math.floor((timeUntilNext % (60 * 1000)) / 1000);

      const timeString =
        minutesRemaining > 0
          ? `${minutesRemaining}m ${secondsRemaining}s`
          : `${secondsRemaining}s`;

      applicationState.communication.io.emit("autoSyncTimer", timeString);
    }
  }, 1000);
}

// Helper functions for file processing
function processFileMatch(
  listingElement: FileInfo,
  syncMap: SyncMap,
  config: Config,
  communication: Communication,
): { localFile: string; remoteFile: string } | null {
  const renameTemplate = syncMap.rename
    ? Handlebars.compile(syncMap.fileRenameTemplate)
    : Handlebars.compile(listingElement.name);
  const regex = syncMap.rename ? new RegExp(syncMap.fileRegex) : /.*/;
  const match = regex.exec(listingElement.name);

  if (match === null) {
    if (config.debugFileNames) {
      communication.logDebug(
        `File did not match regex "${listingElement.name}". Not loading.`,
      );
    }
    return null;
  }

  const templateData: { [key: string]: string } = {
    $syncName: syncMap.id,
  };
  for (let i = 0; i < match.length; i++) {
    templateData["$" + i] = match[i];
  }

  const newName = renameTemplate(templateData);
  const remoteFile = `${syncMap.originFolder}/${listingElement.name}`;
  const localFile = Handlebars.compile(
    `${syncMap.destinationFolder}/${newName}`,
  )(templateData);

  return { localFile, remoteFile };
}

function addFileToMatchesMap(
  fileMatchesMap: FileMatchesMap,
  localFile: string,
  remoteFile: string,
  listingElement: FileInfo,
): void {
  if (!fileMatchesMap[localFile]) {
    fileMatchesMap[localFile] = {
      fileStatOnDisk: null,
      remoteFilesMatching: [],
    };
  }

  fileMatchesMap[localFile].remoteFilesMatching.push({
    path: remoteFile,
    listingElement,
  });

  if (fs.existsSync(localFile)) {
    fileMatchesMap[localFile].fileStatOnDisk = fs.statSync(localFile);
  }
}

function getFileMatchesMap(
  dir: FileInfo[],
  syncMap: SyncMap,
  config: Config,
  communication: Communication,
): FileMatchesMap {
  const fileMatchesMap: FileMatchesMap = {};

  for (const listingElement of dir) {
    const result = processFileMatch(
      listingElement,
      syncMap,
      config,
      communication,
    );
    if (result) {
      addFileToMatchesMap(
        fileMatchesMap,
        result.localFile,
        result.remoteFile,
        listingElement,
      );
    }
  }

  return fileMatchesMap;
}

// Helper functions for sync process
async function waitForResumeIfPaused(
  applicationState: ApplicationState,
): Promise<void> {
  while (applicationState.syncPaused) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function shouldSkipFile(
  fileMatches: FileMatchesMapEntry,
  latestRemoteMatch: RemoteFileMatching,
): boolean {
  return Boolean(
    fileMatches.fileStatOnDisk &&
      fileMatches.fileStatOnDisk.size === latestRemoteMatch.listingElement.size,
  );
}

function logFileAction(
  fileMatches: FileMatchesMapEntry,
  localFile: string,
  latestRemoteMatch: RemoteFileMatching,
  syncMap: SyncMap,
  config: Config,
  communication: Communication,
): void {
  if (config.debugFileNames && syncMap.rename) {
    communication.logDebug(
      `Renaming ${latestRemoteMatch.path} -> ${localFile}`,
    );
  }

  if (fileMatches.fileStatOnDisk) {
    communication.logWarning(
      `New version or damaged file detected, reloading ${localFile}`,
    );
  } else {
    communication.logInfo(`New episode detected, loading ${localFile} now.`);
  }
}

async function downloadFile(
  ftpClient: FTP,
  latestRemoteMatch: RemoteFileMatching,
  localFile: string,
  config: Config,
  applicationState: ApplicationState,
  _syncMapId: string,
): Promise<void> {
  currentWriteStream = fs.createWriteStream(localFile);

  // Add error handler to prevent unhandled errors
  currentWriteStream.on("error", (error) => {
    if (error.message === "Manual abortion.") {
      // This is expected when aborting, don't log as error
      applicationState.communication.logInfo("Download aborted by user.");
    } else {
      applicationState.communication.logError(
        `Download error: ${error.message}`,
      );
    }
  });

  try {
    currentTransformStream = await ftpClient.getFile(
      latestRemoteMatch.path,
      currentWriteStream,
      latestRemoteMatch.listingElement.size,
      config,
      applicationState,
    );
  } finally {
    // Reset the streams after download completion or error
    currentWriteStream = null;
    currentTransformStream = null;
  }
}

async function processFileDownloads(
  fileMatchesMap: FileMatchesMap,
  syncMap: SyncMap,
  ftpClient: FTP,
  applicationState: ApplicationState,
): Promise<number> {
  const { config, communication } = applicationState;
  let filesDownloaded = 0;

  for (const [localFile, fileMatches] of Object.entries(fileMatchesMap)) {
    await waitForResumeIfPaused(applicationState);

    const latestRemoteMatch = getLatestMatchingFile(fileMatches);

    if (shouldSkipFile(fileMatches, latestRemoteMatch)) {
      continue;
    }

    logFileAction(
      fileMatches,
      localFile,
      latestRemoteMatch,
      syncMap,
      config,
      communication,
    );
    await downloadFile(
      ftpClient,
      latestRemoteMatch,
      localFile,
      config,
      applicationState,
      syncMap.id,
    );
    filesDownloaded++;
  }

  return filesDownloaded;
}

function handleSyncError(
  error: unknown,
  syncMap: SyncMap,
  communication: Communication,
): SyncResult {
  if (!(error instanceof Error)) {
    const errorMessage =
      typeof error === "object" && error !== null
        ? JSON.stringify(error)
        : "Unknown error";
    communication.logError(`Unknown error: ${errorMessage}`);
    return { type: "Error", error: new Error(errorMessage) };
  }

  if ("code" in error) {
    const codeError = error as { code: number };
    if (codeError.code === 550) {
      communication.logError(
        `Directory "${syncMap.originFolder}" does not exist on remote.`,
      );
    }
    return { type: "Error", error };
  }

  if (error.message === "Manual abortion.") {
    communication.logWarning(
      `Sync was manually stopped. File will be downloaded again.`,
    );
    return { type: "Aborted" };
  }

  communication.logError(`Unknown error ${error.message}`);
  return { type: "Error", error };
}

// Main sync function - now with reduced complexity
async function sync(
  syncMap: SyncMap,
  ftpClient: FTP,
  applicationState: ApplicationState,
): Promise<SyncResult> {
  const { config, communication } = applicationState;
  const localFolder = Handlebars.compile(syncMap.destinationFolder)({
    $syncName: syncMap.id,
  });

  if (!createLocalFolder(localFolder, communication).exists) {
    return {
      type: "Error",
      error: new Error(`Could not create local folder "${localFolder}"`),
    };
  }

  try {
    await ftpClient.cd(syncMap.originFolder);
    const dir = await ftpClient.listDir(syncMap.originFolder);
    const fileMatchesMap = getFileMatchesMap(
      dir,
      syncMap,
      config,
      communication,
    );

    if (
      syncMap.rename &&
      dir.length > 0 &&
      Object.keys(fileMatchesMap).length === 0
    ) {
      communication.logWarning(
        `Sync config "${syncMap.id}" has a rename configured but it matches no files.`,
      );
    }

    const filesDownloaded = await processFileDownloads(
      fileMatchesMap,
      syncMap,
      ftpClient,
      applicationState,
    );

    return filesDownloaded > 0
      ? { type: "FilesDownloaded" }
      : { type: "NoDownloadsDetected" };
  } catch (error) {
    return handleSyncError(error, syncMap, communication);
  }
}

// Export functions
export function abortSync(): void {
  if (currentTransformStream) {
    currentTransformStream.destroy(new Error("Manual abortion."));
  }
  if (currentWriteStream) {
    currentWriteStream.destroy(new Error("Manual abortion."));
  }
}

export function pauseSync(applicationState: ApplicationState): void {
  if (applicationState.syncInProgress && !applicationState.syncPaused) {
    updateSyncPauseStatus(applicationState, true);
    applicationState.communication.logInfo("Sync paused.");
  }
}

export function resumeSync(applicationState: ApplicationState): void {
  if (applicationState.syncInProgress && applicationState.syncPaused) {
    updateSyncPauseStatus(applicationState, false);
    applicationState.communication.logInfo("Sync resumed.");
  }
}

// Utility functions
function getLatestMatchingFile(
  fileMatches: FileMatchesMapEntry,
): RemoteFileMatching {
  fileMatches.remoteFilesMatching.sort((a, b) =>
    a.listingElement.date > b.listingElement.date ? -1 : 1,
  );

  return fileMatches.remoteFilesMatching[0];
}

function createLocalFolder(
  destinationFolder: string,
  communication: Communication,
): { exists: boolean } {
  try {
    if (!fs.existsSync(destinationFolder)) {
      fs.mkdirSync(destinationFolder, { recursive: true });
    }
    return { exists: true };
  } catch (e) {
    if (e instanceof Error) {
      if ("code" in e) {
        const error = e as ErrnoException;
        communication.logError(
          `Could not create folder on file system, "${destinationFolder}" is faulty: "${error.message}"`,
        );
      }
    }
  }
  return { exists: false };
}
