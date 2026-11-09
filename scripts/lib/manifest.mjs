import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'

export const expandHome = value => typeof value === 'string' && value.startsWith('~') ? path.join(homedir(), value.slice(1)) : value

const substitute = (value, vars) => {
  if (typeof value === 'string') {
    // A value that is exactly one placeholder keeps the variable's type: ports and other
    // numbers must reach the plugin schema as numbers, not strings.
    const whole = /^\{\{(\w+)\}\}$/.exec(value)
    if (whole) return vars[whole[1]] ?? value
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`))
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, vars))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, vars)]))
  return value
}

const mergeLocal = (base, local) => {
  // Shallow for scalars/lists, per-key for maps: a local file can re-point one dependency
  // (e.g. dsh-superagent: link:/path/to/checkout) without repeating the committed manifest.
  const merged = { ...base, ...local }
  if (base.deps || local.deps) merged.deps = { ...(base.deps ?? {}), ...(local.deps ?? {}) }
  return merged
}

const readYaml = file => existsSync(file) ? yaml.load(readFileSync(file, 'utf8')) ?? {} : {}

/**
 * Without `deployment`: ohmysa.yaml + ohmysa.local.yaml (the original single deployment).
 * With `deployment`: ohmysa.yaml + deployments/<name>.yaml (committed: profile, port, dshHome,
 * snapshot paths) + ohmysa.<name>.local.yaml (gitignored machine overrides). The default
 * deployment's local file is not read, so its port and snapshot paths never leak into another.
 */
export function loadManifest(repo, overrides = {}, deployment) {
  const committed = yaml.load(readFileSync(path.join(repo, 'ohmysa.yaml'), 'utf8'))
  let raw
  if (deployment === undefined) raw = mergeLocal(committed, readYaml(path.join(repo, 'ohmysa.local.yaml')))
  else {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(deployment)) throw new Error(`invalid deployment name: ${deployment}`)
    const overlayFile = path.join(repo, 'deployments', `${deployment}.yaml`)
    if (!existsSync(overlayFile)) throw new Error(`unknown deployment ${deployment}: missing ${overlayFile}`)
    raw = mergeLocal(mergeLocal(committed, readYaml(overlayFile)), readYaml(path.join(repo, `ohmysa.${deployment}.local.yaml`)))
    for (const key of ['profile', 'port', 'dshHome', 'settings', 'prompts']) {
      if (raw[key] === committed[key]) throw new Error(`deployment ${deployment} must set its own ${key} (it equals the default deployment's)`)
    }
  }
  const manifest = { ...raw }
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) manifest[key] = value
  for (const key of ['dshVersion', 'profile', 'port']) if (manifest[key] === undefined) throw new Error(`ohmysa.yaml is missing ${key}`)
  const dshHome = expandHome(manifest.dshHome ?? '~/.dsh')
  const stateDirOverride = overrides.stateDir
  let stateDir = stateDirOverride ?? manifest.stateDir
  if (stateDir === undefined) stateDir = path.join(dshHome, 'state', manifest.profile)
  else {
    stateDir = expandHome(stateDir)
    // `--dsh-home` must move the default state location with it, otherwise an isolated
    // build would point the Host at the production database.
    const defaultHome = expandHome('~/.dsh')
    if (!stateDirOverride && dshHome !== defaultHome && stateDir.startsWith(defaultHome + path.sep)) {
      stateDir = path.join(dshHome, stateDir.slice(defaultHome.length + 1))
    }
  }
  const vars = {
    dshHome,
    profile: manifest.profile,
    port: manifest.port,
    host: manifest.host ?? '127.0.0.1',
    stateDir,
    ohmysaHome: expandHome(manifest.ohmysaHome ?? '~/.ohmysa'),
  }
  manifest.host = vars.host
  manifest.stateDir = vars.stateDir
  manifest.ohmysaHome = vars.ohmysaHome
  manifest.dshHome = dshHome
  manifest.repo = repo
  manifest.profileDir = path.join(dshHome, 'profiles', manifest.profile)
  manifest.logsDir = path.join(manifest.ohmysaHome, 'logs')
  manifest.runtimeDir = path.join(manifest.ohmysaHome, 'runtime')
  manifest.patch = substitute(manifest.patch ?? [], vars)
  manifest.bundles = manifest.bundles ?? []
  manifest.deps = manifest.deps ?? {}
  return manifest
}
