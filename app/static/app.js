'use strict';
/* MES Operations UI — vanilla JS, no external assets (CSP: default-src 'self').
   Dynamic widths are applied through the CSSOM (applyWidths) because inline style attributes are blocked. */

// ---------- helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => new Intl.NumberFormat('en-US').format(n ?? 0);
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const ratio = (a, b) => (b > 0 ? clamp((a / b) * 100) : 0);

const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  lots: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  routes: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 3 3v6.5M6 8.5V15a3 3 0 0 0 3 3h6.5"/>',
  audit: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l1 8v6H4v-6z"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-5"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

const ORDER_LABELS = {queued:'Queued', draft:'Draft', released:'Released', in_progress:'In progress', on_hold:'On hold', completed:'Completed', pending:'QC pending', pass:'QC passed', fail:'QC failed'};
const LOT_LABELS = {quarantine:'Quarantine', released:'Approved', rejected:'Rejected'};
const ROLE_LABELS = {admin:'Administrator', planner:'Planner', operator:'Operator', quality:'Quality', viewer:'Viewer'};
const TONES = {queued:'neutral', draft:'neutral', released:'info', in_progress:'violet', on_hold:'warn', completed:'ok', pending:'neutral', pass:'ok', fail:'bad', quarantine:'warn', rejected:'bad', approved:'ok'};
const badge = (s, kind = 'order') => {
  const label = (kind === 'lot' ? LOT_LABELS[s] : ORDER_LABELS[s]) || s;
  const tone = kind === 'lot' && s === 'released' ? 'ok' : (TONES[s] || 'neutral');
  return `<span class="badge tone-${tone}"><span class="badge-dot" aria-hidden="true"></span>${esc(label)}</span>`;
};
const EVENTS = {
  'order.created': ['Order created', 'plus', 'neutral', 'order'],
  'order.release': ['Released with materials', 'play', 'info', 'order'],
  'order.record': ['Output recorded', 'tool', 'violet', 'order'],
  'order.hold': ['Order put on hold', 'pause', 'warn', 'order'],
  'order.resume': ['Order resumed', 'play', 'info', 'order'],
  'order.quality': ['Final inspection recorded', 'shield', 'ok', 'order'],
  'order.complete': ['Order closed', 'flag', 'ok', 'order'],
  'route.created': ['Route revision created', 'routes', 'neutral', 'route'],
  'lot.received': ['Material lot received', 'inbox', 'neutral', 'lot'],
  'lot.quality': ['Lot quality decision', 'shield', 'ok', 'lot'],
};
const eventInfo = action => EVENTS[action] || [action, 'clock', 'neutral', 'other'];
const ENTITY_LABELS = {order:'Order', lot:'Lot', route:'Route'};

// Backend messages are Vietnamese; show them in English.
const ERRORS = {
  'Vui lòng đăng nhập':'Please sign in.',
  'Phiên không hợp lệ':'Your session is invalid. Please sign in again.',
  'Phiên đã hết hạn':'Your session has expired. Please sign in again.',
  'Tài khoản không hoạt động':'This account is inactive.',
  'Không có quyền truy cập nhà máy':'You do not have access to this plant.',
  'Không tìm thấy nhà máy':'Plant not found.',
  'Vai trò không được phép thực hiện thao tác':'Your role is not allowed to perform this action.',
  'Không tìm thấy lệnh':'Work order not found.',
  'Cần Idempotency-Key từ 8 đến 80 ký tự':'Request key must be 8–80 characters.',
  'Idempotency-Key đã dùng cho yêu cầu khác':'This request key was already used for a different request.',
  'Thử đăng nhập quá nhiều. Vui lòng chờ 15 phút.':'Too many sign-in attempts. Please wait 15 minutes.',
  'Tên đăng nhập hoặc mật khẩu không đúng':'Incorrect username or password.',
  'Không tìm thấy lô':'Material lot not found.',
  'Lô đã có quyết định chất lượng':'This lot already has a quality decision.',
  'Lô đã được cập nhật; hãy tải lại':'This lot was updated by someone else. Refresh and try again.',
  'Quy trình không thuộc nhà máy':'The route does not belong to this plant.',
  'Lệnh đã thay đổi. Tải lại rồi thực hiện lại.':'The order was changed by someone else. Refresh and try again.',
  'Lệnh đã đóng, không thể sửa':'The order is closed and can no longer be changed.',
  'Chỉ phát hành lệnh nháp':'Only draft orders can be released.',
  'Không được chọn lặp lô':'Each lot can only be selected once.',
  'Lô không thuộc nhà máy':'The lot does not belong to this plant.',
  'Vật tư không thuộc BOM':'This material is not part of the BOM.',
  'Lô chưa được QC duyệt hoặc không đủ tồn kho':'Lot is not QC-approved or has insufficient stock.',
  'Cấp vật tư phải đúng định mức BOM × số lượng kế hoạch':'Allocated quantities must equal BOM quantity × planned quantity.',
  'Lệnh chưa sẵn sàng hoặc đang bị giữ':'The order is not released or is on hold.',
  'Công đoạn không thuộc lệnh':'The operation does not belong to this order.',
  'Công đoạn đã hoàn tất':'This operation is already finished.',
  'Phải hoàn tất công đoạn trước':'Finish the previous operation first.',
  'Chưa có sản lượng để ghi nhận':'Enter a good or scrap quantity to record.',
  'Cần lý do phế phẩm':'A scrap reason is required.',
  'Sản lượng vượt số lượng đầu vào':'Output exceeds the available input quantity.',
  'Phải ghi nhận đủ số lượng đầu vào trước khi kết thúc công đoạn':'Record the full input quantity before finishing the operation.',
  'Không thể giữ lệnh ở trạng thái này':'The order cannot be put on hold in its current state.',
  'Cần lý do giữ lệnh':'A hold reason is required.',
  'Lệnh không bị giữ':'The order is not on hold.',
  'Cần lý do xử lý và cho chạy lại':'Describe the corrective action before resuming.',
  'Chỉ kiểm tra cuối khi mọi công đoạn hoàn tất và lệnh không bị giữ':'Final inspection requires all operations finished and the order not on hold.',
  'Cần kết quả và biên bản kiểm tra':'A decision and inspection notes are required.',
  'Cần hoàn tất các công đoạn và QC đạt trước khi đóng':'All operations must be finished and QC passed before closing.',
  'Cần lý do đóng lệnh thiếu sản lượng':'A reason is required to close an order short of its planned quantity.',
  'Dữ liệu trùng hoặc xung đột. Tải lại trước khi thử lại.':'Duplicate or conflicting data (for example, a code that already exists). Refresh and try again.',
};
const translate = msg => ERRORS[String(msg).trim()] || msg;

// ---------- state ----------
const state = {
  token: null, username: '', plants: [], plant: null, page: 'overview', detail: null,
  orders: [], routes: [], lots: [], audit: [], auditDone: false, loadedPlant: null,
  filters: {orderState: '', orderQ: '', lotQuality: '', lotQ: '', auditType: '', auditQ: ''},
};
let loadGeneration = 0;
const can = (...roles) => state.plant?.role === 'admin' || roles.includes(state.plant?.role);
const base = () => `/api/plants/${state.plant.id}`;
const NAV = [
  {page: 'overview', label: 'Overview', short: 'Overview', icon: 'overview'},
  {page: 'orders', label: 'Work orders', short: 'Orders', icon: 'orders'},
  {page: 'lots', label: 'Materials', short: 'Materials', icon: 'lots'},
  {page: 'routes', label: 'Routes & BOM', short: 'Routes', icon: 'routes'},
  {page: 'audit', label: 'Activity log', short: 'Activity', icon: 'audit'},
];

// ---------- time ----------
const parseTime = v => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(v) ? v : v + 'Z');
const tz = () => state.plant?.timezone || 'UTC';
const time = v => new Intl.DateTimeFormat('en-GB', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz()}).format(parseTime(v));
const clock = v => new Intl.DateTimeFormat('en-GB', {hour: '2-digit', minute: '2-digit', timeZone: tz()}).format(parseTime(v));
const dayKey = d => new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz()}).format(d);
function dayLabel(v) {
  const d = parseTime(v), key = dayKey(d), today = dayKey(new Date()), yest = dayKey(new Date(Date.now() - 864e5));
  if (key === today) return 'Today';
  if (key === yest) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: tz()}).format(d);
}
function relative(v) {
  const s = (Date.now() - parseTime(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return time(v);
}

// ---------- api ----------
async function api(path, options = {}) {
  const headers = {'Content-Type': 'application/json', ...(state.token ? {Authorization: `Bearer ${state.token}`} : {}), ...options.headers};
  let response;
  try { response = await fetch(path, {...options, headers}); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') logoutLocal();
    const detail = Array.isArray(data.detail)
      ? data.detail.map(x => `${(x.loc || []).slice(1).join('.') || 'input'}: ${x.msg}`).join('; ')
      : translate(data.detail);
    throw new Error(detail || `Request failed (${response.status}).`);
  }
  return data;
}
const post = (path, body, key) => api(path, {method: 'POST', body: JSON.stringify(body), headers: key ? {'Idempotency-Key': key} : {}});

// ---------- domain helpers ----------
const routeOf = o => state.routes.find(r => r.id === o.route_id);
const lastGood = o => o.operations.at(-1)?.good || 0;
const capacityOf = (o, i) => (i === 0 ? o.planned_qty : o.operations[i - 1].good);
const currentOpIndex = o => o.operations.findIndex(op => !op.done);
function orderProgress(o) {
  const n = o.operations.length; if (!n) return 0;
  const done = o.operations.filter(op => op.done).length, i = currentOpIndex(o);
  const partial = i >= 0 ? (o.operations[i].good + o.operations[i].scrap) / Math.max(capacityOf(o, i), 1) : 0;
  return clamp(((done + Math.min(partial, 1)) / n) * 100);
}
function phaseOf(o) {
  if (o.state === 'draft') return 'draft';
  if (o.state === 'released') return 'released';
  if (o.state === 'completed') return 'closed';
  if (o.state === 'on_hold') return 'hold';
  if (o.operations.every(op => op.done)) return o.quality === 'pass' ? 'close' : 'qc';
  return 'production';
}
const scrapOf = o => o.operations.reduce((s, op) => s + op.scrap, 0);
// Show the QC result only once inspection is relevant; before that "pending" is just noise.
const qualityBadge = o => (o.quality !== 'pending' || phaseOf(o) === 'qc' ? badge(o.quality) : '<span class="muted-dash" aria-label="Not inspected yet">—</span>');

// ---------- ui primitives ----------
function applyWidths(root = document) { $$('[data-w]', root).forEach(el => { el.style.width = `${clamp(Number(el.dataset.w) || 0)}%`; }); }
const bar = (pct, tone = 'info', label = '') => `<span class="bar" role="img" aria-label="${esc(label || `${Math.round(pct)}%`)}"><span class="bar-fill tone-${tone}" data-w="${pct}"></span></span>`;
const btn = (label, attrs = '', cls = 'btn-secondary', ic = '') => `<button type="button" class="btn ${cls}" ${attrs}>${ic ? icon(ic) : ''}<span>${label}</span></button>`;
const empty = (title, text = '', action = '', ic = 'inbox') => `<div class="empty">${icon(ic, 'empty-icon')}<p class="empty-title">${title}</p>${text ? `<p class="empty-text">${text}</p>` : ''}${action}</div>`;
function pageHead(title, subtitle = '', actions = '', eyebrow = null) {
  const eb = eyebrow ?? `${esc(state.plant.code)} · ${esc(state.plant.name)}`;
  return `<div class="page-head"><div class="page-title"><p class="eyebrow">${eb}</p><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
const panel = (title, body, extra = '', cls = '') => `<section class="panel ${cls}"><div class="panel-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
let toastTimer;
function toast(message, tone = 'ok') {
  const el = $('#toast');
  el.className = `toast tone-${tone}`;
  el.innerHTML = `${icon(tone === 'ok' ? 'check' : 'alert')}<span>${esc(message)}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, tone === 'ok' ? 3500 : 6000);
}
function setLoading(on) { $('#loading-bar').hidden = !on; }

// ---------- theme ----------
function storedTheme() { try { return localStorage.getItem('mes-theme'); } catch { return null; } }
function effectiveTheme() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  const dark = effectiveTheme() === 'dark';
  $('#theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  $('#theme-toggle').title = dark ? 'Light theme' : 'Dark theme';
}
$('#theme-toggle').onclick = () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('mes-theme', next); } catch { /* storage unavailable */ }
  applyTheme(next);
};
applyTheme(storedTheme());

// ---------- shell ----------
$('#nav').innerHTML = NAV.map(n => `<button type="button" class="nav-item" data-cmd="go" data-page="${n.page}" aria-label="${n.label}" title="${n.label}">${icon(n.icon)}<span class="nav-label">${n.label}</span><span class="nav-short">${n.short}</span><span class="nav-count" data-count="${n.page}" hidden></span></button>`).join('');

function updateChrome() {
  $$('.nav-item').forEach(b => {
    const active = b.dataset.page === state.page;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const setCount = (page, n, tone) => {
    const el = $(`[data-count="${page}"]`); if (!el) return;
    el.hidden = !n; el.textContent = n > 99 ? '99+' : n; el.className = `nav-count tone-${tone}`;
  };
  setCount('orders', state.orders.filter(o => o.state === 'on_hold').length, 'warn');
  setCount('lots', state.lots.filter(l => l.quality === 'quarantine').length, 'warn');
  if (state.plant) {
    $('#user-name').textContent = state.username;
    $('#user-role').textContent = ROLE_LABELS[state.plant.role] || state.plant.role;
    $('#user-avatar').textContent = (state.username || '?').slice(0, 2).toUpperCase();
    $('#plant-select').value = String(state.plant.id);
  }
}

function logoutLocal() {
  state.token = null; loadGeneration++;
  if ($('#dialog').open) $('#dialog').close();
  $('#workspace').hidden = true; $('#login-screen').hidden = false;
  $('#content').replaceChildren(); $('#login-form').reset();
  Object.assign(state, {plants: [], plant: null, orders: [], routes: [], lots: [], audit: [], loadedPlant: null, detail: null});
}
$('#logout').onclick = async () => { try { await post('/api/logout', {}); } catch { /* already signed out */ } finally { logoutLocal(); } };

$('#login-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.target, button = $('button[type=submit]', form);
  button.disabled = true; button.classList.add('is-busy'); $('#login-error').textContent = '';
  try {
    const data = await post('/api/login', Object.fromEntries(new FormData(form)));
    state.token = data.token; state.username = data.username;
    state.plants = await api('/api/plants');
    $('#plant-select').innerHTML = state.plants.map(p => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join('');
    state.plant = state.plants[0] || null; state.page = 'overview'; state.detail = null;
    $('#login-screen').hidden = true; $('#workspace').hidden = false; form.reset();
    if (!state.plant) {
      $('#content').innerHTML = empty('No plant access yet', 'Your account has not been granted access to any plant. Contact your administrator.', '', 'alert');
      return;
    }
    updateChrome();
    await load();
    $('#content').focus();
  } catch (error) {
    $('#login-error').textContent = error.message;
  } finally { button.disabled = false; button.classList.remove('is-busy'); }
};

$('#plant-select').onchange = () => {
  state.plant = state.plants.find(p => p.id === Number($('#plant-select').value));
  state.detail = null; load();
};
$('#close-dialog').onclick = () => $('#dialog').close();

// ---------- loading ----------
function skeleton() {
  return `<div class="skeleton-page" aria-busy="true" aria-label="Loading plant data"><div class="sk sk-title"></div><div class="kpis">${'<div class="sk sk-card"></div>'.repeat(4)}</div><div class="sk sk-panel"></div></div>`;
}
async function load() {
  if (!state.plant) return;
  const generation = ++loadGeneration, path = base(), switching = state.loadedPlant !== state.plant.id;
  updateChrome();
  if (switching) $('#content').innerHTML = skeleton();
  setLoading(true);
  try {
    const [orders, routes, lots, audit] = await Promise.all([api(path + '/orders'), api(path + '/routes'), api(path + '/lots'), api(path + '/audit')]);
    if (generation !== loadGeneration) return;
    Object.assign(state, {orders, routes, lots, audit, auditDone: audit.length < 100, loadedPlant: state.plant.id});
    render();
  } catch (error) {
    if (generation !== loadGeneration) return;
    if (switching) $('#content').innerHTML = `<div class="callout tone-bad">${icon('alert')}<div><strong>Could not load plant data</strong><p>${esc(error.message)}</p></div>${btn('Try again', 'data-cmd="refresh"')}</div>`;
    else toast(error.message, 'bad');
  } finally { if (generation === loadGeneration) setLoading(false); }
}

function navigate(page) {
  state.page = page; state.detail = null;
  render(); window.scrollTo({top: 0}); load();
}

// ---------- command dispatch ----------
const commands = {
  go: el => {
    if (el.dataset.filter !== undefined) state.filters.lotQuality = el.dataset.filter;
    if (el.dataset.state !== undefined) state.filters.orderState = el.dataset.state;
    navigate(el.dataset.page);
  },
  refresh: () => load(),
  'open-order': el => { state.detail = Number(el.dataset.id); state.page = 'orders'; render(); window.scrollTo({top: 0}); },
  back: () => { state.detail = null; render(); },
  'new-order': () => newOrder(),
  'new-lot': () => newLot(),
  'new-route': () => newRoute(),
  'order-action': el => orderAction(currentOrder(), el.dataset.action, el.dataset.id ? Number(el.dataset.id) : undefined),
  trace: () => showTrace(currentOrder()),
  'lot-qc': el => lotQuality(Number(el.dataset.id)),
  'where-used': el => whereUsed(Number(el.dataset.id)),
  'audit-view': el => auditView(Number(el.dataset.id)),
  'audit-more': () => loadMoreAudit(),
  'order-filter': el => { state.filters.orderState = el.dataset.value; renderOrderRows(); },
  'lot-filter': el => { state.filters.lotQuality = el.dataset.value; renderLotRows(); },
  'audit-filter': el => { state.filters.auditType = el.dataset.value; renderAuditList(); },
};
const currentOrder = () => state.orders.find(o => o.id === state.detail);
document.addEventListener('click', event => {
  const el = event.target.closest('[data-cmd]');
  if (!el || el.disabled || !commands[el.dataset.cmd]) return;
  if (el.closest('dialog') && el.dataset.cmd === 'open-order') $('#dialog').close();
  event.preventDefault();
  commands[el.dataset.cmd](el);
});
document.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-cmd]')) { event.preventDefault(); event.target.click(); }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.id === 'order-search') { state.filters.orderQ = el.value; renderOrderRows(); }
  if (el.id === 'lot-search') { state.filters.lotQ = el.value; renderLotRows(); }
  if (el.id === 'audit-search') { state.filters.auditQ = el.value; renderAuditList(); }
});

// ---------- render ----------
function render() {
  updateChrome();
  if (!state.plant) return;
  if (state.detail) { renderDetail(); return; }
  ({overview: renderOverview, orders: renderOrders, lots: renderLots, routes: renderRoutes, audit: renderAudit})[state.page]();
  applyWidths($('#content'));
}

// ----- overview -----
function renderOverview() {
  const orders = state.orders, by = s => orders.filter(o => o.state === s);
  const active = orders.filter(o => o.state === 'released' || o.state === 'in_progress');
  const held = by('on_hold'), closed = by('completed'), drafts = by('draft');
  const goodOut = closed.reduce((s, o) => s + lastGood(o), 0), plannedClosed = closed.reduce((s, o) => s + o.planned_qty, 0);
  let good = 0, scrap = 0;
  orders.forEach(o => o.operations.forEach(op => { good += op.good; scrap += op.scrap; }));
  const scrapRate = good + scrap ? (scrap / (good + scrap)) * 100 : null;
  const awaitingQC = orders.filter(o => phaseOf(o) === 'qc'), readyClose = orders.filter(o => phaseOf(o) === 'close');
  const quarantine = state.lots.filter(l => l.quality === 'quarantine');

  const kpi = (label, value, foot, ic, tone = '') => `<div class="kpi ${tone ? `kpi-${tone}` : ''}"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-icon">${icon(ic)}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
  const kpis = `<div class="kpis">
    ${kpi('Active orders', fmt(active.length), `${fmt(by('in_progress').length)} in progress · ${fmt(by('released').length)} released`, 'orders', 'accent')}
    ${kpi('Good units closed', fmt(goodOut), plannedClosed ? `${ratio(goodOut, plannedClosed).toFixed(1)}% of planned on ${fmt(closed.length)} closed orders` : 'No closed orders yet', 'box')}
    ${kpi('Scrap rate', scrapRate === null ? '—' : `${scrapRate.toFixed(1)}%`, `${fmt(scrap)} scrap in ${fmt(good + scrap)} pcs processed (all operations)`, 'gauge', scrapRate > 5 ? 'warn' : '')}
    ${kpi('On hold', fmt(held.length), held.length ? 'Needs a quality decision' : 'Nothing blocked', 'pause', held.length ? 'warn' : '')}
  </div>`;

  // status distribution
  const states = ['draft', 'released', 'in_progress', 'on_hold', 'completed'];
  const counts = states.map(s => [s, by(s).length]);
  const statusBody = orders.length
    ? `<div class="panel-body"><div class="stack" role="img" aria-label="Orders by status">${counts.filter(([, n]) => n).map(([s, n]) => `<span class="stack-seg tone-${TONES[s]}" data-w="${(n / orders.length) * 100}" title="${ORDER_LABELS[s]}: ${n}"></span>`).join('')}</div>
       <ul class="legend">${counts.map(([s, n]) => `<li><button type="button" class="legend-item" data-cmd="go" data-page="orders" data-state="${s}"><span class="legend-swatch tone-${TONES[s]}"></span><span>${ORDER_LABELS[s]}</span><strong>${fmt(n)}</strong><small>${orders.length ? Math.round((n / orders.length) * 100) : 0}%</small></button></li>`).join('')}</ul></div>`
    : empty('No work orders yet', 'Create an order from a configured route to start production.', can('planner') ? btn('New order', 'data-cmd="new-order"', 'btn-primary', 'plus') : '');

  // needs attention
  const attn = [];
  held.forEach(o => attn.push({tone: 'warn', ic: 'pause', title: `${o.code} is on hold`, text: o.hold_reason || 'Awaiting a quality decision', cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  awaitingQC.forEach(o => attn.push({tone: 'info', ic: 'shield', title: `${o.code} awaits final inspection`, text: `All ${o.operations.length} operations finished`, cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  readyClose.forEach(o => attn.push({tone: 'ok', ic: 'flag', title: `${o.code} is ready to close`, text: `QC passed · ${fmt(lastGood(o))} good pcs`, cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  drafts.slice(0, 3).forEach(o => attn.push({tone: 'neutral', ic: 'play', title: `${o.code} is waiting for release`, text: `${esc(o.product)} · ${fmt(o.planned_qty)} pcs planned`, cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  if (quarantine.length) attn.push({tone: 'warn', ic: 'lots', title: `${quarantine.length} material lot${quarantine.length > 1 ? 's' : ''} in quarantine`, text: 'Approve or reject before they can be issued', cmd: 'data-cmd="go" data-page="lots" data-filter="quarantine"'});
  const attnBody = attn.length
    ? `<ul class="attn-list">${attn.slice(0, 7).map(a => `<li><button type="button" class="attn-item" ${a.cmd}><span class="attn-icon tone-${a.tone}">${icon(a.ic)}</span><span class="attn-text"><strong>${esc(a.title)}</strong><small>${esc(a.text)}</small></span>${icon('chevR', 'chev')}</button></li>`).join('')}</ul>`
    : empty('All clear', 'No orders or lots need action right now.', '', 'check');

  // WIP
  const wip = active.slice(0, 6);
  const wipBody = wip.length
    ? `<ul class="wip-list">${wip.map(o => {
        const i = currentOpIndex(o), op = o.operations[i], p = orderProgress(o);
        const where = op ? `${esc(op.name)} · ${esc(op.work_center)}` : 'All operations finished';
        return `<li><button type="button" class="wip-item" data-cmd="open-order" data-id="${o.id}"><span class="wip-main"><strong>${esc(o.code)}</strong><small>${esc(o.product)} · ${where}</small></span><span class="wip-progress">${bar(p, 'violet', `${Math.round(p)}% complete`)}<small>Op ${Math.max(i, 0) + (op ? 1 : o.operations.length)} of ${o.operations.length} · ${Math.round(p)}%</small></span>${badge(o.state)}</button></li>`;
      }).join('')}</ul>`
    : empty('Nothing in production', 'Released and in-progress orders appear here.', '', 'tool');

  // material availability
  const mats = {};
  state.lots.forEach(l => {
    const m = mats[l.material] ||= {approved: 0, quarantine: 0, lots: 0};
    m.lots++;
    if (l.quality === 'released') m.approved += l.available;
    if (l.quality === 'quarantine') m.quarantine += l.available;
  });
  const matRows = Object.entries(mats).sort((a, b) => a[0].localeCompare(b[0]));
  const maxMat = Math.max(1, ...matRows.map(([, m]) => m.approved + m.quarantine));
  const matBody = matRows.length
    ? `<div class="panel-body"><ul class="mat-list">${matRows.map(([name, m]) => `<li><div class="mat-head"><strong>${esc(name)}</strong><span>${fmt(m.approved)} <small>available</small>${m.quarantine ? ` · <span class="text-warn">${fmt(m.quarantine)} in QC</span>` : ''}</span></div><span class="stack stack-thin" role="img" aria-label="${esc(name)}: ${fmt(m.approved)} available, ${fmt(m.quarantine)} in quarantine"><span class="stack-seg tone-ok" data-w="${(m.approved / maxMat) * 100}"></span><span class="stack-seg tone-warn" data-w="${(m.quarantine / maxMat) * 100}"></span></span></li>`).join('')}</ul><div class="legend legend-inline"><span><span class="legend-swatch tone-ok"></span>Approved stock</span><span><span class="legend-swatch tone-warn"></span>Quarantine</span></div></div>`
    : empty('No material lots', 'Receive lots on the Materials page.', '', 'lots');

  // activity
  const actBody = state.audit.length ? timeline(state.audit.slice(0, 6), {compact: true}) : empty('No activity yet', '', '', 'audit');

  $('#content').innerHTML =
    pageHead('Production overview', `Live data for this plant · up to 500 most recent orders · times in ${esc(tz())}`,
      btn('Refresh', 'data-cmd="refresh"', 'btn-secondary', 'refresh') + (can('planner') ? btn('New order', 'data-cmd="new-order"', 'btn-primary', 'plus') : '')) +
    kpis +
    `<div class="grid grid-2">${panel('Orders by status', statusBody, `<button type="button" class="link-btn" data-cmd="go" data-page="orders">View all ${icon('chevR')}</button>`)}${panel('Needs attention', attnBody, attn.length ? `<span class="count-pill">${attn.length}</span>` : '')}</div>` +
    `<div class="grid grid-wide">${panel('Work in progress', wipBody, `<span class="panel-meta">${fmt(active.length)} active</span>`)}${panel('Material availability', matBody, `<button type="button" class="link-btn" data-cmd="go" data-page="lots">Materials ${icon('chevR')}</button>`)}</div>` +
    panel('Recent activity', actBody, `<button type="button" class="link-btn" data-cmd="go" data-page="audit">Full log ${icon('chevR')}</button>`);
}

// ----- orders -----
function renderOrders() {
  $('#content').innerHTML =
    pageHead('Work orders', 'Release, run, inspect and close production orders.', can('planner') ? btn('New order', 'data-cmd="new-order"', 'btn-primary', 'plus') : '') +
    `<section class="panel"><div class="panel-toolbar"><div class="chips" id="order-chips" role="group" aria-label="Filter by status"></div><label class="search">${icon('search')}<span class="sr-only">Search orders</span><input id="order-search" type="search" placeholder="Search order or product" value="${esc(state.filters.orderQ)}"></label></div><div id="order-list"></div></section>`;
  renderOrderRows();
}
function renderOrderRows() {
  const states = ['', 'draft', 'released', 'in_progress', 'on_hold', 'completed'];
  const count = s => (s ? state.orders.filter(o => o.state === s).length : state.orders.length);
  $('#order-chips').innerHTML = states.map(s => `<button type="button" class="chip ${state.filters.orderState === s ? 'active' : ''}" aria-pressed="${state.filters.orderState === s}" data-cmd="order-filter" data-value="${s}">${s ? ORDER_LABELS[s] : 'All'}<span>${count(s)}</span></button>`).join('');
  const q = state.filters.orderQ.trim().toLowerCase();
  const rows = state.orders.filter(o => (!state.filters.orderState || o.state === state.filters.orderState) && `${o.code} ${o.product}`.toLowerCase().includes(q));
  $('#order-list').innerHTML = rows.length ? orderTable(rows) : (state.orders.length
    ? empty('No matching orders', 'Try another status or search term.', '', 'search')
    : empty('No work orders yet', 'Create an order from a configured route to start production.', can('planner') ? btn('New order', 'data-cmd="new-order"', 'btn-primary', 'plus') : ''));
  applyWidths($('#order-list'));
}
function orderTable(rows) {
  return `<div class="table-wrap"><table class="table table-cards"><thead><tr><th>Order</th><th>Product</th><th class="num">Planned</th><th>Progress</th><th>Status</th><th>Quality</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>${rows.map(o => {
    const done = o.operations.filter(x => x.done).length, p = orderProgress(o);
    return `<tr class="row-link" data-cmd="open-order" data-id="${o.id}" tabindex="0" aria-label="Open order ${esc(o.code)}">
      <td data-label="Order"><span class="cell-main mono">${esc(o.code)}</span><span class="cell-sub">${time(o.created_at)}</span></td>
      <td data-label="Product"><span class="cell-main">${esc(o.product)}</span><span class="cell-sub">Revision ${o.revision}</span></td>
      <td data-label="Planned" class="num"><span class="cell-main">${fmt(o.planned_qty)}</span><span class="cell-sub">pcs</span></td>
      <td data-label="Progress"><div class="progress-cell">${bar(p, o.state === 'on_hold' ? 'warn' : o.state === 'completed' ? 'ok' : 'violet')}<span class="cell-sub">${done}/${o.operations.length} operations</span></div></td>
      <td data-label="Status">${badge(o.state)}</td>
      <td data-label="Quality">${qualityBadge(o)}</td>
      <td class="cell-chev">${icon('chevR')}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// ----- order detail -----
function renderDetail() {
  const o = currentOrder();
  if (!o) { state.detail = null; render(); return; }
  const route = routeOf(o), phase = phaseOf(o), good = lastGood(o), scrap = scrapOf(o);
  const canHold = ['released', 'in_progress'].includes(o.state) && can('planner', 'operator', 'quality');

  // lifecycle stepper
  const steps = ['Draft', 'Released', 'Production', 'Final QC', 'Closed'];
  const anyRecorded = o.operations.some(op => op.good + op.scrap > 0);
  const allDone = o.operations.every(op => op.done);
  const idx = {draft: 0, released: 1, production: 2, qc: 3, close: 4, closed: 5, hold: allDone ? 3 : anyRecorded ? 2 : 1}[phase];
  const stepper = `<ol class="stepper" aria-label="Order lifecycle">${steps.map((s, i) => {
    const st = i < idx ? 'done' : i === idx ? (phase === 'hold' ? 'hold' : 'current') : 'todo';
    return `<li class="step-${st}" ${st === 'current' || st === 'hold' ? 'aria-current="step"' : ''}><span class="stepper-dot">${st === 'done' ? icon('check') : st === 'hold' ? icon('pause') : i + 1}</span><span class="stepper-label">${s}</span></li>`;
  }).join('')}</ol>`;

  // next step callout
  const cur = currentOpIndex(o), curOp = o.operations[cur];
  let next;
  if (phase === 'draft') next = {tone: 'info', ic: 'play', title: 'Release this order', text: 'Allocate QC-approved material lots that match the BOM, then release to the shop floor.', action: can('planner') ? btn('Allocate & release', 'data-cmd="order-action" data-action="release"', 'btn-primary', 'play') : '', wait: 'Waiting for a planner to release.'};
  else if (phase === 'released' || phase === 'production') {
    const capCur = capacityOf(o, cur), rem = capCur - curOp.good - curOp.scrap;
    next = {tone: 'violet', ic: 'tool', title: `Record output at ${esc(curOp.name)}`, text: `Work center ${esc(curOp.work_center)} · ${fmt(rem)} of ${fmt(capCur)} pcs still to record.`, action: can('operator') ? btn('Record output', `data-cmd="order-action" data-action="record" data-id="${curOp.id}"`, 'btn-primary', 'tool') : '', wait: 'Waiting for an operator to record output.'};
  } else if (phase === 'qc') next = {tone: 'info', ic: 'shield', title: 'Run the final inspection', text: 'All operations are finished. Record the final quality decision.', action: can('quality') ? btn('Record inspection', 'data-cmd="order-action" data-action="quality"', 'btn-primary', 'shield') : '', wait: 'Waiting for a quality inspector.'};
  else if (phase === 'close') next = {tone: 'ok', ic: 'flag', title: 'Close the order', text: `Final inspection passed with ${fmt(good)} good pcs. Closing locks the order and creates output lot ${esc(o.code)}.`, action: can('planner') ? btn('Close order', 'data-cmd="order-action" data-action="complete"', 'btn-primary', 'flag') : '', wait: 'Waiting for a planner to close the order.'};
  else if (phase === 'hold') next = {tone: 'warn', ic: 'pause', title: 'Order on hold', text: `Reason: ${esc(o.hold_reason || '—')}`, action: can('quality') ? btn('Resume order', 'data-cmd="order-action" data-action="resume"', 'btn-primary', 'play') : '', wait: 'A quality user must record the corrective action and resume.'};
  else next = {tone: 'ok', ic: 'check', title: 'Order closed', text: `Output lot ${esc(o.code)} · ${fmt(good)} good pcs of ${fmt(o.planned_qty)} planned.`, action: btn('View traceability', 'data-cmd="trace"', 'btn-secondary', 'link'), wait: ''};
  const callout = `<div class="callout tone-${next.tone}">${icon(next.ic)}<div><strong>${next.title}</strong><p>${next.text}${!next.action && next.wait ? ` <em>${next.wait}</em>` : ''}</p></div>${next.action}</div>`;

  const stat = (label, value, sub = '') => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
  const stats = `<div class="stats">${stat('Planned', `${fmt(o.planned_qty)} <small>pcs</small>`)}${stat('Good output', `${fmt(good)} <small>pcs</small>`, `${ratio(good, o.planned_qty).toFixed(0)}% of plan`)}${stat('Scrap', `${fmt(scrap)} <small>pcs</small>`, scrap ? 'across all operations' : '')}${stat('Created', `<span class="stat-date">${time(o.created_at)}</span>`)}</div>`;

  const ops = o.operations.map((op, i) => {
    const cap = capacityOf(o, i), used = op.good + op.scrap, prevDone = i === 0 || o.operations[i - 1].done;
    const enabled = ['released', 'in_progress'].includes(o.state) && !op.done && prevDone && can('operator');
    const st = op.done ? 'completed' : used > 0 ? 'in_progress' : 'queued';
    const projected = i > 0 && !o.operations[i - 1].done;
    return `<li class="op op-${st}"><span class="op-num" aria-hidden="true">${op.done ? icon('check') : op.sequence}</span>
      <div class="op-body"><div class="op-head"><div><strong>${esc(op.name)}</strong><small>${esc(op.work_center)}</small></div>${badge(st)}</div>
      <span class="stack" role="img" aria-label="${fmt(op.good)} good, ${fmt(op.scrap)} scrap of ${fmt(cap)} input"><span class="stack-seg tone-ok" data-w="${cap ? (op.good / cap) * 100 : 0}"></span><span class="stack-seg tone-bad" data-w="${cap ? (op.scrap / cap) * 100 : 0}"></span></span>
      ${projected && used === 0 ? `<div class="op-figures"><span>Starts when <strong>${esc(o.operations[i - 1].name)}</strong> is finished</span></div>` : `<div class="op-figures"><span><i class="legend-swatch tone-ok"></i>Good <strong>${fmt(op.good)}</strong></span><span><i class="legend-swatch tone-bad"></i>Scrap <strong>${fmt(op.scrap)}</strong></span><span>Input <strong>${fmt(cap)}</strong></span><span>Remaining <strong>${fmt(Math.max(cap - used, 0))}</strong></span></div>`}</div>
      ${enabled ? btn('Record', `data-cmd="order-action" data-action="record" data-id="${op.id}"`, i === cur ? 'btn-primary btn-sm' : 'btn-secondary btn-sm', 'tool') : ''}</li>`;
  }).join('');

  const headActions = (canHold ? btn('Put on hold', 'data-cmd="order-action" data-action="hold"', 'btn-secondary', 'pause') : '') + btn('Traceability', 'data-cmd="trace"', 'btn-secondary', 'link');
  $('#content').innerHTML =
    `<button type="button" class="back-link" data-cmd="back">${icon('chevL')}Work orders</button>` +
    pageHead(`<span class="mono">${esc(o.code)}</span> ${badge(o.state)} ${o.quality !== 'pending' || phase === 'qc' ? badge(o.quality) : ''}`, `${esc(o.product)} · Revision ${o.revision}${route ? ` · ${esc(route.name)}` : ''}`, headActions) +
    stepper + callout + stats +
    panel('Operations', `<ol class="op-list">${ops}</ol><p class="panel-note">Only good units from the previous operation move forward. An operation can be finished once its full input is recorded.</p>`, `<span class="panel-meta">${o.operations.filter(x => x.done).length} of ${o.operations.length} finished</span>`);
  applyWidths($('#content'));
}

// ----- materials -----
function renderLots() {
  $('#content').innerHTML =
    pageHead('Materials', 'Received lots, quality decisions and stock available to issue.', can('planner') ? btn('Receive lot', 'data-cmd="new-lot"', 'btn-primary', 'plus') : '') +
    `<section class="panel"><div class="panel-toolbar"><div class="chips" id="lot-chips" role="group" aria-label="Filter by quality"></div><label class="search">${icon('search')}<span class="sr-only">Search lots</span><input id="lot-search" type="search" placeholder="Search lot or material" value="${esc(state.filters.lotQ)}"></label></div><div id="lot-list"></div></section>`;
  renderLotRows();
}
function renderLotRows() {
  const opts = ['', 'quarantine', 'released', 'rejected'];
  const count = s => (s ? state.lots.filter(l => l.quality === s).length : state.lots.length);
  $('#lot-chips').innerHTML = opts.map(s => `<button type="button" class="chip ${state.filters.lotQuality === s ? 'active' : ''}" aria-pressed="${state.filters.lotQuality === s}" data-cmd="lot-filter" data-value="${s}">${s ? LOT_LABELS[s] : 'All'}<span>${count(s)}</span></button>`).join('');
  const q = state.filters.lotQ.trim().toLowerCase();
  const rows = state.lots.filter(l => (!state.filters.lotQuality || l.quality === state.filters.lotQuality) && `${l.code} ${l.material}`.toLowerCase().includes(q));
  $('#lot-list').innerHTML = rows.length
    ? `<div class="table-wrap"><table class="table table-cards"><thead><tr><th>Lot</th><th>Material</th><th class="num">Received</th><th>Available</th><th>Quality</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(l => `<tr>
        <td data-label="Lot"><span class="cell-main mono">${esc(l.code)}</span></td>
        <td data-label="Material"><span class="cell-main">${esc(l.material)}</span></td>
        <td data-label="Received" class="num">${fmt(l.received)} <span class="cell-sub-inline">${esc(l.unit)}</span></td>
        <td data-label="Available"><div class="progress-cell">${bar(ratio(l.available, l.received), l.quality === 'released' ? 'ok' : l.quality === 'rejected' ? 'bad' : 'warn', `${fmt(l.available)} of ${fmt(l.received)} available`)}<span class="cell-sub">${fmt(l.available)} ${esc(l.unit)} left</span></div></td>
        <td data-label="Quality">${badge(l.quality, 'lot')}</td>
        <td class="cell-actions">${l.quality === 'quarantine' && can('quality') ? btn('Inspect', `data-cmd="lot-qc" data-id="${l.id}"`, 'btn-primary btn-sm', 'shield') : ''}${btn('Where used', `data-cmd="where-used" data-id="${l.id}"`, 'btn-ghost btn-sm', 'link')}</td></tr>`).join('')}</tbody></table></div>`
    : (state.lots.length ? empty('No matching lots', 'Try another filter or search term.', '', 'search')
      : empty('No material lots yet', 'Received lots start in quarantine until quality approves them.', can('planner') ? btn('Receive lot', 'data-cmd="new-lot"', 'btn-primary', 'plus') : '', 'lots'));
  applyWidths($('#lot-list'));
}

// ----- routes -----
function renderRoutes() {
  const groups = {};
  state.routes.forEach(r => (groups[r.product] ||= []).push(r));
  const cards = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([product, revs]) => revs.sort((a, b) => b.revision - a.revision).map((r, k) => `
    <section class="panel route">
      <div class="panel-head"><div><h2>${esc(product)} <span class="rev">Rev ${r.revision}</span>${k === 0 && revs.length > 1 ? '<span class="badge tone-info"><span class="badge-dot"></span>Latest</span>' : ''}</h2><p class="panel-sub">${esc(r.name)} · ${r.steps.length} operation${r.steps.length > 1 ? 's' : ''} · ${r.bom.length} material${r.bom.length > 1 ? 's' : ''}</p></div><span class="badge tone-neutral"><span class="badge-dot"></span>Locked revision</span></div>
      <div class="panel-body route-body">
        <div><h3 class="section-label">Operation sequence</h3><ol class="flow">${r.steps.map((s, i) => `<li><span class="flow-num">${i + 1}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.work_center)}</small></span></li>`).join('')}</ol></div>
        <div><h3 class="section-label">Bill of materials · per finished unit</h3><table class="table table-compact"><tbody>${r.bom.map(b => `<tr><td class="mono">${esc(b.material)}</td><td class="num"><strong>${fmt(b.per_unit)}</strong> ${esc(b.unit)}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </section>`).join('')).join('');
  $('#content').innerHTML =
    pageHead('Routes & BOM', 'Each revision is immutable. To change a route, create a new revision.', can('planner') ? btn('New revision', 'data-cmd="new-route"', 'btn-primary', 'plus') : '') +
    (cards || empty('No routes yet', 'Define operations and a bill of materials before creating orders.', can('planner') ? btn('New revision', 'data-cmd="new-route"', 'btn-primary', 'plus') : '', 'routes'));
}

// ----- audit -----
function timeline(items, {compact = false, details = true} = {}) {
  let lastDay = '';
  return `<ol class="timeline ${compact ? 'timeline-compact' : ''}">${items.map(a => {
    const [label, ic, tone] = eventInfo(a.action), day = dayLabel(a.at);
    const header = !compact && day !== lastDay ? `<li class="timeline-day">${esc(day)}</li>` : '';
    lastDay = day;
    return `${header}<li class="timeline-item"><span class="timeline-icon tone-${tone}">${icon(ic)}</span><div class="timeline-body"><div><strong>${esc(label)}</strong><small>${esc(a.actor)} · ${esc(ENTITY_LABELS[a.entity] || a.entity)} #${a.entity_id}</small></div><div class="timeline-meta"><time title="${time(a.at)}">${compact ? relative(a.at) : clock(a.at)}</time>${!compact && details ? `<button type="button" class="btn btn-ghost btn-sm" data-cmd="audit-view" data-id="${a.id}">${icon('eye')}<span>Details</span></button>` : ''}</div></div></li>`;
  }).join('')}</ol>`;
}
function renderAudit() {
  $('#content').innerHTML =
    pageHead('Activity log', `Read-only, append-only record of every change · times in ${esc(tz())}`) +
    `<section class="panel"><div class="panel-toolbar"><div class="chips" id="audit-chips" role="group" aria-label="Filter by type"></div><label class="search">${icon('search')}<span class="sr-only">Search activity</span><input id="audit-search" type="search" placeholder="Search user or record" value="${esc(state.filters.auditQ)}"></label></div><div id="audit-list" class="panel-body"></div></section>`;
  renderAuditList();
}
function renderAuditList() {
  const types = [['', 'All'], ['order', 'Orders'], ['lot', 'Materials'], ['route', 'Routes']];
  $('#audit-chips').innerHTML = types.map(([v, l]) => `<button type="button" class="chip ${state.filters.auditType === v ? 'active' : ''}" aria-pressed="${state.filters.auditType === v}" data-cmd="audit-filter" data-value="${v}">${l}</button>`).join('');
  const q = state.filters.auditQ.trim().toLowerCase();
  const items = state.audit.filter(a => (!state.filters.auditType || a.entity === state.filters.auditType) && `${a.actor} ${a.entity} ${a.entity_id} ${eventInfo(a.action)[0]}`.toLowerCase().includes(q));
  $('#audit-list').innerHTML = (items.length ? timeline(items) : empty(state.audit.length ? 'No matching events' : 'No activity yet', '', '', 'audit')) +
    (!state.auditDone ? `<div class="load-more">${btn('Load older events', 'data-cmd="audit-more"', 'btn-secondary')}</div>` : '');
}
async function loadMoreAudit() {
  const last = state.audit.at(-1); if (!last) return;
  const plant = state.plant.id;
  try {
    const more = await api(`${base()}/audit?before_id=${last.id}`);
    if (state.plant.id !== plant) return;
    state.audit = state.audit.concat(more); state.auditDone = more.length < 100;
    renderAuditList();
  } catch (e) { toast(e.message, 'bad'); }
}
function auditView(id) {
  const a = state.audit.find(x => x.id === id); if (!a) return;
  const [label, ic, tone] = eventInfo(a.action);
  showDialog(label, `<div class="dialog-summary"><span class="timeline-icon tone-${tone}">${icon(ic)}</span><div><strong>${esc(a.actor)}</strong><small>${time(a.at)} · ${esc(ENTITY_LABELS[a.entity] || a.entity)} #${a.entity_id}</small></div></div><h3 class="section-label">Recorded payload</h3><pre class="code-block">${esc(JSON.stringify(a.payload, null, 2))}</pre>`);
}

// ---------- dialogs ----------
function showDialog(title, body, size = '') {
  $('#dialog-title').textContent = title;
  $('#dialog').className = size;
  $('#dialog-body').innerHTML = body;
  applyWidths($('#dialog-body'));
  if (!$('#dialog').open) $('#dialog').showModal();
}
function formDialog(title, fields, submitLabel, onSubmit, {onMount, size = '', note = ''} = {}) {
  showDialog(title, `<form id="modal-form" novalidate>${fields}${note ? `<p class="form-note">${note}</p>` : ''}<p class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">${submitLabel}</button></div></form>`, size);
  const form = $('#modal-form'), key = crypto.randomUUID();
  $('[data-close]', form).onclick = () => $('#dialog').close();
  onMount?.(form);
  const first = form.querySelector('input:not([type=hidden]):not([readonly]),select,textarea');
  first?.focus();
  form.onsubmit = async event => {
    event.preventDefault();
    const button = $('button[type=submit]', form), error = $('.form-error', form);
    error.textContent = '';
    if (!form.checkValidity()) { form.reportValidity(); return; }
    button.disabled = true; button.classList.add('is-busy');
    try {
      await onSubmit(new FormData(form), key, form);
      $('#dialog').close(); toast('Changes saved'); await load();
    } catch (e) { error.textContent = e.message; }
    finally { button.disabled = false; button.classList.remove('is-busy'); }
  };
}
const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
const CODE_PATTERN = 'pattern="[A-Za-z0-9_.\\-]+" title="Letters, numbers, dot, dash and underscore only"';
const materialsDatalist = () => {
  const set = new Set([...state.lots.map(l => l.material), ...state.routes.flatMap(r => r.bom.map(b => b.material))]);
  return `<datalist id="material-options">${[...set].sort().map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist>`;
};

function newOrder() {
  if (!state.routes.length) { toast('Create a route and BOM first.', 'bad'); return; }
  const path = base(), now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const codes = new Set(state.orders.map(o => o.code));
  let n = 1; while (codes.has(`WO-${stamp}-${String(n).padStart(3, '0')}`)) n++;
  const routes = [...state.routes].sort((a, b) => a.product.localeCompare(b.product) || b.revision - a.revision);
  formDialog('New work order',
    `<div class="form-grid">${field('Order code', `<input name="code" required ${CODE_PATTERN} maxlength="80" value="WO-${stamp}-${String(n).padStart(3, '0')}" class="mono">`)}${field('Planned quantity (pcs)', '<input name="planned_qty" type="number" min="1" max="100000000" step="1" required inputmode="numeric" placeholder="e.g. 100">')}</div>
     ${field('Route & revision', `<select name="route_id">${routes.map(r => `<option value="${r.id}">${esc(r.product)} · Rev ${r.revision} · ${esc(r.name)}</option>`).join('')}</select>`)}
     <div class="req-box" id="req-box"></div>`,
    'Create draft order',
    (f, key) => post(path + '/orders', {code: f.get('code').trim(), route_id: Number(f.get('route_id')), planned_qty: Number(f.get('planned_qty'))}, key),
    {onMount: form => {
      const update = () => {
        const r = state.routes.find(x => x.id === Number(form.route_id.value)), qty = Number(form.planned_qty.value) || 0;
        if (!r) return;
        $('#req-box').innerHTML = `<h3 class="section-label">Material requirement${qty ? ` for ${fmt(qty)} pcs` : ''}</h3><ul class="req-list">${r.bom.map(b => {
          const need = b.per_unit * qty, have = state.lots.filter(l => l.material === b.material && l.quality === 'released').reduce((s, l) => s + l.available, 0);
          const ok = !qty || have >= need;
          return `<li><span class="mono">${esc(b.material)}</span><span>${qty ? fmt(need) : `${fmt(b.per_unit)} / unit`}</span><span class="${ok ? 'text-ok' : 'text-bad'}">${icon(ok ? 'check' : 'alert')}${fmt(have)} approved in stock</span></li>`;
        }).join('')}</ul><p class="form-note">${r.steps.map(s => esc(s.name)).join(' → ')}</p>`;
      };
      form.route_id.onchange = update; form.planned_qty.oninput = update; update();
    }, note: 'The order starts as a draft. Materials are issued when it is released.'});
}

function newLot() {
  const path = base();
  formDialog('Receive material lot',
    `<div class="form-grid">${field('Lot code', `<input name="code" required ${CODE_PATTERN} maxlength="80" class="mono" placeholder="e.g. HOUSING-002">`)}${field('Material code', `<input name="material" required ${CODE_PATTERN} maxlength="80" list="material-options" class="mono" placeholder="e.g. HOUSING">`)}</div>${materialsDatalist()}
     ${field('Quantity received (pcs)', '<input name="quantity" type="number" min="1" step="1" max="100000000" required inputmode="numeric">')}`,
    'Receive lot',
    f => post(path + '/lots', {code: f.get('code').trim(), material: f.get('material').trim(), quantity: Number(f.get('quantity'))}),
    {note: 'New lots start in quarantine. Quality must approve a lot before it can be issued to production.'});
}

const decisionPicker = (name, options) => `<fieldset class="choice-group"><legend class="sr-only">Decision</legend>${options.map(([value, title, text, tone], i) => `<label class="choice tone-${tone}"><input type="radio" name="${name}" value="${value}" ${i === 0 ? 'checked' : ''} required><span class="choice-mark">${icon(tone === 'ok' ? 'check' : 'x')}</span><span><strong>${title}</strong><small>${text}</small></span></label>`).join('')}</fieldset>`;

function lotQuality(id) {
  const lot = state.lots.find(l => l.id === id), path = base();
  formDialog(`Inspect lot ${lot ? lot.code : ''}`,
    (lot ? `<div class="dialog-summary"><span class="timeline-icon tone-warn">${icon('lots')}</span><div><strong class="mono">${esc(lot.material)}</strong><small>${fmt(lot.received)} ${esc(lot.unit)} received · in quarantine</small></div></div>` : '') +
    decisionPicker('decision', [['released', 'Approve', 'Lot can be issued to production', 'ok'], ['rejected', 'Reject', 'Lot is blocked from use', 'bad']]) +
    field('Inspection notes', '<textarea name="reason" required minlength="3" maxlength="500" rows="3" placeholder="Results, sample size, reference…"></textarea>', 'At least 3 characters.'),
    'Save decision',
    f => post(`${path}/lots/${id}/quality`, {decision: f.get('decision'), reason: f.get('reason')}));
}

async function whereUsed(id) {
  const lot = state.lots.find(l => l.id === id);
  try {
    const data = await api(`${base()}/lots/${id}/where-used`);
    showDialog(`Where used · ${lot ? lot.code : ''}`, data.length
      ? `<ul class="attn-list">${data.map(x => `<li><button type="button" class="attn-item" data-cmd="open-order" data-id="${x.order_id}"><span class="attn-icon tone-info">${icon('orders')}</span><span class="attn-text"><strong class="mono">${esc(x.order)}</strong><small>${fmt(x.quantity)} pcs issued</small></span>${badge(x.state)}${icon('chevR', 'chev')}</button></li>`).join('')}</ul>`
      : empty('Not issued yet', 'This lot has not been allocated to any work order.', '', 'link'));
  } catch (e) { toast(e.message, 'bad'); }
}

function newRoute() {
  const path = base();
  formDialog('New route revision',
    `<div class="form-grid form-grid-3">${field('Product code', `<input name="product" required ${CODE_PATTERN} maxlength="80" class="mono" placeholder="e.g. ASM-200" list="product-options">`)}${field('Revision', '<input name="revision" type="number" min="1" step="1" value="1" required inputmode="numeric">')}</div>
     <datalist id="product-options">${[...new Set(state.routes.map(r => r.product))].map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist>${materialsDatalist()}
     ${field('Route name', '<input name="name" required maxlength="160" placeholder="e.g. Standard drive assembly">')}
     <div class="builder"><div class="builder-head"><h3 class="section-label">Operations, in order</h3><button type="button" class="btn btn-ghost btn-sm" id="add-step">${icon('plus')}<span>Add operation</span></button></div><ol id="step-rows" class="builder-rows"></ol></div>
     <div class="builder"><div class="builder-head"><h3 class="section-label">Bill of materials · per finished unit</h3><button type="button" class="btn btn-ghost btn-sm" id="add-bom">${icon('plus')}<span>Add material</span></button></div><ul id="bom-rows" class="builder-rows"></ul></div>`,
    'Save revision',
    (f, key, form) => post(path + '/routes', {
      product: f.get('product').trim(), revision: Number(f.get('revision')), name: f.get('name').trim(),
      steps: $$('.step-input', form).map(row => ({name: $('[data-name]', row).value.trim(), work_center: $('[data-center]', row).value.trim()})),
      bom: $$('.bom-input', form).map(row => ({material: $('[data-material]', row).value.trim(), per_unit: Number($('[data-qty]', row).value), unit: 'pcs'})),
    }, key),
    {size: 'dialog-wide', note: 'Saved revisions cannot be edited. Orders keep the revision they were created from.', onMount: form => {
      const renumber = () => $$('#step-rows .row-num').forEach((el, i) => { el.textContent = i + 1; });
      const row = kind => {
        const li = document.createElement('li');
        li.className = `builder-row ${kind}-input`;
        li.innerHTML = kind === 'step'
          ? `<span class="row-num" aria-hidden="true"></span><input data-name aria-label="Operation name" placeholder="Operation name" required maxlength="160"><input data-center aria-label="Work center" placeholder="Work center" required maxlength="100" class="mono"><button type="button" class="btn btn-icon btn-ghost" aria-label="Remove operation">${icon('x')}</button>`
          : `<input data-material aria-label="Material code" placeholder="Material code" ${CODE_PATTERN} required maxlength="80" list="material-options" class="mono"><input data-qty aria-label="Quantity per finished unit" placeholder="Qty / unit" type="number" min="1" step="1" required inputmode="numeric"><span class="unit">pcs</span><button type="button" class="btn btn-icon btn-ghost" aria-label="Remove material">${icon('x')}</button>`;
        $('button', li).onclick = () => {
          const list = li.parentElement;
          if (list.children.length > 1) { li.remove(); renumber(); } else toast(kind === 'step' ? 'A route needs at least one operation.' : 'A BOM needs at least one material.', 'bad');
        };
        $(kind === 'step' ? '#step-rows' : '#bom-rows').append(li); renumber();
        return li;
      };
      $('#add-step').onclick = () => $('input', row('step')).focus();
      $('#add-bom').onclick = () => $('input', row('bom')).focus();
      row('step'); row('bom');
      form.product.oninput = () => {
        const revs = state.routes.filter(r => r.product === form.product.value.trim()).map(r => r.revision);
        form.revision.value = revs.length ? Math.max(...revs) + 1 : 1;
      };
    }});
}

async function showTrace(o) {
  if (!o) return;
  try {
    const t = await api(`${base()}/orders/${o.id}/trace`);
    const inputs = t.inputs.length
      ? t.inputs.map(l => `<li class="trace-node"><span class="mono">${esc(l.lot)}</span><small>${esc(l.material)} · ${fmt(l.quantity)} ${esc(l.unit)}</small></li>`).join('')
      : '<li class="trace-node trace-node-empty"><small>No materials issued yet</small></li>';
    showDialog(`Traceability · ${o.code}`,
      `<div class="trace-flow"><div><h3 class="section-label">Input lots</h3><ul class="trace-col">${inputs}</ul></div><span class="trace-arrow" aria-hidden="true">${icon('arrowR')}</span>
        <div><h3 class="section-label">Work order</h3><ul class="trace-col"><li class="trace-node trace-node-main"><span class="mono">${esc(t.order.code)}</span><small>${esc(t.order.product)} · Rev ${t.order.revision}</small>${badge(t.order.state)}</li></ul></div><span class="trace-arrow" aria-hidden="true">${icon('arrowR')}</span>
        <div><h3 class="section-label">Output lot</h3><ul class="trace-col"><li class="trace-node ${t.output_lot ? 'trace-node-ok' : 'trace-node-empty'}">${t.output_lot ? `<span class="mono">${esc(t.output_lot)}</span><small>${fmt(lastGood(t.order))} good pcs</small>` : '<small>Created when the order is closed</small>'}</li></ul></div></div>
       <h3 class="section-label">Order history</h3>${t.events.length ? timeline(t.events.map(e => ({...e, entity: 'order', entity_id: o.id})), {details: false}) : '<p class="muted">No events.</p>'}`,
      'dialog-wide');
  } catch (e) { toast(e.message, 'bad'); }
}

function orderAction(order, action, operationId) {
  if (!order) return;
  const path = `${base()}/orders/${order.id}/actions`;
  const title = {release: `Release ${order.code}`, record: 'Record output', hold: `Put ${order.code} on hold`, resume: `Resume ${order.code}`, quality: `Final inspection · ${order.code}`, complete: `Close ${order.code}`}[action];
  const send = (body, key) => post(path, {action, version: order.version, ...body}, key);

  if (action === 'release') {
    const route = routeOf(order);
    if (!route) { toast('The route for this order is not available.', 'bad'); return; }
    const sections = route.bom.map(b => {
      const need = b.per_unit * order.planned_qty;
      const lots = state.lots.filter(l => l.material === b.material && l.quality === 'released' && l.available > 0).sort((a, c) => a.id - c.id);
      return `<fieldset class="alloc" data-need="${need}"><legend><span class="mono">${esc(b.material)}</span><span class="alloc-need">Need ${fmt(need)} pcs</span></legend>
        <div class="alloc-status" aria-live="polite"></div>
        ${lots.length ? lots.map(l => `<label class="alloc-row"><span><span class="mono">${esc(l.code)}</span><small>${fmt(l.available)} pcs available</small></span><input type="number" name="lot-${l.id}" data-lot="${l.id}" data-avail="${l.available}" min="0" max="${l.available}" step="1" value="0" inputmode="numeric" aria-label="Quantity from lot ${esc(l.code)}"></label>`).join('')
          : `<p class="text-bad">${icon('alert')} No approved lots with stock. Receive and approve a lot first.</p>`}</fieldset>`;
    }).join('');
    formDialog(title, `<p class="muted">Issue exactly ${fmt(order.planned_qty)} × BOM from QC-approved lots.</p><div class="alloc-tools"><button type="button" class="btn btn-secondary btn-sm" id="auto-alloc">${icon('refresh')}<span>Auto-allocate (oldest lots first)</span></button></div>${sections}`,
      'Release order',
      (f, key, form) => send({allocations: $$('[data-lot]', form).map(i => ({lot_id: Number(i.dataset.lot), quantity: Number(i.value) || 0})).filter(x => x.quantity > 0)}, key),
      {size: 'dialog-wide', onMount: form => {
        const submit = $('button[type=submit]', form);
        const update = () => {
          let allOk = true;
          $$('.alloc', form).forEach(fs => {
            const need = Number(fs.dataset.need), got = $$('[data-lot]', fs).reduce((s, i) => s + (Number(i.value) || 0), 0);
            const st = got === need ? ['ok', `${icon('check')} Allocated ${fmt(got)} of ${fmt(need)}`] : got < need ? ['warn', `${icon('alert')} Allocated ${fmt(got)} of ${fmt(need)} · ${fmt(need - got)} short`] : ['bad', `${icon('alert')} Allocated ${fmt(got)} of ${fmt(need)} · ${fmt(got - need)} too many`];
            if (got !== need) allOk = false;
            const el = $('.alloc-status', fs); el.className = `alloc-status text-${st[0]}`; el.innerHTML = st[1];
          });
          submit.disabled = !allOk;
        };
        $('#auto-alloc').onclick = () => {
          $$('.alloc', form).forEach(fs => {
            let left = Number(fs.dataset.need);
            $$('[data-lot]', fs).forEach(i => { const take = Math.min(left, Number(i.dataset.avail)); i.value = take; left -= take; });
          });
          update();
        };
        form.addEventListener('input', update); update();
      }});
  } else if (action === 'record') {
    const i = order.operations.findIndex(op => op.id === operationId), op = order.operations[i];
    if (!op) return;
    const cap = capacityOf(order, i), used = op.good + op.scrap, rem = cap - used;
    formDialog(title,
      `<div class="dialog-summary"><span class="timeline-icon tone-violet">${icon('tool')}</span><div><strong>${esc(op.name)}</strong><small>${esc(order.code)} · ${esc(op.work_center)} · operation ${op.sequence} of ${order.operations.length}</small></div></div>
       <div class="mini-stats"><span>Input<strong>${fmt(cap)}</strong></span><span>Recorded<strong>${fmt(used)}</strong></span><span>Remaining<strong>${fmt(rem)}</strong></span></div>
       <div class="form-grid">${field('Good (pcs)', `<input name="good" type="number" min="0" max="${Math.max(rem, 0)}" step="1" value="0" required inputmode="numeric">`)}${field('Scrap (pcs)', `<input name="scrap" type="number" min="0" max="${Math.max(rem, 0)}" step="1" value="0" required inputmode="numeric">`)}</div>
       ${rem > 0 ? `<button type="button" class="btn btn-ghost btn-sm fill-btn" id="fill-good">${icon('check')}<span>Record all ${fmt(rem)} remaining as good</span></button>` : ''}
       ${field('Scrap reason / notes', '<textarea name="reason" maxlength="500" rows="2" placeholder="Required when scrap is recorded"></textarea>')}
       <label class="check"><input name="finish" type="checkbox" ${rem === 0 ? 'checked' : ''}><span><strong>Finish this operation</strong><small>Moves good units to the next step. Requires the full input to be recorded.</small></span></label>
       <p class="live-summary" aria-live="polite"></p>`,
      'Save record',
      (f, key) => send({operation_id: op.id, good: Number(f.get('good')) || 0, scrap: Number(f.get('scrap')) || 0, finish: f.has('finish'), reason: f.get('reason') || ''}, key),
      {onMount: form => {
        let finishTouched = false;
        form.finish.addEventListener('change', () => { finishTouched = true; update(); });
        const update = () => {
          const g = Number(form.good.value) || 0, s = Number(form.scrap.value) || 0, after = used + g + s;
          form.reason.required = s > 0;
          if (!finishTouched) form.finish.checked = after === cap;
          const msg = $('.live-summary', form);
          if (after > cap) { msg.className = 'live-summary text-bad'; msg.textContent = `Too much: ${fmt(after)} would exceed the input of ${fmt(cap)}.`; }
          else if (form.finish.checked && after < cap) { msg.className = 'live-summary text-warn'; msg.textContent = `${fmt(cap - after)} pcs still unrecorded — the operation can only be finished at ${fmt(cap)}.`; }
          else { msg.className = 'live-summary muted'; msg.textContent = `After saving: ${fmt(after)} of ${fmt(cap)} recorded${form.finish.checked ? ' · operation finished' : ''}.`; }
        };
        $('#fill-good', form)?.addEventListener('click', () => { form.good.value = rem; form.scrap.value = 0; update(); });
        form.addEventListener('input', update); update();
      }});
  } else if (action === 'quality') {
    formDialog(title,
      `<div class="mini-stats"><span>Planned<strong>${fmt(order.planned_qty)}</strong></span><span>Good output<strong>${fmt(lastGood(order))}</strong></span><span>Scrap<strong>${fmt(scrapOf(order))}</strong></span></div>` +
      decisionPicker('decision', [['pass', 'Pass', 'Order can be closed', 'ok'], ['fail', 'Fail', 'Order goes on hold', 'bad']]) +
      field('Inspection notes', '<textarea name="reason" required minlength="3" maxlength="500" rows="3" placeholder="Checks performed, results, report reference…"></textarea>'),
      'Save inspection', (f, key) => send({decision: f.get('decision'), reason: f.get('reason')}, key));
  } else {
    const short = action === 'complete' && lastGood(order) < order.planned_qty;
    const label = action === 'complete' ? 'Closing note' : action === 'hold' ? 'Reason for hold' : 'Corrective action taken';
    const required = action !== 'complete' || short;
    formDialog(title,
      (action === 'complete' ? `<div class="mini-stats"><span>Planned<strong>${fmt(order.planned_qty)}</strong></span><span>Good output<strong>${fmt(lastGood(order))}</strong></span><span>Output lot<strong class="mono">${esc(order.code)}</strong></span></div>` : '') +
      field(label, `<textarea name="reason" ${required ? 'required minlength="3"' : ''} maxlength="500" rows="3"></textarea>`, short ? `Output is ${fmt(order.planned_qty - lastGood(order))} pcs short of plan, so a note is required.` : required ? 'At least 3 characters.' : 'Optional.'),
      {hold: 'Put on hold', resume: 'Resume order', complete: 'Close order'}[action],
      (f, key) => send({reason: f.get('reason') || ''}, key),
      {note: action === 'complete' ? 'A closed order cannot be changed.' : action === 'hold' ? 'Production stops until a quality user resumes the order.' : ''});
  }
}
