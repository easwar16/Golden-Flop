const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');
// Disabled to fix Metro TransformError – re-enable when CSS transform is fixed
// const { withNativewind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Resolve @/ to this app root (apps/mobile)
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    const subPath = moduleName.slice(2);
    const basePath = path.join(__dirname, subPath);
    const exts = ['.tsx', '.ts', '.jsx', '.js', '.json'];
    for (const ext of exts) {
      const filePath = basePath + ext;
      if (fs.existsSync(filePath)) {
        return { type: 'sourceFile', filePath };
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
