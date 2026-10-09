const $ = s => document.querySelector(s);
const state = { language: 'ja', level: 'beginner', favourites: [] };

const HELLO = {};

init();

async function init() {
  const opts = await fetch('/api/options').then(r => r.json());
  renderChips($('#languages'), opts.languages.map(l => ({ code: l.code, label: l.name })), 'language');
  renderChips($('#levels'), opts.levels.map(l => ({ code: l.code, label: l.label })), 'level');
  opts.languages.forEach(l => (HELLO[l.code] = l.hello));
  updateHello();

  setupTagInput();
  document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => {
    state.favourites = b.dataset.ex.split('|');
    renderFavs();
  }));
  $('#form').addEventListener('submit', onSubmit);
}

function renderChips(el, items, key) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.textContent = it.label;
    b.setAttribute('aria-checked', String(state[key] === it.code));
    b.addEventListener('click', () => {
      state[key] = it.code;
      el.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      if (key === 'language') updateHello();
    });
    el.appendChild(b);
  }
}

function updateHello() {
  $('#hello-line').textContent = `— ${HELLO[state.language] || 'Hello'}. Let's find your kind of thing.`;
}

// ---- favourites input with Qloo-backed autocomplete ----

function setupTagInput() {
  const input = $('#fav-input');
  const list = $('#suggest');
  let timer, active = -1, current = [];

  const close = () => { list.hidden = true; active = -1; };
  const add = name => {
    name = name.trim();
    if (!name || state.favourites.length >= 6) return;
    if (!state.favourites.some(f => f.toLowerCase() === name.toLowerCase())) state.favourites.push(name);
    input.value = '';
    renderFavs();
    close();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.includes(',')) { q.split(',').forEach(add); return; }
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      try {
        const { results } = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`).then(r => r.json());
        current = results || [];
        if (!current.length) return close();
        list.innerHTML = current.map((r, i) => `
          <li role="option" data-i="${i}">
            ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
            <span>${esc(r.name)}<br><small>${typeLabel(r.type)}${r.year ? ' · ' + r.year : ''}</small></span>
          </li>`).join('');
        list.hidden = false;
        list.querySelectorAll('li').forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); add(current[li.dataset.i].name); }));
      } catch { close(); }
    }, 220);
  });

  input.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll('li')];
    if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); active = Math.min(active + 1, items.length - 1); }
    else if (e.key === 'ArrowUp' && !list.hidden) { e.preventDefault(); active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && active >= 0) add(current[active].name);
      else add(input.value);
      return;
    } else if (e.key === 'Backspace' && !input.value && state.favourites.length) {
      state.favourites.pop(); renderFavs(); return;
    } else if (e.key === 'Escape') return close();
    items.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  $('#tagbox').addEventListener('click', () => input.focus());
}

function renderFavs() {
  $('#fav-list').innerHTML = state.favourites.map((f, i) =>
    `<span class="fav">${esc(f)}<button type="button" aria-label="Remove ${esc(f)}" data-i="${i}">×</button></span>`).join('');
  $('#fav-list').querySelectorAll('button').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    state.favourites.splice(+b.dataset.i, 1);
    renderFavs();
  }));
}

// ---- run the agent ----

async function onSubmit(e) {
  e.preventDefault();
  const pending = $('#fav-input').value.trim();
  if (pending) { state.favourites.push(pending); $('#fav-input').value = ''; renderFavs(); }

  $('#form-err').textContent = '';
  if (state.favourites.length < 2) { $('#form-err').textContent = 'Add at least two things you love.'; return; }

  const go = $('#go');
  go.disabled = true; go.textContent = 'Building…';
  $('#steps').innerHTML = '';
  $('#agent').hidden = false;
  $('#result').hidden = true;
  $('#agent').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...state, city: $('#city').value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server said ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.trim()) handle(JSON.parse(line));
      }
    }
  } catch (err) {
    $('#form-err').textContent = err.message;
  } finally {
    go.disabled = false; go.textContent = 'Build my plan';
  }
}

function handle(ev) {
  if (ev.type === 'step') {
    let li = document.querySelector(`#steps li[data-id="${ev.id}"]`);
    if (!li) {
      li = document.createElement('li');
      li.dataset.id = ev.id;
      $('#steps').appendChild(li);
    }
    li.dataset.status = ev.status;
    li.innerHTML = `<span class="dot"></span><div>${esc(ev.title)}${ev.detail ? `<div class="detail">${esc(ev.detail)}</div>` : ''}</div><span class="ms">${ev.ms != null ? (ev.ms / 1000).toFixed(1) + 's' : ''}</span>`;
  } else if (ev.type === 'plan') {
    renderPlan(ev.plan);
  } else if (ev.type === 'error') {
    $('#form-err').textContent = ev.message;
  }
}

function renderPlan(p) {
  const el = $('#result');
  const fp = p.fingerprint.map(t => `<span class="${t.count > 1 ? 'strong' : ''}" title="From: ${esc(t.from.join(', '))}">${esc(t.name)}</span>`).join('');
  el.innerHTML = `
    <div class="card">
      <div class="summary">
        <div>
          <h2>Your ${esc(p.language)} plan</h2>
          <p class="hint">${esc(p.level)} · built from ${p.favourites.map(f => esc(f.name)).join(', ')}</p>
          ${fp ? `<div class="fingerprint">${fp}</div>` : ''}
          <p class="coach">${esc(p.coach)}</p>
        </div>
        <aside class="usual">
          <b>What everyone else gets told</b>
          <ul>${p.usual.map(u => `<li>${esc(u)}</li>`).join('')}</ul>
          <p>Fine picks. Just not picked for you. Everything on the right of this page comes from Qloo matching your taste.</p>
        </aside>
      </div>
      <div class="actions"><button type="button" id="print">Print / save as PDF</button><button type="button" id="copy">Copy as text</button></div>
    </div>
    ${p.weeks.map(renderWeek).join('')}
    ${p.notes.length ? `<div class="card notes"><b>Honest notes from the agent</b><ul>${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
  `;
  el.hidden = false;
  $('#print').onclick = () => window.print();
  $('#copy').onclick = () => {
    const txt = [`My ${p.language} plan (Subtitled)`, '', ...p.weeks.flatMap(w => [`Week ${w.n}: ${w.title}`, ...w.items.map(i => `  - ${i.name} (${i.type}${i.year ? ', ' + i.year : ''})`), ''])].join('\n');
    navigator.clipboard.writeText(txt).then(() => ($('#copy').textContent = 'Copied'));
  };
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderWeek(w) {
  return `
  <section class="card week">
    <div class="week-head"><span class="week-n">${w.n <= 4 ? 'Week ' + w.n : 'Bonus'}</span><h3>${esc(w.title)}</h3></div>
    <p class="week-how">${esc(w.how)}</p>
    <div class="items">${w.items.map(renderItem).join('')}</div>
  </section>`;
}

function renderItem(i) {
  const why = i.shared && i.shared.length
    ? `Shares <b>${i.shared.map(esc).join(', ')}</b> with your favourites`
    : (i.description ? esc(i.description.slice(0, 110)) + (i.description.length > 110 ? '…' : '') : 'Fans of your picks rate this highly');
  return `
  <article class="item">
    <div class="img">${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" onerror="this.remove()">` : esc((i.name || '?')[0])}</div>
    <div class="body">
      <div class="meta"><span>${esc(i.type)}</span>${i.year ? `<span>${i.year}</span>` : ''}${i.match != null ? `<span class="badge match">${i.match}% taste match</span>` : ''}</div>
      <div class="name">${esc(i.name)}</div>
      ${i.address ? `<div class="why">${esc(i.address)}</div>` : ''}
      <div class="why">${why}</div>
    </div>
  </article>`;
}

function typeLabel(t) {
  return ({ movie: 'Film', tv_show: 'Series', artist: 'Music', book: 'Book', podcast: 'Podcast', video_game: 'Game' })[t] || t;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
