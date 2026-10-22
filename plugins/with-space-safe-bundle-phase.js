// The Expo SDK 54 template runs react-native-xcode.sh through an unquoted
// command substitution, which breaks when the project path contains a space
// ("…/claude code/…"). This quotes it in the generated Xcode build phase.
const { withXcodeProject } = require('expo/config-plugins');

const UNQUOTED = /`(\\"\$NODE_BINARY\\" --print \\"[^`]*?react-native-xcode\.sh'\\")`/;

module.exports = function withSpaceSafeBundlePhase(config) {
  return withXcodeProject(config, (cfg) => {
    const phases = cfg.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    for (const phase of Object.values(phases)) {
      if (typeof phase !== 'object' || typeof phase.shellScript !== 'string') continue;
      if (!String(phase.name).includes('Bundle React Native code and images')) continue;
      phase.shellScript = phase.shellScript.replace(UNQUOTED, '\\"$($1)\\"');
    }
    return cfg;
  });
};
