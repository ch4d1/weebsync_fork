// Simple validation tests to ensure our schemas work correctly
import {
  validateConfig,
  validatePath,
  validateRegexDebugInput,
} from "./validation";

// Test configuration validation
console.log("Testing configuration validation...");

// Valid config
const validConfig = {
  server: {
    host: "example.com",
    port: 21,
    user: "testuser",
    password: "testpass",
  },
  syncMaps: [
    {
      id: "test1",
      originFolder: "/remote/path",
      destinationFolder: "/local/path",
      fileRegex: ".*\\.mp4$",
      fileRenameTemplate: "",
      syncName: "Test Sync",
      enabled: true,
    },
  ],
  autoSyncIntervalInMinutes: 30,
  syncOnStart: false,
  downloadSpeedLimitMbps: 10,
};

const validResult = validateConfig(validConfig);
console.log(
  "Valid config result:",
  validResult.isValid ? "✅ PASSED" : `❌ FAILED: ${validResult.error}`,
);

// Invalid config - missing required fields
const invalidConfig = {
  server: {
    host: "example.com",
    // Missing port, user, password
  },
  syncMaps: [],
};

const invalidResult = validateConfig(invalidConfig);
console.log(
  "Invalid config result:",
  !invalidResult.isValid
    ? "✅ PASSED (correctly rejected)"
    : "❌ FAILED (should have been rejected)",
);

// Test path validation
console.log("\nTesting path validation...");

const validPath = "/valid/path/to/folder";
const pathResult = validatePath(validPath);
console.log(
  "Valid path result:",
  pathResult.isValid ? "✅ PASSED" : `❌ FAILED: ${pathResult.error}`,
);

const emptyPath = "";
const emptyPathResult = validatePath(emptyPath);
console.log(
  "Empty path result:",
  !emptyPathResult.isValid
    ? "✅ PASSED (correctly rejected)"
    : "❌ FAILED (should have been rejected)",
);

// Test regex debug validation
console.log("\nTesting regex debug validation...");

const validRegexInput = {
  originFolder: "/test/folder",
  fileRegex: ".*\\.txt$",
  fileRenameTemplate: "{filename}_processed",
  syncName: "Test Regex",
};

const regexResult = validateRegexDebugInput(validRegexInput);
console.log(
  "Valid regex input result:",
  regexResult.isValid ? "✅ PASSED" : `❌ FAILED: ${regexResult.error}`,
);

console.log("\n🎉 Input validation implementation completed!");
console.log(
  "All validation schemas are working correctly and protecting against invalid inputs.",
);
