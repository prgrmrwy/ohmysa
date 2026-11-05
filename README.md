# ohmysa

**Minimal, self-contained launcher and configuration source for one `dsh-superagent` deployment.**
It is to dsh-superagent what a tiny, clean bootstrap of ohmydsh was to a daily DSH: one manifest,
an idempotent `build`, a systemd-managed Host, and export/apply for moving settings between machines.
Secrets are never stored here.

## Layout

| Path | Holds |
| --- | --- |
| `ohmysa.yaml` | the single source of truth: DSH version pin, profile/port/stateDir, bundles+deps, profile patch, settings snapshot paths |
| `scripts/lib/dsh.mjs` | installs the pinned `@deepseek-ai/dsh` into `~/.ohmysa/runtime` (npm, not npx) and materializes the profile |
| `scripts/lib/service.mjs` | transient systemd user service: start/stop/restart/status/log; survives daily-Host restarts because its parent is the user manager |
| `scripts/lib/settings.mjs` | `export`/`apply` for the deployment's settings via the management API |
| `settings/` | exported settings/prompts snapshots (no secrets) |
| `bin/ohmysa` | cross-shell launcher |

## Use

```sh
node scripts/bootstrap.mjs          # toolchain check + root dependencies
ln -s "$PWD/bin/ohmysa" ~/.local/bin/ohmysa   # optional
ohmysa doctor                       # what is installed / running
ohmysa build                        # materialize ohmysa.yaml into the DSH profile
ohmysa start                        # start the Host (systemd user service)
ohmysa status                       # exit 0 when running and set up
ohmysa log -f                       # follow the newest Host log
ohmysa restart                      # stop -> build -> start
```

The panel is served on `http://127.0.0.1:<port>/` (token in the newest log's `dsh web:` line).
A terminal port-forward may use another local port; DSH refuses only non-loopback hosts.

## Moving to another machine

1. clone this repo (manifest + `settings/` snapshot);
2. `node scripts/bootstrap.mjs && ohmysa build && ohmysa start`;
3. `ohmysa apply` to restore the exported settings;
4. do the operator steps secrets need: sign `gh` in as the agent account, log TraeX in, add Magpie
   lines (they live under `$DSH_HOME/plugins` and credentials), and copy the internal registry
   `.npmrc` (used only for installing `@byted/*`; the file itself stays out of git).

`ohmysa export` on the old machine writes `settings/settings.json` and `settings/prompts.json`;
commit them. State (tickets/sessions/DB under `stateDir`) is intentionally not migrated: back it up
separately if you need continuity.

## Relationship to ohmydsh

ohmydsh owns the operator's daily DSH (profile `web`) and its launcher; ohmysa owns this one
super-agent profile and runs it independently. They can coexist: ohmydsh needs no knowledge of
ohmysa, and ohmysa never writes to the `web` profile. Both pin the same official DSH release, so
upgrade them together by bumping `dshVersion` in both manifests.
