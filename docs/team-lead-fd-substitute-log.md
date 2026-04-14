# FD-Substitute Reviewer Invocation Log

Companion to `docs/team-lead-fd-substitute.md`. Each substitute review appends one entry below (newest at bottom, chronological). Keeps the protocol's track record inspectable so repeated-override patterns surface and trigger-threshold tuning (per protocol §6.4) is data-driven rather than felt.

## Entry schema

```
### <YYYY-MM-DD> — Task #<id> @ <sha>
- Session: <session-id-prefix>
- Dev: <dev-name>
- FD at time of invocation: <fd-agent-name> (idle since <time>)
- Verdict: APPROVED (team-lead substitute) | REQUEST CHANGES (team-lead substitute)
- In-scope checks passed: <comma list, §4.1 dimensions>
- Deferred to FD post-hoc: <list or "none">
- Coverage gaps flagged: <list or "none beyond deferrals">
- FD post-hoc resolution: <pending | reviewed-and-concurred | reviewed-and-flagged:<details> | never-returned-this-session>
```

---

## Entries

### 2026-04-14 — Task #9 @ `3dcb949` + `540441e` (pre-codification ad-hoc invocation)
- Session: `70b36414`
- Dev: dev-3
- FD at time of invocation: frontend-designer (idle since early rework cycle)
- Verdict: APPROVED (team-lead substitute), with two structural issues flagged and fixed in follow-on commits
- In-scope checks passed: render structure, motion usage, structural a11y, IPC boundary, store boundary, test presence
- Deferred to FD post-hoc: typography hierarchy, spacing rhythm, motion feel values
- Coverage gaps flagged: none beyond deferrals; issues found in-scope were (a) ark-ui subpath import path, (b) copy-pasted demo page instead of prop-driven wrapper
- FD post-hoc resolution: pending (FD did not return by session end; substitute verdict stood)
- Note: this invocation predates the codified protocol — logged retroactively for completeness.

### 2026-04-14 — Task #19 @ `6f84411` (first post-codification invocation)
- Session: `70b36414`
- Dev: dev-2 (UploadTab work, landed via scope-bleed under dev-4's #21 commit — see §10 hazard; team-lead routed attribution-honest messages to both)
- FD at time of invocation: frontend-designer (idle through #19 handoff window)
- Verdict: APPROVED (team-lead substitute) — dev-2's UploadTab wire-up (`UploadTab.tsx` +81L, `UploadTab.test.tsx` +149L) against §4.1 dimensions
- Commit-scope sanity (§10 check): `git show --stat 6f84411` shows 4 files / 344+ lines spanning SettingsTab (#21) AND UploadTab (#19). Scope exceeds the #21-only commit message; team-lead verified the UploadTab portion matches dev-2's plan and approved the #19 surface specifically, not the whole commit as a single #21 unit.
- In-scope checks passed: render structure (6f84411@UploadTab.tsx:49-77 — Selector toggles mode, primitives render conditionally, Add-to-Graph banner gated on pendingSeries.length > 0); motion usage (n/a — no motion surface, correctly absent); a11y structural (6f84411@UploadTab.tsx:61-63 — ark-ui Selector keyboard-reachable, Button at :72-74 is real <button>); IPC boundary (no direct IPC calls at tab level — data arrives via onSeries callback from primitives); store boundary (6f84411@UploadTab.tsx:22,23,36,39 — reactive reads via per-store selectors, getState() only inside event handlers); test presence (6f84411@UploadTab.test.tsx — 8 discrete it() blocks: renders, file-mode-default, paste-mode-switch, no-button-when-empty, button-when-pending, commit-and-navigate, mode-switch-clears-buffer, palette-rotation-dedicated)
- Deferred to FD post-hoc: typography (heading size/weight at :52); success banner colour tokens green-50/green-200 at :68-71; spacing rhythm (gap-6 p-8 at :50, max-w-2xl centering); microcopy ("N series ready" at :70, "Add to Graph" at :73)
- Coverage gaps flagged: dev server not exercised — FD post-hoc should spot-check file-drop + paste flows in-browser; no visual regression beyond passing test suite
- FD post-hoc resolution: pending
- Note: first post-codification use. Exercised §10 (shared-worktree scope-bleed): a substitute reviewer seeing `git show --stat` exceed the task's plan scope correctly split the review into the #19-scope subset rather than bare-approving the whole SHA. Pattern worked as designed.
