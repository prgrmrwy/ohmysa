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

export function loadManifest(repo, overrides = {}) {
  const committed = yaml.load(readFileSync(path.join(repo, 'ohmysa.yaml'), 'utf8'))
  const localFile = path.join(repo, 'ohmysa.local.yaml')
  const local = existsSync(localFile) ? yaml.load(readFileSync(localFile, 'utf8')) ?? {} : {}
  const raw = mergeLocal(committed, local)
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
  manifest.profileDir = path.join(dshHome, 'profiles', manifest.profile)
  manifest.logsDir = path.join(manifest.ohmysaHome, 'logs')
  manifest.runtimeDir = path.join(manifest.ohmysaHome, 'runtime')
  manifest.patch = substitute(manifest.patch ?? [], vars)
  manifest.bundles = manifest.bundles ?? []
  manifest.deps = manifest.deps ?? {}
  return manifest
}
