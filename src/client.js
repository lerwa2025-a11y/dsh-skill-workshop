/**
 * Browser half of 技能管理 (dsh-skill-workshop).
 *
 * One sidebar entry and the main-column panel it opens:
 *
 *   - 技能: every SKILL.md under the scanned roots, with use / edit / switch /
 *     invocation and the version history kept beside it.
 *   - 回收站: what was removed, restorable, purgable.
 *
 * The page talks to its own Host half over `/skill-workshop/*` and requires only
 * `react` — no other plugin's components, styles or services are involved, so
 * a change to mnemon cannot blank this page.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-workshop',
  factory(require) {
    const React = require('react')
    // createPortal is a platform module: menus must escape the list's clipped
    // scroll container, or they render where nothing can be seen.
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'skillStudio'
    const PANEL_ID = 'skill-workshop'
    const PACKAGE = 'dsh-skill-workshop'
    /** The page's id for "no group"; the Host uses the same string. */
    const UNGROUPED = '__ungrouped__'
    const API = '/skill-workshop'
    const USE_EVENT = 'dsh-skill-workshop:use'
    const PENDING_MS = 10000

    /* ------------------------------------------------------------------ copy */

    const zh = {
      'panel': '技能管理',
      'panel.label': '技能工坊',
      'panel.settings': '插件设置',
      'panel.settingsUnavailable': '插件管理页不可用，改从「插件」页进入。',
      'picker.open': '选择技能',
      'picker.title': '选择技能',
      'picker.search': '搜索技能',
      'picker.empty': '没有可手动调用的技能（都关了或只在模型侧）。',
      'picker.manage': '管理技能…',
      'setting.composer': '输入框旁的技能按钮',
      'setting.composerHint': '在输入框左侧显示一个按钮，点开直接选技能，代替手动输入斜杠命令。关掉后只能用 /技能名。',
      'setting.failed': '保存失败，请重试。',      'page.title': '技能管理',
      'page.description': '管理本机技能：开关可见性、改调用方式、编辑内容，删掉的进回收站。',
      'tab.skills': '技能',
      'tab.trash': '回收站',
      'common.loading': '读取中…',
      'common.save': '保存',
      'common.saving': '保存中…',
      'common.cancel': '取消',
      'common.close': '关闭',
      'common.edit': '编辑',
      'common.more': '更多',
      'common.refresh': '刷新',
      'common.delete': '删除',
      'common.restore': '恢复',
      'common.compare': '对比',
      'skills.search': '搜索技能',
      'skills.noMatch': '没有匹配的技能。',
      'skills.empty': '还没有技能',
      'skills.emptyBody': '在 DSH 的技能目录下放一个 SKILL.md，它就会出现在这里。',
      'skills.select': '选一个技能',
      'skills.selectBody': '从左边挑一个，右边显示它的内容与设置。',
      'skills.use': '使用',
      'skills.useHint': '把 /{name} 放进对话输入框',
      'skills.toggle': '开关 {name}',
      'group.ungrouped': '未分组',
      'group.new': '新建分组',
      'group.newShort': '＋分组',
      'group.reordered': '分组顺序已保存。',
      'group.dragHint': '拖动或按 ↑↓ 调整顺序',
      'group.moveHint': '移动分组「{name}」，方向键调整顺序',
      'group.expandAll': '全部展开',
      'group.collapseAll': '全部收起',
      'group.toggleAllHint': '一次展开或收起所有分组',
      'group.name': '分组名',
      'group.rename': '重命名',
      'group.renameTitle': '重命名分组',
      'group.createTitle': '新建分组',
      'group.delete': '删除分组',
      'group.deleteTitle': '删除分组「{name}」',
      'group.deleteBody': '组里的技能会回到「未分组」，技能本身不受影响。',
      'group.created': '已新建分组「{name}」。',
      'group.renamed': '已重命名为「{name}」。',
      'group.deleted': '已删除分组「{name}」。',
      'group.moved': '已移动「{name}」。',
      'group.toggle': '启停分组「{name}」',
      'group.mixedHint': '组内部分技能是关的，点一下会全部打开',
      'group.switchedOn': '已打开「{name}」的 {count} 个技能。',
      'group.switchedOff': '已关闭「{name}」的 {count} 个技能。',
      'group.confirmOffTitle': '关闭分组「{name}」',
      'group.confirmOffBody': '会逐个改写 {count} 个技能的 SKILL.md，让 DSH 不再加载它们。中途失败会如实报告。',
      'group.confirmOnTitle': '打开分组「{name}」',
      'group.confirmOnBody': '会逐个改写 {count} 个技能，恢复它们各自原来的调用方式。',
      'group.switchOn': '全部打开',
      'group.switchOff': '全部关闭',
      'group.skipped': '（{count} 个被同名技能覆盖，已跳过）',
      'group.failedTitle': '失败的技能',
      'group.confirmOffTitle': 'Turn off group "{name}"',
      'group.confirmOffBody': 'Rewrites the SKILL.md of {count} skills so DSH stops loading them. A partial run is reported honestly.',
      'group.confirmOnTitle': 'Turn on group "{name}"',
      'group.confirmOnBody': 'Rewrites {count} skills, restoring each one to its own invocation mode.',
      'group.switchOn': 'Turn all on',
      'group.switchOff': 'Turn all off',
      'group.skipped': '({count} skipped: shadowed by a same-named skill)',
      'group.failedTitle': 'Skills that failed',
      'group.partial': '「{name}」改了 {count} 个，{failed} 个失败（{reason}）。',
      'skills.shadowed': '被覆盖',
      'skills.shadowedBy': '这个技能被同名技能覆盖，DSH 实际加载的是 {key}。改它不会有任何效果。',
      'skills.files': '附带文件',
      'skills.removed': '已把 {name} 移进回收站。',
      'skills.removeTitle': '移进回收站',
      'skills.removeBody': '它会被移出技能目录，随时可以从回收站恢复。',
      'skills.problems': '{count} 个目录读取失败',
      'skills.new': '新建技能',
      'create.title': '新建技能',
      'create.name': '技能名',
      'create.nameHint': '小写字母、数字和短横线，例如 release-notes',
      'create.description': '一句话描述',
      'create.descriptionHint': '模型靠这句话判断什么时候该用它。',
      'create.root': '技能目录',
      'create.group': '归到分组',
      'create.groupHint': '想新建分组，用左栏的＋分组。',
      'skills.created': '已创建「{name}」。',
      'create.submit': '创建',
      'root.user-dsh': '用户技能',
      'root.user-agents': 'Agents 共享',
      'invocation.label': '调用方式',
      'invocation.both': '模型自动 + 斜杠命令',
      'invocation.slash': '仅斜杠命令',
      'invocation.model': '仅模型自动',
      'invocation.off': '都不启用',
      'invocation.bothHint': '模型需要时会自己加载；你也可以在输入框打 /{name} 主动调用。',
      'invocation.slashHint': '模型不会自己加载；只有你在输入框打 /{name} 时才用。',
      'invocation.modelHint': '模型需要时会自己加载；但斜杠命令列表里没有它，打 /{name} 也调不到。',
      'invocation.offHint': '模型不加载，斜杠命令也没有，这个技能等于暂时停用。',
      'invocation.bothShort': '自动 + 斜杠',
      'invocation.slashShort': '仅斜杠',
      'invocation.modelShort': '仅模型自动',
      'invocation.offShort': '已关闭',
      'editor.title': '编辑 {name}',
      'versions.title': '版本历史',
      'versions.empty': '还没有留存版本，第一次修改后会出现。',
      'versions.current': '当前',
      'versions.restore': '恢复这一版',
      'versions.compareTitle': '与 {time} 的版本对比',
      'trash.title': '回收站',
      'trash.body': '删掉的技能还在磁盘上，可以放回去，也可以在这里彻底删除。',
      'trash.emptyTitle': '回收站是空的',
      'trash.emptyBody': '删除技能后，它会出现在这里。',
      'trash.empty': '清空回收站',
      'trash.restoreHint': '回到它原来的位置',
      'trash.purge': '彻底删除',
      'trash.purgeTitle': '彻底删除 {name}',
      'trash.purgeBody': '这一步无法撤销。',
      'trash.confirmName': '输入技能名 {name} 以确认',
      'trash.clearTitle': '清空回收站（{count} 项）',
      'trash.clearBody': '里面的技能会被永久删除，无法恢复。',
      'trash.restored': '已恢复 {name}。',
      'trash.purged': '已彻底删除 {name}。',
      'trash.emptied': '已清空 {count} 项。',
      'trash.meta': '{time} · {size}',
      'trash.file': '单文件',
      'trash.bundle': '目录',
      'time.justNow': '刚刚',
      'time.minutes': '{count} 分钟前',
      'time.hours': '{count} 小时前',
      'time.days': '{count} 天前',
      'diff.empty': '这一版没有内容变化。',
      'editor.discard': '有未保存的修改，确定关闭吗？',
      'saved.skill': '已保存。',
      'saved.invocation': '调用方式已更新。',
      'saved.version': '已恢复到这一版。',
      'saved.toggle': '开关已更新。',
      'loadFailed': '读取失败',
      'retry': '重试',
    }

    const en = {
      'panel': 'Skills',
      'panel.label': 'Skill workshop',
      'panel.settings': 'Plugin settings',
      'panel.settingsUnavailable': 'The plugin page is unavailable; open it from Plugins.',
      'picker.open': 'Pick a skill',
      'picker.title': 'Pick a skill',
      'picker.search': 'Search skills',
      'picker.empty': 'No skill can be invoked by hand (all are off or model-only).',
      'picker.manage': 'Manage skills…',
      'setting.composer': 'Skill button beside the composer',
      'setting.composerHint': 'Shows a button left of the composer that picks a skill directly instead of typing the slash command. Off means only /name works.',
      'setting.failed': 'Could not save; try again.',      'page.title': 'Skill studio',
      'page.description': 'Manage local skills: switch visibility, choose how each is invoked, edit the file, and restore what you removed.',
      'tab.skills': 'Skills',
      'tab.trash': 'Trash',
      'common.loading': 'Loading…',
      'common.save': 'Save',
      'common.saving': 'Saving…',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.edit': 'Edit',
      'common.more': 'More',
      'common.refresh': 'Refresh',
      'common.delete': 'Delete',
      'common.restore': 'Restore',
      'common.compare': 'Compare',
      'skills.search': 'Search skills',
      'skills.noMatch': 'No skill matches.',
      'skills.empty': 'No skills yet',
      'skills.emptyBody': 'Put a SKILL.md under a DSH skill root and it appears here.',
      'skills.select': 'Choose a skill',
      'skills.selectBody': 'Pick one on the left to see its content and settings.',
      'skills.use': 'Use',
      'skills.useHint': 'Put /{name} in the composer',
      'skills.toggle': 'Switch {name}',
      'group.ungrouped': 'Ungrouped',
      'group.new': 'New group',
      'group.newShort': '+ Group',
      'group.reordered': 'Group order saved.',
      'group.dragHint': 'Drag, or press the arrow keys to reorder',
      'group.moveHint': 'Move group "{name}"; arrow keys reorder',
      'group.expandAll': 'Expand all',
      'group.collapseAll': 'Collapse all',
      'group.toggleAllHint': 'Open or close every group at once',
      'group.name': 'Group name',
      'group.rename': 'Rename',
      'group.renameTitle': 'Rename group',
      'group.createTitle': 'New group',
      'group.delete': 'Delete group',
      'group.deleteTitle': 'Delete group "{name}"',
      'group.deleteBody': 'Its skills return to Ungrouped; the skills themselves are untouched.',
      'group.created': 'Group "{name}" created.',
      'group.renamed': 'Renamed to "{name}".',
      'group.deleted': 'Group "{name}" deleted.',
      'group.moved': '"{name}" moved.',
      'group.toggle': 'Switch group "{name}"',
      'group.mixedHint': 'Some skills in this group are off; one click turns them all on',
      'group.switchedOn': 'Turned on {count} skills in "{name}".',
      'group.switchedOff': 'Turned off {count} skills in "{name}".',
      'group.confirmOffTitle': '关闭分组「{name}」',
      'group.confirmOffBody': '会逐个改写 {count} 个技能的 SKILL.md，让 DSH 不再加载它们。中途失败会如实报告。',
      'group.confirmOnTitle': '打开分组「{name}」',
      'group.confirmOnBody': '会逐个改写 {count} 个技能，恢复它们各自原来的调用方式。',
      'group.switchOn': '全部打开',
      'group.switchOff': '全部关闭',
      'group.skipped': '（{count} 个被同名技能覆盖，已跳过）',
      'group.failedTitle': '失败的技能',
      'group.confirmOffTitle': 'Turn off group "{name}"',
      'group.confirmOffBody': 'Rewrites the SKILL.md of {count} skills so DSH stops loading them. A partial run is reported honestly.',
      'group.confirmOnTitle': 'Turn on group "{name}"',
      'group.confirmOnBody': 'Rewrites {count} skills, restoring each one to its own invocation mode.',
      'group.switchOn': 'Turn all on',
      'group.switchOff': 'Turn all off',
      'group.skipped': '({count} skipped: shadowed by a same-named skill)',
      'group.failedTitle': 'Skills that failed',
      'group.partial': '"{name}": {count} changed, {failed} failed ({reason}).',
      'skills.shadowed': 'Shadowed',
      'skills.shadowedBy': 'A same-named skill shadows this one; DSH loads {key}. Editing this file changes nothing.',
      'skills.files': 'Files',
      'skills.removed': '{name} moved to the trash.',
      'skills.removeTitle': 'Move to the trash',
      'skills.removeBody': 'It leaves the skill folder and stays restorable from the trash.',
      'skills.problems': '{count} folders failed to read',
      'skills.new': 'New skill',
      'create.title': 'New skill',
      'create.name': 'Name',
      'create.nameHint': 'lowercase letters, digits and hyphens, e.g. release-notes',
      'create.description': 'One-line description',
      'create.descriptionHint': 'The model routes on this sentence.',
      'create.root': 'Skill folder',
      'create.group': 'Group',
      'create.groupHint': 'To make a new group, use + Group in the left column.',
      'skills.created': 'Created {name}.',
      'create.submit': 'Create',
      'root.user-dsh': 'User skills',
      'root.user-agents': 'Shared agents',
      'invocation.label': 'Invocation',
      'invocation.both': 'Model auto + slash command',
      'invocation.slash': 'Slash command only',
      'invocation.model': 'Model auto only',
      'invocation.off': 'Neither',
      'invocation.bothHint': 'The model loads it when needed; you can also type /{name} in the composer.',
      'invocation.slashHint': 'The model never loads it on its own; only typing /{name} in the composer uses it.',
      'invocation.modelHint': 'The model loads it when needed, but it is absent from the slash-command list, so /{name} will not work.',
      'invocation.offHint': 'The model does not load it and no slash command exists: the skill is paused.',
      'invocation.bothShort': 'Auto + slash',
      'invocation.slashShort': 'Slash only',
      'invocation.modelShort': 'Model only',
      'invocation.offShort': 'Off',
      'editor.title': 'Edit {name}',
      'versions.title': 'Versions',
      'versions.empty': 'No version is kept until the first edit.',
      'versions.current': 'Current',
      'versions.restore': 'Restore',
      'versions.compareTitle': 'Compared with {time}',
      'trash.title': 'Trash',
      'trash.body': 'Removed skills stay on disk: put one back, or delete it for good here.',
      'trash.emptyTitle': 'The trash is empty',
      'trash.emptyBody': 'Removed skills appear here.',
      'trash.empty': 'Empty the trash',
      'trash.restoreHint': 'Back to where it came from',
      'trash.purge': 'Delete for good',
      'trash.purgeTitle': 'Delete {name} for good',
      'trash.purgeBody': 'This cannot be undone.',
      'trash.confirmName': 'Type {name} to confirm',
      'trash.clearTitle': 'Empty the trash ({count})',
      'trash.clearBody': 'Its skills are deleted permanently.',
      'trash.restored': '{name} restored.',
      'trash.purged': '{name} deleted.',
      'trash.emptied': '{count} removed.',
      'trash.meta': '{time} · {size}',
      'trash.file': 'file',
      'trash.bundle': 'folder',
      'time.justNow': 'just now',
      'time.minutes': '{count} min ago',
      'time.hours': '{count} h ago',
      'time.days': '{count} d ago',
      'diff.empty': 'This version has no content change.',
      'editor.discard': 'Discard the unsaved changes?',
      'saved.skill': 'Saved.',
      'saved.invocation': 'Invocation updated.',
      'saved.version': 'Version restored.',
      'saved.toggle': 'Switch updated.',
      'loadFailed': 'Could not read',
      'retry': 'Retry',
    }

    function makeT(dictionary) {
      return (key, params) => {
        const text = dictionary[key] ?? key
        if (params === undefined) return text
        return text.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match))
      }
    }

    /* ------------------------------------------------------------------- api */

    async function request(path, options) {
      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: { accept: 'application/json', ...(options?.body === undefined ? {} : { 'content-type': 'application/json' }) },
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload
    }

    const api = {
      catalog: () => request('/catalog'),
      skill: (key) => request(`/skill?key=${encodeURIComponent(key)}`),
      trash: () => request('/trash'),
      version: (key, id) => request(`/version?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`),
      save: (input) => request('/skill/save', { method: 'POST', body: JSON.stringify(input) }),
      invocation: (input) => request('/skill/invocation', { method: 'POST', body: JSON.stringify(input) }),
      remove: (input) => request('/skill/delete', { method: 'POST', body: JSON.stringify(input) }),
      create: (input) => request('/skill/create', { method: 'POST', body: JSON.stringify(input) }),
      restoreVersion: (input) => request('/version/restore', { method: 'POST', body: JSON.stringify(input) }),
      restoreTrash: (input) => request('/trash/restore', { method: 'POST', body: JSON.stringify(input) }),
      purgeTrash: (input) => request('/trash/purge', { method: 'POST', body: JSON.stringify(input) }),
      emptyTrash: () => request('/trash/empty', { method: 'POST', body: '{}' }),
      createGroup: (input) => request('/groups/create', { method: 'POST', body: JSON.stringify(input) }),
      renameGroup: (input) => request('/groups/rename', { method: 'POST', body: JSON.stringify(input) }),
      deleteGroup: (input) => request('/groups/delete', { method: 'POST', body: JSON.stringify(input) }),
      assignGroup: (input) => request('/groups/assign', { method: 'POST', body: JSON.stringify(input) }),
      groupInvocation: (input) => request('/groups/invocation', { method: 'POST', body: JSON.stringify(input) }),
      reorderGroups: (ids) => request('/groups/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
      settings: () => request('/settings'),
      settingsSave: (input) => request('/settings', { method: 'POST', body: JSON.stringify(input) }),
    }

    /* ---------------------------------------------------------------- shared */

    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function stamp(iso) {
      if (iso === undefined) return ''
      const date = new Date(iso)
      return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    function size(bytes) {
      if (typeof bytes !== 'number') return ''
      if (bytes < 1024) return `${bytes} B`
      return bytes < 1048576 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`
    }

    function relative(t, iso) {
      if (iso === undefined) return '—'
      const time = Date.parse(iso)
      if (!Number.isFinite(time)) return '—'
      const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
      if (seconds < 60) return t('time.justNow')
      if (seconds < 3600) return t('time.minutes', { count: Math.floor(seconds / 60) })
      if (seconds < 86400) return t('time.hours', { count: Math.floor(seconds / 3600) })
      if (seconds < 604800) return t('time.days', { count: Math.floor(seconds / 86400) })
      return new Date(time).toLocaleDateString()
    }

    function invocationOf(invocation) {
      if (invocation.modelInvocable && invocation.userInvocable) return 'both'
      if (invocation.userInvocable) return 'slash'
      return invocation.modelInvocable ? 'model' : 'off'
    }

    function switchesOf(value) {
      return { modelInvocable: value === 'both' || value === 'model', userInvocable: value === 'both' || value === 'slash' }
    }

    /**
     * A root's display name, falling back to the configured folder name.
     *
     * `t` returns the key itself when a dictionary misses, and extra roots are
     * configured rather than built in, so the fallback is the id cleaned up.
     */
    function rootLabel(t, kind) {
      const key = `root.${kind}`
      const text = t(key)
      return text === key ? kind.replace(/^custom-/u, '自定义 ') : text
    }

    /* -------------------------------------------------------------- markdown */

    /** Inline spans: `code`, **strong**, *emphasis*, [text](url). */
    function inline(text, keyPrefix) {
      const nodes = []
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/gu
      let cursor = 0
      let index = 0
      for (const match of text.matchAll(pattern)) {
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
        const token = match[0]
        const key = `${keyPrefix}-i${index++}`
        if (token.startsWith('`')) nodes.push(h('code', { key }, token.slice(1, -1)))
        else if (token.startsWith('**')) nodes.push(h('strong', { key }, token.slice(2, -2)))
        else if (token.startsWith('*')) nodes.push(h('em', { key }, token.slice(1, -1)))
        else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token)
          nodes.push(h('a', { key, href: link?.[2], target: '_blank', rel: 'noreferrer' }, link?.[1] ?? token))
        }
        cursor = match.index + token.length
      }
      if (cursor < text.length) nodes.push(text.slice(cursor))
      return nodes
    }

    /**
     * A small Markdown reader: headings, fenced code, lists, quotes, tables,
     * rules and paragraphs. It is deliberately not a full CommonMark parser —
     * SKILL.md files are prose with headings, and a wrong nesting is better
     * than pulling a parser into the browser bundle.
     */
    function markdown(body) {
      const lines = body.replace(/\r\n/gu, '\n').split('\n')
      const blocks = []
      let index = 0
      let key = 0
      const nextKey = () => `b${key++}`
      while (index < lines.length) {
        const line = lines[index]
        if (line.trim() === '') { index += 1; continue }
        const fence = /^```(.*)$/u.exec(line)
        if (fence !== null) {
          const code = []
          index += 1
          while (index < lines.length && !/^```/u.test(lines[index])) { code.push(lines[index]); index += 1 }
          index += 1
          blocks.push(h('pre', { key: nextKey() }, h('code', null, code.join('\n'))))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
        if (heading !== null) {
          const level = Math.min(heading[1].length, 4)
          blocks.push(h(`h${level}`, { key: nextKey() }, inline(heading[2], nextKey())))
          index += 1
          continue
        }
        if (/^(\s*)([-*_])(\s*\2){2,}\s*$/u.test(line)) {
          blocks.push(h('hr', { key: nextKey() }))
          index += 1
          continue
        }
        if (line.startsWith('>')) {
          const quote = []
          while (index < lines.length && lines[index].startsWith('>')) { quote.push(lines[index].replace(/^>\s?/u, '')); index += 1 }
          blocks.push(h('blockquote', { key: nextKey() }, markdown(quote.join('\n'))))
          continue
        }
        if (/^\s*[-*+]\s+/u.test(line) || /^\s*\d+[.)]\s+/u.test(line)) {
          const ordered = /^\s*\d+[.)]\s+/u.test(line)
          const items = []
          let itemIndex = 0
          while (index < lines.length && (/^\s*[-*+]\s+/u.test(lines[index]) || /^\s*\d+[.)]\s+/u.test(lines[index]))) {
            const text = lines[index].replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, '')
            items.push(h('li', { key: `l${itemIndex++}` }, inline(text, nextKey())))
            index += 1
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: nextKey() }, items))
          continue
        }
        if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/u.test(lines[index + 1] ?? '')) {
          const cells = (row) => row.replace(/^\s*\|/u, '').replace(/\|\s*$/u, '').split('|').map((cell) => cell.trim())
          const head = cells(line)
          index += 2
          const rows = []
          while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
            rows.push(cells(lines[index]))
            index += 1
          }
          blocks.push(h('table', { key: nextKey() },
            h('thead', null, h('tr', null, head.map((cell, cellIndex) => h('th', { key: `h${cellIndex}` }, inline(cell, nextKey()))))),
            h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: `r${rowIndex}` }, row.map((cell, cellIndex) => h('td', { key: `c${cellIndex}` }, inline(cell, nextKey()))))))))
          continue
        }
        const paragraph = []
        while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,6}\s|```|>)/u.test(lines[index])) {
          paragraph.push(lines[index])
          index += 1
        }
        blocks.push(h('p', { key: nextKey() }, inline(paragraph.join('\n'), nextKey())))
      }
      return blocks
    }

    /* ------------------------------------------------------------------- ui */

    function Button(props) {
      return h('button', {
        type: 'button',
        className: 'ssButton',
        'data-variant': props.variant ?? 'outline',
        disabled: props.disabled === true,
        title: props.title,
        onClick: props.onClick,
      }, props.children)
    }

    function Switch(props) {
      return h('label', { className: 'ssSwitch', title: props.label },
        h('input', {
          type: 'checkbox',
          checked: props.checked,
          disabled: props.disabled === true,
          'aria-label': props.label,
          onChange: (event) => props.onChange(event.target.checked),
        }),
        h('span', null))
    }

    /**
     * A switch that can also say "partly on".
     *
     * `indeterminate` is a property, not an attribute, so it must be written to
     * the node after render. Without it a half-off group would draw as a plain
     * off switch and invite a click that turns everything on by surprise.
     */
    function IndeterminateSwitch(props) {
      const ref = useRef(null)
      useEffect(() => {
        if (ref.current !== null) ref.current.indeterminate = props.mixed === true
      }, [props.mixed, props.checked])
      return h('label', { className: 'ssSwitch', 'data-mixed': props.mixed === true ? '' : undefined, title: props.label },
        h('input', {
          ref,
          type: 'checkbox',
          checked: props.checked,
          disabled: props.disabled === true,
          'aria-label': props.label,
          onChange: (event) => props.onChange(event.target.checked),
        }),
        h('span', null))
    }

    function Tag(props) {
      return h('span', { className: 'ssTag', 'data-tone': props.tone ?? 'outline' }, props.children)
    }

    function Spinner(props) {
      return h('span', { className: 'ssBusy' }, h('span', { className: 'ssSpinner', 'aria-hidden': 'true' }), props.label)
    }

    function Empty(props) {
      return h('div', { className: 'ssEmpty' },
        h('span', { className: 'ssEmptyGlyph', 'aria-hidden': 'true' }, props.glyph),
        h('p', { className: 'ssEmptyTitle' }, props.title),
        props.children === undefined ? null : h('p', { className: 'ssEmptyBody' }, props.children),
        props.action === undefined ? null : h('div', { className: 'ssEmptyActions' }, props.action))
    }

    function Field(props) {
      const id = React.useId()
      return h('div', { className: 'ssField' },
        h('label', { htmlFor: id }, props.label),
        props.children({ id }),
        props.hint === undefined ? null : h('small', null, props.hint))
    }

    function Modal(props) {
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') props.onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [props.onClose])
      return h('div', {
        className: 'ssModalMask',
        role: 'presentation',
        onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() },
      }, h('div', {
        className: 'ssModal',
        'data-wide': props.wide === true ? '' : undefined,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': props.title,
      },
      h('header', { className: 'ssModalHead' },
        h('div', null,
          h('h3', null, props.title),
          props.description === undefined ? null : h('p', null, props.description)),
        h('button', { type: 'button', className: 'ssIconButton', 'aria-label': props.closeLabel ?? '×', onClick: props.onClose }, '×')),
      h('div', { className: 'ssModalBody' }, props.children),
      props.footer === undefined ? null : h('footer', { className: 'ssModalFoot' }, props.footer)))
    }

    /**
     * A menu that renders into `document.body`.
     *
     * The list and its group headings are scroll containers with clipped
     * overflow, so a menu rendered inside them is cut off — the control looks
     * clickable but nothing appears. Portalling to the body and positioning
     * against the trigger's viewport rect keeps the menu whole wherever the
     * list is scrolled to.
     */
    function MoreMenu(props) {
      const [open, setOpen] = useState(false)
      const [place, setPlace] = useState(null)
      const ref = useRef(null)

      /** Close and hand focus back to the trigger, for the keyboard path. */
      const closeAndRestore = useCallback(() => {
        setOpen(false)
        ref.current?.querySelector('button')?.focus()
      }, [])

      const measure = useCallback(() => {
        const trigger = ref.current?.firstChild
        if (trigger === undefined || trigger === null) return
        const box = trigger.getBoundingClientRect()
        const width = 168
        // Keep the menu on screen: flip above the trigger when it would fall
        // past the viewport's bottom, and clamp its right edge inward.
        const below = box.bottom + 4
        const flip = below + 8 + props.items.length * 30 > window.innerHeight
        setPlace({
          top: flip ? undefined : below,
          bottom: flip ? window.innerHeight - box.top + 4 : undefined,
          left: Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)),
          width,
        })
      }, [props.items.length])

      useEffect(() => {
        if (!open) return undefined
        measure()
        const close = (event) => {
          if (ref.current !== null && ref.current.contains(event.target)) return
          // closest exists only on Elements; a text node or the document has none.
          if (event.target instanceof Element && event.target.closest('.ssMenuPortal') !== null) return
          setOpen(false)
          setPlace(null)
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          // A keyboard reader who closes the menu lands back on its trigger,
          // not at the document start.
          closeAndRestore()
        }
        // A scrolling list moves the trigger, so the menu follows or closes;
        // following is cheaper than closing on every wheel tick.
        const onMove = () => measure()
        window.addEventListener('mousedown', close)
        window.addEventListener('keydown', onKey)
        window.addEventListener('resize', onMove)
        window.addEventListener('scroll', onMove, true)
        return () => {
          window.removeEventListener('mousedown', close)
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', onMove)
          window.removeEventListener('scroll', onMove, true)
        }
      }, [open, measure, closeAndRestore])


      if (props.items.length === 0) return null

      /**
       * Move the highlight with the arrow keys and keep it inside the menu.
       *
       * A menu opened from the keyboard must be operable from the keyboard:
       * the trigger focuses the first item, arrows wrap, Escape closes and
       * returns focus to the trigger so the reader is not dropped at the top
       * of the page.
       */
      const move = (step) => {
        const nodes = Array.from(document.querySelectorAll('.ssMenuPortal [role="menuitem"]:not(:disabled)'))
        if (nodes.length === 0) return
        const index = nodes.indexOf(document.activeElement)
        const next = index === -1 ? (step > 0 ? 0 : nodes.length - 1) : (index + step + nodes.length) % nodes.length
        nodes[next].focus()
      }

      useEffect(() => {
        if (!open) return undefined
        // Focus after the portal commits, so the node exists. A host without
        // animation frames still gets a working menu, just without the move.
        if (typeof requestAnimationFrame !== 'function') return undefined
        const frame = requestAnimationFrame(() => {
          const first = document.querySelector('.ssMenuPortal [role="menuitem"]:not(:disabled)')
          first?.focus?.()
        })
        return () => cancelAnimationFrame(frame)
      }, [open])

      const menu = open
        ? createPortal(h('div', {
          className: 'ssMenu ssMenuPortal',
          role: 'menu',
          style: place === null
            // Before the first measurement the menu is already in the tree but
            // hidden: a measurement that cannot run (no layout, a detached
            // trigger) must not make the menu unopenable.
            ? { position: 'fixed', visibility: 'hidden', top: '0px', left: '0px', width: '168px' }
            : {
              position: 'fixed',
              top: place.top === undefined ? undefined : `${place.top}px`,
              bottom: place.bottom === undefined ? undefined : `${place.bottom}px`,
              left: `${place.left}px`,
              width: `${place.width}px`,
            },
          onKeyDown: (event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
            else if (event.key === 'Tab') { event.preventDefault() }
          },
        }, props.items.map((item) => h('button', {
          key: item.id,
          type: 'button',
          role: 'menuitem',
          tabIndex: -1,
          'data-danger': item.danger === true ? '' : undefined,
          disabled: item.disabled === true,
          onClick: () => { setOpen(false); props.onSelect(item.id) },
        }, item.label))), document.body)
        : null

      return h('span', { className: 'ssMenuAnchor', ref },
        h('button', {
          type: 'button',
          className: 'ssIconButton',
          'aria-label': props.label,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => setOpen((value) => !value),
        }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'currentColor', 'aria-hidden': 'true' },
          h('circle', { cx: 3.2, cy: 8, r: 1.15 }),
          h('circle', { cx: 8, cy: 8, r: 1.15 }),
          h('circle', { cx: 12.8, cy: 8, r: 1.15 }))),
        menu)
    }

    function Confirm(props) {
      return h(Modal, {
        title: props.title,
        description: props.body,
        onClose: props.onClose,
        closeLabel: '×',
        footer: [
          h(Button, { key: 'cancel', variant: 'ghost', onClick: props.onClose, disabled: props.busy === true }, props.cancelLabel),
          h(Button, { key: 'ok', variant: props.danger === true ? 'danger' : 'primary', onClick: props.onConfirm, disabled: props.busy === true }, props.confirmLabel),
        ],
      })
    }

    /* --------------------------------------------------------------- the page */

    function SkillStudio(props) {
      const t = props.t
      const [tab, setTab] = useState('skills')
      const [catalog, setCatalog] = useState(null)
      const [trash, setTrash] = useState(null)
      const [selected, setSelected] = useState(undefined)
      const [query, setQuery] = useState('')
      /*
       * Which groups are open, not which are closed: the page opens fully
       * collapsed, and only what the reader opens is remembered for the visit.
       */
      const [expandedGroups, setExpandedGroups] = useState(() => new Set())
      // A catalog with no user groups shows one bucket; opening it is what
      // makes the page usable at first run instead of one silent bar.
      const [seededOnce, setSeededOnce] = useState(false)
      const [revision, setRevision] = useState(0)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [creating, setCreating] = useState(false)
      const [focusSkill, setFocusSkill] = useState(undefined)
      const [groupDialog, setGroupDialog] = useState(null)
      const [groupBusy, setGroupBusy] = useState({})
      const [groupConfirm, setGroupConfirm] = useState(null)
      const [drag, setDrag] = useState(null)

      const refresh = useCallback(() => setRevision((value) => value + 1), [])
      const [errorDetail, setErrorDetail] = useState(null)
      const fail = useCallback((reason, detail) => {
        setError(errorText(reason))
        setErrorDetail(Array.isArray(detail) ? detail : null)
        setNotice(null)
      }, [])
      const done = useCallback((text) => { setNotice(text); setError(null) }, [])

      /**
       * The gear opens this plugin's own page in the official Plugins panel.
       *
       * `pluginNavigation` is provided by ui-plugin-manager; without it (a
       * composition that does not mount that page) the button says so instead
       * of doing nothing.
       */
      const openSettings = useCallback(() => {
        try {
          props.openSettings?.()
        } catch {
          fail(t('panel.settingsUnavailable'))
        }
      }, [props, fail, t])

      useEffect(() => {
        let active = true
        api.catalog().then((value) => {
          if (!active) return
          setCatalog(value)
          setSelected((current) => (current !== undefined && value.skills.some((skill) => skill.key === current)
            ? current
            : value.skills[0]?.key))
        }).catch((reason) => { if (active) fail(reason) })
        return () => { active = false }
      }, [revision, fail])

      useEffect(() => {
        let active = true
        api.trash().then((value) => { if (active) setTrash(value.entries) }).catch((reason) => { if (active) fail(reason) })
        return () => { active = false }
      }, [revision, fail])

      useEffect(() => {
        if (catalog === null) return
        setExpandedGroups((current) => {
          const known = new Set(catalog.groups.map((group) => group.id))
          known.add(UNGROUPED)
          // Drop ids whose group is gone, so the counter and the "all open"
          // label stay honest after a delete.
          const next = new Set([...current].filter((id) => known.has(id)))
          // With no groups of the reader's own there is only the ungrouped
          // bucket, and a fully collapsed page would show nothing at all.
          if (!seededOnce && catalog.groups.length === 0) {
            setSeededOnce(true)
            next.add(UNGROUPED)
          }
          return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next
        })
      }, [catalog, seededOnce])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 5000)
        return () => clearTimeout(timer)
      }, [notice])

      useEffect(() => {
        if (focusSkill === undefined) return
        setSelected(focusSkill)
        setFocusSkill(undefined)
      }, [focusSkill])

      /**
       * "Use" hands `/name` to the conversation and goes there.
       *
       * This page replaces the Conversation, so it unmounts on the same click
       * and a notice raised here would never be seen. The outcome is announced
       * by the composer instead, once it has the draft; the page carries no
       * notice for this action by design.
       */
      const useSkill = useCallback((name) => {
        requestSkillUse(name)
        try { props.selectPanel?.(null) } catch { /* a composition without panels keeps the page */ }
      }, [props])

      /**
       * Turn a whole group on or off.
       *
       * This writes one file per member, so it can partly succeed. The answer
       * names what changed and what failed, and both are reported — a silent
       * "done" over a half-applied switch would be a lie.
       */
      const setGroupOn = useCallback(async (group, on) => {
        setGroupBusy((current) => ({ ...current, [group.id]: true }))
        try {
          const result = await api.groupInvocation({ id: group.id, on })
          const changed = result.changed ?? 0
          const failed = result.failed ?? []
          const skipped = result.skipped ?? []
          // A skipped skill is neither a change nor a failure: it is one DSH
          // will not load anyway, so saying so is more useful than counting it.
          const note = skipped.length === 0 ? '' : ` ${t('group.skipped', { count: skipped.length })}`
          if (failed.length === 0) {
            done(t(on ? 'group.switchedOn' : 'group.switchedOff', { name: group.name, count: changed }) + note)
          } else {
            fail(t('group.partial', {
              name: group.name,
              count: changed,
              failed: failed.length,
              reason: failed.slice(0, 3).map((item) => item.name).join('、') + (failed.length > 3 ? ' 等' : ''),
            }) + note, failed)
          }
          refresh()
        } catch (error) {
          fail(error)
        } finally {
          setGroupBusy((current) => {
            const next = { ...current }
            delete next[group.id]
            return next
          })
        }
      }, [api, refresh, done, fail, t])

      /**
       * Ask before a switch that would rewrite many files at once.
       *
       * The switch is a fan-out of real writes; below the threshold the result
       * toast is enough, above it the reader gets to see the count first.
       */
      /** Commit one order, shared by drag-and-drop and the keyboard path. */
      const commitOrder = useCallback(async (order) => {
        try {
          await api.reorderGroups(order)
          done(t('group.reordered'))
          refresh()
        } catch (error) {
          // The order shown optimistically is now wrong; reread it.
          refresh()
          fail(error)
        }
      }, [api, refresh, done, fail, t])

      /**
       * Group drag state: which group is being dragged and what it is over.
       *
       * The order is committed on drop, not while dragging: a half-finished
       * gesture must never reach the file.
       */
      const onDragStart = useCallback((group) => setDrag({ id: group.id, overId: group.id }), [])
      const onDragOver = useCallback((group) => {
        setDrag((current) => (current === null || current.overId === group.id ? current : { ...current, overId: group.id }))
      }, [])
      const onDragEnd = useCallback(() => setDrag(null), [])
      const onDrop = useCallback(async (target) => {
        const current = drag
        setDrag(null)
        if (current === null || current.id === target.id) return
        const order = (catalog?.groups ?? []).map((group) => group.id)
        const from = order.indexOf(current.id)
        const to = order.indexOf(target.id)
        if (from === -1 || to === -1) return
        order.splice(to, 0, ...order.splice(from, 1))
        await commitOrder(order)
      }, [drag, catalog, commitOrder])


      /** Move a group one place with the keyboard, the pointer's operation. */
      const onNudge = useCallback((group, step) => {
        const order = (catalog?.groups ?? []).map((item) => item.id)
        const from = order.indexOf(group.id)
        const to = from + step
        if (from === -1 || to < 0 || to >= order.length) return
        order.splice(to, 0, ...order.splice(from, 1))
        void commitOrder(order)
      }, [catalog, commitOrder])

      const setGroupOnConfirmed = useCallback((group, on) => {
        if (group.skills.length > 10) setGroupConfirm({ group, on })
        else void setGroupOn(group, on)
      }, [setGroupOn])

      const moveSkill = useCallback(async (skill, groupId) => {
        try {
          await api.assignGroup({ key: skill.key, group: groupId })
          done(t('group.moved', { name: skill.name }))
          refresh()
        } catch (error) {
          fail(error)
        }
      }, [api, refresh, done, fail, t])

      const submitGroup = useCallback(async (name) => {
        const renaming = groupDialog?.mode === 'rename'
        // Renaming to the name it already has is a no-op, not a change worth
        // announcing.
        if (renaming && name === groupDialog.group.name) { setGroupDialog(null); return }
        if (renaming) await api.renameGroup({ id: groupDialog.group.id, name })
        else await api.createGroup({ name })
        setGroupDialog(null)
        done(t(renaming ? 'group.renamed' : 'group.created', { name }))
        refresh()
      }, [api, groupDialog, refresh, done, t])

      const deleteGroup = useCallback(async (group) => {
        try {
          await api.deleteGroup({ id: group.id })
          done(t('group.deleted', { name: group.name }))
          refresh()
        } catch (error) {
          fail(error)
        }
      }, [api, refresh, done, fail, t])

      const context = useMemo(() => ({
        t,
        api,
        revision,
        refresh,
        fail,
        done,
        useSkill,
        setGroupOn: setGroupOnConfirmed,
        openSkill: (key) => { setTab('skills'); setFocusSkill(key) },
      }), [t, revision, refresh, fail, done, useSkill, setGroupOn])

      const tabs = h('div', { className: 'ssTabs', role: 'tablist', 'aria-label': t('page.title') },
        ['skills', 'trash'].map((value) => h('button', {
          key: value,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === value,
          'data-active': tab === value ? '' : undefined,
          onClick: () => setTab(value),
        }, t(`tab.${value}`), value === 'trash' && (trash ?? []).length > 0 ? h('b', { className: 'ssBadge' }, (trash ?? []).length) : null)))

      const body = catalog === null
        ? error === null
          ? h(Spinner, { label: t('common.loading') })
          : h(Empty, {
            glyph: '!',
            title: t('loadFailed'),
            action: h(Button, { variant: 'outline', onClick: refresh }, t('retry')),
          }, error)
        : tab === 'skills'
          ? h(SkillsPage, {
            context,
            catalog,
            selected,
            setSelected,
            query,
            setQuery,
            expandedGroups,
            setExpandedGroups,
            drag,
            onDragStart,
            onDragOver,
            onDrop,
            onDragEnd,
            onNudge,
            groupBusy,
            onCreate: () => setCreating(true),
            onCreateGroup: () => setGroupDialog({ mode: 'create' }),
            groupAction: (group, id) => {
              if (id === 'rename') setGroupDialog({ mode: 'rename', group })
              else setGroupDialog({ mode: 'delete', group })
            },
            moveSkill,
          })
          : h(TrashPage, { context, entries: trash })

      return h('div', { className: 'ssShell' },
        h('header', { className: 'ssHead' },
          h('div', { className: 'ssMasthead' },
          h('div', { className: 'ssHeading' },
            h('h2', null, t('page.title')),
            h('p', null, t('page.description'))),
          h('div', { className: 'ssMastheadActions' },
            h('button', {
              type: 'button',
              className: 'ssIconButton',
              'aria-label': t('panel.settings'),
              title: t('panel.settings'),
              onClick: openSettings,
            }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' },
              h('path', {
                d: 'M8 6.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z',
                stroke: 'currentColor', strokeWidth: 1.2,
              }),
              h('path', {
                d: 'M13.1 9.4a1.1 1.1 0 0 0 .2 1.2l.1.1a1.35 1.35 0 1 1-1.9 1.9l-.1-.1a1.1 1.1 0 0 0-1.2-.2 1.1 1.1 0 0 0-.67 1v.15a1.35 1.35 0 1 1-2.7 0v-.08a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.2.2l-.1.1a1.35 1.35 0 1 1-1.9-1.9l.1-.1a1.1 1.1 0 0 0 .2-1.2 1.1 1.1 0 0 0-1-.67H2.4a1.35 1.35 0 1 1 0-2.7h.08a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.2-1.2l-.1-.1a1.35 1.35 0 1 1 1.9-1.9l.1.1a1.1 1.1 0 0 0 1.2.2h.05a1.1 1.1 0 0 0 .67-1V2.4a1.35 1.35 0 1 1 2.7 0v.08a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.2-.2l.1-.1a1.35 1.35 0 1 1 1.9 1.9l-.1.1a1.1 1.1 0 0 0-.2 1.2v.05a1.1 1.1 0 0 0 1 .67h.15a1.35 1.35 0 1 1 0 2.7h-.08a1.1 1.1 0 0 0-1 .67Z',
                stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round',
              }))),
            h(Button, { variant: 'ghost', onClick: refresh }, t('common.refresh')))),
          tabs),
        h('div', { className: 'ssBody' },
          error === null ? null : h('div', { className: 'ssAlert', role: 'alert' },
            h('span', null, error),
            errorDetail === null ? null : h('details', { className: 'ssAlertDetail' },
              h('summary', null, t('group.failedTitle')),
              h('ul', null, errorDetail.map((item) => h('li', { key: item.key },
                h('code', null, item.name),
                h('span', null, item.reason))))),
            h('button', {
              type: 'button',
              className: 'ssDismiss',
              'aria-label': t('common.close'),
              onClick: () => { setError(null); setErrorDetail(null) },
            }, '×')),
          notice === null ? null : h('div', { className: 'ssNotice', role: 'status' },
            h('span', null, notice),
            h('button', { type: 'button', className: 'ssDismiss', 'aria-label': t('common.close'), onClick: () => setNotice(null) }, '×')),
          h('div', { className: 'ssPage' }, body)),
groupConfirm === null ? null : h(Confirm, {
          title: t(groupConfirm.on ? 'group.confirmOnTitle' : 'group.confirmOffTitle', { name: groupConfirm.group.name }),
          body: t(groupConfirm.on ? 'group.confirmOnBody' : 'group.confirmOffBody', { count: groupConfirm.group.skills.length }),
          confirmLabel: t(groupConfirm.on ? 'group.switchOn' : 'group.switchOff'),
          cancelLabel: t('common.cancel'),
          onClose: () => setGroupConfirm(null),
          onConfirm: () => {
            const target = groupConfirm
            setGroupConfirm(null)
            void setGroupOn(target.group, target.on)
          },
        }),
        groupDialog === null ? null : groupDialog.mode === 'delete'
          ? h(Confirm, {
            danger: true,
            title: t('group.deleteTitle', { name: groupDialog.group.name }),
            body: t('group.deleteBody'),
            confirmLabel: t('group.delete'),
            cancelLabel: t('common.cancel'),
            onClose: () => setGroupDialog(null),
            onConfirm: () => {
              const target = groupDialog.group
              setGroupDialog(null)
              void deleteGroup(target)
            },
          })
          : h(GroupDialog, {
            context,
            title: t(groupDialog.mode === 'rename' ? 'group.renameTitle' : 'group.createTitle'),
            initial: groupDialog.mode === 'rename' ? groupDialog.group.name : '',
            onClose: () => setGroupDialog(null),
            onSubmit: submitGroup,
          }),
        creating ? h(CreateDialog, {
          context,
          roots: (catalog?.roots ?? []).map((root) => root.kind),
          groups: catalog?.groups ?? [],
          onClose: () => setCreating(false),
          onCreated: (created) => {
            setCreating(false)
            setTab('skills')
            setFocusSkill(created.key)
            // The dialog names the group, so no lookup is needed. Both that
            // group and 未分组 can be collapsed, and an active search would hide
            // the new skill outright, so clear the search and open its group.
            setQuery('')
            setExpandedGroups((currentSet) => new Set([...currentSet, created.group ?? UNGROUPED]))
            refresh()
            done(t('skills.created', { name: created.name ?? created.key }))
          },
        }) : null)
    }

    function SkillsPage(props) {
      const { context, catalog } = props
      const t = context.t
      const needle = props.query.trim().toLowerCase()
      const visible = (catalog.skills ?? []).filter((skill) => needle === ''
        || skill.name.toLowerCase().includes(needle)
        || String(skill.description).toLowerCase().includes(needle))
      const current = (catalog.skills ?? []).find((skill) => skill.key === props.selected)

      /*
       * Groups are the reader's own, not the roots: a skill belongs to the one
       * group it was filed under, and everything unfiled shows under 未分组.
       * An empty group still renders, so a group can be made before its skills
       * are moved into it.
       */
      const groups = [
        ...(catalog.groups ?? []).map((group) => ({ id: group.id, name: group.name, status: group.status, members: group.memberKeys })),
        { id: UNGROUPED, name: t('group.ungrouped'), status: catalog.ungrouped?.status ?? 'on', members: catalog.ungrouped?.memberKeys ?? [], virtual: true },
      ].map((group) => ({
        ...group,
        skills: group.members
          .map((key) => visible.find((skill) => skill.key === key))
          .filter((skill) => skill !== undefined),
      }))

      /*
       * How many groups the reader currently has open. A stale id from a
       * deleted group must not count, or the toggle would offer 全部收起 while
       * nothing is open.
       */
      const openCount = groups.filter((group) => props.expandedGroups.has(group.id)).length

      const list = h('aside', { className: 'ssList' },
        h('header', { className: 'ssListBar' },
          h('input', {
            type: 'search',
            value: props.query,
            placeholder: t('skills.search'),
            'aria-label': t('skills.search'),
            className: 'ssSearch',
            onChange: (event) => props.setQuery(event.target.value),
          }),
          h(Button, { variant: 'outline', onClick: props.onCreateGroup, title: t('group.new') }, t('group.newShort')),
          h(Button, { variant: 'outline', onClick: props.onCreate }, t('skills.new'))),
        (catalog.skills ?? []).length > 0 && visible.length === 0 ? h('p', { className: 'ssListNote' }, t('skills.noMatch')) : null,
        groups.length > 1 && needle === '' ? h('div', { className: 'ssListTools' },
          h('button', {
            type: 'button',
            className: 'ssLink',
            onClick: () => props.setExpandedGroups(openCount === 0
              // Everything closed opens every group; anything open closes them
              // all, so one control covers both directions.
              ? new Set(groups.map((group) => group.id))
              : new Set()),
            title: t('group.toggleAllHint'),
          }, openCount === 0 ? t('group.expandAll') : t('group.collapseAll'))) : null,
        groups.filter((group) => {
          // While filtering, a group with no match is noise: its header would
          // read "0" and push the matching group off screen.
          if (needle !== '') return group.skills.length > 0
          return group.skills.length > 0 || !group.virtual
        }).map((group) => {
          // A search always shows its matches; otherwise only what was opened.
          const expanded = needle !== '' || props.expandedGroups.has(group.id)
          return h('section', {
            key: group.id,
            className: 'ssListGroup',
            'data-dragging': props.drag?.id === group.id ? '' : undefined,
            'data-drop': props.drag?.overId === group.id && props.drag.id !== group.id ? '' : undefined,
            /*
             * Only the grip starts a drag. A draggable section would make the
             * switch, the kebab and the name drag sources too, so a few pixels
             * of drift while clicking would begin a drag and swallow the click.
             * Drag events bubble, so the section still receives enter/over/drop.
             */
            onDragEnter: (event) => {
              if (props.drag === null) return
              event.preventDefault()
              props.onDragOver(group)
            },
            onDragOver: (event) => {
              if (props.drag === null) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            },
            onDrop: (event) => {
              if (props.drag === null) return
              event.preventDefault()
              props.onDrop(group)
            },
            onDragEnd: () => props.onDragEnd(),
          },
            h('h5', null, h('div', { className: 'ssGroupHead' },
              // A grab handle is the affordance: a row you can drag without a
              // visible handle is a discovery problem, not a feature.
              /*
               * The grip is the only drag source, and it is also a button so a
               * keyboard reader can reorder: arrows move it, which is the same
               * operation the pointer performs.
               */
              group.virtual ? null : h('span', {
                className: 'ssDragGrip',
                role: 'button',
                tabIndex: 0,
                title: t('group.dragHint'),
                'aria-label': t('group.moveHint', { name: group.name }),
                draggable: true,
                onDragStart: (event) => {
                  event.stopPropagation()
                  event.dataTransfer.effectAllowed = 'move'
                  // A payload makes the drag legal in every browser; the state
                  // of record is the id held by this page.
                  event.dataTransfer.setData('text/plain', group.id)
                  props.onDragStart(group)
                },
                onKeyDown: (event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  props.onNudge(group, event.key === 'ArrowUp' ? -1 : 1)
                },
              }, h('svg', { viewBox: '0 0 10 14', width: 10, height: 14, fill: 'currentColor', 'aria-hidden': 'true' },
                [2, 7, 12].map((y) => h('g', { key: y },
                  h('circle', { cx: 3, cy: y, r: 1 }),
                  h('circle', { cx: 7, cy: y, r: 1 }))))),
              h('button', {
                type: 'button',
                className: 'ssGroupToggle',
                'aria-expanded': expanded,
                disabled: needle !== '',
                onClick: () => props.setExpandedGroups((currentSet) => {
                  const next = new Set(currentSet)
                  if (next.has(group.id)) next.delete(group.id)
                  else next.add(group.id)
                  return next
                }),
              },
              h('span', { 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
              // Renaming lives in the ⋯ menu only: the name is a label here, so
              // a stray double click can never open a dialog by surprise.
              h('span', { className: 'ssGroupName' }, group.name),
              h('span', { className: 'ssGroupCount' }, group.skills.length)),
              h(GroupSwitch, { context, group, cluster: props.groupBusy }),
              group.virtual ? null : h(MoreMenu, {
                label: t('common.more'),
                items: [
                  { id: 'rename', label: t('group.rename') },
                  { id: 'delete', label: t('group.delete'), danger: true },
                ],
                onSelect: (id) => props.groupAction(group, id),
              }))),
            expanded ? group.skills.map((skill) => h(SkillRow, {
              key: skill.key,
              context,
              skill,
              selected: props.selected === skill.key,
              onSelect: () => props.setSelected(skill.key),
              groups: catalog.groups ?? [],
              groupId: group.id,
              onMove: (groupId) => props.moveSkill(skill, groupId),
            })) : null)
        }),

        (catalog.problems ?? []).length > 0 ? h('details', { className: 'ssProblems' },
          h('summary', null, t('skills.problems', { count: catalog.problems.length })),
          h('ul', null, catalog.problems.map((problem) => h('li', { key: problem.path },
            h('code', { title: problem.path }, String(problem.path).split(/[\\/]/u).slice(-2).join('/')),
            h('span', null, problem.reason))))) : null)

      const pane = h('div', { className: 'ssPane' },
        (catalog.skills ?? []).length === 0
          ? h(Empty, { glyph: '✦', title: t('skills.empty'), action: h(Button, { variant: 'primary', onClick: props.onCreate }, t('skills.new')) },
            t('skills.emptyBody'))
          : current === undefined
            ? h(Empty, { glyph: '✦', title: t('skills.select') }, t('skills.selectBody'))
            : h(SkillDetail, {
              key: current.key,
              context,
              skillKey: current.key,
              onDeleted: () => props.setSelected(undefined),
            }))

      return h('div', { className: 'ssSplit ssSkillsSplit' }, list, pane)
    }

    /**
     * One group's switch.
     *
     * A group is on only when every member is on; a partly-off group reads as
     * "部分" and its next click turns everything on, because a mixed group
     * treated as on would switch off skills that were already off.
     */
    function GroupSwitch(props) {
      const t = props.context.t
      const { group } = props
      const busy = props.cluster?.[group.id] === true
      // A group with nothing in it has nothing to switch; a disabled lit
      // control would read as "on" while promising an action.
      if (group.skills.length === 0) return null
      const status = group.status ?? 'on'
      return h('span', {
        className: 'ssGroupSwitch',
        'data-status': status,
        title: status === 'mixed' ? t('group.mixedHint') : t('group.toggle', { name: group.name }),
      },
      busy ? h('span', { className: 'ssSpinner', 'aria-hidden': 'true' }) : null,
      h(IndeterminateSwitch, {
        checked: status === 'on',
        mixed: status === 'mixed',
        label: t('group.toggle', { name: group.name }),
        disabled: busy,
        onChange: (next) => props.context.setGroupOn(group, next),
      }))
    }

    /** Ask for a group name. Used for both create and rename. */
    function GroupDialog(props) {
      const t = props.context.t
      const [name, setName] = useState(props.initial ?? '')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const valid = name.trim() !== ''
      const submit = async () => {
        setBusy(true)
        setError(null)
        try {
          await props.onSubmit(name.trim())
        } catch (reason) {
          setError(errorText(reason))
          setBusy(false)
        }
      }
      return h(Modal, {
        title: props.title,
        onClose: props.onClose,
        footer: [
          error === null ? null : h('span', { key: 'e', className: 'ssFormError' }, error),
          h(Button, { key: 'c', variant: 'ghost', onClick: props.onClose }, t('common.cancel')),
          h(Button, { key: 'o', variant: 'primary', disabled: !valid || busy, onClick: () => void submit() }, t('common.save')),
        ],
      }, h('div', { className: 'ssForm' },
        h(Field, { label: t('group.name') }, (control) => h('input', {
          ...control,
          value: name,
          maxLength: 60,
          autoFocus: true,
          onChange: (event) => setName(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter' && valid && !busy) void submit() },
        }))))
    }

    /** The invocation a skill had before it was switched off, so switching back on returns it. */
    const lastMode = new Map()

    /** One skill: icon, name and one line; Use on hover, and its switch. */
    function SkillRow(props) {
      const t = props.context.t
      const { skill } = props
      const [busy, setBusy] = useState(false)
      const invocation = invocationOf(skill.invocation)
      const on = invocation !== 'off'
      if (on) lastMode.set(skill.key, invocation)
      const toggle = async (next) => {
        setBusy(true)
        try {
          // Switching back on restores the mode this skill had: a skill kept at
          // "/ only" or "model only" must not silently become "both".
          const restore = next ? (lastMode.get(skill.key) ?? 'both') : 'off'
          await props.context.api.invocation({ key: skill.key, ...switchesOf(restore), expectedHash: skill.hash })
          props.context.refresh()
          props.context.done(t('saved.toggle'))
        } catch (error) {
          props.context.fail(error)
        } finally {
          setBusy(false)
        }
      }
      const usable = on && skill.invocation.userInvocable
      return h('div', { className: 'ssRow', draggable: false, 'data-selected': props.selected ? '' : undefined, 'data-off': on && skill.shadowedBy === undefined ? undefined : '' },
        h('button', { type: 'button', className: 'ssRowMain', onClick: props.onSelect },
          h('span', { className: 'ssIcon', 'aria-hidden': 'true' }, skill.name.slice(0, 1).toUpperCase()),
          h('span', { className: 'ssRowText' },
            h('strong', null,
              h('span', null, skill.name),
              skill.shadowedBy === undefined ? null : h(Tag, { tone: 'quiet', title: skill.shadowedBy }, t('skills.shadowed')),
              on && invocation !== 'both' ? h(Tag, { tone: 'outline' }, t(`invocation.${invocation}Short`)) : null),
            h('small', null, skill.description))),
        h('div', { className: 'ssRowActions' },
          usable ? h('button', {
            type: 'button',
            className: 'ssButton ssUse',
            'data-variant': 'outline',
            title: t('skills.useHint', { name: skill.name }),
            onClick: () => props.context.useSkill(skill.name),
          }, t('skills.use')) : null,
          h(Switch, {
            checked: on,
            label: t('skills.toggle', { name: skill.name }),
            disabled: busy,
            onChange: (next) => { void toggle(next) },
          }),
          props.onMove === undefined ? null : h(MoreMenu, {
            label: t('common.more'),
            items: [
              // A row offers the groups it is not already in, so the menu never
              // lists a move that would change nothing.
              ...(props.groups ?? []).filter((group) => group.id !== props.groupId).map((group) => ({ id: group.id, label: group.name })),
              ...(props.groupId === UNGROUPED ? [] : [{ id: UNGROUPED, label: t('group.ungrouped') }]),
            ],
            onSelect: (id) => props.onMove(id),
          })))
    }

    function SkillDetail(props) {
      const t = props.context.t
      const [skill, setSkill] = useState(null)
      const hintId = React.useId()
      // `api` and `fail` are stable; the revision only says when to re-read.
      const [editing, setEditing] = useState(null)
      const [busy, setBusy] = useState(false)
      const [deleting, setDeleting] = useState(false)
      const [comparing, setComparing] = useState(null)
      const [reload, setReload] = useState(0)

      const api = props.context.api
      const fail = props.context.fail
      const revision = props.context.revision
      useEffect(() => {
        let active = true
        api.skill(props.skillKey).then((value) => { if (active) setSkill(value) }).catch(fail)
        return () => { active = false }
      }, [api, fail, props.skillKey, revision, reload])

      if (skill === null) return h(Spinner, { label: t('common.loading') })

      /** Run one write, then say so: a silent save leaves the reader unsure it happened. */
      const write = async (operation, said) => {
        setBusy(true)
        try {
          await operation()
          setReload((value) => value + 1)
          props.context.refresh()
          props.context.done(said)
        } catch (error) {
          props.context.fail(error)
        } finally {
          setBusy(false)
        }
      }

      const invocation = invocationOf(skill.invocation)
      const shadowed = skill.shadowedBy !== undefined
      const usable = invocation !== 'off' && skill.invocation.userInvocable && !shadowed

      return h('article', { className: 'ssDetail' },
        shadowed ? h('p', { className: 'ssWarn' }, t('skills.shadowedBy', { key: skill.shadowedBy })) : null,
        h('header', { className: 'ssDetailHead' },
          h('div', null,
            h('h3', null, skill.name),
            h('p', null, skill.description),
            h('span', { className: 'ssMeta' },
              h('span', null, rootLabel(t, skill.root)),
              h('code', { title: skill.path }, skill.path),
              h('span', null, relative(t, skill.updatedAt)))),
          h('div', { className: 'ssDetailActions' },
            usable ? h(Button, { variant: 'outline', onClick: () => props.context.useSkill(skill.name) }, t('skills.use')) : null,
            h(Button, { variant: 'outline', disabled: busy || shadowed, onClick: () => setEditing(skill.content) }, t('common.edit')),
            h(MoreMenu, {
              label: t('common.more'),
              items: [{ id: 'remove', label: t('common.delete'), danger: true }],
              onSelect: () => setDeleting(true),
            }))),
        h('div', { className: 'ssInvocation' },
          h('span', { className: 'ssInvocationLabel' }, t('invocation.label')),
          h('select', {
            value: invocation,
            disabled: busy,
            'aria-label': t('invocation.label'),
            'aria-describedby': hintId,
            onChange: (event) => {
              const next = switchesOf(event.target.value)
              void write(() => props.context.api.invocation({ key: skill.key, ...next, expectedHash: skill.hash }), t('saved.invocation'))
            },
          }, ['both', 'slash', 'model', 'off'].map((value) => h('option', { key: value, value }, t(`invocation.${value}`)))),
          // The four options are one choice over two surfaces; the line spells
          // out what the chosen one means for this skill by name, so the
          // reader never has to infer it from two flag words.
          h('span', { id: hintId, className: 'ssInvocationHint' }, t(`invocation.${invocation}Hint`, { name: skill.name }))),
        skill.whenToUse === undefined ? null : h('p', { className: 'ssWhen' }, skill.whenToUse),
        h('div', { className: 'ssDoc' }, markdown(skill.content.replace(/^---[\s\S]*?\n---\n?/u, ''))),
        h('div', { className: 'ssFolds' },
          h(Fold, { title: t('versions.title'), meta: String(skill.versions.length) },
            skill.versions.length === 0
              ? h('p', { className: 'ssMuted' }, t('versions.empty'))
              : h('ul', { className: 'ssVersions' }, skill.versions.slice().reverse().map((version) => h('li', { key: version.id },
                h('time', { title: version.createdAt }, stamp(version.createdAt)),
                version.hash === skill.hash ? h(Tag, { tone: 'success' }, t('versions.current')) : null,
                h('span', null),
                version.hash === skill.hash ? null : h('button', {
                  type: 'button',
                  className: 'ssLink',
                  onClick: () => {
                    void props.context.api.version(skill.key, version.id)
                      .then((value) => setComparing({ version, content: value.content }))
                      .catch(props.context.fail)
                  },
                }, t('common.compare')),
                version.hash === skill.hash ? null : h('button', {
                  type: 'button',
                  className: 'ssLink',
                  disabled: busy,
                  onClick: () => void write(() => props.context.api.restoreVersion({ key: skill.key, versionId: version.id, expectedHash: skill.hash }), t('saved.version')),
                }, t('versions.restore')))))),
          (skill.resources ?? []).length === 0 ? null : h(Fold, { title: t('skills.files'), meta: String(skill.resources.length) },
            h('div', { className: 'ssResources' }, skill.resources.map((file) => h('code', { key: file }, file))))),
        editing === null ? null : h(Modal, {
          wide: true,
          title: t('editor.title', { name: skill.name }),
          onClose: () => { if (editing === skill.content || window.confirm(t('editor.discard'))) setEditing(null) },
          footer: [
            h(Button, { key: 'cancel', variant: 'ghost', disabled: busy, onClick: () => setEditing(null) }, t('common.cancel')),
            h(Button, {
              key: 'save',
              variant: 'primary',
              disabled: busy || editing === skill.content,
              onClick: () => void write(async () => {
                await props.context.api.save({ key: skill.key, content: editing, expectedHash: skill.hash })
                setEditing(null)
              }, t('saved.skill')),
            }, busy ? t('common.saving') : t('common.save')),
          ],
        }, h('textarea', {
          className: 'ssEditor',
          spellCheck: false,
          value: editing,
          'aria-label': 'SKILL.md',
          onChange: (event) => setEditing(event.target.value),
        })),
        comparing === null ? null : h(Modal, {
          wide: true,
          title: t('versions.compareTitle', { time: stamp(comparing.version.createdAt) }),
          onClose: () => setComparing(null),
          footer: h(Button, { variant: 'ghost', onClick: () => setComparing(null) }, t('common.close')),
        }, h(DiffBlock, { before: comparing.content, after: skill.content, emptyLabel: t('diff.empty') })),
        deleting ? h(Confirm, {
          danger: true,
          title: t('skills.removeTitle'),
          body: `${skill.name} · ${t('skills.removeBody')}`,
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          busy,
          onClose: () => setDeleting(false),
          onConfirm: () => void (async () => {
            setBusy(true)
            try {
              await props.context.api.remove({ key: skill.key, expectedHash: skill.hash })
              props.context.done(t('skills.removed', { name: skill.name }))
              setDeleting(false)
              props.onDeleted()
              props.context.refresh()
            } catch (error) {
              props.context.fail(error)
            } finally {
              setBusy(false)
            }
          })(),
        }) : null)
    }

    function Fold(props) {
      const [open, setOpen] = useState(false)
      const id = React.useId()
      return h('section', { className: 'ssFold', 'data-open': open ? '' : undefined },
        h('header', null,
          h('button', {
            type: 'button',
            'aria-expanded': open,
            'aria-controls': id,
            onClick: () => setOpen((value) => !value),
          },
          h('span', { className: 'ssChevron', 'aria-hidden': 'true' }, '▾'),
          h('span', null, props.title),
          props.meta === undefined ? null : h('small', null, props.meta))),
        open ? h('div', { id, className: 'ssFoldBody' }, props.children) : null)
    }

    /** A line diff, enough to see what changed between two versions. */
    function DiffBlock(props) {
      const rows = useMemo(() => diffLines(props.before, props.after), [props.before, props.after])
      if (rows.every((row) => row.kind === 'same')) return h('p', { className: 'ssMuted' }, props.emptyLabel)
      return h('div', { className: 'ssDiff' }, rows.slice(0, 800).map((row, index) => h('div', { key: index, 'data-kind': row.kind },
        h('b', null, String(row.line)),
        h('span', null, row.text === '' ? ' ' : row.text))))
    }

    /** Longest-common-subsequence line diff, capped so a huge file cannot hang the page. */
    function diffLines(before, after) {
      const left = before.split('\n')
      const right = after.split('\n')
      if (left.length * right.length > 250000) {
        return [
          ...left.filter((line) => !right.includes(line)).map((text, index) => ({ kind: 'remove', line: index + 1, text })),
          ...right.filter((line) => !left.includes(line)).map((text, index) => ({ kind: 'add', line: index + 1, text })),
        ]
      }
      const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
      for (let i = left.length - 1; i >= 0; i -= 1) {
        for (let j = right.length - 1; j >= 0; j -= 1) {
          table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
        }
      }
      const rows = []
      let i = 0
      let j = 0
      while (i < left.length && j < right.length) {
        if (left[i] === right[j]) { rows.push({ kind: 'same', line: j + 1, text: right[j] }); i += 1; j += 1 }
        else if (table[i + 1][j] >= table[i][j + 1]) { rows.push({ kind: 'remove', line: i + 1, text: left[i] }); i += 1 }
        else { rows.push({ kind: 'add', line: j + 1, text: right[j] }); j += 1 }
      }
      while (i < left.length) { rows.push({ kind: 'remove', line: i + 1, text: left[i] }); i += 1 }
      while (j < right.length) { rows.push({ kind: 'add', line: j + 1, text: right[j] }); j += 1 }
      return rows
    }

    function CreateDialog(props) {
      const t = props.context.t
      const [group, setGroup] = useState(props.defaultGroup ?? UNGROUPED)
      const [name, setName] = useState('')
      const [description, setDescription] = useState('')
      const [root, setRoot] = useState(props.roots.includes('user-dsh') ? 'user-dsh' : (props.roots[0] ?? 'user-dsh'))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) && name.length <= 64 && description.trim() !== ''
      const submit = async () => {
        setBusy(true)
        setError(null)
        try {
          props.onCreated(await props.context.api.create({ name, description: description.trim(), root, group }))
        } catch (reason) {
          setError(errorText(reason))
        } finally {
          setBusy(false)
        }
      }
      return h(Modal, {
        title: t('create.title'),
        onClose: props.onClose,
        footer: [
          error === null ? null : h('span', { key: 'error', className: 'ssFormError' }, error),
          h(Button, { key: 'cancel', variant: 'ghost', onClick: props.onClose }, t('common.cancel')),
          h(Button, { key: 'ok', variant: 'primary', disabled: !valid || busy, onClick: () => void submit() }, t('create.submit')),
        ],
      }, h('div', { className: 'ssForm' },
        h(Field, { label: t('create.name'), hint: t('create.nameHint') }, (control) => h('input', {
          ...control,
          value: name,
          placeholder: 'release-notes',
          onChange: (event) => setName(event.target.value.trim().toLowerCase()),
        })),
        h(Field, { label: t('create.description'), hint: t('create.descriptionHint') }, (control) => h('textarea', {
          ...control,
          rows: 3,
          value: description,
          onChange: (event) => setDescription(event.target.value),
        })),
        h(Field, { label: t('create.root') }, (control) => h('select', {
          ...control,
          value: root,
          onChange: (event) => setRoot(event.target.value),
        }, props.roots.map((kind) => h('option', { key: kind, value: kind }, rootLabel(t, kind))))),
        h(Field, { label: t('create.group'), hint: t('create.groupHint') }, (control) => h('select', {
          ...control,
          value: group,
          onChange: (event) => setGroup(event.target.value),
        }, [
          ...props.groups.map((item) => h('option', { key: item.id, value: item.id }, item.name)),
          h('option', { key: UNGROUPED, value: UNGROUPED }, t('group.ungrouped')),
        ]))))
    }

    function TrashPage(props) {
      const t = props.context.t
      const entries = props.entries
      const [busy, setBusy] = useState(false)
      const [purging, setPurging] = useState(null)
      const [emptying, setEmptying] = useState(false)

      if (entries === null) return h(Spinner, { label: t('common.loading') })

      const run = async (operation, after) => {
        setBusy(true)
        try {
          await operation()
          after()
          props.context.refresh()
        } catch (error) {
          props.context.fail(error)
        } finally {
          setBusy(false)
        }
      }

      return h('article', { className: 'ssDetail' },
        h('header', { className: 'ssDetailHead' },
          h('div', null,
            h('h3', null, t('trash.title')),
            h('p', null, t('trash.body'))),
          entries.length === 0 ? null : h('div', { className: 'ssDetailActions' },
            h(Button, { variant: 'outline', disabled: busy, onClick: () => setEmptying(true) }, t('trash.empty')))),
        entries.length === 0
          ? h(Empty, { glyph: '×', title: t('trash.emptyTitle') }, t('trash.emptyBody'))
          : h('ul', { className: 'ssVersions ssTrashList' }, entries.map((entry) => h('li', { key: entry.id },
            h('span', { className: 'ssIcon', 'aria-hidden': 'true' }, entry.name.slice(0, 1).toUpperCase()),
            h('span', { className: 'ssRowText' },
              h('strong', null, entry.name),
              h('small', null, t('trash.meta', { time: stamp(entry.trashedAt), size: size(entry.bytes) })),
              h('small', { title: entry.originalPath }, h('code', null, entry.originalPath)),
              h('span', { className: 'ssTrashTags' },
                h(Tag, { tone: 'quiet' }, rootLabel(t, entry.root)),
                h(Tag, { tone: 'quiet' }, t(entry.kind === 'file' ? 'trash.file' : 'trash.bundle')))),
            h('span', { className: 'ssTrashActions' },
              h(Button, {
                variant: 'outline',
                disabled: busy,
                title: t('trash.restoreHint'),
                onClick: () => void run(
                  () => props.context.api.restoreTrash({ id: entry.id }),
                  () => props.context.done(t('trash.restored', { name: entry.name })),
                ),
              }, t('common.restore')),
              h(Button, { variant: 'ghost', disabled: busy, onClick: () => setPurging(entry) }, t('trash.purge')))))),
        purging === null ? null : h(PurgeDialog, {
          t,
          entry: purging,
          busy,
          onClose: () => setPurging(null),
          onConfirm: () => void run(
            () => props.context.api.purgeTrash({ id: purging.id }),
            () => {
              props.context.done(t('trash.purged', { name: purging.name }))
              setPurging(null)
            },
          ),
        }),
        emptying ? h(Confirm, {
          danger: true,
          title: t('trash.clearTitle', { count: entries.length }),
          body: t('trash.clearBody'),
          confirmLabel: t('trash.empty'),
          cancelLabel: t('common.cancel'),
          busy,
          onClose: () => setEmptying(false),
          onConfirm: () => void run(
            () => props.context.api.emptyTrash(),
            () => {
              props.context.done(t('trash.emptied', { count: entries.length }))
              setEmptying(false)
            },
          ),
        }) : null)
    }

    function PurgeDialog(props) {
      const t = props.t
      const [name, setName] = useState('')
      return h(Modal, {
        title: t('trash.purgeTitle', { name: props.entry.name }),
        description: t('trash.purgeBody'),
        onClose: props.onClose,
        footer: [
          h(Button, { key: 'cancel', variant: 'ghost', disabled: props.busy, onClick: props.onClose }, t('common.cancel')),
          h(Button, {
            key: 'ok',
            variant: 'danger',
            disabled: props.busy || name !== props.entry.name,
            onClick: props.onConfirm,
          }, t('trash.purge')),
        ],
      }, h(Field, { label: t('trash.confirmName', { name: props.entry.name }) }, (control) => h('input', {
        ...control,
        value: name,
        onChange: (event) => setName(event.target.value),
      })))
    }

    /* --------------------------------------------------------------- settings */

    /**
     * The plugin's preferences, shared by the detail page and the composer.
     *
     * A tiny observable rather than a hook: the detail page writes it, and the
     * composer button — mounted in a different slot, possibly in another
     * session — must disappear the moment the switch flips, without a reload.
     */
    const settingsStore = (() => {
      let value = { composerButton: true }
      const listeners = new Set()
      let loaded = null
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        /** Read once from the Host; later callers share the same request. */
        load() {
          loaded ??= api.settings()
            .then((next) => {
              value = { composerButton: next.composerButton !== false }
              for (const listener of listeners) listener()
              return value
            })
            .catch(() => value)
          return loaded
        },
        async set(next) {
          const previous = value
          value = { composerButton: next.composerButton !== false }
          for (const listener of listeners) listener()
          try {
            await api.settingsSave(value)
          } catch (error) {
            value = previous
            for (const listener of listeners) listener()
            throw error
          }
        },
      }
    })()

    /* ------------------------------------------------------- the composer link */

    /** Where `/name` goes in a draft: first, once, ahead of what is already typed. */
    function draftWithSkill(draft, name) {
      const token = `/${name}`
      if (new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(\\s|$)`, 'u').test(draft)) return draft
      const rest = draft.trimStart()
      return rest === '' ? `${token} ` : `${token} ${rest}`
    }

    /**
     * A request no composer has taken yet.
     *
     * Our panel replaces the Conversation, so the composer that would take
     * `/name` is unmounted at the moment "Use" runs; the request waits here for
     * the composer that mounts when the page returns to the conversation.
     */
    let pending

    /**
     * Ask the open composer to take `/name`, queueing it when none is mounted.
     * @returns whether a composer took it at once.
     */
    function requestSkillUse(name) {
      const detail = { name, handled: false }
      window.dispatchEvent(new CustomEvent(USE_EVENT, { detail }))
      pending = detail.handled ? undefined : { detail, at: Date.now() }
      return detail.handled
    }

    /**
     * The composer's skill picker: a button beside the plus control that picks
     * a skill without typing `/name`.
     *
     * It writes the same `/name` token the slash gesture would, so nothing
     * downstream changes: DSH still adjudicates the literal text on send. The
     * button exists because the slash gesture is invisible unless you already
     * know it.
     */
    function SkillPicker(props) {
      const [open, setOpen] = useState(false)
      const [catalog, setCatalog] = useState(null)
      const [query, setQuery] = useState('')
      const [place, setPlace] = useState(null)
      const ref = useRef(null)
      const t = props.t

      // The catalog is read on first open, not on mount: a composer is mounted
      // for every session and most of them never open the picker.
      useEffect(() => {
        if (!open || catalog !== null) return undefined
        let active = true
        api.catalog()
          .then((value) => { if (active) setCatalog(value.skills.filter((skill) => skill.invocation.userInvocable && skill.shadowedBy === undefined)) })
          .catch(() => { if (active) setCatalog([]) })
        return () => { active = false }
      }, [open, catalog])

      const measure = useCallback(() => {
        const trigger = ref.current?.firstChild
        if (trigger === undefined || trigger === null) return
        const box = trigger.getBoundingClientRect()
        const width = 300
        const below = box.bottom + 6
        const space = window.innerHeight - below
        const flip = space < 260 && box.top > 280
        setPlace({
          top: flip ? undefined : below,
          bottom: flip ? window.innerHeight - box.top + 6 : undefined,
          left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
          width,
        })
      }, [])

      useEffect(() => {
        if (!open) return undefined
        measure()
        const close = (event) => {
          if (ref.current !== null && ref.current.contains(event.target)) return
          if (event.target instanceof Element && event.target.closest('.ssPicker') !== null) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          setOpen(false)
          ref.current?.querySelector('button')?.focus()
        }
        window.addEventListener('mousedown', close)
        window.addEventListener('keydown', onKey)
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        return () => {
          window.removeEventListener('mousedown', close)
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
        }
      }, [open, measure])

      const pick = (skill) => {
        requestSkillUse(skill.name)
        setOpen(false)
        setQuery('')
      }

      const visible = (catalog ?? []).filter((skill) => {
        const needle = query.trim().toLowerCase()
        return needle === '' || skill.name.toLowerCase().includes(needle)
          || String(skill.description).toLowerCase().includes(needle)
      })

      const panel = open
        ? createPortal(h('div', {
          className: 'ssPicker',
          role: 'dialog',
          'aria-label': t('picker.title'),
          style: place === null
            ? { position: 'fixed', visibility: 'hidden', top: '0px', left: '0px', width: '300px' }
            : {
              position: 'fixed',
              top: place.top === undefined ? undefined : `${place.top}px`,
              bottom: place.bottom === undefined ? undefined : `${place.bottom}px`,
              left: `${place.left}px`,
              width: `${place.width}px`,
            },
        },
        h('header', { className: 'ssPickerHead' },
          h('input', {
            type: 'search',
            className: 'ssSearch',
            value: query,
            autoFocus: true,
            placeholder: t('picker.search'),
            'aria-label': t('picker.search'),
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && visible.length > 0) pick(visible[0])
            },
          })),
        catalog === null
          ? h('p', { className: 'ssMuted ssPickerNote' }, t('common.loading'))
          : visible.length === 0
            ? h('p', { className: 'ssMuted ssPickerNote' },
              catalog.length === 0 ? t('picker.empty') : t('skills.noMatch'))
            : h('ul', { className: 'ssPickerList' }, visible.map((skill) => h('li', { key: skill.key },
              h('button', {
                type: 'button',
                className: 'ssPickerItem',
                onClick: () => pick(skill),
              },
              h('strong', null, skill.name),
              h('small', null, skill.description))))),
        h('footer', { className: 'ssPickerFoot' },
          h('button', {
            type: 'button',
            className: 'ssLink',
            onClick: () => {
              setOpen(false)
              try { props.openPanel?.() } catch { /* a composition without panels keeps the composer */ }
            },
          }, t('picker.manage')))), document.body)
        : null

      return h('span', { className: 'ssPickerAnchor', ref },
        h('button', {
          type: 'button',
          className: 'ssPickerButton',
          'aria-label': t('picker.open'),
          title: t('picker.open'),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => setOpen((value) => !value),
        }, h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true' },
          h('path', { d: 'M8 1.9l1.75 3.55 3.9.57-2.82 2.75.66 3.89L8 10.83l-3.49 1.83.66-3.89L2.35 6.02l3.9-.57L8 1.9Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }))),
        panel)
    }

    /**
     * Mounted in the composer row; renders nothing and answers "Use" for its
     * own session by putting `/name` into that session's draft.
     *
     * Without `useInput` there is no draft to append to, so the request is left
     * queued rather than overwriting whatever the reader already typed.
     */
    function SkillUseBridge(props) {
      const useInput = props.useInput
      const draft = useInput === undefined ? undefined : useInput((state) => state.draft)
      const latest = useRef(draft)
      latest.current = draft
      useEffect(() => {
        const take = (detail) => {
          if (detail === undefined || detail.handled || props.inputActions === undefined || useInput === undefined) return
          props.inputActions.setDraft(draftWithSkill(latest.current ?? '', detail.name))
          detail.handled = true
          if (pending?.detail === detail) pending = undefined
        }
        if (pending !== undefined && Date.now() - pending.at < PENDING_MS) take(pending.detail)
        const listener = (event) => take(event.detail)
        window.addEventListener(USE_EVENT, listener)
        return () => window.removeEventListener(USE_EVENT, listener)
      }, [props.inputActions])
      return null
    }

    /* --------------------------------------------------------------- the shell */

    const icon = (props) => h('span', { 'data-dsh-part': 'skill-workshop-icon', style: { display: 'inline-flex' } },
      h('svg', { viewBox: '0 0 16 16', width: props?.size ?? 16, height: props?.size ?? 16, fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 1.6 9.9 5.6l4.4.6-3.2 3.1.75 4.4L8 11.7l-3.85 2 .75-4.4L1.7 6.2l4.4-.6L8 1.6Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        h('circle', { cx: 8, cy: 8, r: 1.5, fill: 'currentColor' })))

    const CSS_ID = 'dsh-skill-workshop/styles'

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      let tag = document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`)
      if (tag === null) {
        tag = document.createElement('style')
        tag.dataset.pluginCss = CSS_ID
        document.head.appendChild(tag)
      }
      tag.textContent = CSS__
      return () => {
        if (tag !== null && tag.parentNode !== null) tag.parentNode.removeChild(tag)
      }
    }

    /** The one switch this plugin owns, rendered on its page in the Plugins panel. */
    function ComposerSetting(props) {
      const t = props.t
      const [, force] = useState(0)
      const [error, setError] = useState(null)
      const settings = props.settings

      useEffect(() => {
        if (settings === undefined) return undefined
        void settings.load()
        return settings.subscribe(() => force((value) => value + 1))
      }, [settings])

      const on = settings === undefined ? true : settings.getSnapshot().composerButton
      return h('section', { className: 'ssSetting' },
        h('div', { className: 'ssSettingText' },
          h('h4', null, t('setting.composer')),
          h('p', null, t('setting.composerHint'))),
        h(Switch, {
          checked: on,
          label: t('setting.composer'),
          disabled: settings === undefined,
          onChange: (next) => {
            setError(null)
            void settings.set({ composerButton: next }).catch(() => setError(t('setting.failed')))
          },
        }),
        error === null ? null : h('p', { className: 'ssSettingError', role: 'alert' }, error))
    }

    /**
     * The composer row's occupant: the picker button when it is switched on,
     * plus the bridge that always answers "Use" from the page.
     *
     * Both live here because they share one registration: a reader who turns
     * the button off still needs `/name` from the page to arrive in the draft.
     */
    function ComposerRow(props) {
      const t = props.t
      const [, force] = useState(0)
      const settings = props.settings

      useEffect(() => {
        if (settings === undefined) return undefined
        void settings.load()
        return settings.subscribe(() => force((value) => value + 1))
      }, [settings])

      const showButton = settings === undefined ? true : settings.getSnapshot().composerButton
      return h(React.Fragment, null,
        showButton ? h(SkillPicker, { t, openPanel: () => props.openPanel?.() }) : null,
        h(SkillUseBridge, { useInput: props.useInput, inputActions: props.inputActions, sessionId: props.sessionId }))
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-workshop: dictionaries')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => installStyles(), 'skill-workshop: styles')

        const selectPanel = (id) => {
          try { ctx.layout?.selectPanel(id) } catch { /* a composition without panels keeps the page */ }
        }

        /**
         * Open this bundle's own page in the official Plugins panel.
         *
         * `pluginNavigation` exists only while that page's registration is
         * alive, so it is looked up at click time rather than captured on
         * mount: a page opened before the Plugins panel first mounts would
         * otherwise keep a dead reference. A composition without it throws,
         * and the page turns that into a message.
         */
        const openSettings = () => {
          const navigation = ctx.get('pluginNavigation')
          if (navigation === undefined) throw new Error('plugin page unavailable')
          navigation.openBundle(PACKAGE)
        }

        ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
          const stopMain = ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ selectPanel, openSettings }),
          }, (props) => h(SkillStudio, { ...props, t: props.t ?? t }))

          let stopIcon
          try {
            stopIcon = ctx.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 32,
              label: () => t('panel.label'),
              locale: NS,
            }, icon)
          } catch (error) {
            stopMain()
            throw error
          }
          return () => {
            stopIcon?.()
            stopMain()
          }
        }))

        /*
         * One composer-row registration carries both halves: the picker button
         * (when the reader left it on) and the bridge that answers "Use" from
         * the page. Registering them together keeps the button and the queue
         * it feeds from ever being out of step.
         */
        /*
         * The switch lives on this plugin's own page in the Plugins panel: that
         * is where a reader looks for "settings for this plugin", and the
         * composer button must be switchable without hunting a menu.
         */
        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          name: 'plugins.detail.section',
          id: 'skill-workshop.composer',
          order: 10,
          locale: NS,
          inject: () => ({ settings: settingsStore, t }),
        }, (props) => {
          if (props.subject?.kind !== 'bundle' || props.subject.pkg?.name !== PACKAGE) return null
          return h(ComposerSetting, props)
        }))

        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'skill-workshop/use',
          order: 1000,
          locale: NS,
          inject: () => ({ settings: settingsStore, t, openPanel: () => selectPanel(PANEL_ID) }),
        }, ComposerRow))
      },
    }
  },
})
