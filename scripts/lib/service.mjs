import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'

export const unitName = manifest => `ohmysa-${manifest.profile}`
const systemctl = (args, options = {}) => spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8', ...options })
const active = manifest => systemctl(['is-active', unitName(manifest)]).stdout?.trim() === 'active'
export const newestLog = manifest => {
  if (!existsSync(manifest.logsDir)) return undefined
  const files = readdirSync(manifest.logsDir).filter(name => name.startsWith(`${manifest.profile}-`)).sort()
  return files.length ? path.join(manifest.logsDir, files[files.length - 1]) : undefined
}
const stateOf = (manifest, timeoutMs = 1500) => new Promise(resolve => {
  const request = http.request({ host: '127.0.0.1', port: manifest.port, path: '/orchestrator/api/state', timeout: timeoutMs,
    headers: { host: `127.0.0.1:${manifest.port}`, 'x-orchestrator-request': '1' } }, response => {
    let body = ''
    response.on('data', chunk => { body += chunk })
    response.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(undefined) } })
  })
  request.on('timeout', () => { request.destroy(); resolve(undefined) })
  request.on('error', () => resolve(undefined))
  request.end()
})

export async function start(manifest, { repo }) {
  if (active(manifest)) throw new Error(`${unitName(manifest)} is already active; run \`ohmysa status\` or \`ohmysa restart\``)
  if (systemctl(['is-active', `${unitName(manifest)}`]).stdout?.trim() === 'activating') throw new Error(`${unitName(manifest)} is still starting`)
  mkdirSync(manifest.logsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15)
  const log = path.join(manifest.logsDir, `${manifest.profile}-${stamp}.log`)
  const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
  const bus = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtime}/bus`
  const forwarded = ['HOME', 'PATH', 'DSH_HOME', 'LANG', 'http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']
    .filter(name => process.env[name] !== undefined).map(name => `${name}=${process.env[name]}`)
  const command = ['systemd-run', '--user', '--collect', `--unit=${unitName(manifest)}`,
    '-p', `WorkingDirectory=${repo}`, '-p', `StandardOutput=append:${log}`, '-p', `StandardError=append:${log}`, '--',
    '/usr/bin/env', ...forwarded, `DSH_HOME=${manifest.dshHome}`, process.execPath,
    path.join(manifest.runtimeDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), manifest.profile, '--port', String(manifest.port), '--no-open']
  const started = spawnSync('env', [`XDG_RUNTIME_DIR=${runtime}`, `DBUS_SESSION_BUS_ADDRESS=${bus}`, ...command], { encoding: 'utf8' })
  if (started.status !== 0) throw new Error(`systemd-run failed: ${(started.stderr || started.stdout || '').trim()}`)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const state = await stateOf(manifest)
    if (state?.health?.runtime === 'ready' || state?.health?.runtime === 'paused') {
      console.log(`started ${unitName(manifest)}: http://${manifest.host}:${manifest.port}/  log: ${log}`)
      return { unit: unitName(manifest), log, state }
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`the Host did not become ready within 120s; inspect ${log}`)
}

export async function stop(manifest, { timeoutMs = 60_000 } = {}) {
  if (!active(manifest)) { console.log(`${unitName(manifest)} is not active`); return }
  systemctl(['kill', '--signal=SIGINT', unitName(manifest)])
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!active(manifest)) { console.log(`stopped ${unitName(manifest)}`); return }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  console.log(`graceful stop timed out; stopping ${unitName(manifest)} with SIGTERM`)
  systemctl(['stop', unitName(manifest)])
}

export async function status(manifest) {
  const running = active(manifest)
  const state = running ? await stateOf(manifest) : undefined
  console.log(JSON.stringify({
    unit: `${unitName(manifest)}.service`, active: running,
    url: `http://${manifest.host}:${manifest.port}/`,
    health: state?.health ?? null, setup: state?.setup?.problem ?? null,
    log: newestLog(manifest) ?? null,
  }, null, 2))
  return running && state?.setup?.problem == null ? 0 : 1
}

export const logPath = newestLog
