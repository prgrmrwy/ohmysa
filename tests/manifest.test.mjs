import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadManifest } from '../scripts/lib/manifest.mjs'

function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ohmysa-manifest-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    writeFileSync(path.join(dir, name), text)
  }
  return dir
}
const base = 'dshVersion: 1.0.0\nprofile: superagent\nport: 3082\ndshHome: "/tmp/home-a"\nsettings: settings/settings.json\nprompts: settings/prompts.json\n'
const overlay = 'profile: magpie\nport: 3084\ndshHome: "/tmp/home-b"\nsettings: settings/magpie/settings.json\nprompts: settings/magpie/prompts.json\n'

test('default deployment reads ohmysa.local.yaml', () => {
  const dir = repo({ 'ohmysa.yaml': base, 'ohmysa.local.yaml': 'port: 3083\nsettings: /x/local.json\n' })
  try {
    const m = loadManifest(dir)
    assert.equal(m.port, 3083); assert.equal(m.settings, '/x/local.json'); assert.equal(m.profile, 'superagent')
  } finally { rmSync(dir, { recursive: true }) }
})

test('named deployment ignores the default local file and uses its own', () => {
  const dir = repo({ 'ohmysa.yaml': base, 'ohmysa.local.yaml': 'port: 3083\nsettings: /x/local.json\n',
    'deployments/magpie.yaml': overlay, 'ohmysa.magpie.local.yaml': 'settings: /x/magpie.json\n' })
  try {
    const m = loadManifest(dir, {}, 'magpie')
    assert.equal(m.port, 3084); assert.equal(m.profile, 'magpie'); assert.equal(m.settings, '/x/magpie.json')
    assert.equal(m.prompts, 'settings/magpie/prompts.json')
    assert.equal(m.stateDir, path.join('/tmp/home-b', 'state', 'magpie'))
  } finally { rmSync(dir, { recursive: true }) }
})

test('named deployment must not share identity with the default one', () => {
  const dir = repo({ 'ohmysa.yaml': base, 'deployments/bad.yaml': 'profile: bad\nport: 3085\ndshHome: "/tmp/home-c"\n' })
  try {
    assert.throws(() => loadManifest(dir, {}, 'bad'), /must set its own settings/)
    assert.throws(() => loadManifest(dir, {}, 'missing'), /unknown deployment/)
    assert.throws(() => loadManifest(dir, {}, '../x'), /invalid deployment name/)
  } finally { rmSync(dir, { recursive: true }) }
})
