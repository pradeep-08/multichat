// Small, safe Markdown renderer for chat replies (Smart UI).
// Builds DOM nodes directly (never innerHTML), so model output can't inject HTML or scripts.
// Supports: headings, paragraphs, line breaks, bold, italic, strikethrough, inline code, fenced code blocks
// (with language label and Copy button), bullet / numbered / task lists (nested by indent), blockquotes,
// tables, horizontal rules, and http(s)/mailto links.
(function () {
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const safeUrl = (u) => /^(https?:\/\/|mailto:)/i.test(u) ? u : null;

  // ---------- inline ----------
  const INLINE = [
    { re: /`([^`\n]+)`/, make: (m) => el('code', 'md-code', m[1]) },
    { re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/, make: (m) => wrap('strong', m[1]) },
    { re: /__(?=\S)([\s\S]+?)(?<=\S)__/, make: (m) => wrap('strong', m[1]) },
    { re: /~~(?=\S)([\s\S]+?)(?<=\S)~~/, make: (m) => wrap('del', m[1]) },
    { re: /\[([^\]\n]+)\]\(([^)\s]+)\)/, make: (m) => link(m[2], m[1]) },
    { re: /(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=\S)\*(?![\w*])/, make: (m) => wrap('em', m[1]) },
    { re: /(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/, make: (m) => wrap('em', m[1]) },
    { re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]]/, make: (m) => link(m[0], m[0]) },
  ];
  function wrap(tag, inner) { const e = el(tag); e.append(inline(inner)); return e; }
  function link(url, label) {
    const href = safeUrl(url);
    if (!href) return document.createTextNode(label);
    const a = el('a', 'md-link');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
    a.append(inline(label));
    return a;
  }
  function inline(text) {
    const frag = document.createDocumentFragment();
    let rest = text;
    while (rest) {
      let best = null;
      for (const rule of INLINE) {
        const m = rule.re.exec(rest);
        if (m && (!best || m.index < best.m.index)) best = { m, rule };
      }
      if (!best) { frag.append(rest); break; }
      if (best.m.index) frag.append(rest.slice(0, best.m.index));
      frag.append(best.rule.make(best.m));
      rest = rest.slice(best.m.index + best.m[0].length);
    }
    return frag;
  }
  function inlineLines(lines) {
    const frag = document.createDocumentFragment();
    lines.forEach((l, i) => { if (i) frag.append(el('br')); frag.append(inline(l)); });
    return frag;
  }

  // ---------- blocks ----------
  const isFence = (l) => /^\s*(```|~~~)/.test(l);
  const isHeading = (l) => /^\s{0,3}#{1,6}\s+\S/.test(l);
  const isHr = (l) => /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
  const isQuote = (l) => /^\s{0,3}>/.test(l);
  const listMatch = (l) => /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(l);
  const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l) || (l.includes('|') && l.trim().split('|').length > 2);
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  function codeBlock(lang, code) {
    const box = el('div', 'md-pre');
    const head = el('div', 'md-pre-head');
    head.append(el('span', 'md-lang', lang || 'code'));
    const btn = el('button', 'md-copy', 'Copy');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText(code).then(() => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); }).catch(() => {});
    });
    head.append(btn);
    const pre = el('pre');
    pre.append(el('code', null, code));
    box.append(head, pre);
    return box;
  }

  function table(rows, align) {
    const wrapEl = el('div', 'md-table-wrap');
    const t = el('table', 'md-table');
    const thead = el('thead');
    const tr = el('tr');
    rows[0].forEach((c, i) => { const th = el('th'); th.append(inline(c)); if (align[i]) th.style.textAlign = align[i]; tr.append(th); });
    thead.append(tr);
    const tbody = el('tbody');
    rows.slice(1).forEach((r) => {
      const row = el('tr');
      rows[0].forEach((_, i) => { const td = el('td'); td.append(inline(r[i] || '')); if (align[i]) td.style.textAlign = align[i]; row.append(td); });
      tbody.append(row);
    });
    t.append(thead, tbody);
    wrapEl.append(t);
    return wrapEl;
  }

  // Lists: collect consecutive list lines (and their continuation lines), nest by indentation.
  function list(lines) {
    const root = { children: [], indent: -1 };
    const stack = [root];
    let lastItem = null;
    for (const line of lines) {
      const m = listMatch(line);
      if (!m) { if (lastItem) lastItem.text.push(line.trim()); continue; }
      const indent = m[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(m[2]);
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1];
      const owner = parent === root ? root : parent.item;
      let group = owner.children[owner.children.length - 1];
      if (!group || group.ordered !== ordered || group.type !== 'list') {
        group = { type: 'list', ordered, start: ordered ? parseInt(m[2], 10) : 1, items: [] };
        owner.children.push(group);
      }
      lastItem = { text: [m[3]], children: [] };
      group.items.push(lastItem);
      stack.push({ indent, item: lastItem });
    }
    const build = (group) => {
      const L = el(group.ordered ? 'ol' : 'ul', 'md-list');
      if (group.ordered && group.start !== 1) L.start = group.start;
      for (const it of group.items) {
        const li = el('li');
        const task = /^\[( |x|X)\]\s+/.exec(it.text[0]);
        if (task) {
          li.className = 'md-task';
          const box = el('span', `md-check${task[1] !== ' ' ? ' done' : ''}`, task[1] !== ' ' ? '✓' : '');
          li.append(box);
          it.text[0] = it.text[0].slice(task[0].length);
        }
        li.append(inlineLines(it.text));
        it.children.forEach((g) => li.append(build(g)));
        L.append(li);
      }
      return L;
    };
    const frag = document.createDocumentFragment();
    root.children.forEach((g) => frag.append(build(g)));
    return frag;
  }

  function blocks(lines) {
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      if (isFence(line)) {
        const fence = line.trim().slice(0, 3);
        const lang = line.trim().slice(3).trim().split(/\s/)[0];
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
        i++; // closing fence (missing while a reply is still streaming)
        frag.append(codeBlock(lang, body.join('\n')));
        continue;
      }
      if (isHeading(line)) {
        const m = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
        const hEl = el(`h${Math.min(6, m[1].length + 2)}`, 'md-h');
        hEl.append(inline(m[2]));
        frag.append(hEl);
        i++;
        continue;
      }
      if (isHr(line)) { frag.append(el('hr', 'md-hr')); i++; continue; }
      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : null));
        const rows = [head];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
        frag.append(table(rows, align));
        continue;
      }
      if (isQuote(line)) {
        const body = [];
        while (i < lines.length && isQuote(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        const q = el('blockquote', 'md-quote');
        q.append(blocks(body));
        frag.append(q);
        continue;
      }
      if (listMatch(line)) {
        const body = [];
        while (i < lines.length && lines[i].trim() && (listMatch(lines[i]) || /^\s{2,}\S/.test(lines[i]))) body.push(lines[i++]);
        // A blank line followed by another list item continues the same list.
        while (i + 1 < lines.length && !lines[i].trim() && listMatch(lines[i + 1])) {
          i++;
          while (i < lines.length && lines[i].trim() && (listMatch(lines[i]) || /^\s{2,}\S/.test(lines[i]))) body.push(lines[i++]);
        }
        frag.append(list(body));
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i]) && !isQuote(lines[i]) && !listMatch(lines[i])
        && !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) para.push(lines[i++].trim());
      const pEl = el('p', 'md-p');
      pEl.append(inlineLines(para));
      frag.append(pEl);
    }
    return frag;
  }

  // Splits the "Follow-ups: a | b | c" line the model adds in Smart UI mode.
  const FOLLOW_RE = /\n[ \t>*_]*follow[- ]?ups?\s*[:：][*_]*\s*([^\n]*)\s*$/i;
  function splitFollowups(text) {
    const m = FOLLOW_RE.exec('\n' + String(text || '').trimEnd());
    if (!m) return { body: text, followups: [] };
    const body = ('\n' + String(text).trimEnd()).slice(0, m.index).replace(/^\n/, '').trimEnd();
    const followups = m[1].split('|').map((s) => s.replace(/^[\s*_"“]+|[\s*_"”]+$/g, '')).filter((s) => s.length > 2).slice(0, 3);
    return { body, followups };
  }
  // While streaming, hide a partly written Follow-ups line.
  function hideFollowupTail(text) {
    return String(text || '').replace(/\n[ \t>*_]*follow[- ]?ups?[\s\S]*$/i, '');
  }

  function renderMarkdown(text) {
    const box = el('div', 'md');
    box.append(blocks(String(text || '').replace(/\r\n?/g, '\n').split('\n')));
    return box;
  }

  window.MD = { renderMarkdown, splitFollowups, hideFollowupTail };
})();
