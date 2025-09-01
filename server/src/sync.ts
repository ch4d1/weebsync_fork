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

export type SyncResult =
  | { type: "FilesDownloaded" }
  | { type: "NoDownloadsDetected" }
  | { type: "Aborted" }
  | { type: "Error"; error: Error };

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
    const syncResult = await sync(
      syncMap,
      ftpClient,
      applicationState.config,
      applicationState.communication,
    );
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

export function toggleAutoSync(
  applicationState: ApplicationState,
  enabled: boolean,
): void {
  if (applicationState.autoSyncIntervalHandler) {
    clearInterval(applicationState.autoSyncIntervalHandler);
    delete applicationState.autoSyncIntervalHandler;
  }

  // Clear any existing timer update interval
  if (applicationState.autoSyncTimerUpdateHandler) {
    clearInterval(applicationState.autoSyncTimerUpdateHandler);
    delete applicationState.autoSyncTimerUpdateHandler;
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

    let nextSyncTime = Date.now() + interval * 60 * 1000;

    applicationState.autoSyncIntervalHandler = setInterval(
      () => {
        syncFiles(applicationState);
        nextSyncTime = Date.now() + interval * 60 * 1000;
      },
      interval * 60 * 1000,
    );

    // Update timer display every second
    applicationState.autoSyncTimerUpdateHandler = setInterval(() => {
      const timeRemaining = nextSyncTime - Date.now();
      if (timeRemaining > 0) {
        const minutes = Math.floor(timeRemaining / (60 * 1000));
        const seconds = Math.floor((timeRemaining % (60 * 1000)) / 1000);
        const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;
        applicationState.communication.sendAutoSyncTimer(timeString);
      }
    }, 1000);
  } else {
    applicationState.communication.logInfo("AutoSync disabled!");
    applicationState.communication.sendAutoSyncTimer(null);
  }
}

function buildTemplateData(
  match: RegExpExecArray,
  syncMapId: string,
): { [key: string]: string } {
  const templateData: { [key: string]: string } = {
    $syncName: syncMapId,
  };
  for (let i = 0; i < match.length; i++) {
    templateData["$" + i] = match[i];
  }
  return templateData;
}

function processFileMatch(
  listingElement: FileInfo,
  syncMap: SyncMap,
  match: RegExpExecArray,
  fileMatchesMap: FileMatchesMap,
): void {
  const renameTemplate = syncMap.rename
    ? Handlebars.compile(syncMap.fileRenameTemplate)
    : Handlebars.compile(listingElement.name);

  const templateData = buildTemplateData(match, syncMap.id);
  const newName = renameTemplate(templateData);
  const remoteFile = `${syncMap.originFolder}/${listingElement.name}`;
  const localFile = Handlebars.compile(
    `${syncMap.destinationFolder}/${newName}`,
  )(templateData);

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
    const regex = syncMap.rename ? new RegExp(syncMap.fileRegex) : /no_rename/;
    const match = syncMap.rename
      ? regex.exec(listingElement.name)
      : regex.exec("no_rename");

    if (match === null) {
      if (config.debugFileNames) {
        communication.logDebug(
          `File did not match regex "${listingElement.name}". Not loading.`,
        );
      }
      continue;
    }

    processFileMatch(listingElement, syncMap, match, fileMatchesMap);
  }

  return fileMatchesMap;
}

export function abortSync(): void {
  if (currentWriteStream) {
    currentWriteStream.destroy(new Error("Manual abortion."));
  }
}

function shouldDownloadFile(
  fileMatches: FileMatchesMapEntry,
  latestRemoteMatch: RemoteFileMatching,
): boolean {
  if (!fileMatches.fileStatOnDisk) {
    return true;
  }
  return (
    fileMatches.fileStatOnDisk.size !== latestRemoteMatch.listingElement.size
  );
}

function logFileDownloadReason(
  fileMatches: FileMatchesMapEntry,
  localFile: string,
  communication: Communication,
): void {
  if (fileMatches.fileStatOnDisk) {
    communication.logWarning(
      `New version or damaged file detected, reloading ${localFile}`,
    );
  } else {
    communication.logInfo(`New episode detected, loading ${localFile} now.`);
  }
}

async function downloadMatchedFiles(
  fileMatchesMap: FileMatchesMap,
  ftpClient: FTP,
  config: Config,
  syncMap: SyncMap,
  communication: Communication,
): Promise<number> {
  let filesDownloaded = 0;

  for (const [localFile, fileMatches] of Object.entries(fileMatchesMap)) {
    const latestRemoteMatch = getLatestMatchingFile(fileMatches);

    if (config.debugFileNames && syncMap.rename) {
      communication.logDebug(
        `Renaming ${latestRemoteMatch.path} -> ${localFile}`,
      );
    }

    if (!shouldDownloadFile(fileMatches, latestRemoteMatch)) {
      continue;
    }

    logFileDownloadReason(fileMatches, localFile, communication);

    currentWriteStream = fs.createWriteStream(localFile);
    await ftpClient.getFile(
      latestRemoteMatch.path,
      currentWriteStream,
      latestRemoteMatch.listingElement.size,
    );
    filesDownloaded++;
  }

  return filesDownloaded;
}

function handleSyncError(
  e: unknown,
  syncMap: SyncMap,
  communication: Communication,
): SyncResult {
  if (e instanceof Error) {
    if ("code" in e) {
      const error = e as { code: number };
      if (error.code === 550) {
        communication.logError(
          `Directory "${syncMap.originFolder}" does not exist on remote.`,
        );
      }
      return { type: "Error", error: e };
    } else if (e.message === "Manual abortion.") {
      communication.logWarning(
        `Sync was manually stopped. File will be downloaded again.`,
      );
      return { type: "Aborted" };
    } else {
      communication.logError(`Unknown error ${e.message}`);
      return { type: "Error", error: e };
    }
  }

  communication.logError(`Unknown error ${e}`);
  return {
    type: "Error",
    error: e instanceof Error ? e : new Error(String(e)),
  };
}

async function sync(
  syncMap: SyncMap,
  ftpClient: FTP,
  config: Config,
  communication: Communication,
): Promise<SyncResult> {
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

    const filesDownloaded = await downloadMatchedFiles(
      fileMatchesMap,
      ftpClient,
      config,
      syncMap,
      communication,
    );

    return filesDownloaded > 0
      ? { type: "FilesDownloaded" }
      : { type: "NoDownloadsDetected" };
  } catch (e) {
    return handleSyncError(e, syncMap, communication);
  }
}

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
