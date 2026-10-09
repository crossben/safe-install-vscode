# Changelog

## Unreleased

- Risky dependencies are marked in `package.json` (Problems panel, CodeLens), with a hover
  listing each finding and what to do. Packages brought in by a dependency are shown on
  that dependency, with the chain. Re-checked on save; `safe-install: Check Dependencies`
  checks on demand.
- **Install Scripts** view (Explorer): installed packages that want to run scripts, grouped
  into "Needs your approval" and "Approved", with their scripts and findings.
- **Approve…**: shows the scripts and findings, and on an explicit yes runs
  `safe-install approve <package>` in a visible terminal. High-risk packages are never
  approved from the editor (the CLI needs `--force`, which you run yourself).
- Quick fixes on markers: "Why is this package here?" (dependency chains) and "Explain
  rule".
- Get-started walkthrough; **Copy Agent Instructions** (`safe-install llm`) for AI coding
  agents; install or update command for your OS when the CLI is missing or too old.
- Findings are ordered worst first in markers, CodeLens and hovers.
- Status bar shows the worst level in the workspace.
- Settings: `safeInstall.path` (user settings only), `checkOnSave`, `diffBase`,
  `minSeverity`, `codeLens`, `timeoutSeconds`.
- Runs the safe-install CLI safely: version check (needs 0.2.3+), timeouts and output
  limits, no shell, nothing in Restricted Mode.
