#!/usr/bin/env node
// Zero-dependency initialization for ohmysa. Like ohmydsh's first bootstrap: check the
// toolchain, install the few root dependencies, then get out of the way.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'ohmysa.yaml')

function fail(message) { console.error(message); process.exit(1) }

const major = Number(process.versions.node.split('.')[0])
const minor = Number(process.versions.node.split('.')[1])
if (major < 22 || (major === 22 && minor < 19)) fail(`Node ${process.versions.node} is below 22.19; install a supported Node from https://nodejs.org/`)
if (!existsSync(MANIFEST)) fail(`missing manifest: ${MANIFEST}`)

const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
if (pnpm.status !== 0) console.log('warn: pnpm is not on PATH; `ohmysa build` needs it to install the profile')
const systemctl = spawnSync('systemctl', ['--user', 'is-system-running'], { encoding: 'utf8' })
if (systemctl.status !== 0 && !/running|degraded/.test(systemctl.stdout ?? '')) console.log('warn: systemd --user does not look available; service commands will fail')

const installed = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' })
if (installed.status !== 0) fail('npm install failed; initialization stopped')
console.log('OK 初始化完成。Next: bin/ohmysa build && bin/ohmysa start')
