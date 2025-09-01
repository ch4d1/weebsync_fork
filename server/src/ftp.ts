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
  ): Promise<void> {
    const startTime = Date.now();
    const speedHistory: number[] = [];
    const maxHistoryLength = 5; // Keep last 5 measurements for smoothing

    // Timer-based progress tracking every 500ms
    const progressTimer = setInterval(() => {
      this._lastAction = new Date();
      const currentTime = Date.now();
      const currentBytes = localFileStream.bytesWritten;
      const progress = (currentBytes / size) * 100;

      const totalTimeInSeconds = (currentTime - startTime) / 1000;

      // Only calculate after 1 second and if we have meaningful data
      if (totalTimeInSeconds >= 1 && currentBytes > 0) {
        // Calculate overall average speed from start
        const overallSpeedBytesPerSecond = currentBytes / totalTimeInSeconds;

        // Convert to MiB/s using binary (1024) - Mebibyte = 1,048,576 bytes
        const mebibytesPerSecond = overallSpeedBytesPerSecond / (1024 * 1024);

        // Add to history for smoothing
        speedHistory.push(mebibytesPerSecond);
        if (speedHistory.length > maxHistoryLength) {
          speedHistory.shift(); // Remove oldest measurement
        }

        // Calculate smoothed speed (simple moving average of MiB/s)
        const smoothedMebibytesPerSecond =
          speedHistory.reduce((sum, speed) => sum + speed, 0) /
          speedHistory.length;

        this._communication.updateBottomBar({
          fileProgress: `${progress.toFixed(2).padStart(6, " ")}%`,
          downloadSpeed: `${smoothedMebibytesPerSecond.toFixed(1).padStart(7, " ")} MiB/s`,
        });
      } else {
        // Still update progress
        this._communication.updateBottomBar({
          fileProgress: `${progress.toFixed(2).padStart(6, " ")}%`,
          downloadSpeed: "... MiB/s",
        });
      }
    }, 500);

    this._lastAction = new Date();
    try {
      await this._client.downloadTo(localFileStream, hostFilePath);
    } finally {
      clearInterval(progressTimer);
      this._communication.updateBottomBar({
        fileProgress: "",
        downloadSpeed: "",
      });
    }
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
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { type: "ConnectionError", message: errorMessage };
  }
}
