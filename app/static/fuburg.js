// Fuburg work queues share authentication, plant selection and dialogs with MES.
const FB_LABELS = {
  start_run:'Start a production run', report_output:'Record A / B / C output', finish_run:'Finish production run',
  confirm_completion:'Confirm production', release_quality:'Release good output', record_packaging:'Record packaging',
  submit_receipt:'Request warehouse receipt', decide_receipt:'Approve / reject receipt', report_ay:'Receive AY by-product',
  record_material_use:'Record shift material use', preview_consumption:'Preview shift allocation', allocate_consumption:'Confirm shift allocation',
  return_material:'Return unused material', cancel_document:'Reverse material document', cancel_txn:'Cancel pending transaction', request_correction:'Request SAP correction'
};
Object.assign(ERRORS, {
  RELEASE_EXCEEDS_GOOD:'The quantity exceeds the good output available for quality release.',
  PACKAGE_EXCEEDS_RELEASE:'The quantity exceeds the remaining quality release.',
  RECEIPT_EXCEEDS_PACKAGE:'The quantity exceeds the remaining packaged output.',
  ASRS_MANAGED_SLOC:'This storage location is managed by the automated warehouse.',
  ORDER_VERSION_CHANGED:'SAP has updated this order. Reconcile the run against the new order before continuing.',
  CONSUMPTION_PREVIEW_CHANGED:'The allocation has changed. Preview it again before confirming.',
  SHIFT_HAS_OPEN_RUNS:'Finish all runs in this shift before allocating materials.',
  RECEIPT_NOT_DRAFT:'This receipt already has a decision, or a decision is waiting to synchronize.',
  CARTON_SLOC_REQUIRED:'Enter the approved carton storage location.',
  NOTHING_TO_ALLOCATE:'There are no unallocated materials for this line and shift.',
  LINE_BUSY:'This line already has an open run.', ROLE_NOT_ALLOWED:'Your plant role cannot perform this action.'
});
const fbAllowed = action => state.fuburg?.actions?.some(a => a.action === action);
const fbButton = (action, label, ref='') => fbAllowed(action) ? btn(esc(label || FB_LABELS[action]), `data-fb-action="${action}" data-ref="${esc(ref)}"`, 'btn-secondary btn-sm') : '';
const fbState = s => `<span class="badge tone-${['REJECTED','FAILED','BLOCKED'].includes(s)?'bad':['APPROVED','ACCEPTED','SENT'].includes(s)?'ok':'info'}">${esc(s.replaceAll('_',' ').toLowerCase())}</span>`;
const fbTable = (headers, rowsHtml) => rowsHtml.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rowsHtml.join('')}</tbody></table></div>` : empty('Nothing waiting here', 'New records appear here as work progresses.');
function renderFuburg() {
  const f=state.fuburg;
  if (!f?.enabled) { $('#content').innerHTML=pageHead('Fuburg operations','Production, quality, packaging and warehouse')+empty('This plant is not configured for Fuburg','Choose a configured plant to view SAP orders and production work queues.');return; }
  const pending=Object.entries(f.sync.counts).filter(([k])=>k!=='SENT').reduce((n,[,v])=>n+v,0);
  const cards=[['SAP orders (up to 500)',f.orders.length],['Open runs',f.run.filter(r=>r.state==='OPEN').length],['Good output · recent 200 (EA)',f.completion.reduce((n,c)=>n+c.good_pieces,0)],['Awaiting sync',pending]];
  $('#content').innerHTML=pageHead('Fuburg operations','SAP order → production → quality → packaging → warehouse',btn('Refresh','data-cmd="refresh"','btn-secondary','refresh'))+
    `<div class="callout tone-${f.integration_enabled?'info':'warn'}">${icon('info')}<div><strong>${f.integration_enabled?'Integration configured':'Local workflow · SAP synchronization is off'}</strong><p>${f.pending_configuration.length?'Site mapping and grade rule require business approval. ':''}A = good · B = AY by-product · C = scrap. Quantities are tracked in pieces.</p></div></div>`+
    `<div class="kpis">${cards.map(([title,n])=>`<section class="panel fb-kpi"><span class="muted">${title}</span><strong>${fmt(n)}</strong></section>`).join('')}</div>`+
    `<div class="fb-toolbar">${['start_run','report_ay','record_material_use','preview_consumption','return_material'].map(a=>fbButton(a)).join('')}</div>`+
    panel('SAP work orders',fbTable(['Order / product','Site','Planned pieces','Availability',''],f.orders.map(o=>`<tr><td><strong class="mono">${esc(o.order_no)}</strong><small class="fb-sub">${esc(o.material)} · ${esc(o.description||'')}</small></td><td>${esc(o.site||'Pending')}</td><td>${fmt(o.planned_pieces)}</td><td>${fbState(o.closed||o.deleted?'CLOSED':o.released?'RELEASED':'ON_HOLD')}</td><td>${o.released&&!o.closed&&!o.deleted?fbButton('start_run','Start run',o.order_no):''}</td></tr>`)))+
    panel('Production by line & shift',fbTable(['Order / line','Shift / date','Status','Next step'],f.run.map(r=>`<tr><td><strong>${esc(r.order_no)}</strong><small class="fb-sub">${esc(r.line)}</small></td><td>${esc(r.shift)} · ${esc(r.production_date)}</td><td>${fbState(r.state)}</td><td>${r.state==='OPEN'?fbButton('report_output','Record output',r.run_id)+fbButton('finish_run','Finish run',r.run_id):r.state==='FINISHED'?fbButton('confirm_completion','Confirm production',r.run_id):'Confirmed'}</td></tr>`)))+
    panel('Quality release',fbTable(['Order','A · good','B · AY','C · scrap','Status',''],f.completion.map(c=>`<tr><td>${esc(c.order_no)}</td><td>${fmt(c.good_pieces)}</td><td>${fmt(c.ay_pieces)}</td><td>${fmt(c.scrap_pieces)}</td><td>${fbState(c.state)}</td><td>${fbButton('release_quality','Release',c.completion_id)}</td></tr>`)))+
    panel('Packaging',fbTable(['Release','Released pieces','Status',''],f.release_lot.map(r=>`<tr><td class="mono">${esc(r.release_id.slice(0,8))}</td><td>${fmt(r.pieces)}</td><td>${fbState(r.state)}</td><td>${fbButton('record_packaging','Pack',r.release_id)}</td></tr>`)))+
    panel('Finished packages',fbTable(['Lot','Packages + loose','Pieces','Status',''],f.package.map(p=>`<tr><td>${esc(p.lot_no)}</td><td>${p.actual_packages} ${esc(p.package_uom)} + ${p.loose_pieces} EA</td><td>${fmt(p.pieces)}</td><td>${fbState(p.state)}</td><td>${fbButton('submit_receipt','Request receipt',p.package_id)}</td></tr>`)))+
    panel('Warehouse decisions',fbTable(['Receipt','Quantity','Location','Status',''],f.receipt.map(r=>`<tr><td class="mono">${esc(r.receipt_id.slice(0,8))}</td><td>${esc(r.quantity)} ${esc(r.uom)}</td><td>${esc(r.storage_location)}</td><td>${fbState(r.state)}</td><td>${['QUEUED','DRAFT'].includes(r.state)?fbButton('decide_receipt','Review receipt',r.receipt_id):''}</td></tr>`)))+
    panel('Synchronization & activity',`<div class="fb-sync">${Object.entries(f.sync.counts).map(([k,v])=>`<span>${fbState(k)} ${v}</span>`).join('')||'<p class="muted">No messages queued.</p>'}</div>`+f.sync.problems.map(p=>`<p class="form-error">${esc(FB_LABELS[p.intf_action]||p.intf_action)}: ${esc(translate(p.last_error||p.state))}</p>`).join('')+`<ul class="fb-history">${f.audit.slice(0,8).map(a=>`<li><strong>${esc(FB_LABELS[a.action]||a.action.replaceAll('_',' '))}</strong><span>${esc(a.actor)} · ${time(a.at)}</span></li>`).join('')}</ul>`)+
    `<div class="fb-toolbar">${['cancel_txn','cancel_document','request_correction'].map(a=>fbButton(a)).join('')}</div>`;
}

const FB_FIELDS={
 start_run:['order_no','line','production_date','shift'], report_output:['run_id','grade_code','pieces'],
 finish_run:['run_id','machine_minutes','work_center','headcount','labor_minutes'], confirm_completion:['run_ids','posting_date','approval_ref'],
 release_quality:['completion_id','pieces','evidence_ref'], record_packaging:['release_id','package_uom','actual_packages','loose_pieces','lot_no','evidence_ref'],
 submit_receipt:['package_id','actual_packages','loose_pieces','storage_location','posting_date','shift','evidence_ref'],
 decide_receipt:['receipt_id','decision','reason','evidence_ref'], report_ay:['order_no','ay_material','quantity','uom','cartons','storage_location','carton_sloc','posting_date','shift'],
 record_material_use:['line','production_date','shift','material','quantity','uom','storage_location'],
 preview_consumption:['line','production_date','shift'], return_material:['order_no','material','quantity','uom','storage_location','posting_date','shift'],
 cancel_txn:['txn_id','reason'], cancel_document:['document_no','document_year','reason','posting_date','shift'], request_correction:['completion_id','original_txn_id','reason','evidence_ref']
};
const FB_FIELD_LABELS={run_ids:'Finished run',run_id:'Production run',order_no:'SAP order',completion_id:'Production confirmation',release_id:'Quality release',package_id:'Package lot',receipt_id:'Warehouse receipt',grade_code:'Output grade',pieces:'Quantity (pieces)',actual_packages:'Full packages',loose_pieces:'Loose pieces',evidence_ref:'Inspection / document reference',approval_ref:'Supervisor approval reference',carton_sloc:'Carton issue location',cartons:'Cartons (required for AY in EA)',txn_id:'SAP transaction ID',original_txn_id:'Original PP transaction ID',quantity:'Quantity (up to 3 decimals)',work_center:'Labor work center (optional)',headcount:'Headcount',labor_minutes:'Labor minutes'};
function fbOptions(name,action) {
 const f=state.fuburg;
 const list=(rows,key,label)=>rows.map(r=>[r[key],label(r)]);
 if(name==='order_no')return list(f.orders.filter(o=>o.released&&!o.closed&&!o.deleted),'order_no',o=>`${o.order_no} · ${o.material}`);
 if(name==='run_id'||name==='run_ids')return list(f.run.filter(r=>r.state===(name==='run_ids'?'FINISHED':'OPEN')),'run_id',r=>`${r.order_no} · ${r.line} · ${r.shift}`);
 if(name==='completion_id')return list(f.completion.filter(c=>!['REJECTED','CANCELLED'].includes(c.state)),'completion_id',c=>`${c.order_no} · ${c.good_pieces} good · ${c.completion_id.slice(0,8)}`);
 if(name==='release_id')return list(f.release_lot.filter(r=>r.state!=='REJECTED'),'release_id',r=>`${r.pieces} pieces · ${r.release_id.slice(0,8)}`);
 if(name==='package_id')return list(f.package.filter(r=>r.state!=='REJECTED'),'package_id',r=>`${r.lot_no} · ${r.pieces} pieces`);
 if(name==='receipt_id')return list(f.receipt.filter(r=>['QUEUED','DRAFT'].includes(r.state)),'receipt_id',r=>`${r.quantity} ${r.uom} → ${r.storage_location} · ${r.receipt_id.slice(0,8)}`);
 if(name==='shift')return Object.entries(f.shifts);
 if(name==='grade_code')return [['A','A · Good'],['B','B · AY by-product'],['C','C · Scrap']];
 if(name==='decision')return [['APPROVE','Approve'],['REJECT','Reject']];
 return null;
}
function fbOpenForm(action,ref='') {
 const names=FB_FIELDS[action];if(!names||!fbAllowed(action))return;
 const path=base()+'/fuburg/actions',plant=state.plant.id;
 const html=names.map((name,i)=>{
   const label=FB_FIELD_LABELS[name]||name.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase()), options=fbOptions(name,action);
   const optional=['cartons','carton_sloc','reason','work_center','headcount','labor_minutes'].includes(name);
   if(options)return field(label,`<select name="${name}" required><option value="">Choose…</option>${options.map(([value,text])=>`<option value="${esc(value)}" ${i===0&&ref===value?'selected':''}>${esc(text)}</option>`).join('')}</select>`);
   const date=name.endsWith('_date'), numeric=['pieces','actual_packages','loose_pieces','machine_minutes','quantity','cartons','headcount','labor_minutes'].includes(name);
   const value=date?dayKey(new Date()):['loose_pieces','actual_packages','machine_minutes'].includes(name)?'0':'';
   return field(label,`<input name="${name}" type="${date?'date':numeric?'number':'text'}" ${optional?'':'required'} ${numeric?`min="0" step="${name==='quantity'?'0.001':'1'}"`: 'maxlength="160"'} value="${esc(value)}">`);
 }).join('');
 if(action==='preview_consumption'){
   showDialog(FB_LABELS[action],`<form id="fb-preview">${html}<p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Preview allocation</button></form><div id="fb-plan"></div>`);
   const form=$('#fb-preview');form.onsubmit=async event=>{
     event.preventDefault();const button=form.querySelector('button');button.disabled=true;$('#fb-plan').replaceChildren();
     try{const body=Object.fromEntries(new FormData(form));const result=await post(path,{action,body});
       $('#fb-plan').innerHTML=fbTable(['Order','Material','Quantity','Reservation'],Object.entries(result.plan).flatMap(([order,items])=>items.map(it=>`<tr><td>${esc(order)}</td><td>${esc(it.material)}</td><td>${esc(it.quantity)} ${esc(it.uom)}</td><td>${esc(it.reservation_no)} / ${esc(it.reservation_item)}</td></tr>`)))+
         (fbAllowed('allocate_consumption')?'<button id="fb-confirm-plan" type="button" class="btn btn-primary">Confirm this allocation</button>':'<p>A supervisor must confirm this allocation.</p>');
       const confirm=$('#fb-confirm-plan');const key=crypto.randomUUID();
       if(confirm)confirm.onclick=async()=>{confirm.disabled=true;try{if(plant!==state.plant.id)throw Error('Plant changed. Open a new preview.');await post(path,{action:'allocate_consumption',body:{...body,posting_date:dayKey(new Date()),preview_token:result.preview_token}},key);$('#dialog').close();toast('Shift allocation queued');await load();}catch(e){$('.form-error',form).textContent=e.message;confirm.disabled=false;}};
     }catch(e){$('.form-error',form).textContent=e.message;}finally{button.disabled=false;}
   };return;
 }
 formDialog(FB_LABELS[action],`<div class="form-grid">${html}</div>`,'Save',async(form,key)=>{
   if(plant!==state.plant.id)throw Error('Plant changed. Reopen this action.');
   const body=Object.fromEntries(form);
   for(const name of ['cartons','carton_sloc','work_center','headcount','labor_minutes'])if(body[name]==='')delete body[name];
   if(action==='confirm_completion')body.run_ids=[body.run_ids];
   if(action==='finish_run'){
     if(body.work_center)body.labor=[{work_center:body.work_center,headcount:Number(body.headcount||1),labor_minutes:Number(body.labor_minutes||0)}];
     delete body.work_center;delete body.headcount;delete body.labor_minutes;
   }
   if(action==='return_material'){body.items=[{material:body.material,quantity:body.quantity,uom:body.uom,storage_location:body.storage_location}];for(const k of ['material','quantity','uom','storage_location'])delete body[k];}
   return post(path,{action,body},key);
 },{note: 'Saved locally with an audit record. SAP-linked steps remain queued until synchronization accepts them.'});
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-fb-action]');if(button)fbOpenForm(button.dataset.fbAction,button.dataset.ref);});
