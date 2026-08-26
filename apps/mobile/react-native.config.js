// Keep a project-level RN config file so Expo autolinking invalidates its
// generated cache when the workspace-native project configuration changes.
//
// apps/mobile/package.json declares "type": "module", so this file must use
// ESM syntax (export default) instead of `module.exports`. Otherwise Node
// reports `ReferenceError: module is not defined in ES module scope` during
// the Xcode ReactCodegen phase, which skips the autolinking JSON generation
// and causes runtime "Cannot find native module" errors for any module
// autolinking would have registered (e.g. expo-image).
export default {};
