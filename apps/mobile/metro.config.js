// Metro config for pnpm monorepo + Expo SDK 57.
// pnpm workspace root 解析问题：默认 Metro 找 ./index from <workspace root>，应解析到 apps/mobile。
// 见 https://docs.expo.dev/guides/monorepos/

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// apps/mobile 实际所在
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

console.log("[metro.config.js] projectRoot =", projectRoot);
console.log("[metro.config.js] monorepoRoot =", monorepoRoot);
console.log("[metro.config.js] cwd =", process.cwd());

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

console.log("[metro.config.js] after getDefaultConfig projectRoot =", config.projectRoot);
console.log("[metro.config.js] after getDefaultConfig watchFolders =", config.watchFolders);
console.log("[metro.config.js] after getDefaultConfig resolver.nodeModulesPaths =", config.resolver && config.resolver.nodeModulesPaths);

// pnpm 模式：node_modules 在 workspace root 而不是 projectRoot
config.watchFolders = Array.from(new Set([...(config.watchFolders || []), monorepoRoot]));
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
  ...(config.resolver?.nodeModulesPaths || []),
];
config.resolver.disableHierarchicalLookup = false;
config.resolver.extraNodeModules = {
  ...(config.resolver?.extraNodeModules || {}),
  "@proxy/contracts": path.resolve(monorepoRoot, "packages/contracts"),
};

module.exports = config;
