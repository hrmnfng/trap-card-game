module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 moved its Babel plugin to react-native-worklets; it must be LAST.
    plugins: ['react-native-worklets/plugin'],
  };
};
