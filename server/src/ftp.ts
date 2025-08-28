import fs from "fs";

import { Communication } from "./communication";
import { FileInfo, Client, FTPResponse } from "basic-ftp";
import { Config } from "@shared/types";

export type CreateFtpClientResult =
  | {
      type: "Ok";
      data: FTP;
    }
  | { type: "ConnectionError"; message: string };

export class FTP {
  private readonly _client = new Client();
  private _used = false;
  private _lastAction: Date = new Date();

  constructor(private readonly _communication: Communication) {}

  borrow() {
    if (this._used) {
      throw new Error("Tried to borrow while it was still borrowed?!");
    }
    this._used = true;
  }

  free() {
    if (!this._used) {
      throw new Error("Tried to free while it was already freed?!");
    }
    this._used = false;
  }

  available(): boolean {
    return !this._used;
  }

  getLastActionTime(): number {
    return this._lastAction.getTime();
  }

  async connect(config: Config) {
    await this._client.access({
      host: config.server.host,
      user: config.server.user,
      port: config.server.port,
      password: config.server.password,
      secure: true,
      secureOptions: { rejectUnauthorized: false },
    });
  }

  async listDir(path: string): Promise<FileInfo[]> {
    this._lastAction = new Date();
    return await this._client.list(path);
  }

  async cd(path: string): Promise<FTPResponse> {
    this._lastAction = new Date();
    return await this._client.cd(path);
  }

  close(): void {
    this._client.close();
  }

  isClosed(): boolean {
    return this._client.closed;
  }

  async getFile(
    hostFilePath: string,
    localFileStream: fs.WriteStream,
    size: number,
    config?: Config,
    applicationState?: any,
  ): Promise<any> {
    const updateInterval = 500; // Update every 500ms
    let lastBytesWritten = 0;
    let lastUpdateTime = Date.now();
    let progressTimer: NodeJS.Timeout;

    // Parse speed limit from config
    let speedLimitMbps: number | null = null;
    if (config?.downloadSpeedLimitMbps) {
      if (typeof config.downloadSpeedLimitMbps === "string") {
        speedLimitMbps = parseFloat(config.downloadSpeedLimitMbps);
      } else {
        speedLimitMbps = config.downloadSpeedLimitMbps;
      }
    }

    const speedLimitBytesPerSecond =
      speedLimitMbps && speedLimitMbps > 0
        ? speedLimitMbps * 1024 * 1024
        : null;

    // Function to update progress
    const updateProgress = () => {
      const currentTime = Date.now();
      const currentBytes = localFileStream.bytesWritten;
      const timeDiff = currentTime - lastUpdateTime;

      if (timeDiff > 0) {
        const bytesDiff = currentBytes - lastBytesWritten;
        const progress = (currentBytes / size) * 100;

        // Calculate speed: bytes per millisecond -> bytes per second -> megabytes per second
        const bytesPerSecond = (bytesDiff / timeDiff) * 1000;
        const megabytesPerSecond = bytesPerSecond / (1024 * 1024);

        this._communication.updateBottomBar({
          fileProgress: `${progress.toFixed(2).padStart(6, " ")}%`,
          downloadSpeed: `${megabytesPerSecond
            .toFixed(2)
            .padStart(7, " ")} MB/s`,
        });

        lastBytesWritten = currentBytes;
        lastUpdateTime = currentTime;
      }
    };

    // Start progress monitoring
    progressTimer = setInterval(updateProgress, updateInterval);

    this._lastAction = new Date();
    let transformStream = null;

    try {
      if (speedLimitBytesPerSecond || applicationState) {
        // Use custom download with speed limiting and pause support
        transformStream = await this._downloadWithControlledSpeed(
          localFileStream,
          hostFilePath,
          speedLimitBytesPerSecond,
          applicationState,
        );
      } else {
        await this._client.downloadTo(localFileStream, hostFilePath);
      }
    } finally {
      // Clear the timer and reset progress display
      clearInterval(progressTimer);
      this._communication.updateBottomBar({
        fileProgress: "",
        downloadSpeed: "",
      });
    }

    return transformStream; // Return the transform stream for abort control
  }

  private async _downloadWithControlledSpeed(
    localFileStream: fs.WriteStream,
    hostFilePath: string,
    speedLimitBytesPerSecond: number | null,
    applicationState?: any,
  ): Promise<any> {
    // Wrap the original downloadTo with pause/resume and speed control
    const originalDownloadTo = this._client.downloadTo.bind(this._client);

    // Create a transform stream for speed limiting and pause control
    const { Transform } = await import("stream");

    let totalBytesTransferred = 0;
    let lastSpeedCheckTime = Date.now();
    let lastSpeedCheckBytes = 0;
    let isAborted = false;

    const controlledTransform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        // Handle abort
        if (isAborted) {
          callback(new Error("Manual abortion."));
          return;
        }

        // Handle pause state
        const checkPauseAndContinue = async () => {
          // Wait for resume if paused
          if (applicationState?.syncPaused) {
            while (applicationState.syncPaused && !isAborted) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          if (isAborted) {
            callback(new Error("Manual abortion."));
            return;
          }

          totalBytesTransferred += chunk.length;

          // Speed limiting - smoother approach
          if (speedLimitBytesPerSecond) {
            const now = Date.now();
            const timeSinceLastCheck = now - lastSpeedCheckTime;

            if (timeSinceLastCheck >= 50) {
              // Check every 50ms for smoother control
              const bytesSinceLastCheck =
                totalBytesTransferred - lastSpeedCheckBytes;

              // Calculate how long this chunk should have taken at target speed
              const targetTimeForChunk =
                (bytesSinceLastCheck / speedLimitBytesPerSecond) * 1000;

              // If we processed it faster than target, add appropriate delay
              if (timeSinceLastCheck < targetTimeForChunk) {
                const delayNeeded = targetTimeForChunk - timeSinceLastCheck;
                if (delayNeeded > 0) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, Math.min(delayNeeded, 500)),
                  );
                }
              }

              lastSpeedCheckTime = Date.now(); // Update to actual time after delay
              lastSpeedCheckBytes = totalBytesTransferred;
            }
          }

          this.push(chunk);
          callback();
        };

        checkPauseAndContinue().catch(callback);
      },
    });

    // Speed limit updates during download removed to prevent stream corruption

    // Set up abort listener
    const abortHandler = () => {
      isAborted = true;
      controlledTransform.destroy(new Error("Manual abortion."));
    };

    // Listen for abort on the local file stream
    localFileStream.on("error", (error) => {
      if (error.message === "Manual abortion.") {
        abortHandler();
      }
    });

    // Pipe the transform stream to the local file stream
    controlledTransform.pipe(localFileStream);

    try {
      // Download to the controlled transform stream
      await originalDownloadTo(controlledTransform, hostFilePath);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage === "Manual abortion." || isAborted) {
        throw new Error("Manual abortion.");
      }
      throw error;
    }

    return controlledTransform; // Return the transform stream for external control
  }
}

let ftpConnections: FTP[] = [];
const FTP_CONNECTION_TIMEOUT = 1000 * 60;
setInterval(() => {
  cleanFTPConnections();
}, FTP_CONNECTION_TIMEOUT);

function cleanFTPConnections() {
  ftpConnections = ftpConnections.filter((ftp) => {
    if (
      Date.now() - ftp.getLastActionTime() > FTP_CONNECTION_TIMEOUT ||
      ftp.isClosed()
    ) {
      ftp.close();
      return false;
    }
    return true;
  });
}

export async function getFTPClient(
  config: Config,
  communication: Communication,
): Promise<CreateFtpClientResult> {
  try {
    cleanFTPConnections();
    let freeFtpConnection = ftpConnections.find(
      (f) => f.available() && !f.isClosed(),
    );
    if (!freeFtpConnection) {
      if (ftpConnections.length >= 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return await getFTPClient(config, communication);
      }

      freeFtpConnection = new FTP(communication);
      ftpConnections.push(freeFtpConnection);
      await freeFtpConnection.connect(config);
    }

    freeFtpConnection.borrow();
    return { type: "Ok", data: freeFtpConnection };
  } catch (err) {
    return {
      type: "ConnectionError",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
