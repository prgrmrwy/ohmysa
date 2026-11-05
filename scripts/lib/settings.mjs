import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const request = (manifest, method, route, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port: manifest.port, method, path: `/orchestrator/api/${route}`, timeout: 15_000,
    headers: { host: `127.0.0.1:${manifest.port}`, 'x-orchestrator-request': '1', ...(payload ? { 'content-type': 'application/json' } : {}) } },
  response => {
    let text = ''
    response.on('data', chunk => { text += chunk })
    response.on('end', () => {
      let parsed
      try { parsed = JSON.parse(text) } catch { parsed = text }
      if ((response.statusCode ?? 500) >= 400) reject(new Error(`${method} ${route} failed (${response.statusCode}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`))
      else resolve(parsed)
    })
  })
  req.on('timeout', () => { req.destroy(new Error(`${route} timed out`)) })
  req.on('error', reject)
  if (payload) req.write(payload)
  req.end()
})

export const readState = async manifest => { try { return await request(manifest, 'GET', 'state') } catch { return undefined } }
export async function waitReady(manifest, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await readState(manifest)
    if (state?.health?.runtime === 'ready' || state?.health?.runtime === 'paused') return state
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`the Host at ${manifest.host}:${manifest.port} did not become ready within ${timeoutMs / 1000}s`)
}

const filePath = (repo, value) => path.isAbsolute(value) ? value : path.join(repo, value)

/** Snapshot the deployment's settings (no secrets: credentials stay in files/operator logins). */
export async function exportSettings(manifest, repo) {
  const settings = await request(manifest, 'GET', 'settings')
  const prompts = await request(manifest, 'GET', 'prompts')
  const item = id => settings.sources.find(source => source.id === id)?.value
  const snapshot = {
    exportedAt: new Date().toISOString(),
    policy: settings.blocks.policy.value,
    eval: settings.blocks.eval.value,
    executor: settings.blocks.executor.value,
    sources: { github: item('github') ?? null },
    prompts: prompts.current.config,
  }
  const settingsFile = filePath(repo, manifest.settings ?? 'settings/settings.json')
  const promptsFile = filePath(repo, manifest.prompts ?? 'settings/prompts.json')
  mkdirSync(path.dirname(settingsFile), { recursive: true }); mkdirSync(path.dirname(promptsFile), { recursive: true })
  writeFileSync(settingsFile, JSON.stringify(snapshot, null, 2) + '\n')
  writeFileSync(promptsFile, JSON.stringify(snapshot.prompts, null, 2) + '\n')
  console.log(`exported settings -> ${settingsFile}\nexported prompts  -> ${promptsFile}`)
}

const save = async (manifest, block, route, value) => {
  const settings = await request(manifest, 'GET', 'settings')
  const current = block === 'source:github' ? settings.sources.find(source => source.id === 'github') : settings.blocks[block]
  if (!current) throw new Error(`no settings block ${block} in this deployment`)
  const saved = await request(manifest, 'PUT', route, { value, revision: current.revision })
  console.log(`${block}: revision ${current.revision} -> ${saved.revision}${saved.restarting ? ' (restarting)' : ''}`)
  if (saved.restarting) await waitReady(manifest)
}

/** Apply a snapshot produced by `ohmysa export` to a running Host, using its current revisions. */
export async function applySettings(manifest, repo) {
  const settingsFile = filePath(repo, manifest.settings ?? 'settings/settings.json')
  const promptsFile = filePath(repo, manifest.prompts ?? 'settings/prompts.json')
  if (!existsSync(settingsFile)) throw new Error(`missing ${settingsFile}; run \`ohmysa export\` first`)
  const snapshot = JSON.parse(readFileSync(settingsFile, 'utf8'))
  await waitReady(manifest)
  if (snapshot.sources?.github) await save(manifest, 'source:github', 'settings/source:github', snapshot.sources.github)
  if (snapshot.policy) await save(manifest, 'policy', 'settings/policy', snapshot.policy)
  if (snapshot.eval) await save(manifest, 'eval', 'settings/eval', snapshot.eval)
  if (snapshot.executor) await save(manifest, 'executor', 'settings/executor', snapshot.executor)
  if (existsSync(promptsFile)) {
    const prompts = await request(manifest, 'GET', 'prompts')
    const config = JSON.parse(readFileSync(promptsFile, 'utf8'))
    const saved = await request(manifest, 'PUT', 'prompts', { config, baseRevision: prompts.current.revision })
    console.log(`prompts: revision ${prompts.current.revision} -> ${saved.revision}`)
  }
  console.log('settings applied')
}
