const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const mobileRoot = path.join(projectRoot, 'apps/mobile');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// Resolve @/ to apps/mobile with absolute path so Metro finds the file
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    const subPath = moduleName.slice(2);
    const basePath = path.join(mobileRoot, subPath);
    const exts = ['.tsx', '.ts', '.jsx', '.js', '.json'];
    for (const ext of exts) {
      const filePath = basePath + ext;
      if (fs.existsSync(filePath)) {
        return { type: 'sourceFile', filePath };
      }
    }
    // Fallback: let Metro try with the path (it will try extensions)
    return context.resolveRequest(context, path.join('apps/mobile', subPath), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
