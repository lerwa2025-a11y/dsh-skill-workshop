/**
 * Offline checks for the Host half.
 *
 * A throwaway DSH home is created under the OS temp directory, the real
 * `apply` is mounted on a fake web server, and every route is exercised
 * against real files. Nothing touches the user's own DSH home.
 *
 *   node tools/verify-host.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'skill-studio-'))
process.env.DSH_HOME = home

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  if (!ok) console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${detail}`}`)
  else console.log(`ok    ${name}`)
}

/** Collect the routes `apply` registers, so they can be called directly. */
const routes = new Map()
const ctx = {
  inject: (_services, run) => run({
    effect: (factory) => factory(),
    webServer: {
      register: (route) => {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
  }),
}

const { apply } = await import('../index.js')
apply(ctx, {})

/** Call one route with a JSON body or query and read the JSON answer. */
async function call(path, { method = 'GET', body, query, headers } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body)
  const stream = payload === null
    ? (async function* () {})()
    : (async function* () { yield Buffer.from(payload) })()
  stream.on = () => {}
  const req = {
    method,
    url: `${path}${query === undefined ? '' : `?${new URLSearchParams(query)}`}`,
    headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
    [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
  }
  let status = 200
  let text = ''
  const res = {
    setHeader: () => {},
    writeHead: (code) => { status = code },
    end: (chunk) => { text = chunk ?? '' },
  }
  await routes.get(path)(req, res)
  return { status, body: text === '' ? null : JSON.parse(text) }
}

// ---------------------------------------------------------------- fixtures

const skillsRoot = join(home, 'skills')
mkdirSync(join(skillsRoot, 'alpha', 'scripts'), { recursive: true })
const alphaFile = join(skillsRoot, 'alpha', 'SKILL.md')
writeFileSync(alphaFile, [
  '---',
  'name: alpha',
  'description: 第一个技能',
  'metadata:',
  '  openclaw:',
  '    requires:',
  '      bins: [ffmpeg]',
  'whenToUse: 需要 alpha 时',
  'disable-model-invocation: true',
  '---',
  '',
  '# Alpha',
  '',
  '- 一条',
  '',
].join('\n'), 'utf8')
writeFileSync(join(skillsRoot, 'alpha', 'scripts', 'run.sh'), 'echo hi\n', 'utf8')
writeFileSync(join(skillsRoot, 'flat.md'), '---\nname: flat\ndescription: 单文件技能\n---\n\n正文\n', 'utf8')

// ------------------------------------------------------------------ catalog

const catalog = await call('/skill-workshop/catalog')
check('catalog lists both shapes', catalog.body.skills.length === 2, JSON.stringify(catalog.body.skills.map((s) => s.name)))
const alpha = catalog.body.skills.find((skill) => skill.name === 'alpha')
check('frontmatter description read', alpha.description === '第一个技能')
check('invocation resolved', alpha.invocation.modelInvocable === false && alpha.invocation.userInvocable === true)
check('whenToUse read', alpha.whenToUse === '需要 alpha 时')

const detail = await call('/skill-workshop/skill', { query: { key: alpha.key } })
check('detail carries body', detail.body.content.includes('# Alpha'))
check('detail lists resources', detail.body.resources.includes('scripts/run.sh'), JSON.stringify(detail.body.resources))

// ---------------------------------------------------------- invocation write

const flipped = await call('/skill-workshop/skill/invocation', {
  method: 'POST',
  body: { key: alpha.key, modelInvocable: true, userInvocable: false, expectedHash: alpha.hash },
})
check('invocation write accepted', flipped.status === 200 && typeof flipped.body.hash === 'string', JSON.stringify(flipped.body))
const rewritten = readFileSync(alphaFile, 'utf8')
check('model key removed rather than set true', !rewritten.includes('disable-model-invocation'), rewritten.split('\n---')[0])
check('user key written false', rewritten.includes('user-invocable: false'))
check('nested metadata survived', rewritten.includes('      bins: [ffmpeg]'), rewritten.slice(0, 260))
check('body untouched', rewritten.includes('# Alpha') && rewritten.includes('- 一条'))

// ----------------------------------------------------------------- fencing

const stale = await call('/skill-workshop/skill/save', {
  method: 'POST',
  body: { key: alpha.key, content: '---\nname: alpha\n---\n\nstale\n', expectedHash: alpha.hash },
})
check('stale hash refused', stale.status === 400 && /被改过/u.test(stale.body.error), JSON.stringify(stale.body))

const current = (await call('/skill-workshop/skill', { query: { key: alpha.key } })).body
const saved = await call('/skill-workshop/skill/save', {
  method: 'POST',
  body: { key: alpha.key, content: current.content.replace('一条', '两条'), expectedHash: current.hash },
})
check('save with fresh hash accepted', saved.status === 200)
const versions = (await call('/skill-workshop/skill', { query: { key: alpha.key } })).body.versions
check('version kept before write', versions.length === 1, JSON.stringify(versions))

const restored = await call('/skill-workshop/version/restore', {
  method: 'POST',
  body: { key: alpha.key, versionId: versions[0].id, expectedHash: saved.body.hash },
})
check('version restore accepted', restored.status === 200)
check('restore brought old text back', readFileSync(alphaFile, 'utf8').includes('一条'))

// ------------------------------------------------------------------- trash

const currentAgain = (await call('/skill-workshop/skill', { query: { key: alpha.key } })).body
const removed = await call('/skill-workshop/skill/delete', {
  method: 'POST',
  body: { key: alpha.key, expectedHash: currentAgain.hash },
})
check('delete accepted', removed.status === 200, JSON.stringify(removed.body))
check('bundle gone from root', !existsSync(join(skillsRoot, 'alpha')))
const trash = await call('/skill-workshop/trash')
check('trash lists one entry', trash.body.entries.length === 1, JSON.stringify(trash.body.entries))
check('trash entry remembered origin', trash.body.entries[0].originalPath === join(skillsRoot, 'alpha'))
check('trash computed size', trash.body.entries[0].bytes > 0)

const restoredEntry = await call('/skill-workshop/trash/restore', { method: 'POST', body: { id: trash.body.entries[0].id } })
check('trash restore accepted', restoredEntry.status === 200, JSON.stringify(restoredEntry.body))
check('restored with its folder', existsSync(join(skillsRoot, 'alpha', 'scripts', 'run.sh')))

// -------------------------------------------------------------- create/empty

const created = await call('/skill-workshop/skill/create', {
  method: 'POST',
  body: { name: 'beta', description: '第二个技能', root: 'user-dsh' },
})
check('create accepted', created.status === 200, JSON.stringify(created.body))
check('created file is valid frontmatter', readFileSync(join(skillsRoot, 'beta', 'SKILL.md'), 'utf8').startsWith('---\nname: beta\n'))
const dupe = await call('/skill-workshop/skill/create', {
  method: 'POST',
  body: { name: 'beta', description: 'again', root: 'user-dsh' },
})
check('duplicate name refused', dupe.status === 400)

const betaKey = created.body.key
const beta = (await call('/skill-workshop/skill', { query: { key: betaKey } })).body
await call('/skill-workshop/skill/delete', { method: 'POST', body: { key: betaKey, expectedHash: beta.hash } })
const emptied = await call('/skill-workshop/trash/empty', { method: 'POST', body: {} })
check('empty trash accepted', emptied.status === 200)
check('trash now empty', (await call('/skill-workshop/trash')).body.entries.length === 0)

// ------------------------------------------------------------------- guards

const crossSite = await call('/skill-workshop/catalog', { headers: { 'sec-fetch-site': 'cross-site' } })
check('cross-site refused', crossSite.status === 403)
const wrongMethod = await call('/skill-workshop/catalog', { method: 'POST', body: {} })
check('wrong method refused', wrongMethod.status === 405)

// ------------------------------------------------------- duplicate shapes

/*
 * `foo/SKILL.md` and `foo.md` in one root are two skills. They used to share
 * one key, so the second could never be opened; this pins the fix.
 */
writeFileSync(join(skillsRoot, 'dup.md'), '---\nname: dup\ndescription: 单文件版\n---\n\nflat\n', 'utf8')
mkdirSync(join(skillsRoot, 'dup'), { recursive: true })
writeFileSync(join(skillsRoot, 'dup', 'SKILL.md'), '---\nname: dup\ndescription: 目录版\n---\n\nbundle\n', 'utf8')
const dupCatalog = (await call('/skill-workshop/catalog')).body.skills
const dupKeys = dupCatalog.filter((skill) => skill.name === 'dup').map((skill) => skill.key)
check('two shapes keep distinct keys', dupKeys.length === 2 && new Set(dupKeys).size === 2, JSON.stringify(dupKeys))
const bundleDup = dupCatalog.find((skill) => skill.name === 'dup' && skill.kind === 'bundle')
const fileDup = dupCatalog.find((skill) => skill.name === 'dup' && skill.kind === 'file')
check('the losing shape is marked shadowed', fileDup?.shadowedBy === bundleDup?.key || bundleDup?.shadowedBy === fileDup?.key, JSON.stringify({ bundle: bundleDup?.shadowedBy, file: fileDup?.shadowedBy }))
const shadowedKey = [bundleDup, fileDup].find((skill) => skill.shadowedBy !== undefined)?.key
const shadowWrite = await call('/skill-workshop/skill/save', {
  method: 'POST',
  body: { key: shadowedKey, content: '---\nname: dup\n---\n\nx\n' },
})
check('a shadowed skill refuses writes', shadowWrite.status === 400 && /覆盖/u.test(shadowWrite.body.error), JSON.stringify(shadowWrite.body))

// ------------------------------------------------------------------- groups

const groupA = await call('/skill-workshop/groups/create', { method: 'POST', body: { name: '写作' } })
check('group created', groupA.status === 200 && typeof groupA.body.id === 'string', JSON.stringify(groupA.body))
const groupAId = groupA.body.id
const duplicateGroup = await call('/skill-workshop/groups/create', { method: 'POST', body: { name: '写作' } })
check('duplicate group name refused', duplicateGroup.status === 400)

const alphaNow = (await call('/skill-workshop/catalog')).body.skills.find((skill) => skill.name === 'alpha')
const assigned = await call('/skill-workshop/groups/assign', { method: 'POST', body: { key: alphaNow.key, group: groupAId } })
check('skill assigned to group', assigned.status === 200 && assigned.body.members[alphaNow.key] === groupAId)

const withGroups = (await call('/skill-workshop/catalog')).body
const renderedGroup = withGroups.groups.find((group) => group.id === groupAId)
check('catalog reports group membership', renderedGroup?.memberKeys.includes(alphaNow.key), JSON.stringify(renderedGroup))
check('ungrouped bucket lists the rest', withGroups.ungrouped.memberKeys.length === withGroups.skills.length - 1, String(withGroups.ungrouped.memberKeys.length))

const renamed = await call('/skill-workshop/groups/rename', { method: 'POST', body: { id: groupAId, name: '写作类' } })
check('group renamed', renamed.status === 200 && renamed.body.groups.find((group) => group.id === groupAId).name === '写作类')

// --------------------------------------------------------- group switching

const beforeOff = (await call('/skill-workshop/skill', { query: { key: alphaNow.key } })).body
const turnedOff = await call('/skill-workshop/groups/invocation', { method: 'POST', body: { id: groupAId, on: false } })
check('group switch off reports one change', turnedOff.status === 200 && turnedOff.body.changed === 1, JSON.stringify(turnedOff.body))
const afterOff = (await call('/skill-workshop/skill', { query: { key: alphaNow.key } })).body
check('member is off after the switch', afterOff.invocation.modelInvocable === false && afterOff.invocation.userInvocable === false)
check('previous mode remembered', turnedOff.body.state.previousMode[alphaNow.key] !== undefined, JSON.stringify(turnedOff.body.state.previousMode))

const turnedOn = await call('/skill-workshop/groups/invocation', { method: 'POST', body: { id: groupAId, on: true } })
const afterOn = (await call('/skill-workshop/skill', { query: { key: alphaNow.key } })).body
check('switch on restores the earlier mode', afterOn.invocation.userInvocable === beforeOff.invocation.userInvocable && afterOn.invocation.modelInvocable === beforeOff.invocation.modelInvocable, JSON.stringify({ before: beforeOff.invocation, after: afterOn.invocation }))
check('previous mode cleared once restored', turnedOn.body.state.previousMode[alphaNow.key] === undefined)

const mixedStatus = (await call('/skill-workshop/groups/invocation', { method: 'POST', body: { id: groupAId, on: false } })).body
const statusAfterOff = (await call('/skill-workshop/catalog')).body.groups.find((group) => group.id === groupAId).status
check('group status reads off when every member is off', statusAfterOff === 'off', statusAfterOff)
await call('/skill-workshop/groups/invocation', { method: 'POST', body: { id: groupAId, on: true } })

// ------------------------------------------- group switch and shadowed skills

/*
 * A group switch must not write a shadowed skill's file: DSH never loads it,
 * and the single-row path already refuses. The group path reports it instead.
 */
const dupGroup = await call('/skill-workshop/groups/create', { method: 'POST', body: { name: '重复组' } })
const dupGroupId = dupGroup.body.id
const dupAll = (await call('/skill-workshop/catalog')).body.skills.filter((skill) => skill.name === 'dup')
const winnerDup = dupAll.find((skill) => skill.shadowedBy === undefined)
const loserDup = dupAll.find((skill) => skill.shadowedBy !== undefined)
await call('/skill-workshop/groups/assign', { method: 'POST', body: { key: winnerDup.key, group: dupGroupId } })
await call('/skill-workshop/groups/assign', { method: 'POST', body: { key: loserDup.key, group: dupGroupId } })
const loserFile = loserDup.path
const loserBefore = readFileSync(loserFile, 'utf8')
const dupSwitch = await call('/skill-workshop/groups/invocation', { method: 'POST', body: { id: dupGroupId, on: false } })
check('a shadowed member is skipped, not written', dupSwitch.body.skipped?.length === 1 && dupSwitch.body.skipped[0].key === loserDup.key, JSON.stringify(dupSwitch.body.skipped))
check('the shadowed file is untouched', readFileSync(loserFile, 'utf8') === loserBefore)
check('the winning member still changes', dupSwitch.body.changed === 1, String(dupSwitch.body.changed))
await call('/skill-workshop/groups/invocation', { method: 'POST', body: { id: dupGroupId, on: true } })

// -------------------------------------------------------- group reordering

const orderOne = await call('/skill-workshop/groups/create', { method: 'POST', body: { name: '甲' } })
const orderTwo = await call('/skill-workshop/groups/create', { method: 'POST', body: { name: '乙' } })
const beforeOrder = (await call('/skill-workshop/groups')).body.groups.map((group) => group.id)
const reversed = [...beforeOrder].reverse()
const reordered = await call('/skill-workshop/groups/reorder', { method: 'POST', body: { ids: reversed } })
check('reorder accepted', reordered.status === 200, JSON.stringify(reordered.body))
const afterOrder = (await call('/skill-workshop/groups')).body.groups.map((group) => group.id)
check('the new order persisted', JSON.stringify(afterOrder) === JSON.stringify(reversed), JSON.stringify({ before: beforeOrder, after: afterOrder }))
check('order values are renumbered', (await call('/skill-workshop/groups')).body.groups.every((group, index) => group.order === index), JSON.stringify((await call('/skill-workshop/groups')).body.groups.map((group) => group.order)))

const wrongSet = await call('/skill-workshop/groups/reorder', { method: 'POST', body: { ids: [orderOne.body.id] } })
check('a partial order is refused', wrongSet.status === 400 && /不一致/u.test(wrongSet.body.error), JSON.stringify(wrongSet.body))
const dupIds = await call('/skill-workshop/groups/reorder', { method: 'POST', body: { ids: [orderOne.body.id, orderOne.body.id] } })
check('a duplicated id is refused', dupIds.status === 400)
const stillOrdered = (await call('/skill-workshop/groups')).body.groups.map((group) => group.id)
check('a refused reorder leaves the order intact', JSON.stringify(stillOrdered) === JSON.stringify(afterOrder))

// A fresh read is what the next visit sees; the order must survive it.
const reread = (await call('/skill-workshop/groups')).body.groups.map((group) => group.name)
check('order survives a fresh read', JSON.stringify(reread) === JSON.stringify(reversed.map((id) => (id === orderOne.body.id ? '甲' : id === orderTwo.body.id ? '乙' : reread[reversed.indexOf(id)]))), JSON.stringify(reread))

// Keep the later assertions independent of these two groups.
await call('/skill-workshop/groups/reorder', { method: 'POST', body: { ids: beforeOrder } })
for (const id of [orderOne.body.id, orderTwo.body.id]) await call('/skill-workshop/groups/delete', { method: 'POST', body: { id } })

// --------------------------------------------- creating a skill into a group

/*
 * The create dialog names a group; the Host must honour it in the same write,
 * and refuse one that does not exist rather than silently dropping it.
 */
const createdInGroup = await call('/skill-workshop/skill/create', {
  method: 'POST',
  body: { name: 'grouped-skill', description: '指定分组的技能', root: 'user-dsh', group: groupAId },
})
check('create accepts a group', createdInGroup.status === 200 && createdInGroup.body.group === groupAId, JSON.stringify(createdInGroup.body))
const groupedCatalog = (await call('/skill-workshop/catalog')).body
check('the new skill is in that group immediately', groupedCatalog.groups.find((group) => group.id === groupAId).memberKeys.includes(createdInGroup.body.key), JSON.stringify(groupedCatalog.groups.map((group) => group.memberKeys)))
const badGroupCreate = await call('/skill-workshop/skill/create', {
  method: 'POST',
  body: { name: 'orphan-skill', description: '分组不存在', root: 'user-dsh', group: 'no-such-group' },
})
check('an unknown group is refused', badGroupCreate.status === 400, JSON.stringify(badGroupCreate.body))

const plainCreate = await call('/skill-workshop/skill/create', {
  method: 'POST',
  body: { name: 'ungrouped-skill', description: '没有指定分组', root: 'user-dsh' },
})
check('create without a group reports the ungrouped bucket', plainCreate.body.group === '__ungrouped__', JSON.stringify(plainCreate.body))
const ungroupedAfter = (await call('/skill-workshop/catalog')).body
check('a skill created without a group is ungrouped', ungroupedAfter.ungrouped.memberKeys.includes(plainCreate.body.key), JSON.stringify(ungroupedAfter.ungrouped.memberKeys))

// ------------------------------------------------------------ group delete

const deleted = await call('/skill-workshop/groups/delete', { method: 'POST', body: { id: groupAId } })
// The duplicate group from the shadow test is still there, so this asserts the\n// target is gone rather than that no groups remain at all.\ncheck('group deleted', deleted.status === 200 && !deleted.body.groups.some((group) => group.id === groupAId), JSON.stringify(deleted.body.groups.map((group) => group.name)))
check('its members fall back to ungrouped', !Object.hasOwn(deleted.body.members, alphaNow.key), JSON.stringify(deleted.body.members))
const afterDelete = (await call('/skill-workshop/catalog')).body
check('the skill is still listed after its group is gone', afterDelete.skills.some((skill) => skill.key === alphaNow.key))

// ------------------------------------------------------------------ settings

/*
 * The composer button is on by default: it is this plugin's visible point in
 * the conversation, and a reader who never opens settings still finds it.
 */
const defaultSettings = await call('/skill-workshop/settings')
check('the composer button defaults on', defaultSettings.status === 200 && defaultSettings.body.composerButton === true, JSON.stringify(defaultSettings.body))
const switchOff = await call('/skill-workshop/settings', { method: 'POST', body: { composerButton: false } })
check('the switch saves', switchOff.status === 200 && switchOff.body.composerButton === false)
check('the switch persists across reads', (await call('/skill-workshop/settings')).body.composerButton === false)
const badSetting = await call('/skill-workshop/settings', { method: 'POST', body: { composerButton: 'yes' } })
check('a non-boolean switch value is refused', badSetting.status === 400)
await call('/skill-workshop/settings', { method: 'POST', body: { composerButton: true } })

// ------------------------------------------------------- groups file safety

writeFileSync(join(home, 'dsh-skill-workshop', 'groups.json'), '{ this is not json', 'utf8')
const brokenFile = await call('/skill-workshop/groups')
check('a broken groups file degrades to empty', brokenFile.status === 200 && Array.isArray(brokenFile.body.groups) && brokenFile.body.groups.length === 0)

// ------------------------------------------------------------ plugin skills

/*
 * A real profile shape under the throwaway home: a package.json naming the
 * installed plugins, and package folders that ship skills in the layouts
 * packages actually use. Nothing here is invented for the test — the point is
 * that the scan reads a profile the way the running app lays one out.
 */
const profileDir = join(home, 'profiles', 'desktop')
const modules = join(profileDir, 'node_modules')
/*
 * The app exports DSH_PROFILE_DIR, and this process inherits it when the suite
 * runs inside DSH. Pin it to the fixture, or the scan reads the real profile.
 */
process.env.DSH_PROFILE_DIR = profileDir
mkdirSync(join(modules, 'demo-bundle', 'skills', 'demo-one'), { recursive: true })
mkdirSync(join(modules, 'demo-bundle', 'skills', 'demo-two'), { recursive: true })
mkdirSync(join(modules, 'demo-flat', 'skill'), { recursive: true })
mkdirSync(join(modules, 'demo-noreg', 'skills', 'orphan'), { recursive: true })
writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-desktop',
  dependencies: { 'demo-bundle': '1.0.0', 'demo-flat': '2.0.0', 'demo-noreg': '3.0.0' },
  dsh: { profile: { bundles: ['demo-bundle', 'demo-flat', 'demo-noreg'] } },
}, null, 2), 'utf8')

/** Write one package: manifest, a source file with or without a provider, and skills. */
function writePackage(name, version, { provider = false, description = '' } = {}) {
  const dir = join(modules, name)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, description }, null, 2), 'utf8')
  writeFileSync(join(dir, 'index.js'), provider ? 'ctx.skills.registerProvider(() => p)\n' : 'export const x = 1\n', 'utf8')
}
writePackage('demo-bundle', '1.0.0', { provider: true, description: '演示插件' })
writePackage('demo-flat', '2.0.0', { provider: true })
writePackage('demo-noreg', '3.0.0', { provider: false })

writeFileSync(join(modules, 'demo-bundle', 'skills', 'demo-one', 'SKILL.md'),
  '---\nname: demo-one\ndescription: 第一个插件技能\n---\n\n# Demo one\n', 'utf8')
writeFileSync(join(modules, 'demo-bundle', 'skills', 'demo-two', 'SKILL.md'),
  '---\nname: demo-two\ndescription: 第二个插件技能\n---\n\n# Demo two\n', 'utf8')
writeFileSync(join(modules, 'demo-flat', 'skill', 'SKILL.md'),
  '---\nname: demo-flat-skill\ndescription: 扁平布局\n---\n\n# Flat\n', 'utf8')
writeFileSync(join(modules, 'demo-noreg', 'skills', 'orphan', 'SKILL.md'),
  '---\nname: orphan-skill\ndescription: 没有注册的技能\n---\n\n# Orphan\n', 'utf8')

/*
 * Remount with a stubbed registry: one name is listed, so everything else must
 * read as scoped or unregistered — the distinction this tab exists to make.
 */
routes.clear()
const listed = [{ name: 'demo-one' }]
const registry = { list: () => Promise.resolve(listed) }
const skillCtx = {
  get: (name) => (name === 'skills' ? registry : undefined),
  inject: (_services, run) => run({
    effect: (factory) => factory(),
    webServer: {
      register: (route) => {
        routes.set(route.path, route.handler)
        return () => {}
      },
    },
  }),
}
const fresh = await import(`../index.js?plugin-skills=${Date.now()}`)
fresh.apply(skillCtx, {})

const pluginAnswer = await call('/skill-workshop/plugin-skills')
check('plugin skills route answers', pluginAnswer.status === 200, JSON.stringify(pluginAnswer.body).slice(0, 200))

const pluginSkills = pluginAnswer.body?.skills ?? []
check('plugin scan finds every bundled skill', pluginSkills.length === 4, String(pluginSkills.length))
check('plugin scan keeps both package layouts',
  pluginSkills.some((skill) => skill.name === 'demo-one') && pluginSkills.some((skill) => skill.name === 'demo-flat-skill'))
check('plugin scan groups by package', new Set(pluginSkills.map((skill) => skill.package)).size === 3)
check('plugin groups carry the manifest version', pluginAnswer.body?.plugins.find((group) => group.id === 'demo-bundle')?.version === '1.0.0')

/*
 * Status is the whole point of the tab: a skill in the live catalog is loaded,
 * one whose package registers a provider but is not in this catalog is
 * mode-scoped, and one whose package never registers is unregistered.
 */
const byName = new Map(pluginSkills.map((skill) => [skill.name, skill]))
check('a listed skill reads as loaded', byName.get('demo-one')?.status === 'loaded', byName.get('demo-one')?.status)
check('an unlisted skill of a registering package reads as scoped', byName.get('demo-two')?.status === 'scoped', byName.get('demo-two')?.status)
check('a skill whose package never registers reads as unregistered', byName.get('orphan-skill')?.status === 'unregistered', byName.get('orphan-skill')?.status)

/*
 * The page reads one file through a route that re-derives its path from a
 * fresh scan, so a crafted key cannot address a file outside the profile.
 */
const oneDetail = await call('/skill-workshop/plugin-skills/skill', { query: { key: byName.get('demo-two')?.key } })
check('one plugin skill carries its body', String(oneDetail.body?.content ?? '').includes('# Demo two'))
check('one plugin skill carries its package', oneDetail.body?.package === 'demo-bundle')

const escape = await call('/skill-workshop/plugin-skills/skill', { query: { key: 'plugin:demo-bundle:../../../../etc/passwd' } })
check('a crafted key is refused', escape.status === 400, String(escape.status))

/*
 * A read-only tab must have no write route at all: these are the paths the
 * reader's own tab uses, and none may exist for plugin skills.
 */
for (const path of ['/skill-workshop/plugin-skills/save', '/skill-workshop/plugin-skills/delete', '/skill-workshop/plugin-skills/invocation']) {
  check(`no write route at ${path}`, !routes.has(path))
}

// ---------------------------------------------------------------- translate

/*
 * Translation is delegated to DSH's own translator service, so the test stubs
 * that service rather than the network: what this plugin must get right is
 * which text it sends and what it does when the service is missing or refuses.
 */
const calls = []
const translator = {
  maxTextChars: 4000,
  resolve: (request) => ({ ...request, sourceLanguage: 'auto' }),
  translate: async (spec) => {
    calls.push(spec)
    if (spec.text.includes('FAIL')) throw new Error('TRANSLATION_REQUEST_FAILED')
    return `[${spec.targetLanguage}] ${spec.text.slice(0, 20)}`
  },
}
routes.clear()
/*
 * `translator` arrives through the injection list, not through ctx.get: Cordis
 * only resolves a service a plugin declares, so the stub must provide it the
 * same way the real loader does.
 */
const translateCtx = {
  inject: (services, run) => run({
    ...(services.includes('translator') ? { translator } : {}),
    effect: (factory) => factory(),
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
  }),
}
const translateMod = await import(`../index.js?translate=${Date.now()}`)
translateMod.apply(translateCtx, {})

const own = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'own', key: 'user-dsh:file:flat', target: 'en' } })
check('translate answers for an own skill', own.status === 200, JSON.stringify(own.body).slice(0, 160))
check('translate returns the translated text', String(own.body?.text ?? '').startsWith('[en]'), own.body?.text)
/*
 * The frontmatter is machine-read: translating it would produce a document no
 * tool could parse if the reader copied it back, so only the body is sent.
 */
check('translate sends the body without the frontmatter', !String(calls[0]?.text ?? '').includes('name:'), String(calls[0]?.text ?? '').slice(0, 80))

const pluginOne = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'plugin', key: byName.get('demo-one')?.key, target: 'zh' } })
check('translate answers for a plugin skill', pluginOne.status === 200, JSON.stringify(pluginOne.body).slice(0, 160))

/*
 * A real skill body is routinely longer than one provider request — the bundled
 * Blender skill is over fifty thousand characters — so the route must split it
 * rather than refuse. A single call would fail most skills in practice.
 */
calls.length = 0
const longText = `${'段落。'.repeat(1500)}\n\n${'第二段。'.repeat(1500)}`
writeFileSync(join(skillsRoot, 'long.md'), `---\nname: long\ndescription: 长正文\n---\n\n${longText}\n`, 'utf8')
const longAnswer = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'own', key: 'user-dsh:file:long', target: 'en' } })
check('a body over the provider limit is split, not refused', longAnswer.status === 200, JSON.stringify(longAnswer.body).slice(0, 160))
check('the split sent more than one request', calls.length > 1, String(calls.length))
check('every piece stayed within the provider limit', calls.every((spec) => spec.text.length <= 4000), calls.map((spec) => spec.text.length).join(','))
check('the pieces were rejoined in order', String(longAnswer.body?.text ?? '').startsWith('[en]'), String(longAnswer.body?.text ?? '').slice(0, 40))

/*
 * The description is translated on its own: it is the one-line summary above
 * the body, short enough for a single request, and a reader may want it without
 * translating the whole instruction.
 */
calls.length = 0
const descAnswer = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'own', key: 'user-dsh:file:flat', target: 'en', field: 'description' } })
check('the description can be translated on its own', descAnswer.status === 200 && descAnswer.body?.field === 'description', JSON.stringify(descAnswer.body).slice(0, 160))
check('the description request carries only the summary', calls.length === 1 && !String(calls[0]?.text ?? '').includes('# '), String(calls[0]?.text ?? '').slice(0, 60))

const bodyAnswer = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'own', key: 'user-dsh:file:flat', target: 'en' } })
check('the body remains the default field', bodyAnswer.status === 200 && bodyAnswer.body?.field === 'body', JSON.stringify(bodyAnswer.body).slice(0, 120))

const badTarget = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'own', key: 'user-dsh:file:flat', target: '../../etc' } })
check('a malformed target language is refused', badTarget.status === 400, String(badTarget.status))

const unknownKey = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'own', key: 'no-such-skill', target: 'en' } })
check('an unknown skill is refused', unknownKey.status === 400, String(unknownKey.status))

/*
 * Without the service the page must say so rather than break: the body still
 * renders, only the aid is unavailable.
 */
routes.clear()
const noTranslator = {
  inject: (_services, run) => run({
    effect: (factory) => factory(),
    webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
  }),
}
const bare = await import(`../index.js?no-translator=${Date.now()}`)
bare.apply(noTranslator, {})
const missing = await call('/skill-workshop/translate', { method: 'POST', body: { kind: 'own', key: 'user-dsh:file:flat', target: 'en' } })
check('a missing translator is reported, not thrown', missing.status === 400 && String(missing.body?.error ?? '').includes('翻译服务'), JSON.stringify(missing.body).slice(0, 160))

rmSync(home, { recursive: true, force: true })

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
