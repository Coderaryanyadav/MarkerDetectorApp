/**
 * Metro Bundler Configuration
 *
 * Key customizations:
 * - Adds 'cjs' to asset extensions for OpenCV WASM support
 * - Configures resolver for .worklet.ts files
 * - Enables inline requires for performance
 */
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  transformer: {
    // Enable inline requires for better startup performance
    // Components are only loaded when first rendered
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
    // Enable SVG transformer
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    // Additional extensions for Vision Camera frame processor plugins & OpenCV
    assetExts: [
      ...defaultConfig.resolver.assetExts.filter(ext => ext !== 'svg'),
      'bin',    // OpenCV binary data files
      'xml',    // OpenCV cascade classifiers
      'dat',    // Binary data
    ],
    sourceExts: [
      ...defaultConfig.resolver.sourceExts,
      'svg',        // SVG files as React components
      'cjs',        // CommonJS modules (some OpenCV wrappers)
      'mjs',        // ES modules
      'worklet.ts', // Explicit worklet files
      'worklet.js',
    ],
    // Resolve platform-specific files
    platforms: ['android', 'native'],
  },
  // Increase max workers for faster builds on multi-core machines
  maxWorkers: 4,
};

module.exports = mergeConfig(defaultConfig, config);
