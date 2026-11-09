#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest } from './lib/manifest.mjs'
import { buildProfile, ensureRuntime, importState, runtimeBin } from './lib/dsh.mjs'
import { installService, logPath, start, status, stop, uninstallService, unitName } from './lib/service.mjs'
import { applySettings, exportSettings } from './lib/settings.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = `ohmysa — minimal launcher for one dsh-superagent deployment

  ohmysa doctor            check the toolchain and the current deployment
  ohmysa build             materialize ohmysa.yaml into the DSH profile (idempotent)
  ohmysa start [--no-build] start the Host as a transient systemd user service
  ohmysa install-service   persistent user unit: restart on failure, start at boot (needs linger)
  ohmysa uninstall-service remove it (stops the Host)
  ohmysa stop              graceful stop (SIGINT to the Host)
  ohmysa restart           stop, build, start
  ohmysa status            unit/health/log summary (exit 0 when healthy)
  ohmysa log [-f]          newest Host log, optionally follow it
  ohmysa import [--from d] copy credentials/plugin settings from another DSH home (default ~/.dsh)
  ohmysa export            snapshot this deployment's settings into settings/
  ohmysa apply             apply the snapshot to the running Host

options: --deployment <name>  use deployments/<name>.yaml + ohmysa.<name>.local.yaml (default: ohmysa.yaml + ohmysa.local.yaml)
         --profile <name> --port <n> --ohmysa-home <dir> --dsh-home <dir> --state-dir <dir> --repo <dir>
`

const argv = process.argv.slice(2)
const command = argv[0]
const flag = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
const overrides = {
  profile: flag('--profile'), port: flag('--port') === undefined ? undefined : Number(flag('--port')),
  ohmysaHome: flag('--ohmysa-home'), dshHome: flag('--dsh-home'), stateDir: flag('--state-dir'),
}
const repo = flag('--repo') ?? REPO
const manifest = loadManifest(repo, overrides, flag('--deployment'))
const noBuild = argv.includes('--no-build')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function doctor() {
  const { spawnSync } = await import('node:child_process')
  const check = (name, command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    const detail = result.status === 0 ? (result.stdout ?? '').trim().split('\n')[0] : 'missing'
    console.log(`${result.status === 0 ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} ${detail}`)
    return result.status === 0
  }
  check('node', process.execPath, ['--version'])
  check('pnpm', 'pnpm', ['--version'])
  check('systemd', 'systemctl', ['--user', 'is-system-running'])
  check('gh', 'gh', ['--version'])
  console.log(`     manifest   profile=${manifest.profile} port=${manifest.port} dsh=${manifest.dshVersion}`)
  console.log(`     runtime    ${runtimeBin(manifest)} ${existsSync(runtimeBin(manifest)) ? '(installed)' : '(not installed: run ohmysa build)'}`)
  console.log(`     profile    ${manifest.profileDir} ${existsSync(path.join(manifest.profileDir, 'cordis.yml')) ? '(exists)' : '(missing: run ohmysa build)'}`)
  console.log(`     service    ${unitName(manifest)}.service ${function () {
    const result = spawnSync('systemctl', ['--user', 'is-active', `${unitName(manifest)}.service`], { encoding: 'utf8' })
    return (result.stdout ?? '').trim() || 'unknown'
  }()}`)
}

const main = async () => {
  switch (command) {
    case 'doctor': await doctor(); return 0
    case 'build': ensureRuntime(manifest); buildProfile(manifest); return 0
    case 'start': if (!noBuild) buildProfile(manifest); await start(manifest, { repo }); return 0
    case 'install-service': installService(manifest, { repo }); return 0
    case 'uninstall-service': uninstallService(manifest); return 0
    case 'stop': await stop(manifest); return 0
    case 'restart': await stop(manifest); if (!noBuild) buildProfile(manifest); await start(manifest, { repo }); return 0
    case 'status': return await status(manifest)
    case 'log': {
      const file = logPath(manifest)
      if (!file || !existsSync(file)) { console.error('no Host log yet; run `ohmysa start` first'); return 1 }
      const follow = argv.includes('-f') || argv.includes('--follow')
      const tailed = spawnSync('tail', [...(follow ? ['-f'] : ['-n', '200']), file], { stdio: 'inherit' })
      return tailed.status ?? 0
    }
    case 'import': importState(manifest, flag('--from') ?? '~/.dsh', { force: argv.includes('--force') }); return 0
    case 'export': await exportSettings(manifest, repo); return 0
    case 'apply': await applySettings(manifest, repo); return 0
    case undefined: case '-h': case '--help': case 'help': console.log(USAGE); return 0
    default: console.error(`unknown command: ${command}\n\n${USAGE}`); return 2
  }
}
main().then(code => { process.exitCode = code }).catch(error => { console.error(`ohmysa: ${error.message}`); process.exitCode = 1 })
