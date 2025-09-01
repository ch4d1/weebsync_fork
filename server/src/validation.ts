import Joi from "joi";
import { Config, SyncMap } from "@shared/types";

// Validation schemas
export const syncMapSchema = Joi.object<SyncMap>({
  id: Joi.string().alphanum().min(1).max(50).required(),
  originFolder: Joi.string().min(1).max(500).required(),
  destinationFolder: Joi.string().min(1).max(500).required(),
  fileRegex: Joi.string().max(1000).default(".*"),
  fileRenameTemplate: Joi.string().max(500).allow("").default(""),
  rename: Joi.boolean().default(true),
});

export const serverConfigSchema = Joi.object({
  host: Joi.string().hostname().required(),
  port: Joi.number().port().required(),
  user: Joi.string().min(1).max(100).required(),
  password: Joi.string().min(1).max(200).required(),
});

export const configSchema = Joi.object<Config>({
  server: serverConfigSchema.required(),
  syncMaps: Joi.array().items(syncMapSchema).min(0).max(50).default([]),
  autoSyncIntervalInMinutes: Joi.number().min(1).max(1440).default(30),
  syncOnStart: Joi.boolean().default(false),
});

// Socket event validation schemas
export const pathSchema = Joi.string().min(1).max(1000).required();

export const regexDebugSchema = Joi.object({
  originFolder: Joi.string().min(1).max(500).required(),
  fileRegex: Joi.string().max(1000).required(),
  fileRenameTemplate: Joi.string().max(500).allow("").default(""),
  syncName: Joi.string().min(1).max(100).required(),
});

// Validation helper functions
export function validateConfig(config: unknown): {
  isValid: boolean;
  error?: string;
  value?: Config;
} {
  const result = configSchema.validate(config, {
    stripUnknown: true,
    abortEarly: false,
    allowUnknown: false,
  });

  if (result.error) {
    return {
      isValid: false,
      error: `Configuration validation failed: ${result.error.details.map((d) => d.message).join(", ")}`,
    };
  }

  return { isValid: true, value: result.value };
}

export function validatePath(path: unknown): {
  isValid: boolean;
  error?: string;
  value?: string;
} {
  const result = pathSchema.validate(path);

  if (result.error) {
    return {
      isValid: false,
      error: `Path validation failed: ${result.error.message}`,
    };
  }

  return { isValid: true, value: result.value };
}

export function validateRegexDebugInput(input: unknown): {
  isValid: boolean;
  error?: string;
  value?: {
    originFolder: string;
    fileRegex: string;
    fileRenameTemplate: string;
    syncName: string;
  };
} {
  const result = regexDebugSchema.validate(input);

  if (result.error) {
    return {
      isValid: false,
      error: `Regex debug validation failed: ${result.error.message}`,
    };
  }

  return { isValid: true, value: result.value };
}

// Generic validation wrapper for socket events
export function withValidation<T, R>(
  schema: Joi.Schema<T>,
  handler: (validatedInput: T) => Promise<R> | R,
) {
  return async (
    input: unknown,
    callback?: (result: R | { error: string }) => void,
  ) => {
    try {
      const result = schema.validate(input, {
        stripUnknown: true,
        abortEarly: false,
      });

      if (result.error) {
        const error = `Validation failed: ${result.error.details.map((d) => d.message).join(", ")}`;
        if (callback) callback({ error });
        return;
      }

      const handlerResult = await handler(result.value);
      if (callback) callback(handlerResult);
      return handlerResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      if (callback) callback({ error: errorMessage });
      return;
    }
  };
}
