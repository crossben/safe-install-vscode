# Changelog

## Unreleased

- Risky dependencies are marked in `package.json` (Problems panel, CodeLens), with a hover
  listing each finding and what to do. Packages brought in by a dependency are shown on
  that dependency, with the chain. Re-checked on save; `safe-install: Check Dependencies`
  checks on demand.
- Status bar shows the worst level in the workspace.
- Settings: `safeInstall.path` (user settings only), `checkOnSave`, `diffBase`,
  `minSeverity`, `codeLens`, `timeoutSeconds`.
- Runs the safe-install CLI safely: version check (needs 0.2.3+), timeouts and output
  limits, no shell, nothing in Restricted Mode.
