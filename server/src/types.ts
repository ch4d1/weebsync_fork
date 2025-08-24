// Modern TypeScript type definitions for WeebSync

export type PluginConfig = Record<string, string | number | boolean>;

export interface NodeError extends Error {
  code?: string;
  path?: string;
  syscall?: string;
  errno?: number;
}
