'use strict';
const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => new Intl.NumberFormat('vi-VN').format(n);
const labels = {queued:'Chờ thực hiện',draft:'Nháp',released:'Đã duyệt',in_progress:'Đang thực hiện',on_hold:'Tạm giữ',completed:'Hoàn tất',pending:'Chờ kiểm tra',pass:'Đạt',fail:'Không đạt',quarantine:'Cách ly',rejected:'Loại bỏ',admin:'Quản trị',planner:'Kế hoạch',operator:'Vận hành',quality:'Chất lượng',viewer:'Chỉ xem'};
const badge = s => `<span class="badge ${esc(s)}">${esc(labels[s] || s)}</span>`;
const state = {token:null, plants:[], plant:null, page:'overview', orders:[], routes:[], lots:[], audit:[], detail:null, username:''};
let loadGeneration = 0;
const can = (...roles) => state.plant?.role === 'admin' || roles.includes(state.plant?.role);
const time = value => new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:state.plant?.timezone || 'UTC'}).format(new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value+'Z'));
async function api(path, options = {}) {
  const headers = {'Content-Type':'application/json', ...(state.token ? {Authorization:`Bearer ${state.token}`} : {}), ...options.headers};
  const response = await fetch(path, {...options, headers});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') logoutLocal();
    const detail = Array.isArray(data.detail) ? data.detail.map(x => `${x.loc?.slice(1).join('.')}: ${x.msg}`).join('; ') : data.detail;
    throw new Error(detail || `Không thể thực hiện yêu cầu (${response.status})`);
  }
  return data;
}
const base = () => `/api/plants/${state.plant.id}`;
function post(path, body, key) {
  return api(path, {method:'POST',body:JSON.stringify(body),headers:key ? {'Idempotency-Key':key} : {}});
}
function toast(message) {
  $('#toast').textContent=message; $('#toast').hidden=false;
  clearTimeout(toast.timer); toast.timer=setTimeout(() => $('#toast').hidden=true, 4500);
}
function logoutLocal(){state.token=null;loadGeneration++;$('#dialog').close();$('#workspace').hidden=true;$('#login-screen').hidden=false;$('#content').replaceChildren();$('#login-form').reset();}
$('#logout').onclick=async()=>{try{await post('/api/logout',{});}finally{logoutLocal();}};
$('#login-form').onsubmit=async event=>{
  event.preventDefault();const button=$('button',event.target);button.disabled=true;$('#login-error').textContent='';
  try{const data=await post('/api/login',Object.fromEntries(new FormData(event.target)));state.token=data.token;state.username=data.username;
    state.plants=await api('/api/plants');$('#plant-select').innerHTML=state.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
    state.plant=state.plants[0];state.page='overview';state.detail=null;$('#login-screen').hidden=true;$('#workspace').hidden=false;$('#login-form').reset();
    if(!state.plant){$('#content').innerHTML='<div class="empty">Tài khoản chưa được cấp quyền nhà máy. Liên hệ quản trị viên.</div>';return;}await load();
  }catch(error){$('#login-error').textContent=error.message;}finally{button.disabled=false;}
};
$('#plant-select').onchange=()=>{state.plant=state.plants.find(p=>p.id===Number($('#plant-select').value));state.detail=null;load();};
document.querySelectorAll('nav button').forEach(button=>button.onclick=()=>{state.page=button.dataset.page;state.detail=null;load();});
$('#close-dialog').onclick=()=>$('#dialog').close();
async function load(){
  if(!state.plant)return;
  const generation=++loadGeneration;const path=base();$('#content').innerHTML='<div class="loading">Đang tải dữ liệu nhà máy…</div>';
  $('#user-label').textContent=`${state.username} · ${labels[state.plant.role]}`;
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));
  try{const [orders,routes,lots,audit]=await Promise.all([api(path+'/orders'),api(path+'/routes'),api(path+'/lots'),api(path+'/audit')]);
    if(generation!==loadGeneration)return;Object.assign(state,{orders,routes,lots,audit});render();
  }catch(error){if(generation===loadGeneration)$('#content').innerHTML=`<div class="error-box">${esc(error.message)} <button id="retry-load">Tải lại</button></div>`;const retry=$('#retry-load');if(retry)retry.onclick=load;}
}
function heading(title,subtitle,action=''){return `<div class="page-head"><div><div class="eyebrow">${esc(state.plant.code)} / ${esc(state.plant.name)}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;}
function orderTable(orders){return orders.length?`<div class="table-wrap"><table><thead><tr><th>Lệnh sản xuất</th><th>Sản phẩm</th><th>Kế hoạch</th><th>Công đoạn</th><th>Trạng thái</th><th>Chất lượng</th></tr></thead><tbody>${orders.map(o=>`<tr><td><button class="table-link" data-order="${o.id}">${esc(o.code)}</button></td><td>${esc(o.product)} <small>R${o.revision}</small></td><td>${number(o.planned_qty)} <small>pcs</small></td><td>${o.operations.filter(x=>x.done).length} / ${o.operations.length}</td><td>${badge(o.state)}</td><td>${badge(o.quality)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Chưa có lệnh sản xuất. Tạo lệnh từ quy trình đã cấu hình để bắt đầu.</div>';}
function render(){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));
  if(state.detail){renderDetail();return;}
  const content=$('#content');
  if(state.page==='overview'){
    const active=state.orders.filter(o=>['released','in_progress'].includes(o.state)), held=state.orders.filter(o=>o.state==='on_hold'), completed=state.orders.filter(o=>o.state==='completed');
    const good=completed.reduce((s,o)=>s+(o.operations.at(-1)?.good||0),0);
    content.innerHTML=heading('Điều hành sản xuất','Dữ liệu đang lưu tại nhà máy được chọn · Tối đa 500 lệnh gần nhất', '<button id="refresh">↻ Cập nhật</button>')+
      `<div class="stats"><div class="stat featured"><div class="label">Lệnh đang thực hiện</div><strong>${active.length}</strong><small>Đã phát hành hoặc đang chạy</small></div><div class="stat"><div class="label">Thành phẩm đã đóng lệnh</div><strong>${number(good)}</strong><small>Đơn vị: chiếc / pcs</small></div><div class="stat"><div class="label">Cần xử lý</div><strong>${held.length}</strong><small>Lệnh đang tạm giữ</small></div><div class="stat"><div class="label">Lệnh hoàn tất</div><strong>${completed.length}</strong><small>Đã đạt QC và đóng lệnh</small></div></div>`+
      `<section class="panel"><div class="panel-head"><h3>Lệnh sản xuất gần đây</h3><button class="quiet" id="all-orders">Xem tất cả →</button></div>${orderTable(state.orders.slice(0,6))}</section>`+
      `<div class="two-col"><section class="panel"><div class="panel-head"><h3>Hoạt động mới nhất</h3><span class="subtle">Theo múi giờ nhà máy</span></div><div class="panel-body">${state.audit.slice(0,5).map(a=>`<div class="metric-row"><span>${esc(eventLabel(a.action))}<br><small>${esc(a.actor)} · ${esc(a.entity)} #${a.entity_id}</small></span><small>${time(a.at)}</small></div>`).join('')||'<div class="empty">Chưa có hoạt động.</div>'}</div></section><section class="panel"><div class="panel-head"><h3>Sẵn sàng sản xuất</h3></div><div class="panel-body"><div class="metric-row"><span>Phiên bản quy trình</span><strong>${state.routes.length}</strong></div><div class="metric-row"><span>Lô vật tư đã được duyệt</span><strong>${state.lots.filter(l=>l.quality==='released').length}</strong></div><div class="metric-row"><span>Lô chờ kiểm tra</span><strong>${state.lots.filter(l=>l.quality==='quarantine').length}</strong></div><p class="note">Lệnh phải được cấp đủ vật tư và hoàn tất từng công đoạn trước khi kiểm tra chất lượng cuối.</p></div></section></div>`;
    $('#refresh').onclick=load;$('#all-orders').onclick=()=>{state.page='orders';load();};
  }else if(state.page==='orders'){
    content.innerHTML=heading('Lệnh sản xuất','Quản lý từ phát hành đến hoàn tất và truy xuất nguồn gốc.',can('planner')?'<button class="primary" id="new-order">＋ Tạo lệnh</button>':'')+`<section class="panel"><div class="panel-head"><h3>Danh sách lệnh <small>(${state.orders.length})</small></h3><div class="toolbar"><input id="search-orders" aria-label="Tìm lệnh" placeholder="Tìm mã lệnh, sản phẩm…"><select id="filter-state" aria-label="Lọc trạng thái"><option value="">Tất cả trạng thái</option>${['draft','released','in_progress','on_hold','completed'].map(s=>`<option value="${s}">${labels[s]}</option>`).join('')}</select></div></div><div id="order-table">${orderTable(state.orders)}</div></section>`;
    const filter=()=>{const q=$('#search-orders').value.toLowerCase(),status=$('#filter-state').value;$('#order-table').innerHTML=orderTable(state.orders.filter(o=>(!status||o.state===status)&&`${o.code} ${o.product}`.toLowerCase().includes(q)));bindOrderLinks();};$('#search-orders').oninput=filter;$('#filter-state').onchange=filter;if($('#new-order'))$('#new-order').onclick=newOrder;
  }else if(state.page==='lots'){
    content.innerHTML=heading('Nguyên vật liệu','Kiểm soát lô nhập, quyết định chất lượng và lượng còn có thể cấp.',can('planner')?'<button id="new-lot" class="primary">＋ Nhập lô</button>':'')+`<section class="panel"><div class="table-wrap"><table><thead><tr><th>Mã lô</th><th>Vật tư</th><th>Đã nhận</th><th>Còn lại</th><th>Chất lượng</th><th>Thao tác</th></tr></thead><tbody>${state.lots.map(l=>`<tr><td class="code">${esc(l.code)}</td><td>${esc(l.material)}</td><td>${number(l.received)}</td><td>${number(l.available)} ${esc(l.unit)}</td><td>${badge(l.quality)}</td><td>${l.quality==='quarantine'&&can('quality')?`<button data-lot-qc="${l.id}">Kiểm tra</button> `:''}<button class="quiet" data-where="${l.id}">Đã dùng ở đâu ↗</button></td></tr>`).join('')}</tbody></table></div>${!state.lots.length?'<div class="empty">Chưa có lô vật tư.</div>':''}</section>`;
    if($('#new-lot'))$('#new-lot').onclick=newLot;
    document.querySelectorAll('[data-lot-qc]').forEach(b=>b.onclick=()=>lotQuality(Number(b.dataset.lotQc)));
    document.querySelectorAll('[data-where]').forEach(b=>b.onclick=async()=>{try{const data=await api(`${base()}/lots/${b.dataset.where}/where-used`);showDialog('Lệnh sử dụng lô vật tư',data.length?data.map(x=>`<div class="metric-row"><span>${esc(x.order)} ${badge(x.state)}</span><strong>${number(x.quantity)} pcs</strong></div>`).join(''):'<p>Lô chưa được cấp cho lệnh sản xuất.</p>');}catch(e){toast(e.message);}});
  }else if(state.page==='routes'){
    content.innerHTML=heading('Quy trình & định mức','Mỗi phiên bản là bất biến. Khi thay đổi, tạo một phiên bản mới.',can('planner')?'<button id="new-route" class="primary">＋ Tạo phiên bản</button>':'')+state.routes.map(r=>`<section class="panel"><div class="panel-head"><div><h3>${esc(r.product)} · ${esc(r.name)}</h3><small>Phiên bản R${r.revision} · ${r.steps.length} công đoạn</small></div><span class="badge released">Đã lưu phiên bản</span></div><div class="panel-body"><div class="two-col"><div>${r.steps.map((s,i)=>`<div class="step"><span class="step-num">${i+1}</span><div><h3>${esc(s.name)}</h3><p>${esc(s.work_center)}</p></div></div>`).join('')}</div><div><h3>Định mức cho 1 thành phẩm</h3>${r.bom.map(b=>`<div class="metric-row"><span>${esc(b.material)}</span><strong>${number(b.per_unit)} ${esc(b.unit)}</strong></div>`).join('')}<p class="note">Vật tư được xuất vào sản xuất khi phát hành lệnh. Định mức và công đoạn được giữ theo phiên bản đã chọn.</p></div></div></div></section>`).join('');if($('#new-route'))$('#new-route').onclick=newRoute;
  }else if(state.page==='audit'){
    content.innerHTML=heading('Nhật ký hoạt động','100 sự kiện gần nhất · Chỉ đọc · Thời gian theo nhà máy')+`<section class="panel"><div class="table-wrap"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hoạt động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>${state.audit.map(a=>`<tr><td>${time(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(eventLabel(a.action))}</td><td>${esc(a.entity)} #${a.entity_id}</td><td><button class="quiet" data-audit="${a.id}">Xem bản ghi</button></td></tr>`).join('')}</tbody></table></div>${!state.audit.length?'<div class="empty">Chưa có sự kiện.</div>':''}</section>`;
    document.querySelectorAll('[data-audit]').forEach(b=>b.onclick=()=>{const a=state.audit.find(x=>x.id===Number(b.dataset.audit));showDialog(eventLabel(a.action),`<p>${esc(a.actor)} · ${time(a.at)}</p><pre class="audit-payload">${esc(JSON.stringify(a.payload,null,2))}</pre>`);});
  }
  bindOrderLinks();
}
function eventLabel(s){return {'order.created':'Tạo lệnh sản xuất','order.release':'Phát hành & cấp vật tư','order.record':'Ghi nhận công đoạn','order.hold':'Tạm giữ lệnh','order.resume':'Cho phép chạy lại','order.quality':'Kiểm tra chất lượng','order.complete':'Đóng lệnh','route.created':'Tạo phiên bản quy trình','lot.received':'Nhập lô vật tư','lot.quality':'Duyệt chất lượng vật tư'}[s]||s;}
function bindOrderLinks(){document.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>{state.detail=Number(b.dataset.order);state.page='orders';render();});}
function showDialog(title,body){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;if(!$('#dialog').open)$('#dialog').showModal();}
function formDialog(title,fields,submitLabel,onSubmit){
  showDialog(title,`<form id="modal-form">${fields}<p class="form-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">${submitLabel}</button></div></form>`);
  const key=crypto.randomUUID();
  $('#modal-form').onsubmit=async event=>{event.preventDefault();const form=event.target,button=$('button[type=submit]',form);button.disabled=true;$('.form-error',form).textContent='';
    try{await onSubmit(new FormData(form),key,form);$('#dialog').close();toast('Đã lưu thay đổi');await load();}catch(e){$('.form-error',form).textContent=e.message;}finally{button.disabled=false;}};
}
function newOrder(){
  if(!state.routes.length){toast('Cần tạo quy trình và BOM trước.');return;}
  const path=base();formDialog('Tạo lệnh sản xuất',`<label>Mã lệnh<input name="code" required pattern="[A-Za-z0-9_.-]+" placeholder="WO-2026-001" maxlength="80"></label><label>Quy trình / phiên bản<select name="route_id">${state.routes.map(r=>`<option value="${r.id}">${esc(r.product)} · R${r.revision} · ${esc(r.name)}</option>`).join('')}</select></label><label>Số lượng kế hoạch (pcs)<input name="planned_qty" type="number" min="1" max="100000000" step="1" required></label>`,'Tạo lệnh nháp',(f,key)=>post(path+'/orders',{code:f.get('code'),route_id:Number(f.get('route_id')),planned_qty:Number(f.get('planned_qty'))},key));
}
function newLot(){const path=base();formDialog('Nhập lô nguyên vật liệu','<label>Mã lô<input name="code" required pattern="[A-Za-z0-9_.-]+" maxlength="80"></label><label>Mã vật tư<input name="material" required pattern="[A-Za-z0-9_.-]+" maxlength="80"></label><label>Số lượng nhận (pcs)<input name="quantity" type="number" min="1" step="1" max="100000000" required></label><p class="note">Lô mới ở trạng thái cách ly. Bộ phận chất lượng phải duyệt trước khi cấp vào sản xuất.</p>','Nhập lô',f=>post(path+'/lots',{code:f.get('code'),material:f.get('material'),quantity:Number(f.get('quantity'))}));}
function lotQuality(id){const path=base();formDialog('Kiểm tra chất lượng lô','<label>Kết quả<select name="decision"><option value="released">Đạt — cho phép sử dụng</option><option value="rejected">Không đạt — loại bỏ</option></select></label><label>Biên bản / lý do<textarea name="reason" required minlength="3" maxlength="500"></textarea></label>','Lưu quyết định',f=>post(`${path}/lots/${id}/quality`,Object.fromEntries(f)));}
function newRoute(){
  const path=base();formDialog('Tạo phiên bản quy trình','<div class="form-grid"><label>Mã sản phẩm<input name="product" required pattern="[A-Za-z0-9_.-]+" maxlength="80"></label><label>Phiên bản<input name="revision" type="number" min="1" step="1" value="1" required></label></div><label>Tên quy trình<input name="name" required maxlength="160"></label><div class="section-caption">CÔNG ĐOẠN THEO THỨ TỰ</div><div id="step-rows"></div><button type="button" id="add-step">＋ Thêm công đoạn</button><div class="section-caption">BOM — VẬT TƯ CHO 1 THÀNH PHẨM</div><div id="bom-rows"></div><button type="button" id="add-bom">＋ Thêm vật tư</button>','Lưu phiên bản',(f,key,form)=>post(path+'/routes',{product:f.get('product'),revision:Number(f.get('revision')),name:f.get('name'),steps:[...form.querySelectorAll('.step-input')].map(row=>({name:$('[data-name]',row).value,work_center:$('[data-center]',row).value})),bom:[...form.querySelectorAll('.bom-input')].map(row=>({material:$('[data-material]',row).value,per_unit:Number($('[data-qty]',row).value),unit:'pcs'}))}));
  const row=(kind)=>{const div=document.createElement('div');div.className=`inline-row ${kind}-input`;div.innerHTML=kind==='step'?'<input data-name aria-label="Tên công đoạn" placeholder="Tên công đoạn" required maxlength="160"><input data-center aria-label="Trạm làm việc" placeholder="Trạm làm việc" required maxlength="100"><button type="button" aria-label="Xóa dòng">×</button>':'<input data-material aria-label="Mã vật tư" placeholder="Mã vật tư" pattern="[A-Za-z0-9_.-]+" required maxlength="80"><input data-qty aria-label="Số chiếc trên thành phẩm" placeholder="Số pcs / thành phẩm" type="number" min="1" step="1" required><button type="button" aria-label="Xóa dòng">×</button>';$('button',div).onclick=()=>div.remove();$(`#${kind==='step'?'step':'bom'}-rows`).append(div);};$('#add-step').onclick=()=>row('step');$('#add-bom').onclick=()=>row('bom');row('step');row('bom');
}
function renderDetail(){
  const order=state.orders.find(o=>o.id===state.detail);if(!order){state.detail=null;render();return;}
  let actions='';
  if(order.state==='draft'&&can('planner'))actions+='<button class="primary" data-action="release">Phát hành & cấp vật tư</button>';
  if(['released','in_progress'].includes(order.state)&&can('planner','operator','quality'))actions+='<button data-action="hold">Tạm giữ lệnh</button>';
  if(order.state==='on_hold'&&can('quality'))actions+='<button data-action="resume">Cho phép chạy lại</button>';
  if(order.state==='in_progress'&&order.operations.every(x=>x.done)&&can('quality'))actions+='<button data-action="quality">Kiểm tra chất lượng cuối</button>';
  if(order.state==='in_progress'&&order.quality==='pass'&&can('planner'))actions+='<button class="primary" data-action="complete">Đóng lệnh</button>';
  $('#content').innerHTML=`<button class="quiet" id="back-orders">← Danh sách lệnh</button>`+heading(esc(order.code),`${esc(order.product)} · Quy trình R${order.revision}`,badge(order.state))+`<div class="detail-meta"><div><span>Kế hoạch</span> <strong>${number(order.planned_qty)} pcs</strong></div><div><span>Chất lượng</span> ${badge(order.quality)}</div><div><span>Tạo lúc</span> ${time(order.created_at)}</div></div>${order.hold_reason?`<div class="error-box">Lý do tạm giữ: ${esc(order.hold_reason)}</div>`:''}<div class="actions">${actions}<button id="trace">Truy xuất nguồn gốc ↗</button></div><section class="panel"><div class="panel-head"><h3>Tiến độ từng công đoạn</h3><small>Ghi nhận theo thứ tự · Đơn vị pcs</small></div><div class="panel-body">${order.operations.map((op,i)=>{const capacity=i===0?order.planned_qty:order.operations[i-1].good;const enabled=['released','in_progress'].includes(order.state)&&!op.done&&(i===0||order.operations[i-1].done)&&can('operator');return `<div class="step"><span class="step-num">${op.done?'✓':op.sequence}</span><div><h3>${esc(op.name)} <small>${esc(op.work_center)}</small></h3><p>Đạt: ${number(op.good)} · Phế: ${number(op.scrap)} · Đầu vào ${i>0&&!order.operations[i-1].done?'dự kiến':''}: ${number(capacity)}</p></div>${enabled?`<button data-record="${op.id}">Ghi nhận sản lượng</button>`:badge(op.done?'completed':(op.good+op.scrap>0?'in_progress':'queued'))}</div>`;}).join('')}</div></section><p class="note">Chỉ thành phẩm đạt từ công đoạn trước mới được chuyển tiếp. Kết thúc công đoạn yêu cầu ghi nhận đầy đủ số lượng đầu vào.</p>`;
  $('#back-orders').onclick=()=>{state.detail=null;render();};document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>orderAction(order,b.dataset.action));document.querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>orderAction(order,'record',Number(b.dataset.record)));
  $('#trace').onclick=async()=>{try{const t=await api(`${base()}/orders/${order.id}/trace`);showDialog(`Truy xuất · ${order.code}`,`<h3>Lô vật tư đầu vào</h3>${t.inputs.map(l=>`<div class="metric-row"><span>${esc(l.lot)}<br><small>${esc(l.material)}</small></span><strong>${number(l.quantity)} ${esc(l.unit)}</strong></div>`).join('')||'<p>Chưa cấp vật tư.</p>'}<h3 class="section-caption">LÔ THÀNH PHẨM</h3><p>${t.output_lot?esc(t.output_lot):'Chưa đóng lệnh'}</p><h3 class="section-caption">LỊCH SỬ LỆNH</h3><div class="trace-list">${t.events.map(a=>`<div class="trace-item"><small>${time(a.at)} · ${esc(a.actor)}</small>${esc(eventLabel(a.action))}</div>`).join('')}</div>`);}catch(e){toast(e.message);}};
}
function orderAction(order,action,operationId){
  const path=`${base()}/orders/${order.id}/actions`;let fields='',title=eventLabel('order.'+action),allocations=[];
  if(action==='release'){
    const route=state.routes.find(r=>r.id===order.route_id);fields='<p class="note">Chọn số lượng từ các lô đã được QC duyệt. Tổng cấp của từng vật tư phải bằng đúng định mức.</p>';
    for(const bom of route.bom){const eligible=state.lots.filter(l=>l.material===bom.material&&l.quality==='released'&&l.available>0);fields+=`<h3>${esc(bom.material)} · Cần ${number(bom.per_unit*order.planned_qty)} pcs</h3>`;if(!eligible.length)fields+='<p class="error">Chưa có lô đạt chất lượng và còn tồn kho.</p>';for(const lot of eligible){allocations.push(lot.id);fields+=`<label>${esc(lot.code)} — còn ${number(lot.available)} pcs<input name="lot-${lot.id}" type="number" min="0" max="${lot.available}" step="1" value="0"></label>`;}}
  }else if(action==='record')fields='<div class="form-grid"><label>Số lượng đạt<input name="good" type="number" min="0" step="1" value="0" required></label><label>Số lượng phế phẩm<input name="scrap" type="number" min="0" step="1" value="0" required></label></div><label>Lý do phế phẩm / ghi chú<textarea name="reason" maxlength="500"></textarea></label><label class="checkbox"><input name="finish" type="checkbox"> Kết thúc công đoạn sau khi ghi nhận</label>';
  else if(action==='quality')fields='<label>Kết quả<select name="decision"><option value="pass">Đạt</option><option value="fail">Không đạt — tạm giữ lệnh</option></select></label><label>Biên bản kiểm tra<textarea name="reason" required minlength="3" maxlength="500"></textarea></label>';
  else fields=`<label>${action==='complete'?'Ghi chú đóng lệnh (bắt buộc khi thiếu sản lượng)':'Lý do / biện pháp xử lý'}<textarea name="reason" ${action==='complete'?'':'required minlength="3"'} maxlength="500"></textarea></label>${action==='complete'?'<p class="note">Sau khi đóng, lệnh không thể sửa. Lô thành phẩm được nhận diện bằng mã lệnh trong nhà máy này.</p>':''}`;
  formDialog(title,fields,'Xác nhận', (f,key)=>{const body={action,version:order.version};if(action==='release')body.allocations=allocations.map(id=>({lot_id:id,quantity:Number(f.get('lot-'+id))})).filter(x=>x.quantity>0);else if(action==='record')Object.assign(body,{operation_id:operationId,good:Number(f.get('good')),scrap:Number(f.get('scrap')),finish:f.has('finish'),reason:f.get('reason')});else if(action==='quality')Object.assign(body,{decision:f.get('decision'),reason:f.get('reason')});else body.reason=f.get('reason');return post(path,body,key);});
}
