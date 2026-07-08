/**
 * Extends app.json: injects the ROOT package.json version — the single value
 * release.yml gates and tags on — as `extra.appVersion` at config-eval time.
 * This runs in Node (dev server, `expo export`, EAS build), so the app gets
 * the release version without bundling the whole root package.json into the
 * shipped JS (scripts, dependency versions, workspace layout).
 */
const { version } = require('../../package.json');

module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, appVersion: version },
});
