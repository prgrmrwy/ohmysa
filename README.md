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
| `ohmysa.local.yaml` | gitignored machine-local dependency overrides (local checkouts); the committed manifest stays reproducible |

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

### Panel access (same-origin fence)

The panel is served on `http://127.0.0.1:<port>/` (token in the newest log's `dsh web:` line).
`dsh-superagent`'s management API accepts only requests whose `Host` is the loopback address the
profile was configured with, so **open the panel through exactly that host:port** — e.g. an SSH
tunnel that maps a local port `3082` to `127.0.0.1:3082`:

```sh
ssh -L 3082:127.0.0.1:3082 <host>
```

If the panel must be reached through another local port or a domain, terminate it with a header-
rewriting proxy instead of patching the plugin, e.g.:

```nginx
location / {
  proxy_pass http://127.0.0.1:3082;
  proxy_set_header Host 127.0.0.1:3082;
  proxy_set_header Origin "";
}
```

(Stripping `Origin` is safe here: the API's anti-CSRF header `x-orchestrator-request` is still
required and the proxy must only listen on trusted interfaces.)

### Dependency sources

| Dependency | Source |
| --- | --- |
| `@deepseek-ai/dsh` | npm, exact `dshVersion` pin |
| `dsh-superagent` | pinned official commit; `build` clones it, runs `pnpm install --frozen-lockfile && pnpm build`, and caches the build under `<ohmysaHome>/src/<name>-<ref>` |
| `dsh-magpie-connector`, `dsh-auto-model-routing` | npm |
| `dsh-cockpit-bridge` | GitHub release tarball (cockpit session/approval reporting in the super-agent panel) |

A dependency entry may also be an object, in which case ohmysa builds it from that pinned public
source:

```yaml
deps:
  dsh-superagent:
    repository: "https://github.com/deepseek-ai/dsh-superagent-prototype.git"
    ref: "<commit>"
```

No internal or closed-source registry is required. If a future dependency needs one, set
`npmrcFrom` in the manifest to a local `.npmrc` and treat it as an operator step.

## Moving to another machine

1. clone this repo (manifest + `settings/` snapshot);
2. `node scripts/bootstrap.mjs && ohmysa build && ohmysa start`;
3. `ohmysa apply` to restore the exported settings;
4. do the operator steps secrets need: sign `gh` in as the agent account and add the Magpie
   lines (they live under `$DSH_HOME/plugins` and the DSH credentials store).

`ohmysa export` on the old machine writes `settings/settings.json` and `settings/prompts.json`;
commit them. State (tickets/sessions/DB under `stateDir`) is intentionally not migrated: back it up
separately if you need continuity.

## Relationship to ohmydsh

ohmydsh owns the operator's daily DSH (profile `web`) and its launcher; ohmysa owns this one
super-agent profile and runs it independently. They can coexist: ohmydsh needs no knowledge of
ohmysa, and ohmysa never writes to the `web` profile. Both pin the same official DSH release, so
upgrade them together by bumping `dshVersion` in both manifests.
