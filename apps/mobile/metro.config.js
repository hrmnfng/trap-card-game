// Metro config for the npm-workspace monorepo: extend Expo's defaults to also
// watch the repo root and resolve hoisted dependencies (and the @trap/shared
// workspace package) from both the app's and the root's node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), workspaceRoot])
);
config.resolver.nodeModulesPaths = Array.from(
  new Set([
    ...(config.resolver.nodeModulesPaths ?? []),
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ])
);

// Force `tslib` to its CJS build. framer-motion (via moti) otherwise resolves
// the package's ESM wrapper (`tslib/modules/index.js`) through the `exports`
// "import" condition, which breaks under Metro's Node rendering during
// `expo export --platform web` (the interop leaves the default import
// undefined). Same library, CJS flavor, works in every context.
const tslibCjs = require.resolve('tslib');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib') {
    return { type: 'sourceFile', filePath: tslibCjs };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
