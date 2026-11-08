import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { exportSettings, applySettings } from '../scripts/lib/settings.mjs'

async function fixture(run) {
  const repo = await mkdtemp(path.join(tmpdir(), 'ohmysa-settings-'))
  const sources = [
    { id: 'github', installed: true, revision: 2, value: { enabled: true, config: { repository: 'owner/repo' } } },
    { id: 'feishu', installed: true, revision: 5, value: { enabled: true, config: { cli: '/usr/local/bin/lark-bot', directMessages: true } } },
    { id: 'unavailable', installed: false, revision: 0, value: { enabled: false, config: {} } },
  ]
  const settings = { sources, blocks: Object.fromEntries(['policy', 'eval', 'executor'].map(block => [block, { revision: 3, value: {} }])) }
  const prompts = { current: { revision: 7, config: { communication: 'Test', scope: '', delivery: '', skills: {} } } }
  const writes = []
  const server = http.createServer(async (req, res) => {
    const route = req.url.replace('/orchestrator/api/', '')
    res.setHeader('content-type', 'application/json')
    assert.equal(req.headers['x-orchestrator-request'], '1')
    if (req.method === 'GET') {
      res.end(JSON.stringify(route === 'state' ? { health: { runtime: { state: 'ready' } } } : route === 'settings' ? settings : prompts))
      return
    }
    let text = ''
    for await (const chunk of req) text += chunk
    writes.push({ route, ...JSON.parse(text) })
    res.end(JSON.stringify({ revision: 8, restarting: route === 'settings/source:feishu' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const manifest = { host: '127.0.0.1', port: server.address().port }
  try { await run({ repo, manifest, sources, writes, prompts }) }
  finally {
    await new Promise(resolve => server.close(resolve))
    assert.equal(path.dirname(repo), tmpdir())
    assert.ok(path.basename(repo).startsWith('ohmysa-settings-'))
    await rm(repo, { recursive: true, force: true })
  }
}

test('snapshot round trip preserves GitHub and Feishu and uses each source revision', async () => {
  await fixture(async ({ repo, manifest, sources, writes, prompts }) => {
    await exportSettings(manifest, repo)
    const snapshot = JSON.parse(await readFile(path.join(repo, 'settings/settings.json'), 'utf8'))
    assert.deepEqual(snapshot.sources, Object.fromEntries(sources.filter(source => source.installed).map(source => [source.id, source.value])))
    await applySettings(manifest, repo)
    const sourceWrites = writes.filter(write => write.route.startsWith('settings/source:'))
    assert.deepEqual(sourceWrites, sources.filter(source => source.installed).map(source => ({ route: `settings/source:${source.id}`, value: source.value, revision: source.revision })))
    assert.deepEqual(writes.at(-1), { route: 'prompts', config: prompts.current.config, baseRevision: 7 })
  })
})
