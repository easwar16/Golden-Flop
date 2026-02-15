const { getDefaultConfig } = require('expo/metro-config');
// Disabled to fix Metro TransformError – re-enable when CSS transform is fixed
// const { withNativewind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
