import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'

export const expandHome = value => typeof value === 'string' && value.startsWith('~') ? path.join(homedir(), value.slice(1)) : value

const substitute = (value, vars) => {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`))
  if (Array.isArray(value)) return value.map(item => substitute(item, vars))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, vars)]))
  return value
}

export function loadManifest(repo, overrides = {}) {
  const raw = yaml.load(readFileSync(path.join(repo, 'ohmysa.yaml'), 'utf8'))
  const manifest = { ...raw }
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) manifest[key] = value
  for (const key of ['dshVersion', 'profile', 'port']) if (manifest[key] === undefined) throw new Error(`ohmysa.yaml is missing ${key}`)
  const vars = {
    home: path.join(homedir(), '.dsh'),
    profile: manifest.profile,
    port: manifest.port,
    host: manifest.host ?? '127.0.0.1',
    stateDir: expandHome(manifest.stateDir ?? `~/.dsh/state/${manifest.profile}`),
    ohmysaHome: expandHome(manifest.ohmysaHome ?? '~/.ohmysa'),
  }
  manifest.host = vars.host
  manifest.stateDir = vars.stateDir
  manifest.ohmysaHome = vars.ohmysaHome
  manifest.dshHome = expandHome(manifest.dshHome ?? '~/.dsh')
  manifest.profileDir = path.join(manifest.dshHome, 'profiles', manifest.profile)
  manifest.logsDir = path.join(manifest.ohmysaHome, 'logs')
  manifest.runtimeDir = path.join(manifest.ohmysaHome, 'runtime')
  manifest.patch = substitute(manifest.patch ?? [], vars)
  manifest.bundles = manifest.bundles ?? []
  manifest.deps = manifest.deps ?? {}
  return manifest
}
