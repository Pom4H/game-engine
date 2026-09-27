/** Development UI only. Reads existing views; writes use the source editor's command path. */
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => value != null && Object.hasOwn(value, key);

export function readPath(sources, path, cache = new Map()) {
  const [root, ...keys] = path.split('.');
  if ([root, ...keys].some(key => !key || forbidden.has(key))) throw new Error('Invalid read path');
  if (!own(sources, root)) throw new Error(`Unknown view: ${root}`);
  if (!cache.has(root)) cache.set(root, sources[root]());
  let value = cache.get(root);
  for (const key of keys) {
    if (value instanceof Map) {
      if (!value.has(key)) throw new Error(`Unknown field: ${path}`);
      value = value.get(key);
    } else {
      const descriptor = value == null ? null : Object.getOwnPropertyDescriptor(Object(value), key);
      if (!descriptor || !own(descriptor, 'value')) throw new Error(`Unknown or computed field: ${path}`);
      value = descriptor.value;
    }
  }
  if (typeof value === 'function') throw new Error('Use an explicit command, not a method path');
  return value;
}

/** Bound inspection work before serialization, including cyclic or large engine objects. */
export function formatValue(value) {
  const seen = new WeakSet();
  let remaining = 160;
  const visit = (item, depth) => {
    if (--remaining < 0) return '…';
    if (item == null || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : String(item);
    if (typeof item === 'string') return item.length > 300 ? item.slice(0, 300) + '…' : item;
    if (typeof item !== 'object') return String(item);
    if (seen.has(item)) return '[reference]';
    if (depth > 3) return '[object]';
    seen.add(item);
    const array = Array.isArray(item) || ArrayBuffer.isView(item) && !(item instanceof DataView);
    if (array) {
      const result = Array.from({length: Math.min(item.length, 16)}, (_, i) => visit(item[i], depth + 1));
      if (item.length > 16) result.push(`… ${item.length - 16} more`);
      return result;
    }
    const result = Object.create(null);
    if (item instanceof Map) {
      let count = 0;
      for (const [key, entry] of item) { if (count++ === 16) { result['…'] = 'more entries'; break; } result[String(key)] = visit(entry, depth + 1); }
    } else {
      let count = 0;
      for (const key in item) {
        if (!own(item, key)) continue;
        if (count++ === 16) { result['…'] = 'more fields'; break; }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        result[key] = own(descriptor, 'value') ? visit(descriptor.value, depth + 1) : '[getter]';
      }
    }
    return result;
  };
  return (JSON.stringify(visit(value, 0), null, 2) ?? 'undefined').slice(0, 6000);
}

export function consoleSession({sources, actions = {}, bindings = () => [], edit}) {
  const watches = new Set();
  const sample = () => { const cache = new Map(); return path => readPath(sources, path, cache); };
  return {
    watches, sample,
    async execute(line) {
      if (line.length > 2048) throw new Error('Command limit: 2048 characters');
      const [, command = 'help', tail = ''] = line.trim().match(/^(\S+)?\s*([\s\S]*)$/);
      if (command === 'help') return `Views: ${Object.keys(sources).join(', ')}\ninspect <path> · watch <path> · unwatch <path>\nbindings · set <unique key or binding id> <JSON>\n${Object.keys(actions).join(' · ')}\nRead views are not writable. set changes TypeScript; compilation applies it later.`;
      if (command === 'inspect') return formatValue(sample()(tail || 'scene'));
      if (command === 'watch') {
        sample()(tail);
        if (!watches.has(tail) && watches.size >= 16) throw new Error('Watch limit: 16');
        watches.add(tail); return `Watching ${tail}`;
      }
      if (command === 'unwatch') { watches.delete(tail); return `Unwatched ${tail}`; }
      if (command === 'bindings') return bindings().map(b => `${b.id} = ${JSON.stringify(b.value)}${b.editable ? '' : ' [read-only]'}`).join('\n');
      if (command === 'set') {
        const match = tail.match(/^(\S+)\s+([\s\S]+)$/);
        if (!match) throw new Error('set <unique key or binding id> <JSON>');
        const [, key, json] = match, all = bindings();
        const exact = all.find(b => b.id === key), matches = exact ? [exact] : all.filter(b => b.key === key);
        if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous key; use an exact id from bindings' : 'Unknown source binding');
        if (!matches[0].editable) throw new Error('Expression is read-only; edit its source');
        const value = JSON.parse(json);
        return await edit(matches[0].id, value);
      }
      if (!own(actions, command)) throw new Error(`Unknown command: ${command}`);
      return await actions[command](tail);
    },
  };
}

/** Existing panels are the drawer contents, never copied into another debug UI. */
export function mountConsole({panel, toggle, session, onOpen}) {
  const input = panel.querySelector('#console-input'), log = panel.querySelector('#console-log');
  const watchList = panel.querySelector('#console-watches'), history = [], rows = new Map();
  const events = new AbortController(), options = {signal: events.signal};
  let previousFocus = null, historyIndex = 0, draft = '', busy = false, focusFrame = 0;
  const append = text => {
    const node = document.createElement('pre'); node.textContent = String(text).slice(0, 12000); log.append(node);
    while (log.childElementCount > 40) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  };
  const open = (value = panel.hidden) => {
    if (value === !panel.hidden) return;
    if (value) { previousFocus = document.activeElement; document.exitPointerLock?.(); }
    panel.hidden = !value; panel.inert = !value; toggle.setAttribute('aria-expanded', String(value));
    cancelAnimationFrame(focusFrame);
    if (value) { focusFrame = requestAnimationFrame(() => { if (!panel.hidden) input.focus({preventScroll: true}); }); onOpen(); }
    else if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
  };
  panel.inert = panel.hidden;
  toggle.addEventListener('click', () => open(), options);
  panel.querySelector('#console-close').addEventListener('click', () => open(false), options);
  window.addEventListener('keydown', event => {
    if (event.isComposing || event.repeat) return;
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopImmediatePropagation(); open(false); return; }
    const typing = event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])');
    if (event.code === 'Backquote' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopImmediatePropagation(); open();
    }
  }, {...options, capture: true});
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.isComposing || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (historyIndex === history.length) draft = input.value;
    historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
    input.value = history[historyIndex] ?? draft;
  }, options);
  input.addEventListener('keyup', event => event.stopPropagation(), options);
  panel.querySelector('#console-form').addEventListener('submit', async event => {
    event.preventDefault(); const line = input.value.trim(); if (!line || busy) return;
    busy = true; input.setAttribute('aria-busy', 'true'); input.value = '';
    if (history.at(-1) !== line) history.push(line); if (history.length > 50) history.shift(); historyIndex = history.length; draft = '';
    append('> ' + line);
    try { append(await session.execute(line) ?? 'Done'); } catch (error) { append('Error: ' + error.message); }
    finally { busy = false; input.removeAttribute('aria-busy'); if (!panel.hidden) onOpen(); }
  }, options);
  return {
    open,
    refresh(read) {
      if (panel.hidden) return;
      for (const [path, row] of rows) if (!session.watches.has(path)) { row.remove(); rows.delete(path); }
      for (const path of session.watches) {
        let row = rows.get(path);
        if (!row) { row = document.createElement('pre'); watchList.append(row); rows.set(path, row); }
        let value; try { value = formatValue(read(path)); } catch (error) { value = 'Unavailable: ' + error.message; }
        const text = path + '\n' + value; if (row.textContent !== text) row.textContent = text;
      }
    },
    dispose() { cancelAnimationFrame(focusFrame); events.abort(); session.watches.clear(); rows.clear(); },
  };
}
