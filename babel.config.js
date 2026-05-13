/**
 * Babel Configuration for MarkerDetectorApp
 *
 * Plugin ORDER matters here:
 * 1. react-native-worklets-core/plugin — must come BEFORE reanimated
 * 2. react-native-reanimated/plugin   — must be LAST in plugins array
 * 3. module-resolver                  — resolves @components/@hooks/etc. path aliases
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Path alias resolution — must come before worklets/reanimated
    [
      'module-resolver',
      {
        root: ['./'],
        extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
        alias: {
          '@components': './src/components',
          '@screens': './src/screens',
          '@hooks': './src/hooks',
          '@utils': './src/utils',
          '@types': './src/types',
          '@constants': './src/constants',
          '@services': './src/services',
          '@assets': './src/assets',
          '@store': './src/store',
        },
      },
    ],
    // Worklets plugin — enables JS→native worklet functions for Vision Camera frame processors
    'react-native-worklets-core/plugin',
    // Reanimated — MUST be last
    'react-native-reanimated/plugin',
  ],
};
