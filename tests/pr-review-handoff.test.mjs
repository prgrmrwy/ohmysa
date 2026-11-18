import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import yaml from 'js-yaml'

const workflow = yaml.load(fs.readFileSync(new URL('../settings/pr-review-handoff.yml', import.meta.url), 'utf8'))
const script = workflow.jobs.handoff.steps[0].with.script
const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', script)
const old = new Date(Date.now() - 5 * 3600_000).toISOString()
const pr = (number, extra = {}) => ({ number, state: 'open', draft: false, created_at: old, user: { login: 'contributor', type: 'User' }, ...extra })
async function simulate(pulls, { comments = {}, reviews = {}, current = {} } = {}) {
  const posted = []
  const rest = {
    pulls: { list: () => pulls, listReviews: p => reviews[p.pull_number] ?? [], get: async p => ({ data: current[p.pull_number] ?? pulls.find(x => x.number === p.pull_number) }) },
    issues: { listComments: p => comments[p.issue_number] ?? [], createComment: async p => { posted.push(p); comments[p.issue_number] = [{ user: { login: 'github-actions[bot]' }, body: p.body }] } }
  }
  const github = { rest, paginate: async (fn, p) => fn(p) }
  await run(github, { repo: { owner: 'prgrmrwy', repo: 'example' } }, { info() {} })
  return posted
}
test('hands off only external human, non-draft PRs older than four hours', async () => {
  const posts = await simulate([pr(1), pr(2, { created_at: new Date(Date.now() - 3.9 * 3600_000).toISOString() }), pr(3, { draft: true }), pr(4, { user: { login: 'prgrmrwy', type: 'User' } }), pr(5, { user: { login: 'agent-bebop', type: 'User' } }), pr(6, { user: { login: 'dependabot[bot]', type: 'Bot' } }), pr(7, { created_at: 'bad' })])
  assert.deepEqual(posts.map(p => p.issue_number), [1])
  assert.match(posts[0].body, /<!-- bebop:pr-review -->/)
  assert.match(posts[0].body, /@prgrmrwy/)
})
test('trusted marker, manual assignment and prior agent review suppress duplicates; forged marker does not', async () => {
  const comments = { 1: [{ user: { login: 'github-actions[bot]' }, body: '<!-- bebop:pr-review -->' }], 2: [{ user: { login: 'prgrmrwy' }, body: '@agent-bebop review' }], 3: [{ user: { login: 'agent-bebop' }, body: 'On it' }], 5: [{ user: { login: 'contributor' }, body: '<!-- bebop:pr-review -->' }], 6: [{ user: { login: 'prgrmrwy' }, body: 'Thanks for contributing' }] }
  const reviews = { 4: [{ user: { login: 'agent-bebop' } }] }
  const pulls = [1, 2, 3, 4, 5, 6].map(n => pr(n))
  assert.deepEqual((await simulate(pulls, { comments, reviews })).map(p => p.issue_number), [5, 6])
  assert.equal((await simulate(pulls, { comments, reviews })).length, 0)
})
test('rechecks closed/draft PRs and caps each batch at five', async () => {
  const posts = await simulate(Array.from({ length: 9 }, (_, n) => pr(n + 1)), { current: { 1: pr(1, { state: 'closed' }), 2: pr(2, { draft: true }) } })
  assert.deepEqual(posts.map(p => p.issue_number), [3, 4, 5, 6, 7])
})
test('all deployment snapshots authorize the same marker and completion notification', () => {
  for (const name of ['settings', 'magpie/settings', 'auto-routing/settings']) {
    const settings = JSON.parse(fs.readFileSync(new URL(`../settings/${name}.json`, import.meta.url), 'utf8'))
    const rule = settings.policy.rules.find(r => r.id === 'external-pr-review')
    assert.equal(rule.enabled, true)
    assert.ok(rule.instruction.includes(settings.sources.github.config.repository))
    assert.match(rule.instruction, /<!-- bebop:pr-review -->/)
    assert.match(rule.instruction, /summary comment in the original PR mentioning @prgrmrwy/)
    assert.equal(settings.sources.github.config.observePulls, false)
  }
  assert.equal(workflow.on.schedule[0].cron, '37 * * * *')
  assert.equal(workflow.permissions['pull-requests'], 'read')
  assert.equal(workflow.jobs.handoff.steps.length, 1)
})
