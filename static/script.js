/* =========================================================
   TripMate AI — frontend
   Talks to:  POST /api/travel  { message, thread_id }
   Receives:  { success, thread_id, answer, flight_results,
                hotel_results, itinerary, llm_calls }
   ========================================================= */
(() => {
  'use strict';

  const CONFIG = {
    endpoint: '/api/travel',
    timeoutMs: 180000,          // the agent runs several steps; allow up to 3 minutes
    storageKey: 'tripmate.session.v1',
    maxStoredMessages: 8,
    progressStepMs: 8000,
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PLANE_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const dom = {
    chat: document.getElementById('chat'),
    welcome: document.getElementById('welcome'),
    form: document.getElementById('composer'),
    input: document.getElementById('input'),
    send: document.getElementById('send'),
    newTrip: document.getElementById('new-trip'),
    status: document.getElementById('status'),
  };

  const state = {
    threadId: null,
    messages: [],   // [{role:'user', text} | {role:'bot', answer, flights, hotels, itinerary}]
    busy: false,
  };

  let uid = 0;

  /* -------------------------------------------------------
     Small helpers
     ------------------------------------------------------- */

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value; // only ever fed sanitized/static markup
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  function announce(message) {
    dom.status.textContent = '';
    // Re-set on the next frame so screen readers announce repeated messages
    requestAnimationFrame(() => { dom.status.textContent = message; });
  }

  function scrollToEnd() {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }

  function isEmptyValue(value) {
    if (value == null) return true;
    const v = String(value).trim();
    return v === '' || /^(n\/a|unknown.*|none|null|-)$/i.test(v);
  }

  function clean(value) {
    return isEmptyValue(value) ? '—' : String(value).trim();
  }

  /* -------------------------------------------------------
     Markdown -> safe HTML
     Input is HTML-escaped first, so only tags generated here
     can reach the DOM. Links are restricted to http(s).
     ------------------------------------------------------- */

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inlineMd(escaped) {
    const codes = [];
    let s = escaped.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });

    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (match, lead, url) => {
      const trailing = (url.match(/[.,;:!?]+$/) || [''])[0];
      const href = trailing ? url.slice(0, -trailing.length) : url;
      return `${lead}<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>${trailing}`;
    });

    s = s
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>');

    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function renderMarkdown(source) {
    const lines = escapeHtml(String(source || '').replace(/\r\n?/g, '\n')).split('\n');
    const out = [];
    const stack = [];
    let para = [];

    const flushPara = () => {
      if (para.length) {
        out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`);
        para = [];
      }
    };
    const closeLists = () => {
      while (stack.length) out.push(`</li></${stack.pop().type}>`);
    };
    const listItem = (type, indent, text) => {
      while (stack.length && stack[stack.length - 1].indent > indent) {
        out.push(`</li></${stack.pop().type}>`);
      }
      const top = stack[stack.length - 1];
      if (!top) {
        stack.push({ type, indent });
        out.push(`<${type}><li>${inlineMd(text)}`);
      } else if (top.type !== type && top.indent === indent) {
        out.push(`</li></${stack.pop().type}>`);
        stack.push({ type, indent });
        out.push(`<${type}><li>${inlineMd(text)}`);
      } else if (indent > top.indent) {
        stack.push({ type, indent });
        out.push(`<${type}><li>${inlineMd(text)}`);
      } else {
        out.push(`</li><li>${inlineMd(text)}`);
      }
    };

    const isTableSeparator = (l) => l.includes('|') && /^[\s|:-]+$/.test(l) && /-{2,}/.test(l);
    const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;

      if (!line.trim()) { flushPara(); continue; }

      if ((m = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/.exec(line))) {
        flushPara();
        listItem(/\d/.test(m[2]) ? 'ol' : 'ul', m[1].length, m[3]);
        continue;
      }

      closeLists();

      if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        flushPara();
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        i--;
        out.push(
          '<div class="table-wrap"><table><thead><tr>' +
          head.map((c) => `<th>${inlineMd(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table></div>'
        );
        continue;
      }

      if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) {
        flushPara();
        const level = m[1].length;
        const tag = level <= 2 ? 'h3' : level === 3 ? 'h4' : 'h5';
        out.push(`<${tag}>${inlineMd(m[2].replace(/\*\*/g, ''))}</${tag}>`);
        continue;
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushPara();
        out.push('<hr>');
        continue;
      }

      if ((m = /^&gt;\s?(.*)$/.exec(line))) {
        flushPara();
        out.push(`<blockquote>${inlineMd(m[1])}</blockquote>`);
        continue;
      }

      para.push(line.trim());
    }

    flushPara();
    closeLists();
    return out.join('');
  }

  function markdownBlock(source) {
    return el('div', { class: 'md', html: renderMarkdown(source) });
  }

  /* -------------------------------------------------------
     Parsers for the text blocks returned by the backend tools
     ------------------------------------------------------- */

  function parseFlights(text) {
    const raw = String(text || '').trim();
    const result = { header: '', flights: [], note: '' };
    if (!raw) return result;

    raw.split(/\n\s*---\s*\n/).forEach((part, index) => {
      const start = part.search(/^\s*Airline:/m);
      if (start === -1) {
        if (index === 0) result.note = part.trim();
        return;
      }
      if (index === 0) {
        result.header = part.slice(0, start).trim();
        part = part.slice(start);
      }
      const flight = parseFlightBlock(part);
      if (flight) result.flights.push(flight);
    });

    if (result.flights.length) result.note = '';
    else if (!result.note) result.note = raw;
    return result;
  }

  function parseFlightBlock(block) {
    const flight = { dep: {}, arr: {} };
    let section = null;

    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let m;
      if ((m = /^Airline:\s*(.*)$/i.exec(t))) flight.airline = m[1];
      else if ((m = /^Flight:\s*(.*)$/i.exec(t))) flight.number = m[1];
      else if ((m = /^Status:\s*(.*)$/i.exec(t))) flight.status = m[1];
      else if (/^Departure:?$/i.test(t)) section = 'dep';
      else if (/^Arrival:?$/i.test(t)) section = 'arr';
      else if (section && (m = /^-\s*(Airport|IATA|Terminal|Gate|Scheduled|Delay):\s*(.*)$/i.exec(t))) {
        flight[section][m[1].toLowerCase()] = m[2];
      }
    }
    return flight.airline || flight.number ? flight : null;
  }

  function parseHotels(text) {
    const raw = String(text || '').trim();
    const result = { items: [], note: '' };
    if (!raw) return result;

    for (const block of raw.split(/\n\s*\n(?=\d+\.\s+\*\*)/)) {
      const m = /^\s*\d+\.\s+\*\*(.+?)\*\*\s*\n\s*(https?:\/\/\S+)\s*\n?([\s\S]*)$/.exec(block);
      if (m) {
        result.items.push({
          title: m[1].trim(),
          url: m[2].trim(),
          snippet: m[3].replace(/\s+/g, ' ').trim(),
        });
      }
    }
    if (!result.items.length) result.note = raw;
    return result;
  }

  function formatSchedule(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    if (!m) return { time: '—', date: '' };
    // Times are shown exactly as given: they are local to each airport.
    return { time: `${m[4]}:${m[5]}`, date: `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` };
  }

  function statusVariant(status) {
    const s = String(status || '').toLowerCase();
    if (['active', 'landed'].includes(s)) return 'ok';
    if (s === 'scheduled') return 'info';
    if (['cancelled', 'canceled'].includes(s)) return 'bad';
    if (['incident', 'diverted', 'delayed'].includes(s)) return 'warn';
    return 'neutral';
  }

  function hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function safeHttpUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch { return null; }
  }

  /* -------------------------------------------------------
     Panels
     ------------------------------------------------------- */

  function flightCard(f) {
    const dep = f.dep || {};
    const arr = f.arr || {};
    const depTime = formatSchedule(dep.scheduled);
    const arrTime = formatSchedule(arr.scheduled);
    const pair = (a, b) => `${clean(a)} → ${clean(b)}`;

    const leg = (info, when, cls) =>
      el('div', { class: `leg ${cls}` },
        el('span', { class: 'iata', text: clean(info.iata) }),
        el('span', { class: 'airport', text: clean(info.airport), title: clean(info.airport) }),
        el('span', { class: 'time', text: when.time }),
        el('span', { class: 'date', text: when.date }));

    const stubRow = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }));

    return el('article', { class: 'pass' },
      el('div', { class: 'pass-main' },
        el('div', { class: 'pass-head' },
          el('span', { class: 'airline', text: clean(f.airline) }),
          el('span', { class: 'flight-no', text: clean(f.number) }),
          el('span', { class: `badge ${statusVariant(f.status)}`, text: clean(f.status) })),
        el('div', { class: 'route' },
          leg(dep, depTime, 'dep'),
          el('div', { class: 'route-line', html: PLANE_SVG }),
          leg(arr, arrTime, 'arr'))),
      el('dl', { class: 'pass-stub' },
        stubRow('Terminal', pair(dep.terminal, arr.terminal)),
        stubRow('Gate', pair(dep.gate, arr.gate)),
        stubRow('Delay', pair(dep.delay, arr.delay))));
  }

  function flightsPanel(parsed) {
    if (!parsed.flights.length) {
      return el('p', { class: 'notice', text: parsed.note || 'No flight information was returned.' });
    }
    return el('div', {},
      parsed.header ? el('p', { class: 'panel-note', text: parsed.header }) : null,
      el('div', { class: 'passes' }, parsed.flights.map(flightCard)),
      el('p', { class: 'panel-note', text: 'Live flight status only. Ticket prices are not included.' }));
  }

  function hotelsPanel(parsed) {
    if (!parsed.items.length) {
      return el('p', { class: 'notice', text: parsed.note || 'No hotel suggestions were returned.' });
    }
    return el('div', { class: 'hotels' }, parsed.items.map((h) => {
      const href = safeHttpUrl(h.url);
      const site = hostname(h.url);
      return el('article', { class: 'hotel' },
        el('h4', { text: h.title }),
        site ? el('p', { class: 'hotel-site', text: site }) : null,
        h.snippet ? el('p', { text: h.snippet }) : null,
        href ? el('a', { class: 'visit', href, target: '_blank', rel: 'noopener noreferrer', text: 'Open page' }) : null);
    }));
  }

  /* -------------------------------------------------------
     Result card with tabs
     ------------------------------------------------------- */

  function copyText(text, button) {
    const done = () => {
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original; }, 1800);
    };
    const fallback = () => {
      const ta = el('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0;top:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch { /* ignore */ }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function buildResult(data) {
    const id = ++uid;
    const flights = parseFlights(data.flights);
    const hotels = parseHotels(data.hotels);

    const tabs = [
      { key: 'plan', label: 'Plan', source: data.answer, node: () => markdownBlock(data.answer || 'No answer was returned.') },
    ];
    if (data.flights && data.flights.trim()) {
      tabs.push({ key: 'flights', label: 'Flights', count: flights.flights.length || null, source: data.flights, node: () => flightsPanel(flights) });
    }
    if (data.hotels && data.hotels.trim()) {
      tabs.push({ key: 'hotels', label: 'Hotels', count: hotels.items.length || null, source: data.hotels, node: () => hotelsPanel(hotels) });
    }
    if (data.itinerary && data.itinerary.trim()) {
      tabs.push({ key: 'itinerary', label: 'Itinerary', source: data.itinerary, node: () => markdownBlock(data.itinerary) });
    }

    const tabButtons = tabs.map((t, i) =>
      el('button', {
        class: 'tab',
        type: 'button',
        role: 'tab',
        id: `tab-${id}-${t.key}`,
        'aria-controls': `panel-${id}-${t.key}`,
        'aria-selected': i === 0 ? 'true' : 'false',
        tabindex: i === 0 ? '0' : '-1',
      }, t.label, t.count ? el('span', { class: 'count', text: String(t.count) }) : null));

    const panels = tabs.map((t, i) =>
      el('div', {
        class: 'panel',
        role: 'tabpanel',
        id: `panel-${id}-${t.key}`,
        'aria-labelledby': `tab-${id}-${t.key}`,
        hidden: i === 0 ? false : true,
      }, t.node()));

    let active = 0;
    const copyBtn = el('button', { class: 'copy-btn', type: 'button', text: 'Copy' });
    copyBtn.addEventListener('click', () => copyText(tabs[active].source || '', copyBtn));

    function select(index, focus) {
      active = index;
      tabButtons.forEach((b, i) => {
        const on = i === index;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
      });
      if (focus) tabButtons[index].focus();
    }

    tabButtons.forEach((b, i) => {
      b.addEventListener('click', () => select(i, false));
      b.addEventListener('keydown', (e) => {
        const last = tabButtons.length - 1;
        let next = null;
        if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1;
        else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = last;
        if (next !== null) { e.preventDefault(); select(next, true); }
      });
    });

    return el('div', { class: 'result' },
      el('div', { class: 'result-bar' },
        el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Trip details' }, tabButtons),
        copyBtn),
      panels);
  }

  /* -------------------------------------------------------
     Message rendering
     ------------------------------------------------------- */

  function appendUser(text) {
    const node = el('div', { class: 'msg user' }, el('div', { class: 'bubble', text }));
    dom.chat.append(node);
    return node;
  }

  function appendBot(reply) {
    const node = el('div', { class: 'msg bot' }, buildResult(reply));
    dom.chat.append(node);
    return node;
  }

  function appendError(message, retryText) {
    const node = el('div', { class: 'msg bot', role: 'alert' });
    const retry = el('button', { type: 'button', text: 'Try again' });
    retry.addEventListener('click', () => {
      node.remove();
      send(retryText, { echo: false });
    });
    node.append(el('div', { class: 'error-card' }, el('p', { text: message }), retry));
    dom.chat.append(node);
    return node;
  }

  function showProgress() {
    const labels = ['Searching flights', 'Finding hotels', 'Drafting your itinerary', 'Writing your plan'];
    const items = labels.map((label) => el('li', { class: 'step', text: label }));
    items[0].classList.add('active');

    const node = el('div', { class: 'msg bot' },
      el('div', { class: 'progress' },
        el('p', { class: 'progress-title', text: 'Planning your trip' }),
        el('ol', { class: 'steps' }, items),
        el('p', { class: 'progress-note', text: 'This can take a little while.' })));

    let current = 0;
    const timer = setInterval(() => {
      if (current < items.length - 1) {
        items[current].classList.replace('active', 'done');
        current += 1;
        items[current].classList.add('active');
      }
    }, CONFIG.progressStepMs);

    dom.chat.append(node);
    scrollToEnd();
    return { stop() { clearInterval(timer); node.remove(); } };
  }

  /* -------------------------------------------------------
     Persistence (best effort; the page works without it)
     ------------------------------------------------------- */

  function persist() {
    try {
      const trimmed = state.messages.slice(-CONFIG.maxStoredMessages);
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({ threadId: state.threadId, messages: trimmed }));
    } catch { /* storage full or blocked */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || 'null');
      if (!saved || !Array.isArray(saved.messages) || !saved.messages.length) return;
      state.threadId = typeof saved.threadId === 'string' ? saved.threadId : null;
      state.messages = saved.messages;
      dom.welcome.hidden = true;
      for (const m of state.messages) {
        if (m.role === 'user') appendUser(String(m.text || ''));
        else if (m.role === 'bot') appendBot(m);
      }
    } catch { /* corrupted data: start fresh */ }
  }

  function clearSession() {
    state.threadId = null;
    state.messages = [];
    try { localStorage.removeItem(CONFIG.storageKey); } catch { /* ignore */ }
  }

  /* -------------------------------------------------------
     Sending
     ------------------------------------------------------- */

  function setBusy(busy) {
    state.busy = busy;
    dom.form.setAttribute('aria-busy', busy ? 'true' : 'false');
    dom.newTrip.disabled = busy;
    updateSendState();
  }

  function updateSendState() {
    dom.send.disabled = state.busy || !dom.input.value.trim();
  }

  function autoGrow() {
    dom.input.style.height = 'auto';
    dom.input.style.height = `${Math.min(dom.input.scrollHeight, 160)}px`;
  }

  function friendlyError(status, data) {
    if (status === 400 && data && data.error) return data.error;
    if (status === 422) return 'Please check your message and try again.';
    if (status === 429) return 'Too many requests right now. Wait a moment and try again.';
    if (status >= 500) {
      if (data && data.error) console.error('Server error:', data.error);
      return 'The planner ran into a problem on the server. Please try again in a moment.';
    }
    return `Something went wrong (code ${status}). Please try again.`;
  }

  async function send(text, { echo = true } = {}) {
    const message = String(text || '').trim();
    if (!message || state.busy) return;

    setBusy(true);
    dom.welcome.hidden = true;
    if (echo) appendUser(message);
    const progress = showProgress();
    announce('Planning your trip. This can take a little while.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    try {
      const response = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message, thread_id: state.threadId }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.success === false) {
        throw new Error(friendlyError(response.status, data));
      }

      progress.stop();
      if (data.thread_id) state.threadId = data.thread_id;

      const reply = {
        role: 'bot',
        answer: data.answer || '',
        flights: data.flight_results || '',
        hotels: data.hotel_results || '',
        itinerary: data.itinerary || '',
      };
      state.messages.push({ role: 'user', text: message }, reply);
      persist();

      const node = appendBot(reply);
      node.scrollIntoView({ block: 'start', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      announce('Your trip plan is ready.');
    } catch (err) {
      progress.stop();
      let text;
      if (err.name === 'AbortError') {
        text = 'The request took too long and was stopped. Try again, or ask for a shorter trip.';
      } else if (err instanceof TypeError) {
        text = 'Could not reach the server. Check your connection and try again.';
      } else {
        text = err.message || 'Something went wrong. Please try again.';
      }
      appendError(text, message);
      announce(text);
      scrollToEnd();
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  /* -------------------------------------------------------
     Events
     ------------------------------------------------------- */

  dom.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = dom.input.value;
    if (!text.trim() || state.busy) return;
    dom.input.value = '';
    autoGrow();
    updateSendState();
    send(text);
  });

  dom.input.addEventListener('input', () => {
    autoGrow();
    updateSendState();
  });

  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      dom.form.requestSubmit();
    }
  });

  dom.welcome.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.prompt) send(chip.dataset.prompt);
  });

  dom.newTrip.addEventListener('click', () => {
    if (state.busy) return;
    clearSession();
    [...dom.chat.children].forEach((n) => { if (n !== dom.welcome) n.remove(); });
    dom.welcome.hidden = false;
    window.scrollTo({ top: 0 });
    dom.input.focus();
    announce('Started a new trip.');
  });

  restore();
  updateSendState();
})();