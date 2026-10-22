'use strict';
/* MES Operations UI — vanilla JS, no external assets (CSP: default-src 'self').
   UI strings live in i18n.js (MESSAGES). Dynamic widths are applied through the CSSOM (applyWidths)
   because inline style attributes are blocked. */

// ---------- helpers ----------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const ratio = (a, b) => (b > 0 ? clamp((a / b) * 100) : 0);

// ---------- i18n ----------
const LANGS = ['en', 'zh-TW'];
const LOCALES = {en: {number: 'en-US', date: 'en-GB'}, 'zh-TW': {number: 'zh-TW', date: 'zh-TW'}};
function initialLang() {
  try { const saved = localStorage.getItem('mes-lang'); if (LANGS.includes(saved)) return saved; } catch { /* storage unavailable */ }
  return (navigator.languages || [navigator.language]).some(l => /^zh/i.test(l || '')) ? 'zh-TW' : 'en';
}
let lang = initialLang();
const hasKey = key => key in MESSAGES.en;
/* Translate a key. String params are HTML-escaped, so pass raw values; message templates may contain trusted markup. */
function t(key, params = {}) {
  const msg = MESSAGES[lang]?.[key] ?? MESSAGES.en[key] ?? key;
  const safe = {};
  for (const [k, v] of Object.entries(params)) safe[k] = typeof v === 'string' ? esc(v) : v;
  if (typeof msg === 'function') return msg(safe);
  return msg.replace(/\{(\w+)\}/g, (m, k) => (k in safe ? String(safe[k]) : m));
}
const fmt = n => new Intl.NumberFormat(LOCALES[lang].number).format(n ?? 0);

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

const TONES = {queued:'neutral', draft:'neutral', released:'info', in_progress:'violet', on_hold:'warn', completed:'ok', pending:'neutral', pass:'ok', fail:'bad', quarantine:'warn', rejected:'bad', approved:'ok'};
const statusLabel = s => (hasKey(`status.${s}`) ? t(`status.${s}`) : s);
const lotLabel = s => (hasKey(`lot.${s}`) ? t(`lot.${s}`) : s);
const badge = (s, kind = 'order') => {
  const label = kind === 'lot' ? lotLabel(s) : statusLabel(s);
  const tone = kind === 'lot' && s === 'released' ? 'ok' : (TONES[s] || 'neutral');
  return `<span class="badge tone-${tone}"><span class="badge-dot" aria-hidden="true"></span>${esc(label)}</span>`;
};
const EVENTS = {
  'order.created': ['plus', 'neutral'], 'order.release': ['play', 'info'], 'order.record': ['tool', 'violet'],
  'order.hold': ['pause', 'warn'], 'order.resume': ['play', 'info'], 'order.quality': ['shield', 'ok'],
  'order.complete': ['flag', 'ok'], 'route.created': ['routes', 'neutral'], 'lot.received': ['inbox', 'neutral'], 'lot.quality': ['shield', 'ok'],
};
const eventInfo = action => [hasKey(`event.${action}`) ? t(`event.${action}`) : action, ...(EVENTS[action] || ['clock', 'neutral'])];
const entityLabel = e => (hasKey(`entity.${e}`) ? t(`entity.${e}`) : e);

// Backend messages are Vietnamese; show them in the selected UI language.
const SERVER_ERRORS = {
  'Vui lòng đăng nhập': 'signIn',
  'Phiên không hợp lệ': 'sessionInvalid',
  'Phiên đã hết hạn': 'sessionExpired',
  'Tài khoản không hoạt động': 'inactive',
  'Không có quyền truy cập nhà máy': 'noPlantAccess',
  'Không tìm thấy nhà máy': 'plantNotFound',
  'Vai trò không được phép thực hiện thao tác': 'roleNotAllowed',
  'Không tìm thấy lệnh': 'orderNotFound',
  'Cần Idempotency-Key từ 8 đến 80 ký tự': 'idemKeyLength',
  'Idempotency-Key đã dùng cho yêu cầu khác': 'idemKeyReused',
  'Thử đăng nhập quá nhiều. Vui lòng chờ 15 phút.': 'tooManyAttempts',
  'Tên đăng nhập hoặc mật khẩu không đúng': 'badCredentials',
  'Không tìm thấy lô': 'lotNotFound',
  'Lô đã có quyết định chất lượng': 'lotDecided',
  'Lô đã được cập nhật; hãy tải lại': 'lotChanged',
  'Quy trình không thuộc nhà máy': 'routeWrongPlant',
  'Lệnh đã thay đổi. Tải lại rồi thực hiện lại.': 'orderChanged',
  'Lệnh đã đóng, không thể sửa': 'orderClosed',
  'Chỉ phát hành lệnh nháp': 'releaseDraftOnly',
  'Không được chọn lặp lô': 'duplicateLot',
  'Lô không thuộc nhà máy': 'lotWrongPlant',
  'Vật tư không thuộc BOM': 'materialNotInBom',
  'Lô chưa được QC duyệt hoặc không đủ tồn kho': 'lotNotAvailable',
  'Cấp vật tư phải đúng định mức BOM × số lượng kế hoạch': 'allocationMismatch',
  'Lệnh chưa sẵn sàng hoặc đang bị giữ': 'orderNotRunnable',
  'Công đoạn không thuộc lệnh': 'operationWrongOrder',
  'Công đoạn đã hoàn tất': 'operationDone',
  'Phải hoàn tất công đoạn trước': 'previousOperation',
  'Chưa có sản lượng để ghi nhận': 'nothingToRecord',
  'Cần lý do phế phẩm': 'scrapReason',
  'Sản lượng vượt số lượng đầu vào': 'outputExceedsInput',
  'Phải ghi nhận đủ số lượng đầu vào trước khi kết thúc công đoạn': 'finishNeedsFullInput',
  'Không thể giữ lệnh ở trạng thái này': 'cannotHold',
  'Cần lý do giữ lệnh': 'holdReason',
  'Lệnh không bị giữ': 'notOnHold',
  'Cần lý do xử lý và cho chạy lại': 'resumeReason',
  'Chỉ kiểm tra cuối khi mọi công đoạn hoàn tất và lệnh không bị giữ': 'qcNotReady',
  'Cần kết quả và biên bản kiểm tra': 'qcReason',
  'Cần hoàn tất các công đoạn và QC đạt trước khi đóng': 'closeNotReady',
  'Cần lý do đóng lệnh thiếu sản lượng': 'closeShortReason',
  'Dữ liệu trùng hoặc xung đột. Tải lại trước khi thử lại.': 'conflict',
};
const translate = msg => (SERVER_ERRORS[String(msg).trim()] ? t(`err.${SERVER_ERRORS[String(msg).trim()]}`) : msg);

// ---------- state ----------
const state = {
  token: null, username: '', plants: [], plant: null, page: 'overview', detail: null,
  orders: [], routes: [], lots: [], audit: [], auditDone: false, loadedPlant: null,
  filters: {orderState: '', orderQ: '', lotQuality: '', lotQ: '', auditType: '', auditQ: ''},
};
let loadGeneration = 0;
const can = (...roles) => state.plant?.role === 'admin' || roles.includes(state.plant?.role);
const base = () => `/api/plants/${state.plant.id}`;
const NAV = [['overview', 'overview'], ['orders', 'orders'], ['lots', 'lots'], ['routes', 'routes'], ['audit', 'audit']];

// ---------- time ----------
const parseTime = v => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(v) ? v : v + 'Z');
const tz = () => state.plant?.timezone || 'UTC';
const dateLocale = () => LOCALES[lang].date;
const time = v => new Intl.DateTimeFormat(dateLocale(), {year: 'numeric', month: lang === 'en' ? 'short' : '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz()}).format(parseTime(v));
const clock = v => new Intl.DateTimeFormat(dateLocale(), {hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz()}).format(parseTime(v));
const dayKey = d => new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz()}).format(d);
function dayLabel(v) {
  const d = parseTime(v), key = dayKey(d);
  if (key === dayKey(new Date())) return t('time.today');
  if (key === dayKey(new Date(Date.now() - 864e5))) return t('time.yesterday');
  return new Intl.DateTimeFormat(dateLocale(), {weekday: 'short', day: 'numeric', month: lang === 'en' ? 'short' : 'long', year: 'numeric', timeZone: tz()}).format(d);
}
function relative(v) {
  const s = (Date.now() - parseTime(v).getTime()) / 1000;
  if (s < 60) return t('time.justNow');
  if (s < 3600) return t('time.minutesAgo', {n: Math.floor(s / 60)});
  if (s < 86400) return t('time.hoursAgo', {n: Math.floor(s / 3600)});
  return time(v);
}

// ---------- api ----------
async function api(path, options = {}) {
  const headers = {'Content-Type': 'application/json', ...(state.token ? {Authorization: `Bearer ${state.token}`} : {}), ...options.headers};
  let response;
  try { response = await fetch(path, {...options, headers}); }
  catch { throw new Error(t('err.network')); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') logoutLocal();
    const detail = Array.isArray(data.detail)
      ? data.detail.map(x => `${(x.loc || []).slice(1).join('.') || 'input'}: ${x.msg}`).join('; ')
      : translate(data.detail);
    throw new Error(detail || t('err.status', {status: response.status}));
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
// Operations use their own wording ("finished" vs an order being "closed").
const opBadge = st => `<span class="badge tone-${TONES[st] || 'neutral'}"><span class="badge-dot" aria-hidden="true"></span>${esc(t(`opStatus.${st}`))}</span>`;
const qualityBadge = o => (o.quality !== 'pending' || phaseOf(o) === 'qc' ? badge(o.quality) : `<span class="muted-dash" aria-label="${t('orders.notInspected')}">—</span>`);

// ---------- ui primitives ----------
function applyWidths(root = document) { $$('[data-w]', root).forEach(el => { el.style.width = `${clamp(Number(el.dataset.w) || 0)}%`; }); }
const bar = (pct, tone = 'info', label = '') => `<span class="bar" role="img" aria-label="${label || `${Math.round(pct)}%`}"><span class="bar-fill tone-${tone}" data-w="${pct}"></span></span>`;
const btn = (label, attrs = '', cls = 'btn-secondary', ic = '') => `<button type="button" class="btn ${cls}" ${attrs}>${ic ? icon(ic) : ''}<span>${label}</span></button>`;
const empty = (title, text = '', action = '', ic = 'inbox') => `<div class="empty">${icon(ic, 'empty-icon')}<p class="empty-title">${title}</p>${text ? `<p class="empty-text">${text}</p>` : ''}${action}</div>`;
function pageHead(title, subtitle = '', actions = '') {
  return `<div class="page-head"><div class="page-title"><p class="eyebrow">${esc(state.plant.code)} · ${esc(state.plant.name)}</p><h1>${title}</h1>${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
const panel = (title, body, extra = '', cls = '') => `<section class="panel ${cls}"><div class="panel-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
const newOrderBtn = () => (can('planner') ? btn(t('orders.new'), 'data-cmd="new-order"', 'btn-primary', 'plus') : '');
let toastTimer;
function toast(message, tone = 'ok') {
  const el = $('#toast');
  el.className = `toast tone-${tone}`;
  el.innerHTML = `${icon(tone === 'ok' ? 'check' : 'alert')}<span>${esc(message)}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, tone === 'ok' ? 3500 : 6000);
}
function setLoading(on) { $('#loading-bar').hidden = !on; }

// ---------- static text, language & theme ----------
function applyStatic() {
  document.documentElement.lang = lang;
  document.title = t('app.title');
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  $$('[data-i18n-attr]').forEach(el => el.dataset.i18nAttr.split(';').forEach(pair => {
    const [attr, key] = pair.split(':');
    el.setAttribute(attr, t(key));
  }));
  $$('.lang-select').forEach(s => { s.value = lang; });
}
function setLang(next) {
  if (!LANGS.includes(next) || next === lang) { $$('.lang-select').forEach(s => { s.value = lang; }); return; }
  lang = next;
  try { localStorage.setItem('mes-lang', lang); } catch { /* storage unavailable */ }
  if ($('#dialog').open) $('#dialog').close();
  $('#login-error').textContent = '';
  applyStatic(); renderNav(); applyTheme(document.documentElement.dataset.theme);
  if (!$('#workspace').hidden) {
    if (!state.plant) renderNoPlant();
    else if (state.loadedPlant === state.plant.id) render();
    else updateChrome();
  }
}
document.addEventListener('change', event => { if (event.target.matches('.lang-select')) setLang(event.target.value); });
// The top-bar selector uses short labels on phones so the plant picker keeps its room.
const narrow = matchMedia('(max-width: 760px)');
function syncLangLabels() {
  const labels = narrow.matches ? {en: 'EN', 'zh-TW': '中文'} : {en: 'English', 'zh-TW': '繁體中文'};
  $$('.topbar .lang-select option').forEach(o => { o.textContent = labels[o.value]; });
}
narrow.addEventListener('change', syncLangLabels);

function storedTheme() { try { return localStorage.getItem('mes-theme'); } catch { return null; } }
function effectiveTheme() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  const dark = effectiveTheme() === 'dark';
  $('#theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#theme-toggle').setAttribute('aria-label', t(dark ? 'theme.toLight' : 'theme.toDark'));
  $('#theme-toggle').title = t(dark ? 'theme.light' : 'theme.dark');
}
$('#theme-toggle').onclick = () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('mes-theme', next); } catch { /* storage unavailable */ }
  applyTheme(next);
};

// ---------- shell ----------
function renderNav() {
  $('#nav').innerHTML = NAV.map(([page, ic]) => `<button type="button" class="nav-item" data-cmd="go" data-page="${page}" aria-label="${t(`nav.${page}`)}" title="${t(`nav.${page}`)}">${icon(ic)}<span class="nav-label">${t(`nav.${page}`)}</span><span class="nav-short">${t(`nav.${page}.short`)}</span><span class="nav-count" data-count="${page}" hidden></span></button>`).join('');
  updateChrome();
}
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
    $('#user-role').textContent = hasKey(`role.${state.plant.role}`) ? t(`role.${state.plant.role}`) : state.plant.role;
    $('#user-avatar').textContent = (state.username || '?').slice(0, 2).toUpperCase();
    $('#plant-select').value = String(state.plant.id);
  }
}
function renderNoPlant() { $('#content').innerHTML = empty(t('shell.noPlant.title'), t('shell.noPlant.text'), '', 'alert'); }

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
    const data = await post('/api/login', {username: form.username.value, password: form.password.value});
    state.token = data.token; state.username = data.username;
    state.plants = await api('/api/plants');
    $('#plant-select').innerHTML = state.plants.map(p => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join('');
    state.plant = state.plants[0] || null; state.page = 'overview'; state.detail = null;
    $('#login-screen').hidden = true; $('#workspace').hidden = false; form.reset();
    if (!state.plant) { renderNoPlant(); return; }
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
  return `<div class="skeleton-page" aria-busy="true" aria-label="${t('shell.loading')}"><div class="sk sk-title"></div><div class="kpis">${'<div class="sk sk-card"></div>'.repeat(4)}</div><div class="sk sk-panel"></div></div>`;
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
    if (switching) $('#content').innerHTML = `<div class="callout tone-bad">${icon('alert')}<div><strong>${t('shell.loadFailed')}</strong><p>${esc(error.message)}</p></div>${btn(t('common.tryAgain'), 'data-cmd="refresh"')}</div>`;
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
    ${kpi(t('kpi.active'), fmt(active.length), t('kpi.active.foot', {running: fmt(by('in_progress').length), released: fmt(by('released').length)}), 'orders', 'accent')}
    ${kpi(t('kpi.good'), fmt(goodOut), plannedClosed ? t('kpi.good.foot', {pct: ratio(goodOut, plannedClosed).toFixed(1), n: closed.length}) : t('kpi.good.none'), 'box')}
    ${kpi(t('kpi.scrap'), scrapRate === null ? '—' : `${scrapRate.toFixed(1)}%`, t('kpi.scrap.foot', {scrap: fmt(scrap), total: fmt(good + scrap)}), 'gauge', scrapRate > 5 ? 'warn' : '')}
    ${kpi(t('kpi.hold'), fmt(held.length), held.length ? t('kpi.hold.some') : t('kpi.hold.none'), 'pause', held.length ? 'warn' : '')}
  </div>`;

  // status distribution
  const states = ['draft', 'released', 'in_progress', 'on_hold', 'completed'];
  const counts = states.map(s => [s, by(s).length]);
  const statusBody = orders.length
    ? `<div class="panel-body"><div class="stack" role="img" aria-label="${t('overview.byStatus')}">${counts.filter(([, n]) => n).map(([s, n]) => `<span class="stack-seg tone-${TONES[s]}" data-w="${(n / orders.length) * 100}" title="${statusLabel(s)}: ${n}"></span>`).join('')}</div>
       <ul class="legend">${counts.map(([s, n]) => `<li><button type="button" class="legend-item" data-cmd="go" data-page="orders" data-state="${s}"><span class="legend-swatch tone-${TONES[s]}"></span><span>${statusLabel(s)}</span><strong>${fmt(n)}</strong><small>${orders.length ? Math.round((n / orders.length) * 100) : 0}%</small></button></li>`).join('')}</ul></div>`
    : empty(t('orders.empty.title'), t('orders.empty.text'), newOrderBtn());

  // needs attention
  const attn = [];
  held.forEach(o => attn.push({tone: 'warn', ic: 'pause', title: t('attn.hold', {code: o.code}), text: o.hold_reason ? esc(o.hold_reason) : t('attn.hold.text'), cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  awaitingQC.forEach(o => attn.push({tone: 'info', ic: 'shield', title: t('attn.qc', {code: o.code}), text: t('attn.qc.text', {n: o.operations.length}), cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  readyClose.forEach(o => attn.push({tone: 'ok', ic: 'flag', title: t('attn.close', {code: o.code}), text: t('attn.close.text', {good: fmt(lastGood(o))}), cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  drafts.slice(0, 3).forEach(o => attn.push({tone: 'neutral', ic: 'play', title: t('attn.draft', {code: o.code}), text: t('attn.draft.text', {product: o.product, qty: fmt(o.planned_qty)}), cmd: `data-cmd="open-order" data-id="${o.id}"`}));
  if (quarantine.length) attn.push({tone: 'warn', ic: 'lots', title: t('attn.quarantine', {n: quarantine.length}), text: t('attn.quarantine.text'), cmd: 'data-cmd="go" data-page="lots" data-filter="quarantine"'});
  const attnBody = attn.length
    ? `<ul class="attn-list">${attn.slice(0, 7).map(a => `<li><button type="button" class="attn-item" ${a.cmd}><span class="attn-icon tone-${a.tone}">${icon(a.ic)}</span><span class="attn-text"><strong>${a.title}</strong><small>${a.text}</small></span>${icon('chevR', 'chev')}</button></li>`).join('')}</ul>`
    : empty(t('attn.clear.title'), t('attn.clear.text'), '', 'check');

  // WIP
  const wip = active.slice(0, 6);
  const wipBody = wip.length
    ? `<ul class="wip-list">${wip.map(o => {
        const i = currentOpIndex(o), op = o.operations[i], p = orderProgress(o);
        const where = op ? `${esc(op.name)} · ${esc(op.work_center)}` : t('wip.allDone');
        const step = op ? i + 1 : o.operations.length;
        return `<li><button type="button" class="wip-item" data-cmd="open-order" data-id="${o.id}"><span class="wip-main"><strong>${esc(o.code)}</strong><small>${esc(o.product)} · ${where}</small></span><span class="wip-progress">${bar(p, 'violet', t('wip.complete', {pct: Math.round(p)}))}<small>${t('wip.step', {step, total: o.operations.length, pct: Math.round(p)})}</small></span>${badge(o.state)}</button></li>`;
      }).join('')}</ul>`
    : empty(t('wip.empty.title'), t('wip.empty.text'), '', 'tool');

  // material availability
  const mats = {};
  state.lots.forEach(l => {
    const m = mats[l.material] ||= {approved: 0, quarantine: 0};
    if (l.quality === 'released') m.approved += l.available;
    if (l.quality === 'quarantine') m.quarantine += l.available;
  });
  const matRows = Object.entries(mats).sort((a, b) => a[0].localeCompare(b[0]));
  const maxMat = Math.max(1, ...matRows.map(([, m]) => m.approved + m.quarantine));
  const matBody = matRows.length
    ? `<div class="panel-body"><ul class="mat-list">${matRows.map(([name, m]) => `<li><div class="mat-head"><strong>${esc(name)}</strong><span>${t('mat.available', {n: fmt(m.approved)})}${m.quarantine ? ` · <span class="text-warn">${t('mat.inQc', {n: fmt(m.quarantine)})}</span>` : ''}</span></div><span class="stack stack-thin" role="img" aria-label="${t('mat.aria', {name, approved: fmt(m.approved), quarantine: fmt(m.quarantine)})}"><span class="stack-seg tone-ok" data-w="${(m.approved / maxMat) * 100}"></span><span class="stack-seg tone-warn" data-w="${(m.quarantine / maxMat) * 100}"></span></span></li>`).join('')}</ul><div class="legend legend-inline"><span><span class="legend-swatch tone-ok"></span>${t('mat.legend.approved')}</span><span><span class="legend-swatch tone-warn"></span>${t('mat.legend.quarantine')}</span></div></div>`
    : empty(t('mat.empty.title'), t('mat.empty.text'), '', 'lots');

  const actBody = state.audit.length ? timeline(state.audit.slice(0, 6), {compact: true}) : empty(t('audit.empty'), '', '', 'audit');

  $('#content').innerHTML =
    pageHead(t('overview.title'), t('overview.subtitle', {tz: tz()}), btn(t('common.refresh'), 'data-cmd="refresh"', 'btn-secondary', 'refresh') + newOrderBtn()) +
    kpis +
    `<div class="grid grid-2">${panel(t('overview.byStatus'), statusBody, `<button type="button" class="link-btn" data-cmd="go" data-page="orders">${t('common.viewAll')} ${icon('chevR')}</button>`)}${panel(t('overview.attention'), attnBody, attn.length ? `<span class="count-pill">${attn.length}</span>` : '')}</div>` +
    `<div class="grid grid-wide">${panel(t('overview.wip'), wipBody, `<span class="panel-meta">${t('overview.activeCount', {n: fmt(active.length)})}</span>`)}${panel(t('overview.materials'), matBody, `<button type="button" class="link-btn" data-cmd="go" data-page="lots">${t('nav.lots')} ${icon('chevR')}</button>`)}</div>` +
    panel(t('overview.activity'), actBody, `<button type="button" class="link-btn" data-cmd="go" data-page="audit">${t('overview.fullLog')} ${icon('chevR')}</button>`);
}

// ----- orders -----
function renderOrders() {
  $('#content').innerHTML =
    pageHead(t('nav.orders'), t('orders.subtitle'), newOrderBtn()) +
    `<section class="panel"><div class="panel-toolbar"><div class="chips" id="order-chips" role="group" aria-label="${t('orders.filterAria')}"></div><label class="search">${icon('search')}<span class="sr-only">${t('orders.search')}</span><input id="order-search" type="search" placeholder="${t('orders.search')}" value="${esc(state.filters.orderQ)}"></label></div><div id="order-list"></div></section>`;
  renderOrderRows();
}
function renderOrderRows() {
  const states = ['', 'draft', 'released', 'in_progress', 'on_hold', 'completed'];
  const count = s => (s ? state.orders.filter(o => o.state === s).length : state.orders.length);
  $('#order-chips').innerHTML = states.map(s => `<button type="button" class="chip ${state.filters.orderState === s ? 'active' : ''}" aria-pressed="${state.filters.orderState === s}" data-cmd="order-filter" data-value="${s}">${s ? statusLabel(s) : t('common.all')}<span>${count(s)}</span></button>`).join('');
  const q = state.filters.orderQ.trim().toLowerCase();
  const rows = state.orders.filter(o => (!state.filters.orderState || o.state === state.filters.orderState) && `${o.code} ${o.product}`.toLowerCase().includes(q));
  $('#order-list').innerHTML = rows.length ? orderTable(rows) : (state.orders.length
    ? empty(t('orders.noMatch.title'), t('orders.noMatch.text'), '', 'search')
    : empty(t('orders.empty.title'), t('orders.empty.text'), newOrderBtn()));
  applyWidths($('#order-list'));
}
function orderTable(rows) {
  const col = k => t(`orders.col.${k}`);
  return `<div class="table-wrap"><table class="table table-cards"><thead><tr><th>${col('order')}</th><th>${col('product')}</th><th class="num">${col('planned')}</th><th>${col('progress')}</th><th>${col('status')}</th><th>${col('quality')}</th><th><span class="sr-only">${t('common.open')}</span></th></tr></thead><tbody>${rows.map(o => {
    const done = o.operations.filter(x => x.done).length, p = orderProgress(o);
    return `<tr class="row-link" data-cmd="open-order" data-id="${o.id}" tabindex="0" aria-label="${t('orders.openAria', {code: o.code})}">
      <td data-label="${col('order')}" data-col="order"><span class="cell-main mono">${esc(o.code)}</span><span class="cell-sub">${time(o.created_at)}</span></td>
      <td data-label="${col('product')}"><span class="cell-main">${esc(o.product)}</span><span class="cell-sub">${t('common.revision', {rev: o.revision})}</span></td>
      <td data-label="${col('planned')}" class="num"><span class="cell-main">${fmt(o.planned_qty)}</span><span class="cell-sub">${t('common.pcs')}</span></td>
      <td data-label="${col('progress')}"><div class="progress-cell">${bar(p, o.state === 'on_hold' ? 'warn' : o.state === 'completed' ? 'ok' : 'violet')}<span class="cell-sub">${t('orders.opsDone', {done, total: o.operations.length})}</span></div></td>
      <td data-label="${col('status')}">${badge(o.state)}</td>
      <td data-label="${col('quality')}">${qualityBadge(o)}</td>
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
  const steps = ['draft', 'released', 'production', 'qc', 'closed'];
  const anyRecorded = o.operations.some(op => op.good + op.scrap > 0);
  const allDone = o.operations.every(op => op.done);
  const idx = {draft: 0, released: 1, production: 2, qc: 3, close: 4, closed: 5, hold: allDone ? 3 : anyRecorded ? 2 : 1}[phase];
  const stepper = `<ol class="stepper" aria-label="${t('detail.lifecycle')}">${steps.map((s, i) => {
    const st = i < idx ? 'done' : i === idx ? (phase === 'hold' ? 'hold' : 'current') : 'todo';
    return `<li class="step-${st}" ${st === 'current' || st === 'hold' ? 'aria-current="step"' : ''}><span class="stepper-dot">${st === 'done' ? icon('check') : st === 'hold' ? icon('pause') : i + 1}</span><span class="stepper-label">${t(`step.${s}`)}</span></li>`;
  }).join('')}</ol>`;

  // next step callout
  const cur = currentOpIndex(o), curOp = o.operations[cur];
  let next;
  if (phase === 'draft') next = {tone: 'info', ic: 'play', title: t('next.release.title'), text: t('next.release.text'), action: can('planner') ? btn(t('next.release.action'), 'data-cmd="order-action" data-action="release"', 'btn-primary', 'play') : '', wait: t('next.release.wait')};
  else if (phase === 'released' || phase === 'production') {
    const capCur = capacityOf(o, cur), rem = capCur - curOp.good - curOp.scrap;
    next = {tone: 'violet', ic: 'tool', title: t('next.record.title', {name: curOp.name}), text: t('next.record.text', {wc: curOp.work_center, rem: fmt(rem), cap: fmt(capCur)}), action: can('operator') ? btn(t('next.record.action'), `data-cmd="order-action" data-action="record" data-id="${curOp.id}"`, 'btn-primary', 'tool') : '', wait: t('next.record.wait')};
  } else if (phase === 'qc') next = {tone: 'info', ic: 'shield', title: t('next.qc.title'), text: t('next.qc.text'), action: can('quality') ? btn(t('next.qc.action'), 'data-cmd="order-action" data-action="quality"', 'btn-primary', 'shield') : '', wait: t('next.qc.wait')};
  else if (phase === 'close') next = {tone: 'ok', ic: 'flag', title: t('next.close.title'), text: t('next.close.text', {good: fmt(good), code: o.code}), action: can('planner') ? btn(t('next.close.action'), 'data-cmd="order-action" data-action="complete"', 'btn-primary', 'flag') : '', wait: t('next.close.wait')};
  else if (phase === 'hold') next = {tone: 'warn', ic: 'pause', title: t('next.hold.title'), text: t('next.hold.text', {reason: o.hold_reason || '—'}), action: can('quality') ? btn(t('next.hold.action'), 'data-cmd="order-action" data-action="resume"', 'btn-primary', 'play') : '', wait: t('next.hold.wait')};
  else next = {tone: 'ok', ic: 'check', title: t('next.closed.title'), text: t('next.closed.text', {code: o.code, good: fmt(good), planned: fmt(o.planned_qty)}), action: btn(t('next.closed.action'), 'data-cmd="trace"', 'btn-secondary', 'link'), wait: ''};
  const callout = `<div class="callout tone-${next.tone}">${icon(next.ic)}<div><strong>${next.title}</strong><p>${next.text}${!next.action && next.wait ? ` <em>${next.wait}</em>` : ''}</p></div>${next.action}</div>`;

  const pcs = `<small>${t('common.pcs')}</small>`;
  const stat = (label, value, sub = '') => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
  const stats = `<div class="stats">${stat(t('detail.planned'), `${fmt(o.planned_qty)} ${pcs}`)}${stat(t('detail.good'), `${fmt(good)} ${pcs}`, t('detail.ofPlan', {pct: ratio(good, o.planned_qty).toFixed(0)}))}${stat(t('detail.scrap'), `${fmt(scrap)} ${pcs}`, scrap ? t('detail.scrapAll') : '')}${stat(t('detail.created'), `<span class="stat-date">${time(o.created_at)}</span>`)}</div>`;

  const ops = o.operations.map((op, i) => {
    const cap = capacityOf(o, i), used = op.good + op.scrap, prevDone = i === 0 || o.operations[i - 1].done;
    const enabled = ['released', 'in_progress'].includes(o.state) && !op.done && prevDone && can('operator');
    const st = op.done ? 'completed' : used > 0 ? 'in_progress' : 'queued';
    const projected = i > 0 && !o.operations[i - 1].done;
    const figures = projected && used === 0
      ? `<div class="op-figures"><span>${t('op.waits', {name: o.operations[i - 1].name})}</span></div>`
      : `<div class="op-figures"><span><i class="legend-swatch tone-ok"></i>${t('op.good')} <strong>${fmt(op.good)}</strong></span><span><i class="legend-swatch tone-bad"></i>${t('op.scrap')} <strong>${fmt(op.scrap)}</strong></span><span>${t('op.input')} <strong>${fmt(cap)}</strong></span><span>${t('op.remaining')} <strong>${fmt(Math.max(cap - used, 0))}</strong></span></div>`;
    return `<li class="op op-${st}"><span class="op-num" aria-hidden="true">${op.done ? icon('check') : op.sequence}</span>
      <div class="op-body"><div class="op-head"><div><strong>${esc(op.name)}</strong><small>${esc(op.work_center)}</small></div>${opBadge(st)}</div>
      <span class="stack" role="img" aria-label="${t('op.aria', {good: fmt(op.good), scrap: fmt(op.scrap), input: fmt(cap)})}"><span class="stack-seg tone-ok" data-w="${cap ? (op.good / cap) * 100 : 0}"></span><span class="stack-seg tone-bad" data-w="${cap ? (op.scrap / cap) * 100 : 0}"></span></span>
      ${figures}</div>
      ${enabled ? btn(t('op.record'), `data-cmd="order-action" data-action="record" data-id="${op.id}"`, i === cur ? 'btn-primary btn-sm' : 'btn-secondary btn-sm', 'tool') : ''}</li>`;
  }).join('');

  const headActions = (canHold ? btn(t('detail.hold'), 'data-cmd="order-action" data-action="hold"', 'btn-secondary', 'pause') : '') + btn(t('detail.trace'), 'data-cmd="trace"', 'btn-secondary', 'link');
  const subtitle = `${esc(o.product)} · ${t('common.revision', {rev: o.revision})}${route ? ` · ${esc(route.name)}` : ''}`;
  $('#content').innerHTML =
    `<button type="button" class="back-link" data-cmd="back">${icon('chevL')}${t('nav.orders')}</button>` +
    pageHead(`<span class="mono">${esc(o.code)}</span> ${badge(o.state)} ${o.quality !== 'pending' || phase === 'qc' ? badge(o.quality) : ''}`, subtitle, headActions) +
    stepper + callout + stats +
    panel(t('detail.operations'), `<ol class="op-list">${ops}</ol><p class="panel-note">${t('detail.opsNote')}</p>`, `<span class="panel-meta">${t('detail.opsFinished', {done: o.operations.filter(x => x.done).length, total: o.operations.length})}</span>`);
  applyWidths($('#content'));
}

// ----- materials -----
function renderLots() {
  $('#content').innerHTML =
    pageHead(t('nav.lots'), t('lots.subtitle'), can('planner') ? btn(t('lots.receive'), 'data-cmd="new-lot"', 'btn-primary', 'plus') : '') +
    `<section class="panel"><div class="panel-toolbar"><div class="chips" id="lot-chips" role="group" aria-label="${t('lots.filterAria')}"></div><label class="search">${icon('search')}<span class="sr-only">${t('lots.search')}</span><input id="lot-search" type="search" placeholder="${t('lots.search')}" value="${esc(state.filters.lotQ)}"></label></div><div id="lot-list"></div></section>`;
  renderLotRows();
}
function renderLotRows() {
  const opts = ['', 'quarantine', 'released', 'rejected'];
  const count = s => (s ? state.lots.filter(l => l.quality === s).length : state.lots.length);
  $('#lot-chips').innerHTML = opts.map(s => `<button type="button" class="chip ${state.filters.lotQuality === s ? 'active' : ''}" aria-pressed="${state.filters.lotQuality === s}" data-cmd="lot-filter" data-value="${s}">${s ? lotLabel(s) : t('common.all')}<span>${count(s)}</span></button>`).join('');
  const q = state.filters.lotQ.trim().toLowerCase();
  const rows = state.lots.filter(l => (!state.filters.lotQuality || l.quality === state.filters.lotQuality) && `${l.code} ${l.material}`.toLowerCase().includes(q));
  const col = k => t(`lots.col.${k}`);
  $('#lot-list').innerHTML = rows.length
    ? `<div class="table-wrap"><table class="table table-cards"><thead><tr><th>${col('lot')}</th><th>${col('material')}</th><th class="num">${col('received')}</th><th>${col('available')}</th><th>${col('quality')}</th><th><span class="sr-only">${t('common.actions')}</span></th></tr></thead><tbody>${rows.map(l => `<tr>
        <td data-label="${col('lot')}"><span class="cell-main mono">${esc(l.code)}</span></td>
        <td data-label="${col('material')}"><span class="cell-main">${esc(l.material)}</span></td>
        <td data-label="${col('received')}" class="num">${fmt(l.received)} <span class="cell-sub-inline">${esc(l.unit)}</span></td>
        <td data-label="${col('available')}"><div class="progress-cell">${bar(ratio(l.available, l.received), l.quality === 'released' ? 'ok' : l.quality === 'rejected' ? 'bad' : 'warn', t('lots.availAria', {available: fmt(l.available), received: fmt(l.received)}))}<span class="cell-sub">${t('lots.left', {n: fmt(l.available), unit: l.unit})}</span></div></td>
        <td data-label="${col('quality')}">${badge(l.quality, 'lot')}</td>
        <td class="cell-actions">${l.quality === 'quarantine' && can('quality') ? btn(t('lots.inspect'), `data-cmd="lot-qc" data-id="${l.id}"`, 'btn-primary btn-sm', 'shield') : ''}${btn(t('lots.whereUsed'), `data-cmd="where-used" data-id="${l.id}"`, 'btn-ghost btn-sm', 'link')}</td></tr>`).join('')}</tbody></table></div>`
    : (state.lots.length ? empty(t('lots.noMatch.title'), t('lots.noMatch.text'), '', 'search')
      : empty(t('lots.empty.title'), t('lots.empty.text'), can('planner') ? btn(t('lots.receive'), 'data-cmd="new-lot"', 'btn-primary', 'plus') : '', 'lots'));
  applyWidths($('#lot-list'));
}

// ----- routes -----
function renderRoutes() {
  const groups = {};
  state.routes.forEach(r => (groups[r.product] ||= []).push(r));
  const newRev = can('planner') ? btn(t('routes.new'), 'data-cmd="new-route"', 'btn-primary', 'plus') : '';
  const cards = Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([product, revs]) => revs.sort((a, b) => b.revision - a.revision).map((r, k) => `
    <section class="panel route">
      <div class="panel-head"><div><h2>${esc(product)} <span class="rev">${t('routes.rev', {rev: r.revision})}</span>${k === 0 && revs.length > 1 ? `<span class="badge tone-info"><span class="badge-dot"></span>${t('routes.latest')}</span>` : ''}</h2><p class="panel-sub">${esc(r.name)} · ${t('routes.counts', {ops: r.steps.length, mats: r.bom.length})}</p></div><span class="badge tone-neutral"><span class="badge-dot"></span>${t('routes.locked')}</span></div>
      <div class="panel-body route-body">
        <div><h3 class="section-label">${t('routes.sequence')}</h3><ol class="flow">${r.steps.map((s, i) => `<li><span class="flow-num">${i + 1}</span><span><strong>${esc(s.name)}</strong><small>${esc(s.work_center)}</small></span></li>`).join('')}</ol></div>
        <div><h3 class="section-label">${t('routes.bom')}</h3><table class="table table-compact"><tbody>${r.bom.map(b => `<tr><td class="mono">${esc(b.material)}</td><td class="num"><strong>${fmt(b.per_unit)}</strong> ${esc(b.unit)}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </section>`).join('')).join('');
  $('#content').innerHTML = pageHead(t('nav.routes'), t('routes.subtitle'), newRev) + (cards || empty(t('routes.empty.title'), t('routes.empty.text'), newRev, 'routes'));
}

// ----- audit -----
function timeline(items, {compact = false, details = true} = {}) {
  let lastDay = '';
  return `<ol class="timeline ${compact ? 'timeline-compact' : ''}">${items.map(a => {
    const [label, ic, tone] = eventInfo(a.action), day = dayLabel(a.at);
    const header = !compact && day !== lastDay ? `<li class="timeline-day">${esc(day)}</li>` : '';
    lastDay = day;
    return `${header}<li class="timeline-item"><span class="timeline-icon tone-${tone}">${icon(ic)}</span><div class="timeline-body"><div><strong>${esc(label)}</strong><small>${esc(a.actor)} · ${esc(entityLabel(a.entity))} #${a.entity_id}</small></div><div class="timeline-meta"><time title="${time(a.at)}">${compact ? relative(a.at) : clock(a.at)}</time>${!compact && details ? `<button type="button" class="btn btn-ghost btn-sm" data-cmd="audit-view" data-id="${a.id}">${icon('eye')}<span>${t('common.details')}</span></button>` : ''}</div></div></li>`;
  }).join('')}</ol>`;
}
function renderAudit() {
  $('#content').innerHTML =
    pageHead(t('nav.audit'), t('audit.subtitle', {tz: tz()})) +
    `<section class="panel"><div class="panel-toolbar"><div class="chips" id="audit-chips" role="group" aria-label="${t('audit.filterAria')}"></div><label class="search">${icon('search')}<span class="sr-only">${t('audit.search')}</span><input id="audit-search" type="search" placeholder="${t('audit.search')}" value="${esc(state.filters.auditQ)}"></label></div><div id="audit-list" class="panel-body"></div></section>`;
  renderAuditList();
}
function renderAuditList() {
  const types = [['', t('common.all')], ['order', t('audit.type.order')], ['lot', t('audit.type.lot')], ['route', t('audit.type.route')]];
  $('#audit-chips').innerHTML = types.map(([v, l]) => `<button type="button" class="chip ${state.filters.auditType === v ? 'active' : ''}" aria-pressed="${state.filters.auditType === v}" data-cmd="audit-filter" data-value="${v}">${l}</button>`).join('');
  const q = state.filters.auditQ.trim().toLowerCase();
  const items = state.audit.filter(a => (!state.filters.auditType || a.entity === state.filters.auditType) && `${a.actor} ${a.entity} ${entityLabel(a.entity)} ${a.entity_id} ${eventInfo(a.action)[0]}`.toLowerCase().includes(q));
  $('#audit-list').innerHTML = (items.length ? timeline(items) : empty(state.audit.length ? t('audit.noMatch') : t('audit.empty'), '', '', 'audit')) +
    (!state.auditDone ? `<div class="load-more">${btn(t('audit.loadMore'), 'data-cmd="audit-more"', 'btn-secondary')}</div>` : '');
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
  showDialog(label, `<div class="dialog-summary"><span class="timeline-icon tone-${tone}">${icon(ic)}</span><div><strong>${esc(a.actor)}</strong><small>${time(a.at)} · ${esc(entityLabel(a.entity))} #${a.entity_id}</small></div></div><h3 class="section-label">${t('audit.payload')}</h3><pre class="code-block">${esc(JSON.stringify(a.payload, null, 2))}</pre>`);
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
  showDialog(title, `<form id="modal-form" novalidate>${fields}${note ? `<p class="form-note">${note}</p>` : ''}<p class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button class="btn btn-primary" type="submit">${submitLabel}</button></div></form>`, size);
  const form = $('#modal-form'), key = crypto.randomUUID();
  $('[data-close]', form).onclick = () => $('#dialog').close();
  onMount?.(form);
  form.querySelector('input:not([type=hidden]):not([readonly]),select,textarea')?.focus();
  form.onsubmit = async event => {
    event.preventDefault();
    const button = $('button[type=submit]', form), error = $('.form-error', form);
    error.textContent = '';
    if (!form.checkValidity()) { form.reportValidity(); return; }
    button.disabled = true; button.classList.add('is-busy');
    try {
      await onSubmit(new FormData(form), key, form);
      $('#dialog').close(); toast(t('common.saved')); await load();
    } catch (e) { error.textContent = e.message; }
    finally { button.disabled = false; button.classList.remove('is-busy'); }
  };
}
const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
const codePattern = () => `pattern="[A-Za-z0-9_.\\-]+" title="${t('form.codeHint')}"`;
const materialsDatalist = () => {
  const set = new Set([...state.lots.map(l => l.material), ...state.routes.flatMap(r => r.bom.map(b => b.material))]);
  return `<datalist id="material-options">${[...set].sort().map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist>`;
};

function newOrder() {
  if (!state.routes.length) { toast(t('toast.needRoute'), 'bad'); return; }
  const path = base(), now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const codes = new Set(state.orders.map(o => o.code));
  let n = 1; while (codes.has(`WO-${stamp}-${String(n).padStart(3, '0')}`)) n++;
  const routes = [...state.routes].sort((a, b) => a.product.localeCompare(b.product) || b.revision - a.revision);
  formDialog(t('newOrder.title'),
    `<div class="form-grid">${field(t('newOrder.code'), `<input name="code" required ${codePattern()} maxlength="80" value="WO-${stamp}-${String(n).padStart(3, '0')}" class="mono">`)}${field(t('newOrder.qty'), `<input name="planned_qty" type="number" min="1" max="100000000" step="1" required inputmode="numeric" placeholder="${t('newOrder.qtyPlaceholder')}">`)}</div>
     ${field(t('newOrder.route'), `<select name="route_id">${routes.map(r => `<option value="${r.id}">${esc(r.product)} · ${t('routes.rev', {rev: r.revision})} · ${esc(r.name)}</option>`).join('')}</select>`)}
     <div class="req-box" id="req-box"></div>`,
    t('newOrder.submit'),
    (f, key) => post(path + '/orders', {code: f.get('code').trim(), route_id: Number(f.get('route_id')), planned_qty: Number(f.get('planned_qty'))}, key),
    {onMount: form => {
      const update = () => {
        const r = state.routes.find(x => x.id === Number(form.route_id.value)), qty = Number(form.planned_qty.value) || 0;
        if (!r) return;
        $('#req-box').innerHTML = `<h3 class="section-label">${qty ? t('newOrder.reqFor', {qty: fmt(qty)}) : t('newOrder.req')}</h3><ul class="req-list">${r.bom.map(b => {
          const need = b.per_unit * qty, have = state.lots.filter(l => l.material === b.material && l.quality === 'released').reduce((s, l) => s + l.available, 0);
          const ok = !qty || have >= need;
          return `<li><span class="mono">${esc(b.material)}</span><span>${qty ? fmt(need) : t('newOrder.perUnit', {n: fmt(b.per_unit)})}</span><span class="${ok ? 'text-ok' : 'text-bad'}">${icon(ok ? 'check' : 'alert')}${t('newOrder.inStock', {n: fmt(have)})}</span></li>`;
        }).join('')}</ul><p class="form-note">${r.steps.map(s => esc(s.name)).join(' → ')}</p>`;
      };
      form.route_id.onchange = update; form.planned_qty.oninput = update; update();
    }, note: t('newOrder.note')});
}

function newLot() {
  const path = base();
  formDialog(t('newLot.title'),
    `<div class="form-grid">${field(t('newLot.code'), `<input name="code" required ${codePattern()} maxlength="80" class="mono" placeholder="${t('newLot.codePlaceholder')}">`)}${field(t('newLot.material'), `<input name="material" required ${codePattern()} maxlength="80" list="material-options" class="mono" placeholder="${t('newLot.materialPlaceholder')}">`)}</div>${materialsDatalist()}
     ${field(t('newLot.qty'), '<input name="quantity" type="number" min="1" step="1" max="100000000" required inputmode="numeric">')}`,
    t('newLot.submit'),
    f => post(path + '/lots', {code: f.get('code').trim(), material: f.get('material').trim(), quantity: Number(f.get('quantity'))}),
    {note: t('newLot.note')});
}

const decisionPicker = (name, options) => `<fieldset class="choice-group"><legend class="sr-only">${t('form.decision')}</legend>${options.map(([value, title, text, tone], i) => `<label class="choice tone-${tone}"><input type="radio" name="${name}" value="${value}" ${i === 0 ? 'checked' : ''} required><span class="choice-mark">${icon(tone === 'ok' ? 'check' : 'x')}</span><span><strong>${title}</strong><small>${text}</small></span></label>`).join('')}</fieldset>`;

function lotQuality(id) {
  const lot = state.lots.find(l => l.id === id), path = base();
  formDialog(t('lotQc.title', {code: lot ? lot.code : ''}),
    (lot ? `<div class="dialog-summary"><span class="timeline-icon tone-warn">${icon('lots')}</span><div><strong class="mono">${esc(lot.material)}</strong><small>${t('lotQc.summary', {n: fmt(lot.received), unit: lot.unit})}</small></div></div>` : '') +
    decisionPicker('decision', [['released', t('lotQc.approve'), t('lotQc.approve.text'), 'ok'], ['rejected', t('lotQc.reject'), t('lotQc.reject.text'), 'bad']]) +
    field(t('form.inspectionNotes'), `<textarea name="reason" required minlength="3" maxlength="500" rows="3" placeholder="${t('lotQc.placeholder')}"></textarea>`, t('form.min3')),
    t('lotQc.submit'),
    f => post(`${path}/lots/${id}/quality`, {decision: f.get('decision'), reason: f.get('reason')}));
}

async function whereUsed(id) {
  const lot = state.lots.find(l => l.id === id);
  try {
    const data = await api(`${base()}/lots/${id}/where-used`);
    showDialog(t('whereUsed.title', {code: lot ? lot.code : ''}), data.length
      ? `<ul class="attn-list">${data.map(x => `<li><button type="button" class="attn-item" data-cmd="open-order" data-id="${x.order_id}"><span class="attn-icon tone-info">${icon('orders')}</span><span class="attn-text"><strong class="mono">${esc(x.order)}</strong><small>${t('whereUsed.issued', {n: fmt(x.quantity)})}</small></span>${badge(x.state)}${icon('chevR', 'chev')}</button></li>`).join('')}</ul>`
      : empty(t('whereUsed.empty.title'), t('whereUsed.empty.text'), '', 'link'));
  } catch (e) { toast(e.message, 'bad'); }
}

function newRoute() {
  const path = base();
  formDialog(t('newRoute.title'),
    `<div class="form-grid form-grid-3">${field(t('newRoute.product'), `<input name="product" required ${codePattern()} maxlength="80" class="mono" placeholder="${t('newRoute.productPlaceholder')}" list="product-options">`)}${field(t('newRoute.revision'), '<input name="revision" type="number" min="1" step="1" value="1" required inputmode="numeric">')}</div>
     <datalist id="product-options">${[...new Set(state.routes.map(r => r.product))].map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist>${materialsDatalist()}
     ${field(t('newRoute.name'), `<input name="name" required maxlength="160" placeholder="${t('newRoute.namePlaceholder')}">`)}
     <div class="builder"><div class="builder-head"><h3 class="section-label">${t('newRoute.ops')}</h3><button type="button" class="btn btn-ghost btn-sm" id="add-step">${icon('plus')}<span>${t('newRoute.addOp')}</span></button></div><ol id="step-rows" class="builder-rows"></ol></div>
     <div class="builder"><div class="builder-head"><h3 class="section-label">${t('routes.bom')}</h3><button type="button" class="btn btn-ghost btn-sm" id="add-bom">${icon('plus')}<span>${t('newRoute.addMat')}</span></button></div><ul id="bom-rows" class="builder-rows"></ul></div>`,
    t('newRoute.submit'),
    (f, key, form) => post(path + '/routes', {
      product: f.get('product').trim(), revision: Number(f.get('revision')), name: f.get('name').trim(),
      steps: $$('.step-input', form).map(row => ({name: $('[data-name]', row).value.trim(), work_center: $('[data-center]', row).value.trim()})),
      bom: $$('.bom-input', form).map(row => ({material: $('[data-material]', row).value.trim(), per_unit: Number($('[data-qty]', row).value), unit: 'pcs'})),
    }, key),
    {size: 'dialog-wide', note: t('newRoute.note'), onMount: form => {
      const renumber = () => $$('#step-rows .row-num').forEach((el, i) => { el.textContent = i + 1; });
      const row = kind => {
        const li = document.createElement('li');
        li.className = `builder-row ${kind}-input`;
        li.innerHTML = kind === 'step'
          ? `<span class="row-num" aria-hidden="true"></span><input data-name aria-label="${t('newRoute.opName')}" placeholder="${t('newRoute.opName')}" required maxlength="160"><input data-center aria-label="${t('newRoute.workCenter')}" placeholder="${t('newRoute.workCenter')}" required maxlength="100" class="mono"><button type="button" class="btn btn-icon btn-ghost" aria-label="${t('newRoute.removeOp')}">${icon('x')}</button>`
          : `<input data-material aria-label="${t('newRoute.matCode')}" placeholder="${t('newRoute.matCode')}" ${codePattern()} required maxlength="80" list="material-options" class="mono"><input data-qty aria-label="${t('newRoute.qtyPerUnit')}" placeholder="${t('newRoute.qtyPerUnitShort')}" type="number" min="1" step="1" required inputmode="numeric"><span class="unit">pcs</span><button type="button" class="btn btn-icon btn-ghost" aria-label="${t('newRoute.removeMat')}">${icon('x')}</button>`;
        $('button', li).onclick = () => {
          if (li.parentElement.children.length > 1) { li.remove(); renumber(); } else toast(t(kind === 'step' ? 'toast.needOp' : 'toast.needMat'), 'bad');
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
    const tr = await api(`${base()}/orders/${o.id}/trace`);
    const inputs = tr.inputs.length
      ? tr.inputs.map(l => `<li class="trace-node"><span class="mono">${esc(l.lot)}</span><small>${esc(l.material)} · ${fmt(l.quantity)} ${esc(l.unit)}</small></li>`).join('')
      : `<li class="trace-node trace-node-empty"><small>${t('trace.noInputs')}</small></li>`;
    const output = tr.output_lot
      ? `<span class="mono">${esc(tr.output_lot)}</span><small>${t('trace.goodPcs', {n: fmt(lastGood(tr.order))})}</small>`
      : `<small>${t('trace.outputPending')}</small>`;
    showDialog(t('trace.title', {code: o.code}),
      `<div class="trace-flow"><div><h3 class="section-label">${t('trace.inputs')}</h3><ul class="trace-col">${inputs}</ul></div><span class="trace-arrow" aria-hidden="true">${icon('arrowR')}</span>
        <div><h3 class="section-label">${t('trace.order')}</h3><ul class="trace-col"><li class="trace-node trace-node-main"><span class="mono">${esc(tr.order.code)}</span><small>${esc(tr.order.product)} · ${t('routes.rev', {rev: tr.order.revision})}</small>${badge(tr.order.state)}</li></ul></div><span class="trace-arrow" aria-hidden="true">${icon('arrowR')}</span>
        <div><h3 class="section-label">${t('trace.output')}</h3><ul class="trace-col"><li class="trace-node ${tr.output_lot ? 'trace-node-ok' : 'trace-node-empty'}">${output}</li></ul></div></div>
       <h3 class="section-label">${t('trace.history')}</h3>${tr.events.length ? timeline(tr.events.map(e => ({...e, entity: 'order', entity_id: o.id})), {details: false}) : `<p class="muted">${t('trace.noEvents')}</p>`}`,
      'dialog-wide');
  } catch (e) { toast(e.message, 'bad'); }
}

function orderAction(order, action, operationId) {
  if (!order) return;
  const path = `${base()}/orders/${order.id}/actions`;
  const title = t(`action.${action}.title`, {code: order.code});
  const send = (body, key) => post(path, {action, version: order.version, ...body}, key);
  const miniStat = (label, value) => `<span>${label}<strong>${value}</strong></span>`;

  if (action === 'release') {
    const route = routeOf(order);
    if (!route) { toast(t('toast.routeMissing'), 'bad'); return; }
    const sections = route.bom.map(b => {
      const need = b.per_unit * order.planned_qty;
      const lots = state.lots.filter(l => l.material === b.material && l.quality === 'released' && l.available > 0).sort((a, c) => a.id - c.id);
      return `<fieldset class="alloc" data-need="${need}"><legend><span class="mono">${esc(b.material)}</span><span class="alloc-need">${t('release.need', {n: fmt(need)})}</span></legend>
        <div class="alloc-status" aria-live="polite"></div>
        ${lots.length ? lots.map(l => `<label class="alloc-row"><span><span class="mono">${esc(l.code)}</span><small>${t('release.available', {n: fmt(l.available)})}</small></span><input type="number" name="lot-${l.id}" data-lot="${l.id}" data-avail="${l.available}" min="0" max="${l.available}" step="1" value="0" inputmode="numeric" aria-label="${t('release.qtyFrom', {code: l.code})}"></label>`).join('')
          : `<p class="text-bad">${icon('alert')} ${t('release.noLots')}</p>`}</fieldset>`;
    }).join('');
    formDialog(title, `<p class="muted">${t('release.intro', {qty: fmt(order.planned_qty)})}</p><div class="alloc-tools"><button type="button" class="btn btn-secondary btn-sm" id="auto-alloc">${icon('refresh')}<span>${t('release.auto')}</span></button></div>${sections}`,
      t('release.submit'),
      (f, key, form) => send({allocations: $$('[data-lot]', form).map(i => ({lot_id: Number(i.dataset.lot), quantity: Number(i.value) || 0})).filter(x => x.quantity > 0)}, key),
      {size: 'dialog-wide', onMount: form => {
        const submit = $('button[type=submit]', form);
        const update = () => {
          let allOk = true;
          $$('.alloc', form).forEach(fs => {
            const need = Number(fs.dataset.need), got = $$('[data-lot]', fs).reduce((s, i) => s + (Number(i.value) || 0), 0);
            const p = {got: fmt(got), need: fmt(need), diff: fmt(Math.abs(need - got))};
            const st = got === need ? ['ok', `${icon('check')} ${t('release.ok', p)}`] : got < need ? ['warn', `${icon('alert')} ${t('release.short', p)}`] : ['bad', `${icon('alert')} ${t('release.over', p)}`];
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
      `<div class="dialog-summary"><span class="timeline-icon tone-violet">${icon('tool')}</span><div><strong>${esc(op.name)}</strong><small>${t('record.summary', {code: order.code, wc: op.work_center, seq: op.sequence, total: order.operations.length})}</small></div></div>
       <div class="mini-stats">${miniStat(t('op.input'), fmt(cap))}${miniStat(t('record.recorded'), fmt(used))}${miniStat(t('op.remaining'), fmt(rem))}</div>
       <div class="form-grid">${field(t('record.good'), `<input name="good" type="number" min="0" max="${Math.max(rem, 0)}" step="1" value="0" required inputmode="numeric">`)}${field(t('record.scrap'), `<input name="scrap" type="number" min="0" max="${Math.max(rem, 0)}" step="1" value="0" required inputmode="numeric">`)}</div>
       ${rem > 0 ? `<button type="button" class="btn btn-ghost btn-sm fill-btn" id="fill-good">${icon('check')}<span>${t('record.fill', {n: fmt(rem)})}</span></button>` : ''}
       ${field(t('record.reason'), `<textarea name="reason" maxlength="500" rows="2" placeholder="${t('record.reasonPlaceholder')}"></textarea>`)}
       <label class="check"><input name="finish" type="checkbox" ${rem === 0 ? 'checked' : ''}><span><strong>${t('record.finish')}</strong><small>${t('record.finish.text')}</small></span></label>
       <p class="live-summary" aria-live="polite"></p>`,
      t('record.submit'),
      (f, key) => send({operation_id: op.id, good: Number(f.get('good')) || 0, scrap: Number(f.get('scrap')) || 0, finish: f.has('finish'), reason: f.get('reason') || ''}, key),
      {onMount: form => {
        let finishTouched = false;
        const update = () => {
          const g = Number(form.good.value) || 0, s = Number(form.scrap.value) || 0, after = used + g + s;
          form.reason.required = s > 0;
          if (!finishTouched) form.finish.checked = after === cap;
          const msg = $('.live-summary', form), p = {after: fmt(after), cap: fmt(cap), left: fmt(cap - after)};
          if (after > cap) { msg.className = 'live-summary text-bad'; msg.innerHTML = t('record.over', p); }
          else if (form.finish.checked && after < cap) { msg.className = 'live-summary text-warn'; msg.innerHTML = t('record.short', p); }
          else { msg.className = 'live-summary muted'; msg.innerHTML = t(form.finish.checked ? 'record.afterFinish' : 'record.after', p); }
        };
        form.finish.addEventListener('change', () => { finishTouched = true; update(); });
        $('#fill-good', form)?.addEventListener('click', () => { form.good.value = rem; form.scrap.value = 0; update(); });
        form.addEventListener('input', update); update();
      }});
  } else if (action === 'quality') {
    formDialog(title,
      `<div class="mini-stats">${miniStat(t('detail.planned'), fmt(order.planned_qty))}${miniStat(t('detail.good'), fmt(lastGood(order)))}${miniStat(t('detail.scrap'), fmt(scrapOf(order)))}</div>` +
      decisionPicker('decision', [['pass', t('qc.pass'), t('qc.pass.text'), 'ok'], ['fail', t('qc.fail'), t('qc.fail.text'), 'bad']]) +
      field(t('form.inspectionNotes'), `<textarea name="reason" required minlength="3" maxlength="500" rows="3" placeholder="${t('qc.placeholder')}"></textarea>`),
      t('qc.submit'), (f, key) => send({decision: f.get('decision'), reason: f.get('reason')}, key));
  } else {
    const short = action === 'complete' && lastGood(order) < order.planned_qty;
    const required = action !== 'complete' || short;
    const hint = short ? t('close.shortHint', {n: fmt(order.planned_qty - lastGood(order))}) : required ? t('form.min3') : t('form.optional');
    formDialog(title,
      (action === 'complete' ? `<div class="mini-stats">${miniStat(t('detail.planned'), fmt(order.planned_qty))}${miniStat(t('detail.good'), fmt(lastGood(order)))}${miniStat(t('close.outputLot'), `<span class="mono">${esc(order.code)}</span>`)}</div>` : '') +
      field(t(`action.${action}.label`), `<textarea name="reason" ${required ? 'required minlength="3"' : ''} maxlength="500" rows="3"></textarea>`, hint),
      t(`action.${action}.submit`),
      (f, key) => send({reason: f.get('reason') || ''}, key),
      {note: hasKey(`action.${action}.note`) ? t(`action.${action}.note`) : ''});
  }
}

// ---------- boot ----------
syncLangLabels();
applyStatic();
renderNav();
applyTheme(storedTheme());
