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
| `scripts/lib/service.mjs` | systemd user service: `install-service` writes a persistent unit (restart on failure, start at boot); without it, start uses a transient unit. start/stop/restart/status/log |
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
ohmysa install-service              # persistent unit: restart on failure, start at boot
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

## Isolation from the daily DSH

ohmysa runs its Host with its own DSH home (`dshHome`, default `~/.ohmysa/dsh-home`), not the
operator's `~/.dsh`. Profile, state, sessions, credentials, plugin settings, `AGENTS.md`
(generated from `instructions/AGENTS.md`) and skills are all separate, so nothing a daily
customization repo materializes reaches the super-agent's workers.

Secret-bearing machine state is copied once, never committed:

```sh
ohmysa import              # from ~/.dsh: .credentials.yaml, Magpie lines, auto-routing config
ohmysa import --from <dir> --force
```

## Deploying on a new machine

### 0. Prerequisites

- Linux with a systemd user manager, and linger on so the Host survives logout:
  `loginctl enable-linger "$USER"`.
- Node >= 22.19 (24 recommended), pnpm, git, `gh`.
- The super-agent's target repository cloned somewhere (the Executor's `prepare` command makes
  worktrees from it), e.g. `git clone https://github.com/<owner>/<repo> ~/src/<repo>`.

### 1. Agent GitHub identity (operator step, not in git)

The super-agent must act as its own GitHub account, never the operator's. Create a wrapper that
gives `gh` a separate config directory and sign the agent account in:

```sh
mkdir -p ~/.local/bin
printf '#!/bin/sh\nGH_CONFIG_DIR="$HOME/.config/gh-agent" exec gh "$@"\n' > ~/.local/bin/gh-agent
chmod +x ~/.local/bin/gh-agent
gh-agent auth login          # sign in as the agent account
gh-agent api user --jq .login
```

### 2. Install and build

```sh
git clone https://github.com/prgrmrwy/ohmysa ~/opensource/ohmysa && cd ~/opensource/ohmysa
node scripts/bootstrap.mjs
ln -s "$PWD/bin/ohmysa" ~/.local/bin/ohmysa
ohmysa build        # pinned DSH runtime, dsh-superagent built from its pinned commit, profile
ohmysa doctor
```

### 3. Credentials and plugin settings (operator step, not in git)

`ohmysa import` copies `.credentials.yaml`, the Magpie lines and the auto-routing config into
`~/.ohmysa/dsh-home`. Pick the source that exists on this machine:

- this machine already runs a daily DSH: `ohmysa import` (reads `~/.dsh`);
- otherwise copy those items from the old machine's `~/.ohmysa/dsh-home` (e.g. `scp -r` into a
  temp directory) and run `ohmysa import --from <that dir>`; delete the temp copy afterwards.

### 4. Choose: carry state over, or start fresh

- **Carry over** (keeps tickets, decisions, threads, settings): on the old machine
  `ohmysa stop`, then copy its `~/.ohmysa/dsh-home/state/superagent` to the same path here
  before the first start. `worker-gitconfig` and `worker-bin` are rewritten on every start.
- **Fresh**: skip this; step 6 restores the settings from `settings/`.

### 5. Start

```sh
ohmysa install-service   # systemd restarts the Host on failure and starts it at boot
ohmysa start
ohmysa status       # exit 0; `setup` names what is still missing on a fresh state
```

### 6. Restore settings (fresh state only)

`settings/settings.json` holds **absolute machine paths**; fix them for this machine first:

- `sources.github.config.cli`: path to `gh-agent`;
- `executor.prepare`: the target-repository clone path (twice);
- `sources.github.config.repository` if the target repository differs.

Then `ohmysa apply` and check `ohmysa status` again.

### 7. Panel access

The panel only answers on exactly `http://127.0.0.1:3082`. From the operator machine use
dsh-cockpit: device → forwards → add a resident forward for port `3082` with *local port = device
port*, *show as workbench tab*, and this *open-URL command*:

```sh
ls -t ~/.ohmysa/logs/superagent-*.log | head -1 | xargs grep -ho 'http://127\.0\.0\.1:3082/?token=[A-Za-z0-9_-]*' | tail -1
```

After a Host restart the token rotates: use *reload* on the tab. Without cockpit, see
[Panel access](#panel-access-same-origin-fence).

### 8. Recovery

With `install-service` and linger, systemd restarts a crashed Host after 35 s (longer than
dsh-superagent's 30 s state-lock stale window) and starts it at boot; `ohmysa stop` is a
deliberate stop and is not undone. No external watchdog is needed. Problems that need a person
(for example the agent's `gh` login expired) show up in the panel's health and in
`ohmysa status`.

### Updating the snapshot

After changing settings in the panel: `ohmysa export`, review the diff (no secrets are written),
commit and push.

## Relationship to ohmydsh

ohmydsh owns the operator's daily DSH (profile `web`) and its launcher; ohmysa owns this one
super-agent profile and runs it independently. They can coexist: ohmydsh needs no knowledge of
ohmysa, and ohmysa never writes to the `web` profile. Both pin the same official DSH release, so
upgrade them together by bumping `dshVersion` in both manifests.
