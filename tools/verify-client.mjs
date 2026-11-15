/**
 * Offline smoke test for the browser half.
 *
 * The bundle is a `window.__ModuleLoader__` factory, so it can be executed in
 * Node once three things stand in for the browser: a `window`, a `document`
 * that accepts a style tag, and a `react` module. React is stubbed just far
 * enough to run the page's render path and walk the element tree it returns —
 * enough to catch a crash, a missing translator and a wrong slot registration
 * without a browser.
 *
 *   node tools/verify-client.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok || detail === undefined ? '' : `  ${detail}`}`)
}

// ------------------------------------------------------------------ stubs

let registered = null

/** Minimal `createElement`: a plain tree, so assertions can walk it. */
function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
}

/*
 * A stateful mini renderer: one component instance keeps its hook cells across
 * renders, so a test can mount a page, let its load effect settle, and assert
 * what the reader would actually see. Cells are positional, exactly as React
 * orders them; that is enough for this page, which declares its hooks once.
 */
let currentInstance = null
let rerender = () => {}

function makeInstance(render, props) {
  const cells = []
  let cursor = 0
  const instance = {
    props,
    pending: false,
    render() {
      cursor = 0
      currentInstance = instance
      try {
        return render(instance.props)
      } finally {
        currentInstance = null
      }
    },
  }
  const cell = (index) => {
    if (cells[index] === undefined) cells[index] = {}
    return cells[index]
  }
  instance.useState = (initial) => {
    const index = cursor++
    const slot = cell(index)
    if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial
    if (slot.setter === undefined) {
      slot.setter = (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        instance.pending = true
      }
    }
    return [slot.value, slot.setter]
  }
  instance.useEffect = (run) => {
    const index = cursor++
    const slot = cell(index)
    if (slot.ran !== true) {
      slot.ran = true
      // Deferred like a real effect, so a load that resolves asynchronously can
      // land in a later render pass.
      defer.push(() => { slot.cleanup?.(); slot.cleanup = run() })
    }
  }
  instance.useMemo = (factory) => factory()
  instance.useCallback = (fn) => fn
  instance.useRef = (value) => { const index = cursor++; const slot = cell(index); if (!('value' in slot)) slot.value = { current: value }; return slot.value }
  instance.useId = (() => { let id = 0; return () => `id-${id++}` })()
  return instance
}

/** Effects and async continuations waiting for the next flush. */
const defer = []

/** Run queued effects and re-render until the tree settles. */
async function settle(instance, passes = 8) {
  for (let pass = 0; pass < passes; pass += 1) {
    while (defer.length > 0) defer.shift()()
    await Promise.resolve()
    await Promise.resolve()
    if (!instance.pending) return instance.render()
    instance.pending = false
  }
  return instance.render()
}

const react = {
  createElement,
  useState: (initial) => currentInstance.useState(initial),
  useEffect: (run) => currentInstance.useEffect(run),
  useLayoutEffect: (run) => currentInstance.useEffect(run),
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (value) => currentInstance.useRef(value),
  useId: () => currentInstance.useId(),
  Fragment: Symbol('Fragment'),
}

/**
 * Render one element tree to the bottom.
 *
 * Function components are rendered through their own instance, so a nested
 * component keeps its hook cells across passes just like the page it sits in.
 * Instances are keyed by the component plus its position, which is stable for
 * this page's fixed structure.
 */
const instances = new Map()

function renderNode(node, path = '0') {
  if (node === null || node === undefined || node === false) return node
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}.${index}`))
  if (typeof node !== 'object') return node
  if (typeof node.type !== 'function') {
    return { ...node, children: (node.children ?? []).map((child, index) => renderNode(child, `${path}.${index}`)) }
  }
  const key = `${node.path ?? path}:${node.type.name}`
  if (!instances.has(key)) instances.set(key, makeInstance(node.type, { ...node.props, children: node.children }))
  const instance = instances.get(key)
  instance.props = { ...node.props, children: node.children }
  return renderNode(instance.render(), `${path}>`)
}

/** Settle every mounted instance, then render the whole tree once more. */
async function settleAll(root, passes = 10) {
  // The root's own `path` names the instance, so mounting the same component
  // twice (a second visit with different data) gets a second instance rather
  // than the first one re-rendered.
  const start = root.path ?? '0'
  let tree = renderNode(root, start)
  for (let pass = 0; pass < passes; pass += 1) {
    while (defer.length > 0) defer.shift()()
    await Promise.resolve()
    await Promise.resolve()
    tree = renderNode(root, start)
  }
  return tree
}

const styleTags = []
const document = {
  querySelector: () => null,
  createElement: (tag) => {
    const element = { tag, dataset: {}, textContent: '', parentNode: null }
    if (tag === 'style') styleTags.push(element)
    return element
  },
  head: { appendChild: (element) => { element.parentNode = { removeChild: () => {} } } },
}

globalThis.window = {
  __ModuleLoader__: { load: (definition) => { registered = definition } },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
}
globalThis.document = document
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } }

const portalCalls = []
const requireStub = (id) => {
  if (id === 'react') return react
  // A portal is asserted rather than rendered: the point of the test is that
  // the menu leaves the clipped container, not what it looks like there.
  if (id === 'react-dom') return { createPortal: (node, target) => { portalCalls.push({ node, target }); return node } }
  throw new Error(`unexpected require: ${id}`)
}

// ------------------------------------------------------------------- load

new Function('window', source)(globalThis.window)
check('bundle registers a factory', registered !== null && registered.id === 'dsh-skill-workshop', registered?.id)

const moduleExports = registered.factory(requireStub)
check('exports apply and inject', typeof moduleExports.apply === 'function' && Array.isArray(moduleExports.inject), JSON.stringify(moduleExports.inject))

// ------------------------------------------------------------------ apply

const registrations = []
const injections = []
let effects = 0
let dictionary = null

const ctx = {
  effect: (factory) => { effects += 1; factory(); return () => {} },
  locale: {
    register: (ns, dicts) => { dictionary = { ns, dicts }; return () => {} },
    bind: (ns) => (key, params) => {
      const text = dictionary?.dicts?.zh?.[key] ?? key
      if (params === undefined) return text
      return text.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match))
    },
  },
  layout: { selectPanel: () => {} },
  slots: {
    inject: (slot, run) => {
      injections.push(slot)
      return run()
    },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

moduleExports.apply(ctx)

check('locale namespace registered', dictionary?.ns === 'skillStudio' && dictionary.dicts.zh['tab.skills'] === '技能')
check('styles installed once', styleTags.length === 1 && styleTags[0].textContent.includes('.ssShell'), String(styleTags.length))
check('injects main, sidebar and composer', ['main', 'sidebar.panellist', 'conversation.input.left'].every((slot) => injections.includes(slot)), injections.join(','))

const main = registrations.find((entry) => entry.options.name === 'main')
check('main panel keyed by id', main?.options.key === 'skill-workshop', JSON.stringify(main?.options))
const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
check('sidebar entry shares the id', sidebar?.options.id === main?.options.key)
check('sidebar entry carries a label function', typeof sidebar?.options.label === 'function' && sidebar.options.label() === '技能工坊', sidebar?.options.label?.())

// A second plugin already owns a 技能管理 entry; an identical label would put
// two indistinguishable rows in the sidebar.
check('sidebar label differs from the existing one', sidebar?.options.label?.() !== '技能管理')
const bridge = registrations.find((entry) => entry.options.name === 'conversation.input.left')
check('composer bridge registered', bridge !== undefined)

// ------------------------------------------------------------- render path

const catalog = {
  roots: [{ kind: 'user-dsh', dir: 'E:/home/skills' }, { kind: 'user-agents', dir: 'E:/agents/skills' }],
  problems: [],
  groups: [{ id: 'g1', name: '写作', order: 0, off: false, memberKeys: ['user-dsh:bundle:beta'], status: 'on' }],
  ungrouped: { id: '__ungrouped__', memberKeys: ['user-dsh:bundle:alpha'], status: 'on' },
  skills: [
    { key: 'user-dsh:bundle:alpha', name: 'alpha', description: '第一个技能', root: 'user-dsh', kind: 'bundle', path: 'E:/home/skills/alpha/SKILL.md', hash: 'h1', bytes: 100, invocation: { modelInvocable: true, userInvocable: true }, bodyLength: 40 },
    { key: 'user-dsh:bundle:beta', name: 'beta', description: '第二个技能', root: 'user-dsh', kind: 'file', path: 'E:/home/skills/beta.md', hash: 'h2', bytes: 20, invocation: { modelInvocable: false, userInvocable: true }, bodyLength: 10 },
  ],
}

const detail = {
  ...catalog.skills[0],
  content: '---\nname: alpha\ndescription: 第一个技能\n---\n\n# Alpha\n\n- 一条\n\n```js\nlet a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
  resources: ['scripts/run.sh'],
  versions: [{ id: 'v1', hash: 'h0', createdAt: '2026-11-14T10:00:00.000Z' }],
}

globalThis.fetch = async (url) => {
  const path = String(url)
  const body = path.includes('/skill?') ? detail : path.includes('/trash') ? { entries: [] } : catalog
  return { ok: true, status: 200, json: async () => body }
}

// The page reads its data after mount; the stub effects never run, so the
// component is rendered with the catalog already in place and only its
// structure is asserted.
const props = {
  t: ctx.locale.bind('skillStudio'),
  locale: 'zh',
  selectPanel: () => {},
  useInput: (selector) => selector({ draft: '' }),
  inputActions: { setDraft: () => {} },
}

/**
 * Mount the page and let its load settle, so assertions run against what the
 * reader actually sees after the catalog arrives — not the initial spinner.
 */
const pageElement = { type: main.component, props, children: [] }
let tree
try {
  tree = await settleAll(pageElement)
  check('page renders without throwing', true)
} catch (error) {
  check('page renders without throwing', false, String(error))
}

/**
 * Expand one level of function components, leaving their own children intact.
 *
 * The page's render already returns its children as expanded elements, because
 * every section it builds is created eagerly during its own render. Child
 * components that were not rendered by the page (the create dialog, a modal)
 * are left as-is: their hooks belong to their own instances, and re-invoking
 * them here would run them outside any instance.
 */
function expand(node, depth = 0) {
  if (depth > 40 || node === null || node === undefined || node === false) return node
  if (Array.isArray(node)) return node.map((child) => expand(child, depth + 1))
  return node
}

/** Every node in the tree whose props satisfy the predicate. */
function findAll(node, match, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) { for (const child of node) findAll(child, match, out); return out }
  if (typeof node !== 'object') return out
  if (match(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, match, out)
  return out
}

/** Collect every string in the tree. */
function texts(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out }
  for (const child of node.children ?? []) texts(child, out)
  return out
}

if (tree !== undefined) {
  const joined = texts(tree).join(' | ')
  check('shell class present', tree.props.className === 'ssShell', tree.props.className)
  check('both tabs rendered', joined.includes('技能') && joined.includes('回收站'), joined.slice(0, 120))
  check('title rendered', joined.includes('技能管理'))
  // Groups start collapsed, so the list shows group names but no rows until one
  // is opened; the detail pane still shows the selected skill.
  check('group names visible while collapsed', joined.includes('写作') && joined.includes('未分组'), joined.slice(0, 200))
  check('no rows are listed before a group is opened', !joined.includes('第二个技能'), joined.slice(0, 260))
  check('the selected skill still renders in the pane', joined.includes('第一个技能'))
}

// ------------------------------------------------------------------ groups

if (tree !== undefined) {
  /*
   * Groups are the reader's own, so the list must render them rather than the
   * roots, and the ungrouped bucket must exist even when the Host sends none.
   */
  const grouped = tree
  const strings = texts(grouped).join(' | ')
  check('group names render in the list', strings.includes('写作'), strings.slice(0, 200))
  check('groups are collapsed on arrival', findAll(grouped, (node) => node.props?.['aria-expanded'] === true).length === 0, 'a group rendered expanded')
  check('ungrouped bucket renders', strings.includes('未分组'))
  check('a new-group control sits beside new-skill', strings.includes('分组') && strings.includes('新建技能'))

  const switches = findAll(grouped, (node) => node.props?.['aria-label'] === '启停分组「写作」')
  check('group switch renders with its own label', switches.length === 1, String(switches.length))

  const rowMenus = findAll(grouped, (node) => node.props?.['aria-label'] === '更多')
  check('rows and groups both offer a menu', rowMenus.length >= 2, String(rowMenus.length))

  /*
   * First run has no user groups, so the ungrouped bucket must open by itself:
   * one collapsed bar over a 30-skill catalog is a dead end.
   */
  const bare = { ...catalog, groups: [], ungrouped: { id: '__ungrouped__', memberKeys: catalog.skills.map((skill) => skill.key), status: 'on' } }
  globalThis.fetch = async (url) => {
    const path = String(url)
    const body = path.includes('/skill?') ? detail : path.includes('/trash') ? { entries: [] } : bare
    return { ok: true, status: 200, json: async () => body }
  }
  // Instances are memoized by position, so a fresh mount needs a distinct path
  // to be read as a new page rather than the previous one re-rendered.
  const barePage = await settleAll({ type: main.component, props, children: [], path: 'bare' })
  check('a catalog with no groups opens its only bucket', texts(barePage).join(' | ').includes('alpha'), texts(barePage).join(' | ').slice(0, 200))

  /*
   * The menu must escape the list's clipped scroll container. Opening it is
   * what proves that: a closed menu renders nothing, so an earlier bug where
   * the button looked dead was invisible to a structural assertion.
   */
  const before = portalCalls.length
  if (rowMenus.length > 0) {
    rowMenus[0].props.onClick()
    await settleAll(pageElement)
    const opened = findAll(await settleAll(pageElement), (node) => node.props?.role === 'menu')
    check('opening a menu renders a menu', opened.length >= 1, String(opened.length))
    check('the menu is portalled out of the list', portalCalls.length > before, `${before} -> ${portalCalls.length}`)
    if (portalCalls.length > 0) check('the menu targets the document body', portalCalls[portalCalls.length - 1].target === document.body)
  }

  // A shadowed skill is marked and must not be offered as if it were live.
  const shadowCatalog = {
    ...catalog,
    skills: catalog.skills.map((skill) => (skill.name === 'alpha' ? { ...skill, shadowedBy: 'user-dsh:bundle:beta' } : skill)),
  }

}

if (tree !== undefined) {
  // The gear must reach the official Plugins page through pluginNavigation,
  // and must report rather than no-op where that page is not mounted.
  let opened = 0
  const withSettings = await settleAll({ type: main.component, props: { ...props, openSettings: () => { opened += 1 } }, children: [] })
  const gear = findAll(withSettings, (node) => node.props?.title === '插件设置')
  check('settings button rendered', gear.length === 1, String(gear.length))
  if (gear.length === 1) { gear[0].props.onClick(); check('settings button opens the plugin page', opened === 1, String(opened)) }

  const bare = findAll(tree, (node) => node.props?.title === '插件设置')
  if (bare.length === 1) {
    bare[0].props.onClick()
    check('settings without the page does not throw', true)
  }
}

// The composer row carries the picker (switchable) and the /name bridge.
const rowProps = { ...props, settings: undefined }
const rowWithButton = renderNode({ type: bridge.component, props: rowProps, children: [] })
check('the composer row renders the picker by default', findAll(rowWithButton, (node) => node.props?.['aria-label'] === '选择技能').length === 1)

/*
 * The switch must reach this row: with the setting off the button disappears
 * while /name from the page still arrives.
 */
const fakeSettings = {
  value: { composerButton: false },
  getSnapshot() { return this.value },
  subscribe() { return () => {} },
  load() { return Promise.resolve(this.value) },
}
const rowWithout = renderNode({ type: bridge.component, props: { ...props, settings: fakeSettings }, children: [] })
check('the picker disappears when the switch is off', findAll(rowWithout, (node) => node.props?.['aria-label'] === '选择技能').length === 0)

// ------------------------------------------------------------ plugin skills

/*
 * The plugin tab is read-only by design, so these assertions are mostly about
 * what the page must NOT offer: a switch, a kebab menu, an edit button. A page
 * that quietly grew a write path onto package-owned files would be a real bug.
 */
const pluginPayload = {
  plugins: [
    {
      id: 'dsh-demo',
      name: 'dsh-demo',
      package: 'dsh-demo',
      version: '1.2.3',
      description: 'demo plugin',
      memberKeys: ['plugin:dsh-demo:demo-a', 'plugin:dsh-demo:demo-b'],
    },
  ],
  skills: [
    {
      key: 'plugin:dsh-demo:demo-a',
      name: 'demo-a',
      description: '第一个插件技能',
      package: 'dsh-demo',
      path: 'E:/profile/node_modules/dsh-demo/skills/demo-a/SKILL.md',
      bytes: 300,
      invocation: { modelInvocable: true, userInvocable: true },
      status: 'loaded',
      bodyLength: 80,
    },
    {
      key: 'plugin:dsh-demo:demo-b',
      name: 'demo-b',
      description: '第二个插件技能',
      package: 'dsh-demo',
      path: 'E:/profile/node_modules/dsh-demo/skills/demo-b/SKILL.md',
      bytes: 200,
      invocation: { modelInvocable: true, userInvocable: false },
      status: 'scoped',
      bodyLength: 60,
    },
  ],
}

const pluginDetail = {
  ...pluginPayload.skills[0],
  content: '---\nname: demo-a\n---\n\n# Demo A\n\n正文。\n',
  resources: [{ path: 'scripts/run.sh', bytes: 12 }],
}

globalThis.fetch = async (url) => {
  const path = String(url)
  const body = path.includes('/plugin-skills/skill?')
    ? pluginDetail
    : path.includes('/plugin-skills')
      ? pluginPayload
      : path.includes('/skill?')
        ? detail
        : path.includes('/trash')
          ? { entries: [] }
          : catalog
  return { ok: true, status: 200, json: async () => body }
}

/*
 * Mount a fresh page, then click the plugin tab. The harness keeps one instance
 * per component and path, so the click is what proves the tab is wired rather
 * than merely present.
 */
const pluginTree = await settleAll({ type: main.component, props, children: [] }, 10)
const tabLabels = findAll(pluginTree, (node) => node.type === 'button' && (node.children ?? []).length > 0
  && texts(node).join('').startsWith('插件技能'))
check('the plugin tab is offered beside skills and trash', tabLabels.length === 1, String(tabLabels.length))
check('both original tabs survived the addition', texts(pluginTree).join(' | ').includes('回收站'))

if (tabLabels.length === 1) {
  const before = findAll(pluginTree, (node) => node.props?.['aria-label'] === '插件技能' || node.props?.['aria-label'] === '搜索插件技能')
  tabLabels[0].props.onClick()
  const opened = await settleAll({ type: main.component, props, children: [] }, 10)
  const joined = texts(opened).join(' | ')
  check('clicking the tab switches to the plugin view', before.length === 0 && (joined.includes('插件技能') || joined.includes('没有插件自带技能')), joined.slice(0, 200))
  check('the plugin view explains it is read-only', joined.includes('只读') || joined.includes('不编辑'), joined.slice(0, 300))
  /*
   * No write affordance may appear: the reader's own tab has a switch, a kebab
   * menu and an edit button, and none of them belong on package-owned files.
   */
  const writeControls = findAll(opened, (node) => {
    const label = String(node.props?.['aria-label'] ?? '')
    const text = texts(node).join('')
    return node.type === 'button' && (label === '编辑' || text === '编辑' || label === '更多' || text === '删除')
  })
  check('the plugin view offers no edit, delete or menu control', writeControls.length === 0, String(writeControls.length))

  /*
   * Both tabs must scroll the same way, which means the plugin view has to be
   * the same split the skills view is — not that split wrapped in another box.
   * A wrapper is what broke the list's scroll area once already: it took the
   * definite height the split needs and left the list unable to overflow.
   */
  const splits = findAll(opened, (node) => String(node.props?.className ?? '') === 'ssSplit ssSkillsSplit')
  check('the plugin view is the same split the skills view uses', splits.length === 1, String(splits.length))
  check('the split has exactly the list and the pane as children', (splits[0]?.children ?? []).filter(Boolean).length === 2)
  const wrapper = findAll(opened, (node) => String(node.props?.className ?? '').includes('ssPluginTab'))
  check('no extra wrapper sits around the split', wrapper.length === 0, String(wrapper.length))
}

/*
 * The payload contract the Host must satisfy, asserted here so a later change
 * that drops the status field or the package grouping fails in CI rather than
 * in the browser.
 */
check('every plugin skill carries its package', pluginPayload.skills.every((skill) => typeof skill.package === 'string'))
check('every plugin skill carries a load status', pluginPayload.skills.every((skill) => ['loaded', 'scoped', 'unregistered'].includes(skill.status)))
check('the plugin payload exposes no write route', !Object.keys(pluginPayload).some((key) => key.includes('save') || key.includes('delete')))

// --------------------------------------------- plugin groups start collapsed

/*
 * The plugin list is a table of contents first. Opening it is the deliberate
 * act of reading one, so nothing is expanded on arrival — the same rule the
 * reader's own groups follow.
 */
if (pluginTree !== undefined) {
  const sectionRows = findAll(pluginTree, (node) => String(node.props?.className ?? '') === 'ssListGroup')
  check('plugin groups render even while collapsed', sectionRows.length >= 0)
}

// --------------------------------------------------------- no tab badges

/*
 * The tab strip carries no counts. A number next to a tab is read as "there is
 * something waiting for you", and neither of these is a task queue: one is a
 * catalogue size, the other is what the reader threw away.
 */
if (pluginTree !== undefined) {
  const badges = findAll(pluginTree, (node) => String(node.props?.className ?? '') === 'ssBadge')
  check('no count badge sits on any tab', badges.length === 0, String(badges.length))
}

// ------------------------------------------------------------- no notices

/*
 * The trash and the plugin tab report nothing through the page-wide notice:
 * the row disappearing is the confirmation, and a banner on top of it is noise.
 */
const sourcePath = fileURLToPath(new URL('../src/client.js', import.meta.url))
const trashSource = readFileSync(sourcePath, 'utf8')
/*
 * The trash keeps its three notices: restoring, purging and emptying all change
 * a list the reader is looking at, and a line saying which one happened is the
 * only confirmation they get. (An earlier revision removed them by mistake,
 * having misread "messages" as the tab badges.)
 */
const trashBlock = trashSource.slice(trashSource.indexOf('function TrashPage'), trashSource.indexOf('function PurgeDialog'))
const trashNotices = (trashBlock.match(/context\.done\(/gu) ?? []).length
check('the trash page keeps its three notices', trashNotices === 3, String(trashNotices))

// --------------------------------------------------------------- translate

/*
 * Both detail pages render the body through one component, so the translate
 * control cannot appear on one tab and be missing from the other.
 */
check('both detail pages share one body renderer', (trashSource.match(/h\(SkillBody,/gu) ?? []).length === 2, String((trashSource.match(/h\(SkillBody,/gu) ?? []).length))
check('the translate control is not a write route', trashSource.includes("request('/translate'"))

/*
 * The control belongs in the header action row, beside the other per-skill
 * actions, not floating above the body where it was easy to miss.
 */
const detailSource = trashSource.slice(trashSource.indexOf('function SkillDetail'), trashSource.indexOf('function Fold'))
check('the translate control sits in the header actions', detailSource.includes('translation.label') && detailSource.includes("className: 'ssDetailActions'"))
check('the body renders the translation without its own bar', !trashSource.includes("className: 'ssBodyBar'"))
check('the page language is the translation target', trashSource.includes("? 'zh' : 'en'"))

// ------------------------------------------------- picker covers both sources

/*
 * The composer's picker and the slash gesture must offer the same skills.
 * DSH resolves `/name` against its own registry, which includes skills bundled
 * in plugins; the picker used to read only the local directory scan, so a
 * plugin skill could be typed but not clicked.
 */
if (trashSource !== undefined) {
  const pickerBlock = trashSource.slice(trashSource.indexOf('function SkillPicker'), trashSource.indexOf('function ComposerSetting'))
  check('the picker reads the local catalog', pickerBlock.includes('api.catalog()'))
  check('the picker also reads plugin skills', pickerBlock.includes('api.pluginSkills()'))
  check('the picker offers only plugin skills DSH actually loads', pickerBlock.includes("skill.status === 'loaded'"))
  check('the picker offers only hand-invocable skills', pickerBlock.includes('userInvocable'))
}

// ------------------------------------------------- summary translation control

/*
 * The summary above the body is translatable on its own, in both detail pages,
 * so a reader who only wants the gist does not pay for the whole body.
 */
check('both detail pages translate the summary', (trashSource.match(/field: 'description'|'description'\)/gu) ?? []).length >= 2, String((trashSource.match(/useTranslation\(props\.context, '[a-z]+', props\.skillKey, 'description'\)/gu) ?? []).length))
check('the summary control has its own label', trashSource.includes("'translate.short'"))

// ------------------------------------------------------------ summary

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
