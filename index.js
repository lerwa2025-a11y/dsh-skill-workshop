/**
 * Host half of 技能管理 (dsh-skill-workshop).
 *
 * Owns everything the page needs:
 *
 *   GET  /skill-workshop/catalog            every skill under the scanned roots
 *   GET  /skill-workshop/skill?key=         one skill: frontmatter, body, versions, files
 *   GET  /skill-workshop/version?key=&id=   an earlier SKILL.md, for the compare view
 *   GET  /skill-workshop/trash              what sits in the trash
 *
 *   POST /skill-workshop/skill/create       a new skill folder with a minimal SKILL.md
 *   POST /skill-workshop/skill/save         replace SKILL.md (fenced by content hash)
 *   POST /skill-workshop/skill/invocation   flip the two invocation keys in frontmatter
 *   POST /skill-workshop/skill/delete       move a skill into the trash
 *   POST /skill-workshop/version/restore    write an earlier version back
 *   POST /skill-workshop/trash/restore      put a trashed skill back
 *   POST /skill-workshop/trash/purge        delete one trash entry for good
 *   POST /skill-workshop/trash/empty        delete the whole trash
 *
 * Two deliberate rules, both learned the hard way elsewhere in this profile:
 *
 *   - frontmatter is edited as text, never re-serialised. A parse/serialise
 *     round trip destroys nested `metadata:` maps and block scalars that other
 *     tools wrote into these files.
 *   - every write carries the hash of what the reader saw. A stale page is
 *     refused instead of silently overwriting an edit made from the CLI or by
 *     an Agent.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const PREFIX = '/skill-workshop'
const DATA_DIR_NAME = 'dsh-skill-workshop'
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_VERSIONS = 30
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * The page's id for "no group". It is a derived bucket, never a stored group:
 * a skill with no membership belongs here, and one control can cover them all
 * without inventing a real group in the file.
 */
const UNGROUPED = '__ungrouped__'

/** DSH home, resolved the way the official plugins resolve it. */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Shared agents home, resolved the way the skill provider resolves it. */
function agentsHome() {
  return process.env.DSH_AGENTS_HOME || join(homedir(), '.agents')
}

/** This plugin's own data folder: trash and versions. Never inside node_modules. */
/**
 * This plugin's data folder, adopting the one it used under its former name.
 *
 * The package was called `dsh-skill-studio` before it was published; a reader
 * upgrading has real groups, versions and a trash in that folder. Moving it on
 * first use keeps them instead of silently starting empty.
 */
function dataDir() {
  const current = join(dshHome(), DATA_DIR_NAME)
  if (existsSync(current)) return current
  const legacy = join(dshHome(), 'dsh-skill-studio')
  if (!existsSync(legacy)) return current
  try {
    renameSync(legacy, current)
    return current
  } catch {
    // A locked move is not worth failing a page over; the folder stays behind
    // and the next call retries.
    return current
  }
}

function versionsDir() {
  return join(dataDir(), 'versions')
}

function trashDir() {
  return join(dataDir(), 'trash')
}

function settingsFile() {
  return join(dataDir(), 'settings.json')
}

/**
 * This plugin's own preferences.
 *
 * `composerButton` decides whether the composer offers the skill picker; it is
 * on by default because the button is this plugin's point in the conversation,
 * and off is a deliberate choice the reader makes.
 */
function readSettings() {
  const raw = readText(settingsFile())
  if (raw === undefined) return { composerButton: true }
  try {
    const parsed = JSON.parse(raw)
    return { composerButton: parsed?.composerButton !== false }
  } catch {
    return { composerButton: true }
  }
}

function writeSettings(next) {
  const file = settingsFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify({ composerButton: next.composerButton !== false }, null, 2), 'utf8')
  renameSync(temp, file)
}

function groupsFile() {
  return join(dataDir(), 'groups.json')
}

/**
 * The empty grouping.
 *
 * `previousMode` remembers what a skill's invocation was before a group
 * switch turned it off, so switching the group back on restores each skill's
 * own mode instead of flattening everything to "both".
 */
function emptyGroups() {
  return { version: 1, groups: [], members: {}, previousMode: {} }
}

/**
 * Read the grouping, repairing anything unusable to an empty grouping.
 *
 * This file is the only state this plugin owns that a person may hand-edit, so
 * every field is validated rather than trusted; a broken file costs the
 * grouping, never the page.
 */
function readGroups() {
  const raw = readText(groupsFile())
  if (raw === undefined) return emptyGroups()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyGroups()
  }
  const source = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const groups = Array.isArray(source.groups)
    ? source.groups
      .filter((group) => group !== null && typeof group === 'object' && typeof group.id === 'string' && group.id !== '')
      .map((group, index) => ({
        id: group.id,
        name: typeof group.name === 'string' && group.name.trim() !== '' ? group.name.trim().slice(0, 60) : `分组 ${index + 1}`,
        order: Number.isFinite(group.order) ? group.order : index,
        off: group.off === true,
      }))
      .sort((left, right) => left.order - right.order)
    : []
  const known = new Set(groups.map((group) => group.id))
  const members = {}
  if (source.members !== null && typeof source.members === 'object' && !Array.isArray(source.members)) {
    for (const [key, groupId] of Object.entries(source.members)) {
      // A member pointing at a deleted group falls back to "ungrouped" instead
      // of vanishing, so deleting a group never loses which skills it held.
      if (typeof groupId === 'string' && known.has(groupId)) members[key] = groupId
    }
  }
  const previousMode = {}
  if (source.previousMode !== null && typeof source.previousMode === 'object' && !Array.isArray(source.previousMode)) {
    for (const [key, mode] of Object.entries(source.previousMode)) {
      if (['both', 'slash', 'model', 'off'].includes(mode)) previousMode[key] = mode
    }
  }
  return { version: 1, groups, members, previousMode }
}

function writeGroups(state) {
  const file = groupsFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
  // Replace atomically: a crash mid-write must not leave a half grouping.
  renameSync(temp, file)
}

/**
 * The roots this page reads, in DSH's own priority order.
 *
 * Project-local roots are deliberately absent: their location depends on the
 * session's workspace, and a global page must not guess one. `customRoots` in
 * the row config covers any extra folder, project ones included.
 */
function roots(config) {
  // `rank` mirrors the filesystem provider's order: a lower rank wins a name
  // collision, which is what the page reports as the shadowing skill.
  const list = [
    { kind: 'user-dsh', dir: join(dshHome(), 'skills'), rank: 400 },
    { kind: 'user-agents', dir: join(agentsHome(), 'skills'), rank: 500 },
  ]
  for (const [index, dir] of (Array.isArray(config?.customRoots) ? config.customRoots : []).entries()) {
    if (typeof dir === 'string' && dir.trim() !== '') list.push({ kind: `custom-${index + 1}`, dir: dir.trim(), rank: 300 })
  }
  return list
}

function hash(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

function exists(path) {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/** Read a text file, or undefined when it is absent or unreadable. */
function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Split a SKILL.md into its frontmatter values and the body after it.
 *
 * Only the keys this page shows are interpreted; the original lines are kept
 * so the writer can edit the text in place.
 * @param text - the whole file.
 */
function parseFrontmatter(text) {
  const lines = text.split('\n')
  const values = {}
  if (lines[0]?.trim() !== '---') return { values, body: text, end: -1 }
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return { values, body: text, end: -1 }
  let key
  let block = false
  for (let index = 1; index < end; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (key !== undefined && block) {
        const value = line.trim()
        values[key] = values[key] === '' ? value : `${values[key]} ${value}`
      }
      continue
    }
    const match = /^([A-Za-z][\w-]*):(.*)$/u.exec(line)
    if (match === null) continue
    key = match[1]
    const raw = match[2].trim()
    block = raw === '' || /^[>|]/u.test(raw)
    values[key] = block ? '' : unquote(raw)
  }
  return { values, body: lines.slice(end + 1).join('\n'), end }
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/** The tri-state YAML boolean spellings the skill provider accepts. */
function truthy(value) {
  if (value === undefined) return undefined
  const text = String(value).trim().toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(text)) return true
  if (['false', 'no', 'off', '0'].includes(text)) return false
  return undefined
}

/** Resolved invocation policy of one parsed skill. */
function invocationOf(values) {
  return {
    modelInvocable: truthy(values['disable-model-invocation']) !== true,
    userInvocable: truthy(values['user-invocable']) !== false,
  }
}

/** The four-way mode a policy names, the same vocabulary the page shows. */
function modeOf(invocation) {
  if (invocation.modelInvocable && invocation.userInvocable) return 'both'
  if (invocation.userInvocable) return 'slash'
  return invocation.modelInvocable ? 'model' : 'off'
}

/** Frontmatter keys that express one mode; `undefined` removes the key. */
function keysForMode(mode) {
  const modelOn = mode === 'both' || mode === 'model'
  const userOn = mode === 'both' || mode === 'slash'
  return { disableModel: modelOn ? undefined : 'true', userInvocable: userOn ? undefined : 'false' }
}

/**
 * Set or remove one top-level frontmatter key by editing the original lines.
 *
 * Removing a key restores its default, so turning a skill back on leaves no
 * `user-invocable: true` residue behind in a file someone else maintains.
 * @param text - the whole file.
 * @param key - the top-level key to replace or drop.
 * @param value - its new value, or undefined to remove the key.
 */
function setFrontmatterKey(text, key, value) {
  const lines = text.split('\n')
  let end = -1
  if (lines[0]?.trim() === '---') {
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '---') {
        end = index
        break
      }
    }
  }
  if (end === -1) {
    if (value === undefined) return text
    return ['---', `${key}: ${value}`, '---', '', text].join('\n')
  }
  const kept = [lines[0]]
  let replaced = false
  let index = 1
  while (index < end) {
    const line = lines[index]
    const match = /^([A-Za-z][\w-]*):/u.exec(line)
    if (match !== null && match[1] === key) {
      if (value !== undefined && !replaced) kept.push(`${key}: ${value}`)
      replaced = true
      index += 1
      // An indented block belongs to the key that opened it; dropping the key
      // drops the block with it.
      while (index < end && (lines[index].startsWith(' ') || lines[index].startsWith('\t'))) index += 1
      continue
    }
    kept.push(line)
    index += 1
  }
  if (value !== undefined && !replaced) kept.push(`${key}: ${value}`)
  kept.push('---')
  for (let rest = end + 1; rest < lines.length; rest += 1) kept.push(lines[rest])
  return kept.join('\n')
}

/** Every file beside SKILL.md in a bundle, relative to the bundle folder. */
function resourcesOf(dir) {
  const found = []
  const walk = (current, prefix) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(current, entry.name), relative)
      else if (relative !== 'SKILL.md') found.push(relative)
    }
  }
  walk(dir, '')
  return found.sort()
}

function directoryBytes(dir) {
  let total = 0
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        try {
          total += statSync(path).size
        } catch {
          /* an unreadable file contributes nothing */
        }
      }
    }
  }
  walk(dir)
  return total
}

function mtimeOf(path) {
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return undefined
  }
}

/**
 * Every skill under the configured roots.
 *
 * A skill is `<root>/<name>/SKILL.md` or the flat `<root>/<name>.md`, the two
 * shapes DSH's own filesystem provider discovers.
 */
function scan(config) {
  const skills = []
  const problems = []
  const rootList = roots(config)
  for (const root of rootList) {
    if (!exists(root.dir)) continue
    let entries
    try {
      entries = readdirSync(root.dir, { withFileTypes: true })
    } catch (error) {
      problems.push({ root: root.kind, path: root.dir, reason: String(error?.message ?? error) })
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      let file
      let kind
      let bundleDir
      if (entry.isDirectory()) {
        const candidate = join(root.dir, entry.name, 'SKILL.md')
        if (!exists(candidate)) continue
        file = candidate
        bundleDir = join(root.dir, entry.name)
        kind = 'bundle'
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        file = join(root.dir, entry.name)
        kind = 'file'
      } else continue
      const text = readText(file)
      if (text === undefined) {
        problems.push({ root: root.kind, path: file, reason: 'unreadable' })
        continue
      }
      const { values, body } = parseFrontmatter(text)
      const fallbackName = basename(entry.name, '.md')
      skills.push({
        // The key spells out the root AND the shape: `foo/SKILL.md` and
        // `foo.md` in one root are different skills, and a key without the
        // shape made them collide, so one of the two could never be opened.
        key: `${root.kind}:${kind}:${fallbackName}`,
        name: typeof values.name === 'string' && values.name.trim() !== '' ? values.name.trim() : fallbackName,
        description: typeof values.description === 'string' ? values.description : '',
        root: root.kind,
        rootPath: root.dir,
        rank: root.rank,
        kind,
        path: file,
        dir: bundleDir,
        hash: hash(text),
        bytes: Buffer.byteLength(text, 'utf8'),
        invocation: invocationOf(values),
        whenToUse: typeof values.whenToUse === 'string' && values.whenToUse !== '' ? values.whenToUse : undefined,
        bodyLength: body.trim().length,
        updatedAt: mtimeOf(file),
      })
    }
  }
  skills.sort((left, right) => left.name.localeCompare(right.name) || left.rank - right.rank)

  /*
   * DSH loads one skill per name: the lowest-ranked root wins. Both are listed
   * so a duplicate is visible instead of silently ignored, but the loser is
   * marked and its file is not opened for editing — editing it would change
   * nothing the model ever sees.
   */
  const winner = new Map()
  for (const skill of skills) {
    if (!winner.has(skill.name)) winner.set(skill.name, skill.key)
  }
  for (const skill of skills) {
    const best = winner.get(skill.name)
    if (best !== skill.key) skill.shadowedBy = best
  }

  return { skills, roots: rootList.map(({ kind, dir }) => ({ kind, dir })), problems }
}

/** Find one skill by key from a fresh scan. */
function locate(config, key) {
  return scan(config).skills.find((skill) => skill.key === key)
}

/**
 * Find a skill that may be written.
 *
 * A shadowed skill loses its name to a higher-priority root, so editing or
 * deleting it would change a file the model never reads; refusing here is more
 * honest than letting the page report a successful save that changed nothing.
 */
function locateWritable(config, key) {
  const skill = locate(config, key)
  if (skill === undefined) throw new Error(`技能不存在或已被移除：${key}`)
  if (skill.shadowedBy !== undefined) throw new Error(`这个技能被同名技能覆盖，DSH 加载的不是它：${skill.shadowedBy}`)
  return skill
}

function versionDir(skill) {
  return join(versionsDir(), hash(skill.key).slice(0, 16))
}

function listVersions(skill) {
  const index = readText(join(versionDir(skill), 'index.json'))
  if (index === undefined) return []
  try {
    const parsed = JSON.parse(index)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** One skill with its content, resource files and stored versions. */
function detail(config, key) {
  const skill = locate(config, key)
  if (skill === undefined) throw new Error(`技能不存在或已被移除：${key}`)
  return {
    ...skill,
    content: readText(skill.path) ?? '',
    resources: skill.kind === 'bundle' ? resourcesOf(skill.dir) : [],
    versions: listVersions(skill),
  }
}

/** Keep the version a write is about to replace, so a change stays undoable. */
function keepVersion(skill, content) {
  const dir = versionDir(skill)
  mkdirSync(dir, { recursive: true })
  const id = `${Date.now()}-${hash(content).slice(0, 8)}`
  writeFileSync(join(dir, `${id}.md`), content, 'utf8')
  const versions = listVersions(skill)
  versions.push({ id, hash: hash(content), createdAt: new Date().toISOString() })
  while (versions.length > MAX_VERSIONS) {
    const dropped = versions.shift()
    try {
      rmSync(join(dir, `${dropped.id}.md`), { force: true })
    } catch {
      /* an already removed version needs no cleanup */
    }
  }
  writeFileSync(join(dir, 'index.json'), JSON.stringify(versions, null, 2), 'utf8')
}

/**
 * Write a skill file, refusing when the reader's copy is stale.
 *
 * `keep` is false for a change that only flips the invocation keys: the
 * history is for content, and a version per switch would bury it.
 */
function writeSkill(skill, content, expectedHash, keep = true) {
  const current = readText(skill.path)
  if (current === undefined) throw new Error('技能文件已不存在，请刷新后重试')
  if (typeof expectedHash === 'string' && hash(current) !== expectedHash) throw new Error('这个技能在你打开之后被改过，请刷新后再保存')
  if (keep) keepVersion(skill, current)
  writeFileSync(skill.path, content, 'utf8')
  return { hash: hash(content) }
}

function listTrash() {
  const dir = trashDir()
  if (!exists(dir)) return []
  const entries = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const meta = readText(join(dir, entry.name, 'meta.json'))
    if (meta === undefined) continue
    try {
      entries.push(JSON.parse(meta))
    } catch {
      /* an unreadable entry is not offered for restore */
    }
  }
  entries.sort((left, right) => String(right.trashedAt).localeCompare(String(left.trashedAt)))
  return entries
}

/** Move a path into place, falling back to a copy across volumes. */
function moveInto(source, target) {
  try {
    renameSync(source, target)
  } catch {
    cpSync(source, target, { recursive: true })
    rmSync(source, { recursive: true, force: true })
  }
}

/** Move a skill out of its root and into the trash, keeping how to put it back. */
function deleteSkill(config, key, expectedHash) {
  const skill = locateWritable(config, key)
  const current = readText(skill.path)
  if (current === undefined) throw new Error('技能文件已不存在，请刷新后重试')
  if (typeof expectedHash === 'string' && hash(current) !== expectedHash) throw new Error('这个技能在你打开之后被改过，请刷新后再删除')
  keepVersion(skill, current)
  const id = `${Date.now()}-${skill.name}`.replace(/[^\w.-]/gu, '_')
  const target = join(trashDir(), id)
  mkdirSync(target, { recursive: true })
  const source = skill.kind === 'bundle' ? skill.dir : skill.path
  moveInto(source, join(target, basename(source)))
  const meta = {
    id,
    name: skill.name,
    key: skill.key,
    root: skill.root,
    kind: skill.kind,
    originalPath: source,
    trashedAt: new Date().toISOString(),
    bytes: skill.kind === 'bundle' ? directoryBytes(join(target, basename(source))) : skill.bytes,
    file: basename(source),
  }
  writeFileSync(join(target, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

/** Put one trash entry back where it came from, or into an explicit folder. */
function restoreTrash(id, targetDir) {
  const dir = join(trashDir(), id)
  const meta = readText(join(dir, 'meta.json'))
  if (meta === undefined) throw new Error('回收站里没有这一项')
  const entry = JSON.parse(meta)
  const source = join(dir, entry.file)
  if (!exists(source)) throw new Error('回收站里的文件已丢失')
  const destination = typeof targetDir === 'string' && targetDir !== ''
    ? join(targetDir, basename(entry.originalPath))
    : entry.originalPath
  if (exists(destination)) throw new Error(`目标位置已有同名技能：${destination}`)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true })
  rmSync(dir, { recursive: true, force: true })
  return { ...entry, restoredTo: destination }
}

/** Create a new skill folder with the smallest valid SKILL.md. */
function createSkill(config, input) {
  const name = text(input.name, '技能名', 64)
  if (!NAME_PATTERN.test(name)) throw new Error('技能名只能用小写字母、数字和短横线，例如 release-notes')
  const description = text(input.description, '描述', 1000)
  const rootList = roots(config)
  const root = rootList.find((item) => item.kind === (typeof input.root === 'string' ? input.root : 'user-dsh'))
  if (root === undefined) throw new Error('目标根目录不存在')
  mkdirSync(root.dir, { recursive: true })
  const folder = join(root.dir, name)
  if (exists(folder) || exists(join(root.dir, `${name}.md`))) throw new Error(`已存在同名技能：${name}`)
  mkdirSync(folder, { recursive: false })
  const content = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${name}`,
    '',
    description,
    '',
  ].join('\n')
  writeFileSync(join(folder, 'SKILL.md'), content, 'utf8')
  const key = `${root.kind}:bundle:${name}`
  /*
   * The dialog may name the group, and writing it here keeps the answer's
   * group honest: the page then opens exactly the group the skill is in
   * instead of guessing after a refresh.
   */
  if (typeof input.group === 'string' && input.group !== '' && input.group !== UNGROUPED) {
    const state = readGroups()
    if (!state.groups.some((group) => group.id === input.group)) throw new Error('分组不存在')
    state.members[key] = input.group
    writeGroups(state)
  }
  return { key, name, group: typeof input.group === 'string' ? input.group : UNGROUPED }
}

/* ---------------------------------------------------------------- groups */

/**

/** Every skill key a group covers, read from a fresh scan. */
function skillsOfGroup(config, state, groupId) {
  const assigned = new Set(Object.values(state.members))
  return scan(config).skills.filter((skill) => (groupId === UNGROUPED
    ? !Object.hasOwn(state.members, skill.key)
    : state.members[skill.key] === groupId))
}

/**
 * The effective switch state of a group: on, off, or mixed.
 *
 * A mixed group is reported as mixed rather than as "on": treating it as on
 * would make the next click turn things off that were already off.
 */
function groupStatus(skills) {
  if (skills.length === 0) return 'on'
  const modes = skills.map((skill) => modeOf(skill.invocation))
  const on = modes.filter((mode) => mode !== 'off').length
  if (on === modes.length) return 'on'
  return on === 0 ? 'off' : 'mixed'
}

/**
 * Turn a whole group on or off by writing each member's frontmatter.
 *
 * This is a fan-out of N independent file writes, not one transaction: a
 * failure halfway leaves the earlier skills changed. The answer therefore
 * reports every skill's outcome rather than a single success flag, so the page
 * can say exactly what changed.
 */
function setGroupInvocation(config, groupId, on) {
  const state = readGroups()
  const targets = skillsOfGroup(config, state, groupId)
  if (targets.length === 0) return { changed: 0, failed: [], skipped: [], state: readGroups() }
  const next = { ...state, previousMode: { ...state.previousMode } }
  const failed = []
  const skipped = []
  let changed = 0
  for (const skill of targets) {
    // A shadowed skill loses its name to another root, so writing it would
    // change a file the model never reads — the same reason a single-row edit
    // throws. A group switch reports it as skipped instead of pretending.
    if (skill.shadowedBy !== undefined) {
      skipped.push({ key: skill.key, name: skill.name, shadowedBy: skill.shadowedBy })
      continue
    }
    try {
      const current = readText(skill.path)
      if (current === undefined) throw new Error('文件已不存在')
      const mode = modeOf(skill.invocation)
      if (on) {
        // Restore what this skill was before a group switch turned it off,
        // falling back to "both" for a skill that was already off on purpose.
        const restore = next.previousMode[skill.key] ?? (mode === 'off' ? 'both' : mode)
        if (mode === restore) continue
        writeSkill(skill, applyMode(current, restore), undefined, false)
        delete next.previousMode[skill.key]
      } else {
        if (mode === 'off') continue
        next.previousMode[skill.key] = mode
        writeSkill(skill, applyMode(current, 'off'), undefined, false)
      }
      changed += 1
    } catch (error) {
      failed.push({ key: skill.key, name: skill.name, reason: String(error instanceof Error ? error.message : error) })
    }
  }
  writeGroups(next)
  return { changed, failed, skipped, state: next }
}

/** One SKILL.md with the invocation keys rewritten to express `mode`. */
function applyMode(content, mode) {
  const keys = keysForMode(mode)
  let next = setFrontmatterKey(content, 'disable-model-invocation', keys.disableModel)
  next = setFrontmatterKey(next, 'user-invocable', keys.userInvocable)
  return next
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Reject cross-site callers: the skill catalog is only meaningful same-origin. */
function sameOrigin(req) {
  if (String(req.headers['sec-fetch-site'] ?? '') === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (total === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function text(value, label, maximum = 2000) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}不能为空`)
  if (value.length > maximum) throw new Error(`${label}过长`)
  return value.trim()
}

/* ------------------------------------------------------------ plugin skills */

/**
 * The active profile's folder.
 *
 * Installed bundles live in its `node_modules`, which is how a plugin's own
 * bundled skills are found: they ship inside the package, never under the
 * user's skill roots, so the ordinary scan cannot see them.
 */
function profileDir() {
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR
  return join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'desktop')
}

/**
 * Folders inside an installed package that may hold bundled skills.
 *
 * A fixed list, not a recursive walk: these are the layouts packages actually
 * use, and walking a package like ds-bot would read thousands of files on a
 * page open.
 */
const SKILL_DIRS = ['skills', 'skill', 'lib/skills', 'src/host/skills', 'src/office/skills']

/** Every SKILL.md under one candidate folder, or the folder's own when it is one skill. */
function skillsIn(dir) {
  if (!exists(dir)) return []
  if (exists(join(dir, 'SKILL.md'))) return [{ file: join(dir, 'SKILL.md'), dir }]
  const found = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const file = join(dir, entry.name, 'SKILL.md')
    if (exists(file)) found.push({ file, dir: join(dir, entry.name) })
  }
  return found
}

/** The packages this profile actually installs, from its manifest alone. */
function installedPackages() {
  const raw = readText(join(profileDir(), 'package.json'))
  if (raw === undefined) return []
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    return []
  }
  const names = new Set(Object.keys(manifest?.dependencies ?? {}))
  for (const name of Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []) names.add(name)
  return [...names]
}

/**
 * Whether a package's own code registers a skill provider.
 *
 * This separates two very different "not in the catalog" cases. A package that
 * registers a provider (scriptor does, inside its writing preset) has skills
 * the model can load once that mode is active; a package that only ships the
 * folder has skills nothing ever reads. The page must not present them alike.
 *
 * Two markers, because packages register either directly or by mounting the
 * shared filesystem provider with their own bundled root: `registerProvider`
 * covers the first, `bundledSkillDir`/`skill-filesystem` the second.
 *
 * The scan is bounded — a fixed file budget, a size cap, and no node_modules —
 * and cached per package, because it runs at most once per page load.
 */
/*
 * Every way a package can publish a skill. There are two entry points on the
 * registry and one indirect one, and a package uses whichever suits it:
 *
 *   registerProvider()          — a provider that lists many skills
 *   skills.register()           — one embedded runtime skill, content in code
 *   mounting skill-filesystem   — the shared provider pointed at a package dir
 *
 * Missing `skills.register` was a real bug: browser-skill publishes through it
 * and was reported as unregistered while DSH was loading it fine.
 */
const PROVIDER_MARKERS = [
  'registerProvider',
  'skills.register(',
  '.skills.register',
  'bundledSkillDir',
  'skill-filesystem',
]
const providerCache = new Map()
function registersProvider(pkgDir) {
  const cached = providerCache.get(pkgDir)
  if (cached !== undefined) return cached
  let answer = false
  let budget = 160
  const walk = (dir, depth) => {
    if (answer || budget <= 0 || depth > 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (answer || budget <= 0) return
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (!/\.(?:js|mjs|cjs)$/u.test(entry.name)) continue
      budget -= 1
      try {
        if (statSync(path).size > 3 * 1024 * 1024) continue
      } catch {
        continue
      }
      const source = readText(path)
      if (source !== undefined && PROVIDER_MARKERS.some((marker) => source.includes(marker))) {
        answer = true
        return
      }
    }
  }
  walk(pkgDir, 0)
  providerCache.set(pkgDir, answer)
  return answer
}

/**
 * Every plugin-bundled skill, grouped by the package that ships it.
 *
 * Two sources are merged on purpose, because neither is complete alone:
 *
 *   - the live registry says which skills the model can load *right now*, but
 *     it is scope-aware, so a preset-scoped provider is invisible from here;
 *   - the package folders say which skills exist on disk, including the ones
 *     no provider ever registered.
 *
 * A skill present in the first is marked `loaded`; one that exists only on disk
 * is `scoped` when its package registers a provider (it loads in that mode) and
 * `unregistered` when nothing reads it at all.
 */
function pluginSkills(ctx) {
  const root = join(profileDir(), 'node_modules')
  const catalog = new Set()
  let catalogError
  const service = typeof ctx?.get === 'function' ? ctx.get('skills') : undefined
  const plugins = []
  const packages = installedPackages()
  const dirs = []
  for (const name of packages) {
    const dir = join(root, name)
    if (exists(dir)) dirs.push({ name, dir })
  }
  for (const { name, dir } of dirs) {
    const found = []
    for (const sub of SKILL_DIRS) {
      for (const item of skillsIn(join(dir, sub))) {
        if (!found.some((existing) => existing.file === item.file)) found.push(item)
      }
    }
    if (found.length === 0) continue
    let manifest = {}
    try {
      manifest = JSON.parse(readText(join(dir, 'package.json')) ?? '{}')
    } catch {
      manifest = {}
    }
    plugins.push({ name, dir, manifest, found })
  }
  const skills = []
  for (const plugin of plugins) {
    for (const item of plugin.found) {
      const raw = readText(item.file)
      if (raw === undefined) continue
      const { values, body } = parseFrontmatter(raw)
      const fallback = basename(item.dir)
      const skillName = typeof values.name === 'string' && values.name.trim() !== '' ? values.name.trim() : fallback
      skills.push({
        key: `plugin:${plugin.name}:${skillName}`,
        name: skillName,
        description: typeof values.description === 'string' ? values.description : '',
        package: plugin.name,
        path: item.file,
        bytes: Buffer.byteLength(raw, 'utf8'),
        invocation: invocationOf(values),
        bodyLength: body.trim().length,
        updatedAt: mtimeOf(item.file),
      })
    }
  }
  if (service !== undefined && typeof service.list === 'function') {
    try {
      const listed = service.list({})
      if (listed !== null && typeof listed.then === 'function') {
        return Promise.resolve(listed).then((value) => finish(value), (error) => finish(undefined, error))
      }
      return finish(listed)
    } catch (error) {
      return finish(undefined, error)
    }
  }
  return finish(undefined, new Error('技能注册表不可用'))

  /** Mark each skill once the live catalog is known. */
  function finish(listed, error) {
    if (error !== undefined) catalogError = String(error?.message ?? error)
    for (const skill of Array.isArray(listed) ? listed : []) {
      if (typeof skill?.name === 'string') catalog.add(skill.name)
    }
    for (const skill of skills) {
      if (catalog.has(skill.name)) skill.status = 'loaded'
      else skill.status = registersProvider(join(root, skill.package)) ? 'scoped' : 'unregistered'
    }
    skills.sort((left, right) => left.package.localeCompare(right.package) || left.name.localeCompare(right.name))
    const groups = []
    for (const plugin of plugins) {
      const members = skills.filter((skill) => skill.package === plugin.name)
      if (members.length === 0) continue
      groups.push({
        // The package name is the honest label: a manifest description is a
        // paragraph, not a heading, and the page shows it beneath the name.
        id: plugin.name,
        name: plugin.name,
        package: plugin.name,
        version: typeof plugin.manifest.version === 'string' ? plugin.manifest.version : undefined,
        description: typeof plugin.manifest.description === 'string' ? plugin.manifest.description : '',
        memberKeys: members.map((skill) => skill.key),
      })
    }
    return { plugins: groups, skills, catalogError }
  }
}

/**
 * Read one plugin skill's file.
 *
 * The path comes from the page, so it is re-derived from a fresh scan and
 * matched by key instead of being trusted: a caller cannot walk out of
 * `node_modules` by passing a crafted path.
 */
function pluginSkillDetail(ctx, key) {
  const scan = pluginSkills(ctx)
  return Promise.resolve(scan).then((result) => {
    const skill = (result?.skills ?? []).find((item) => item.key === key)
    if (skill === undefined) throw new Error(`插件技能不存在：${key}`)
    return {
      ...skill,
      content: readText(skill.path) ?? '',
      resources: resourcesOf(dirname(skill.path)),
    }
  })
}

/**
 * Translate one fragment through DSH's own translator service.
 *
 * The service is optional: a profile without it (or with every route refused)
 * must still let the page render the original text. Provider choice is the
 * service's, not this plugin's — the reader already picks it in Settings, and
 * a second picker here would let the two disagree.
 *
 * Anonymous routes (Bing, Google) need no Session; the paid DeepSeek routes do,
 * so a missing `sessionId` simply means "ask the anonymous routes".
 */
/**
 * Split one body into provider-sized pieces at paragraph boundaries.
 *
 * A skill body is routinely longer than one provider request — the bundled
 * Blender skill alone is over fifty thousand characters — so a single call
 * would refuse most real skills. Paragraphs are the split unit because cutting
 * mid-sentence is what makes machine translation read badly.
 */
function splitForTranslation(text, limit) {
  const pieces = []
  let current = ''
  const push = () => {
    if (current.trim() !== '') pieces.push(current)
    current = ''
  }
  for (const paragraph of text.split(/\n{2,}/u)) {
    const candidate = current === '' ? paragraph : `${current}\n\n${paragraph}`
    if (candidate.length <= limit) {
      current = candidate
      continue
    }
    push()
    // One paragraph longer than the limit still has to be sent: cut it on a
    // sentence end where possible, otherwise hard-split at the limit.
    if (paragraph.length > limit) {
      let rest = paragraph
      while (rest.length > limit) {
        const window = rest.slice(0, limit)
        const cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('. '), window.lastIndexOf('\n'))
        const at = cut > limit * 0.5 ? cut + 1 : limit
        pieces.push(rest.slice(0, at))
        rest = rest.slice(at)
      }
      current = rest
    } else {
      current = paragraph
    }
  }
  push()
  return pieces
}

/** Translate one body, one provider-sized piece at a time, in order. */
async function translateFragment(service, text, target, sessionId, signal) {
  if (service === undefined) throw new Error('翻译服务不可用：当前 profile 没有挂载 translator')
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (trimmed === '') throw new Error('没有可翻译的正文')
  const limit = typeof service.maxTextChars === 'number' && service.maxTextChars > 0 ? service.maxTextChars : 4000
  const pieces = splitForTranslation(trimmed, limit)
  const out = []
  for (const piece of pieces) {
    signal?.throwIfAborted?.()
    const spec = service.resolve({
      text: piece,
      targetLanguage: target,
      ...(sessionId === undefined ? {} : { sessionId }),
    })
    out.push(await service.translate(spec, signal))
  }
  return out.join('\n\n')
}

export function apply(ctx, config = {}) {
  /*
   * `translator` is optional: a profile without that bundle must still render
   * the page, so the route reports "unavailable" instead of the plugin failing
   * to mount. Cordis only resolves a service a plugin declares, which is why
   * `ctx.get('translator')` on the outer context returned nothing.
   */
  ctx.inject(['webServer', 'translator'], (webCtx) => {
    /** One route: same-origin check, method guard, JSON answer with a readable failure. */
    const route = (path, methods, run) => webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}${path}`,
      handler: async (req, res) => {
        if (!sameOrigin(req)) {
          sendJson(res, 403, { error: '拒绝跨站请求' })
          return
        }
        if (!methods.includes(req.method ?? 'GET')) {
          res.setHeader('allow', methods.join(', '))
          sendJson(res, 405, { error: '不支持的请求方法' })
          return
        }
        try {
          // This route may answer both methods; only a POST carries a body.
          const body = req.method === 'POST' ? await readBody(req, MAX_BODY_BYTES) : {}
          const query = new URL(req.url ?? '/', 'http://localhost').searchParams
          sendJson(res, 200, await run(body, query, req.method ?? 'GET'))
        } catch (error) {
          sendJson(res, 400, { error: String(error instanceof Error ? error.message : error) })
        }
      },
    }), `dsh-skill-workshop: ${PREFIX}${path}`)

    /*
     * The catalog carries the grouping alongside the skills: the page renders
     * one list from one answer, so a group edit can never be shown against a
     * skill list read a moment earlier.
     */
    route('/catalog', ['GET'], () => {
      const state = readGroups()
      const scanned = scan(config)
      const byGroup = new Map()
      for (const skill of scanned.skills) {
        const groupId = state.members[skill.key]
        if (typeof groupId === 'string') byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), skill.key])
      }
      const groups = state.groups.map((group) => {
        const members = byGroup.get(group.id) ?? []
        return {
          ...group,
          memberKeys: members,
          status: groupStatus(scanned.skills.filter((skill) => members.includes(skill.key))),
        }
      })
      const ungrouped = scanned.skills.filter((skill) => !Object.hasOwn(state.members, skill.key))
      return {
        ...scanned,
        groups,
        ungrouped: { id: UNGROUPED, memberKeys: ungrouped.map((skill) => skill.key), status: groupStatus(ungrouped) },
      }
    })

    route('/skill', ['GET'], (_body, query) => detail(config, query.get('key') ?? ''))

    /*
     * Plugin skills are read-only on purpose: the files belong to the installed
     * package, so an edit here would be reverted by the next package update and
     * an entry in the trash would never come back. The page shows them, grouped
     * by the package that ships them, and offers no write path at all.
     */
    route('/plugin-skills', ['GET'], () => pluginSkills(ctx))

    route('/plugin-skills/skill', ['GET'], (_body, query) => pluginSkillDetail(ctx, query.get('key') ?? ''))

    /*
     * Translation of one skill's body. Both tabs read it, so the route takes
     * the text from the file itself rather than from the page: a caller cannot
     * use this as a general-purpose translation proxy, and the text sent to
     * the provider is always the one the reader is looking at.
     */
    route('/translate', ['POST'], async (body) => {
      const kind = body.kind === 'plugin' ? 'plugin' : 'own'
      const key = text(body.key, '技能标识', 300)
      const target = typeof body.target === 'string' && body.target.trim() !== '' ? body.target.trim() : 'zh'
      if (!/^(?:auto|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/u.test(target)) throw new Error('目标语言格式不正确')
      const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
      const found = kind === 'plugin' ? await pluginSkillDetail(ctx, key) : detail(config, key)
      /*
       * Which text to send. The body is the instruction; the description is the
       * one-line summary shown above it and in the picker. They are separate
       * because a reader may want one without the other, and because the
       * description is short enough to translate in one request.
       *
       * The frontmatter is never sent: the YAML keys are machine-read, and
       * translating them would produce a document no tool could parse if
       * anyone copied it back.
       */
      const field = body.field === 'description' ? 'description' : 'body'
      const source = field === 'description'
        ? String(found.description ?? '')
        : String(found.content ?? '').replace(/^---[\s\S]*?\n---\n?/u, '')
      if (source.trim() === '') throw new Error(field === 'description' ? '这个技能没有简介' : '这个技能没有正文')
      const service = webCtx.translator
      const translated = await translateFragment(service, source, target, sessionId)
      return { text: translated, source, target, field, chars: source.trim().length }
    })

    route('/version', ['GET'], (_body, query) => {
      const skill = locate(config, query.get('key') ?? '')
      if (skill === undefined) throw new Error('技能不存在')
      const content = readText(join(versionDir(skill), `${text(query.get('id'), '版本标识', 200)}.md`))
      if (content === undefined) throw new Error('这一版内容已不存在')
      return { id: query.get('id'), content }
    })

    route('/trash', ['GET'], () => ({ entries: listTrash() }))

    route('/skill/create', ['POST'], (body) => createSkill(config, body))

    route('/skill/save', ['POST'], (body) => {
      const skill = locateWritable(config, text(body.key, '技能标识', 300))
      if (typeof body.content !== 'string' || body.content === '') throw new Error('内容不能为空')
      return writeSkill(skill, body.content, body.expectedHash)
    })

    route('/skill/invocation', ['POST'], (body) => {
      const skill = locateWritable(config, text(body.key, '技能标识', 300))
      if (typeof body.modelInvocable !== 'boolean' || typeof body.userInvocable !== 'boolean') throw new Error('调用方式参数不完整')
      const current = readText(skill.path)
      if (current === undefined) throw new Error('技能文件已不存在，请刷新后重试')
      let next = setFrontmatterKey(current, 'disable-model-invocation', body.modelInvocable ? undefined : 'true')
      next = setFrontmatterKey(next, 'user-invocable', body.userInvocable ? undefined : 'false')
      return writeSkill(skill, next, body.expectedHash, false)
    })

    route('/skill/delete', ['POST'], (body) => deleteSkill(config, text(body.key, '技能标识', 300), body.expectedHash))

    route('/version/restore', ['POST'], (body) => {
      const skill = locateWritable(config, text(body.key, '技能标识', 300))
      const content = readText(join(versionDir(skill), `${text(body.versionId, '版本标识', 200)}.md`))
      if (content === undefined) throw new Error('这一版内容已不存在')
      return writeSkill(skill, content, body.expectedHash)
    })

    route('/trash/restore', ['POST'], (body) => restoreTrash(text(body.id, '回收站标识', 300), body.target))

    route('/trash/purge', ['POST'], (body) => {
      const dir = join(trashDir(), text(body.id, '回收站标识', 300))
      if (!exists(dir)) throw new Error('回收站里没有这一项')
      rmSync(dir, { recursive: true, force: true })
      return { purged: body.id }
    })

    route('/trash/empty', ['POST'], () => {
      const dir = trashDir()
      if (exists(dir)) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) rmSync(join(dir, entry.name), { recursive: true, force: true })
      }
      return { emptied: true }
    })

    /* ------------------------------------------------------------- groups */

    route('/groups', ['GET'], () => readGroups())

    /*
     * One route, two methods: a duplicate path registration replaces the first,
     * which silently turned GET into a 405. The handler branches instead.
     */
    route('/settings', ['GET', 'POST'], (body, _query, method) => {
      if (method === 'GET') return readSettings()
      if (typeof body.composerButton !== 'boolean') throw new Error('设置参数不完整')
      const next = { composerButton: body.composerButton }
      writeSettings(next)
      return next
    })

    route('/groups/create', ['POST'], (body) => {
      const name = text(body.name, '分组名', 60)
      const state = readGroups()
      if (state.groups.some((group) => group.name === name)) throw new Error(`已有同名分组：${name}`)
      const id = `g${Date.now().toString(36)}`
      state.groups.push({ id, name, order: state.groups.length, off: false })
      writeGroups(state)
      return { id, state }
    })

    route('/groups/rename', ['POST'], (body) => {
      const id = text(body.id, '分组标识', 100)
      const name = text(body.name, '分组名', 60)
      const state = readGroups()
      const group = state.groups.find((item) => item.id === id)
      if (group === undefined) throw new Error('分组不存在')
      if (state.groups.some((item) => item.id !== id && item.name === name)) throw new Error(`已有同名分组：${name}`)
      group.name = name
      writeGroups(state)
      return state
    })

    /*
     * Reorder by writing the whole visible order back.
     *
     * The client sends the complete id list rather than a single move, so a
     * drag that ends anywhere produces one canonical order — a from/to pair
     * would have to be replayed identically to stay consistent.
     */
    route('/groups/reorder', ['POST'], (body) => {
      const state = readGroups()
      // Reject a non-string entry instead of dropping it: silently shrinking
      // the list would let a malformed request look like a valid reorder.
      if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) {
        throw new Error('分组顺序格式不正确')
      }
      const ids = body.ids
      const known = new Set(state.groups.map((group) => group.id))
      if (ids.length !== state.groups.length || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) {
        throw new Error('分组顺序与当前分组不一致，请刷新后重试')
      }
      const byId = new Map(state.groups.map((group) => [group.id, group]))
      state.groups = ids.map((id, index) => ({ ...byId.get(id), order: index }))
      writeGroups(state)
      return state
    })

    route('/groups/delete', ['POST'], (body) => {
      const id = text(body.id, '分组标识', 100)
      const state = readGroups()
      if (!state.groups.some((group) => group.id === id)) throw new Error('分组不存在')
      state.groups = state.groups.filter((group) => group.id !== id)
      // Members fall back to ungrouped rather than being dropped, so deleting a
      // group never forgets which skills it held.
      for (const [key, groupId] of Object.entries(state.members)) {
        if (groupId === id) delete state.members[key]
      }
      writeGroups(state)
      return state
    })

    route('/groups/assign', ['POST'], (body) => {
      const key = text(body.key, '技能标识', 300)
      const state = readGroups()
      const skill = locate(config, key)
      if (skill === undefined) throw new Error('技能不存在')
      const raw = body.group
      if (raw === null || raw === undefined || raw === '' || raw === UNGROUPED) delete state.members[key]
      else {
        const groupId = text(raw, '分组标识', 100)
        if (!state.groups.some((group) => group.id === groupId)) throw new Error('分组不存在')
        state.members[key] = groupId
      }
      writeGroups(state)
      return state
    })

    /*
     * Switching a group writes every member's SKILL.md. The answer reports
     * each skill that changed and each that failed: a partial run is a real
     * outcome, not a failed request, and the page must be able to say so.
     */
    route('/groups/invocation', ['POST'], (body) => {
      const id = text(body.id, '分组标识', 100)
      if (typeof body.on !== 'boolean') throw new Error('启停参数不完整')
      if (id !== UNGROUPED && !readGroups().groups.some((group) => group.id === id)) throw new Error('分组不存在')
      return setGroupInvocation(config, id, body.on)
    })
  })
}
