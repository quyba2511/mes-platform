'use strict';
// Fuburg work queues share authentication, plant selection, dialogs and i18n (t()) with MES.
// All UI text lives in i18n.js under the fb.* keys.
const fbLabel = action => (hasKey(`fb.action.${action}`) ? t(`fb.action.${action}`) : action.replaceAll('_', ' '));
const fbFieldLabel = name => (hasKey(`fb.field.${name}`) ? t(`fb.field.${name}`) : name.replaceAll('_', ' ').replace(/^./, s => s.toUpperCase()));
const fbStateText = s => (hasKey(`fb.state.${s}`) ? t(`fb.state.${s}`) : s.replaceAll('_', ' ').toLowerCase());
const fbAllowed = action => state.fuburg?.actions?.some(a => a.action === action);
const fbButton = (action, label, ref = '') => fbAllowed(action) ? btn(esc(label || fbLabel(action)), `data-fb-action="${action}" data-ref="${esc(ref)}"`, 'btn-secondary btn-sm') : '';
const fbState = s => `<span class="badge tone-${['REJECTED', 'FAILED', 'BLOCKED'].includes(s) ? 'bad' : ['APPROVED', 'ACCEPTED', 'SENT'].includes(s) ? 'ok' : 'info'}">${esc(fbStateText(s))}</span>`;
const fbTable = (headers, rowsHtml) => rowsHtml.length
  ? `<div class="table-wrap"><table><thead><tr>${headers.map(x => `<th>${esc(t(x))}</th>`).join('')}</tr></thead><tbody>${rowsHtml.join('')}</tbody></table></div>`
  : empty(t('fb.emptyTitle'), t('fb.emptyText'));

function renderFuburg() {
  const f = state.fuburg;
  if (!f?.enabled) {
    $('#content').innerHTML = pageHead(t('fb.title'), t('fb.disabledSubtitle')) + empty(t('fb.notConfigured'), t('fb.notConfiguredText'));
    return;
  }
  const pending = Object.entries(f.sync.counts).filter(([k]) => k !== 'SENT').reduce((n, [, v]) => n + v, 0);
  const cards = [
    ['fb.kpi.orders', f.orders.length],
    ['fb.kpi.openRuns', f.run.filter(r => r.state === 'OPEN').length],
    ['fb.kpi.good', f.completion.reduce((n, c) => n + c.good_pieces, 0)],
    ['fb.kpi.pending', pending],
  ];
  $('#content').innerHTML =
    pageHead(t('fb.title'), t('fb.subtitle'), btn(t('fb.refresh'), 'data-cmd="refresh"', 'btn-secondary', 'refresh')) +
    `<div class="callout tone-${f.integration_enabled ? 'info' : 'warn'}">${icon(f.integration_enabled ? 'check' : 'alert')}<div><strong>${t(f.integration_enabled ? 'fb.integrationOn' : 'fb.integrationOff')}</strong><p>${f.pending_configuration.length ? t('fb.pendingApproval') : ''}${t('fb.gradeLegend')}</p></div></div>` +
    `<div class="kpis">${cards.map(([key, n]) => `<section class="panel fb-kpi"><span class="muted">${t(key)}</span><strong>${fmt(n)}</strong></section>`).join('')}</div>` +
    `<div class="fb-toolbar">${['start_run', 'report_ay', 'record_material_use', 'preview_consumption', 'return_material'].map(a => fbButton(a)).join('')}</div>` +
    panel(t('fb.panel.orders'), fbTable(['fb.col.orderProduct', 'fb.col.site', 'fb.col.plannedPieces', 'fb.col.availability', ''], f.orders.map(o =>
      `<tr><td><strong class="mono">${esc(o.order_no)}</strong><small class="fb-sub">${esc(o.material)} · ${esc(o.description || '')}</small></td><td>${esc(o.site || t('fb.sitePending'))}</td><td>${fmt(o.planned_pieces)}</td><td>${fbState(o.closed || o.deleted ? 'CLOSED' : o.released ? 'RELEASED' : 'ON_HOLD')}</td><td>${o.released && !o.closed && !o.deleted ? fbButton('start_run', t('fb.btn.startRun'), o.order_no) : ''}</td></tr>`))) +
    panel(t('fb.panel.runs'), fbTable(['fb.col.orderLine', 'fb.col.shiftDate', 'fb.col.status', 'fb.col.next'], f.run.map(r =>
      `<tr><td><strong>${esc(r.order_no)}</strong><small class="fb-sub">${esc(r.line)}</small></td><td>${esc(r.shift)} · ${esc(r.production_date)}</td><td>${fbState(r.state)}</td><td>${r.state === 'OPEN' ? fbButton('report_output', t('fb.btn.recordOutput'), r.run_id) + fbButton('finish_run', t('fb.btn.finishRun'), r.run_id) : r.state === 'FINISHED' ? fbButton('confirm_completion', t('fb.btn.confirm'), r.run_id) : esc(t('fb.confirmed'))}</td></tr>`))) +
    panel(t('fb.panel.quality'), fbTable(['fb.col.order', 'fb.col.good', 'fb.col.ay', 'fb.col.scrap', 'fb.col.status', ''], f.completion.map(c =>
      `<tr><td>${esc(c.order_no)}</td><td>${fmt(c.good_pieces)}</td><td>${fmt(c.ay_pieces)}</td><td>${fmt(c.scrap_pieces)}</td><td>${fbState(c.state)}</td><td>${fbButton('release_quality', t('fb.btn.release'), c.completion_id)}</td></tr>`))) +
    panel(t('fb.panel.packaging'), fbTable(['fb.col.release', 'fb.col.releasedPieces', 'fb.col.status', ''], f.release_lot.map(r =>
      `<tr><td class="mono">${esc(r.release_id.slice(0, 8))}</td><td>${fmt(r.pieces)}</td><td>${fbState(r.state)}</td><td>${fbButton('record_packaging', t('fb.btn.pack'), r.release_id)}</td></tr>`))) +
    panel(t('fb.panel.packages'), fbTable(['fb.col.lot', 'fb.col.packagesLoose', 'fb.col.pieces', 'fb.col.status', ''], f.package.map(p =>
      `<tr><td>${esc(p.lot_no)}</td><td>${p.actual_packages} ${esc(p.package_uom)} + ${p.loose_pieces} EA</td><td>${fmt(p.pieces)}</td><td>${fbState(p.state)}</td><td>${fbButton('submit_receipt', t('fb.btn.requestReceipt'), p.package_id)}</td></tr>`))) +
    panel(t('fb.panel.receipts'), fbTable(['fb.col.receipt', 'fb.col.quantity', 'fb.col.location', 'fb.col.status', ''], f.receipt.map(r =>
      `<tr><td class="mono">${esc(r.receipt_id.slice(0, 8))}</td><td>${esc(r.quantity)} ${esc(r.uom)}</td><td>${esc(r.storage_location)}</td><td>${fbState(r.state)}</td><td>${['QUEUED', 'DRAFT'].includes(r.state) ? fbButton('decide_receipt', t('fb.btn.reviewReceipt'), r.receipt_id) : ''}</td></tr>`))) +
    panel(t('fb.panel.sync'),
      `<div class="fb-sync">${Object.entries(f.sync.counts).map(([k, v]) => `<span>${fbState(k)} ${v}</span>`).join('') || `<p class="muted">${t('fb.noMessages')}</p>`}</div>` +
      f.sync.problems.map(p => `<p class="form-error">${esc(fbLabel(p.intf_action))}: ${esc(translate(p.last_error || p.state))}</p>`).join('') +
      `<ul class="fb-history">${f.audit.slice(0, 8).map(a => `<li><strong>${esc(fbLabel(a.action))}</strong><span>${esc(a.actor)} · ${time(a.at)}</span></li>`).join('')}</ul>`) +
    `<div class="fb-toolbar">${['cancel_txn', 'cancel_document', 'request_correction'].map(a => fbButton(a)).join('')}</div>`;
}

const FB_FIELDS = {
  start_run: ['order_no', 'line', 'production_date', 'shift'], report_output: ['run_id', 'grade_code', 'pieces'],
  finish_run: ['run_id', 'machine_minutes', 'work_center', 'headcount', 'labor_minutes'], confirm_completion: ['run_ids', 'posting_date', 'approval_ref'],
  release_quality: ['completion_id', 'pieces', 'evidence_ref'], record_packaging: ['release_id', 'package_uom', 'actual_packages', 'loose_pieces', 'lot_no', 'evidence_ref'],
  submit_receipt: ['package_id', 'actual_packages', 'loose_pieces', 'storage_location', 'posting_date', 'shift', 'evidence_ref'],
  decide_receipt: ['receipt_id', 'decision', 'reason', 'evidence_ref'], report_ay: ['order_no', 'ay_material', 'quantity', 'uom', 'cartons', 'storage_location', 'carton_sloc', 'posting_date', 'shift'],
  record_material_use: ['line', 'production_date', 'shift', 'material', 'quantity', 'uom', 'storage_location'],
  preview_consumption: ['line', 'production_date', 'shift'], return_material: ['order_no', 'material', 'quantity', 'uom', 'storage_location', 'posting_date', 'shift'],
  cancel_txn: ['txn_id', 'reason'], cancel_document: ['document_no', 'document_year', 'reason', 'posting_date', 'shift'], request_correction: ['completion_id', 'original_txn_id', 'reason', 'evidence_ref'],
};
function fbOptions(name) {
  const f = state.fuburg;
  const list = (rows, key, label) => rows.map(r => [r[key], label(r)]);
  if (name === 'order_no') return list(f.orders.filter(o => o.released && !o.closed && !o.deleted), 'order_no', o => `${o.order_no} · ${o.material}`);
  if (name === 'run_id' || name === 'run_ids') return list(f.run.filter(r => r.state === (name === 'run_ids' ? 'FINISHED' : 'OPEN')), 'run_id', r => `${r.order_no} · ${r.line} · ${r.shift}`);
  if (name === 'completion_id') return list(f.completion.filter(c => !['REJECTED', 'CANCELLED'].includes(c.state)), 'completion_id', c => `${c.order_no} · ${t('fb.opt.good', {n: c.good_pieces})} · ${c.completion_id.slice(0, 8)}`);
  if (name === 'release_id') return list(f.release_lot.filter(r => r.state !== 'REJECTED'), 'release_id', r => `${t('fb.opt.pieces', {n: r.pieces})} · ${r.release_id.slice(0, 8)}`);
  if (name === 'package_id') return list(f.package.filter(r => r.state !== 'REJECTED'), 'package_id', r => `${r.lot_no} · ${t('fb.opt.pieces', {n: r.pieces})}`);
  if (name === 'receipt_id') return list(f.receipt.filter(r => ['QUEUED', 'DRAFT'].includes(r.state)), 'receipt_id', r => `${r.quantity} ${r.uom} → ${r.storage_location} · ${r.receipt_id.slice(0, 8)}`);
  if (name === 'shift') return Object.entries(f.shifts);
  if (name === 'grade_code') return ['A', 'B', 'C'].map(g => [g, t(`fb.grade.${g}`)]);
  if (name === 'decision') return ['APPROVE', 'REJECT'].map(d => [d, t(`fb.decision.${d}`)]);
  return null;
}
function fbOpenForm(action, ref = '') {
  const names = FB_FIELDS[action]; if (!names || !fbAllowed(action)) return;
  const path = base() + '/fuburg/actions', plant = state.plant.id;
  const html = names.map((name, i) => {
    const label = esc(fbFieldLabel(name)), options = fbOptions(name);
    const optional = ['cartons', 'carton_sloc', 'reason', 'work_center', 'headcount', 'labor_minutes'].includes(name);
    if (options) return field(label, `<select name="${name}" required><option value="">${esc(t('fb.choose'))}</option>${options.map(([value, text]) => `<option value="${esc(value)}" ${i === 0 && ref === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`);
    const date = name.endsWith('_date'), numeric = ['pieces', 'actual_packages', 'loose_pieces', 'machine_minutes', 'quantity', 'cartons', 'headcount', 'labor_minutes'].includes(name);
    const value = date ? dayKey(new Date()) : ['loose_pieces', 'actual_packages', 'machine_minutes'].includes(name) ? '0' : '';
    return field(label, `<input name="${name}" type="${date ? 'date' : numeric ? 'number' : 'text'}" ${optional ? '' : 'required'} ${numeric ? `min="0" step="${name === 'quantity' ? '0.001' : '1'}"` : 'maxlength="160"'} value="${esc(value)}">`);
  }).join('');
  if (action === 'preview_consumption') {
    showDialog(fbLabel(action), `<form id="fb-preview">${html}<p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">${esc(t('fb.previewBtn'))}</button></form><div id="fb-plan"></div>`);
    const form = $('#fb-preview');
    form.onsubmit = async event => {
      event.preventDefault(); const button = form.querySelector('button'); button.disabled = true; $('#fb-plan').replaceChildren();
      try {
        const body = Object.fromEntries(new FormData(form)); const result = await post(path, {action, body});
        $('#fb-plan').innerHTML = fbTable(['fb.col.order', 'fb.col.material', 'fb.col.quantity', 'fb.col.reservation'], Object.entries(result.plan).flatMap(([order, items]) => items.map(it => `<tr><td>${esc(order)}</td><td>${esc(it.material)}</td><td>${esc(it.quantity)} ${esc(it.uom)}</td><td>${esc(it.reservation_no)} / ${esc(it.reservation_item)}</td></tr>`))) +
          (fbAllowed('allocate_consumption') ? `<button id="fb-confirm-plan" type="button" class="btn btn-primary">${esc(t('fb.confirmPlan'))}</button>` : `<p>${esc(t('fb.supervisorConfirm'))}</p>`);
        const confirm = $('#fb-confirm-plan'); const key = crypto.randomUUID();
        if (confirm) confirm.onclick = async () => {
          confirm.disabled = true;
          try {
            if (plant !== state.plant.id) throw Error(t('fb.plantChangedPreview'));
            await post(path, {action: 'allocate_consumption', body: {...body, posting_date: dayKey(new Date()), preview_token: result.preview_token}}, key);
            $('#dialog').close(); toast(t('fb.allocationQueued')); await load();
          } catch (e) { $('.form-error', form).textContent = e.message; confirm.disabled = false; }
        };
      } catch (e) { $('.form-error', form).textContent = e.message; } finally { button.disabled = false; }
    };
    return;
  }
  formDialog(fbLabel(action), `<div class="form-grid">${html}</div>`, esc(t('fb.save')), async (form, key) => {
    if (plant !== state.plant.id) throw Error(t('fb.plantChanged'));
    const body = Object.fromEntries(form);
    for (const name of ['cartons', 'carton_sloc', 'work_center', 'headcount', 'labor_minutes']) if (body[name] === '') delete body[name];
    if (action === 'confirm_completion') body.run_ids = [body.run_ids];
    if (action === 'finish_run') {
      if (body.work_center) body.labor = [{work_center: body.work_center, headcount: Number(body.headcount || 1), labor_minutes: Number(body.labor_minutes || 0)}];
      delete body.work_center; delete body.headcount; delete body.labor_minutes;
    }
    if (action === 'return_material') {
      body.items = [{material: body.material, quantity: body.quantity, uom: body.uom, storage_location: body.storage_location}];
      for (const k of ['material', 'quantity', 'uom', 'storage_location']) delete body[k];
    }
    return post(path, {action, body}, key);
  }, {note: esc(t('fb.saveNote'))});
}
document.addEventListener('click', event => { const button = event.target.closest('[data-fb-action]'); if (button) fbOpenForm(button.dataset.fbAction, button.dataset.ref); });
