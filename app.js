/* ===================================================================
   ระบบประเมินผลการดำเนินงาน คปสอ. 2570  — frontend (vanilla JS)
   =================================================================== */
const cfg = window.APP_CONFIG;
const db  = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const DISTRICTS = [
  {no:1,name:'เมืองพิษณุโลก'},{no:2,name:'นครไทย'},{no:3,name:'ชาติตระการ'},
  {no:4,name:'บางระกำ'},{no:5,name:'บางกระทุ่ม'},{no:6,name:'พรหมพิราม'},
  {no:7,name:'วัดโบสถ์'},{no:8,name:'วังทอง'},{no:9,name:'เนินมะปราง'},
];
const COMPS = [
  ['p','Plan','การวางแผน'],['d','Do','การดำเนินการ'],['c','Check','การตรวจสอบ/ติดตาม'],
  ['a','Act','การปรับปรุงพัฒนา'],['r','Results','ผลผลิต/ผลลัพธ์'],
];
const CATS = ['งานประจำ/ภารกิจพื้นฐาน','งานนโยบาย','งานยุทธศาสตร์','อื่นๆ'];

function gradeOf(s){
  if(s==null||isNaN(s)) return null;
  if(s>=90) return {t:'ดีเยี่ยม',c:'g1'};
  if(s>=80) return {t:'ดีมาก',c:'g2'};
  if(s>=50) return {t:'ดี',c:'g3'};
  return {t:'ต้องปรับปรุง',c:'g4'};
}
// S ของประเด็น ณ อำเภอหนึ่ง = 15*ค่าเฉลี่ย(5 องค์ประกอบ)+25 (ต้องครบ 5 ช่อง)
function sOfRow(row){
  if(!row) return null;
  const v=[row.p,row.d,row.c,row.a,row.r];
  if(v.some(x=>x==null)) return null;
  return 15*(v.reduce((a,b)=>a+b,0)/5)+25;
}
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const $=id=>document.getElementById(id);

let ST = { user:null, role:null, groupId:null, weights:{w1:60,w2:40} };

/* ---------------- Auth ---------------- */
async function init(){
  if(cfg.TITLE){ $('loginTitle').textContent=cfg.TITLE; $('appTitle').textContent=cfg.TITLE; }
  if(cfg.SUBTITLE){ $('appSub').textContent=cfg.SUBTITLE; }
  const {data}=await db.auth.getSession();
  if(data.session){ await afterLogin(data.session.user); } else { showLogin(); }
}
function showLogin(){ $('app').classList.add('hidden'); $('login').classList.remove('hidden'); }

$('loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  $('loginMsg').innerHTML='';
  const u=$('username').value.trim().toLowerCase();
  const email = u.includes('@') ? u : (u+'@'+cfg.LOGIN_DOMAIN);
  const {data,error}=await db.auth.signInWithPassword({email,password:$('password').value});
  if(error){ $('loginMsg').innerHTML='<div class="msg err">เข้าสู่ระบบไม่สำเร็จ: ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง</div>'; return; }
  await afterLogin(data.user);
});
$('logoutBtn').addEventListener('click', async ()=>{ await db.auth.signOut(); location.reload(); });

async function afterLogin(user){
  ST.user=user;
  const {data:prof,error}=await db.from('profiles').select('role,group_id').eq('user_id',user.id).single();
  if(error||!prof){ $('loginMsg').innerHTML='<div class="msg err">บัญชีนี้ยังไม่ได้ผูกกลุ่ม/บทบาท กรุณาแจ้งผู้ดูแลระบบ</div>'; await db.auth.signOut(); return; }
  ST.role=prof.role; ST.groupId=prof.group_id;
  const {data:set}=await db.from('settings').select('*').eq('id',1).single();
  if(set){ ST.weights={w1:Number(set.weight1),w2:Number(set.weight2)}; }
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  if(ST.role==='admin'){
    $('whoBox').innerHTML='ผู้ดูแลระบบ (Admin)';
    buildTabs([['accounts','บัญชี/กลุ่มงาน'],['kpi','กรอก KPI 60%'],['results','ผลรวม 60/40']]);
  }else{
    const {data:g}=await db.from('groups').select('name').eq('id',ST.groupId).single();
    $('whoBox').innerHTML=esc(g?g.name:('กลุ่ม '+ST.groupId));
    buildTabs([['topics','ประเด็นการประเมิน'],['score','ให้คะแนน PDCA'],['result','ผลของกลุ่ม'],['info','ข้อมูลกลุ่ม']]);
  }
}

/* ---------------- Tabs ---------------- */
let TABS=[];
function buildTabs(tabs){
  TABS=tabs;
  $('tabs').innerHTML=tabs.map(([k,label],i)=>`<button data-k="${k}" class="${i===0?'active':''}">${esc(label)}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    $('tabs').querySelectorAll('button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); route(b.dataset.k);
  });
  route(tabs[0][0]);
}
function route(k){
  const v=$('view'); v.innerHTML='<div class="card">กำลังโหลด…</div>';
  ({topics:viewTopics,score:viewScore,result:viewGroupResult,info:viewInfo,
    accounts:viewAccounts,kpi:viewKpi,results:viewResults}[k])();
}

/* ============ GROUP: จัดการประเด็น ============ */
async function viewTopics(){
  const [{data:g},{data:topics}]=await Promise.all([
    db.from('groups').select('topics_locked').eq('id',ST.groupId).single(),
    db.from('topics').select('*').eq('group_id',ST.groupId).order('id'),
  ]);
  const locked=g&&g.topics_locked;
  const list=(topics||[]).map(t=>`
    <tr>
      <td class="name">${esc(t.name)}</td>
      <td>${esc(t.category||'')}</td>
      <td class="name">${esc(t.resp_name||'')}${t.resp_position?'<br><span style="color:#667085;font-size:12.5px">'+esc(t.resp_position)+'</span>':''}</td>
      <td>${locked?'':`<button class="btn danger sm" data-del="${t.id}">ลบ</button>`}</td>
    </tr>`).join('');
  $('view').innerHTML=`
    <div class="card">
      <h2>ประเด็นการประเมินของกลุ่ม
        <span class="pill ${locked?'lock':'open'}">${locked?'ล็อกแล้ว (แก้ไขไม่ได้)':'เปิดให้เพิ่ม/แก้ไข'}</span></h2>
      <p class="hint">เพิ่มเฉพาะประเด็น/งานย่อยที่กลุ่มของท่านรับผิดชอบ เมื่อผู้ดูแลระบบล็อกแล้วจะแก้ไขไม่ได้ และเริ่มให้คะแนนในแท็บ “ให้คะแนน PDCA”</p>
      <table>
        <thead><tr><th class="name">ชื่อประเด็น/งานย่อย</th><th>ประเภทงาน</th><th class="name">ผู้รับผิดชอบ</th><th>จัดการ</th></tr></thead>
        <tbody>${list||'<tr><td colspan="4" style="color:#667085">ยังไม่มีประเด็น</td></tr>'}</tbody>
      </table>
    </div>
    ${locked?'':`
    <div class="card">
      <h2>เพิ่มประเด็นใหม่</h2>
      <div class="row">
        <div style="flex:2"><label class="fld">ชื่อประเด็น/งานย่อย *</label><input id="nt_name"></div>
        <div><label class="fld">ประเภทงาน</label>
          <select id="nt_cat">${CATS.map(c=>`<option>${c}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div><label class="fld">ผู้รับผิดชอบ (ชื่อ)</label><input id="nt_rn"></div>
        <div><label class="fld">ตำแหน่ง</label><input id="nt_rp"></div>
      </div>
      <div id="nt_msg"></div>
      <button class="btn" id="nt_add" style="margin-top:14px">+ เพิ่มประเด็น</button>
    </div>`}`;
  $('view').querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    if(!confirm('ลบประเด็นนี้และคะแนนที่เกี่ยวข้อง?')) return;
    await db.from('topics').delete().eq('id',b.dataset.del); viewTopics();
  });
  const add=$('nt_add');
  if(add) add.onclick=async()=>{
    const name=$('nt_name').value.trim();
    if(!name){ $('nt_msg').innerHTML='<div class="msg err">กรุณากรอกชื่อประเด็น</div>'; return; }
    const {error}=await db.from('topics').insert({group_id:ST.groupId,name,
      category:$('nt_cat').value,resp_name:$('nt_rn').value.trim(),resp_position:$('nt_rp').value.trim()});
    if(error){ $('nt_msg').innerHTML='<div class="msg err">บันทึกไม่สำเร็จ: '+esc(error.message)+'</div>'; return; }
    viewTopics();
  };
}

/* ============ GROUP: ให้คะแนน PDCA ============ */
async function viewScore(){
  const {data:topics}=await db.from('topics').select('*').eq('group_id',ST.groupId).order('id');
  if(!topics||!topics.length){ $('view').innerHTML='<div class="card">ยังไม่มีประเด็น กรุณาเพิ่มในแท็บ “ประเด็นการประเมิน” ก่อน</div>'; return; }
  const ids=topics.map(t=>t.id);
  const {data:scores}=await db.from('scores').select('*').in('topic_id',ids);
  const map={}; (scores||[]).forEach(s=>map[s.topic_id+'_'+s.dno]=s);

  const cards=topics.map(t=>{
    const rows=DISTRICTS.map(dc=>{
      const s=map[t.id+'_'+dc.no]||{};
      const inputs=COMPS.map(([k])=>`<td><input type="number" min="1" max="5" data-t="${t.id}" data-dno="${dc.no}" data-f="${k}" value="${s[k]??''}"></td>`).join('');
      const sv=sOfRow(s);
      return `<tr><td class="name">${esc(dc.name)}</td>${inputs}<td data-s="${t.id}_${dc.no}">${sv==null?'-':sv.toFixed(1)}</td></tr>`;
    }).join('');
    return `<div class="topic-card">
      <div class="topic-head"><div class="t"><b>${esc(t.name)}</b>
        <div class="meta">${esc(t.category||'')}${t.resp_name?' · '+esc(t.resp_name):''}</div></div></div>
      <table class="score-tbl">
        <thead><tr><th class="name">อำเภอ</th>${COMPS.map(c=>`<th title="${c[2]}">${c[1]}</th>`).join('')}<th>S</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }).join('');
  $('view').innerHTML=`<div class="card">
    <h2>ให้คะแนน PDCA (ระดับ 1–5) ครบ 9 อำเภอ ทุกประเด็น</h2>
    <p class="hint">P=วางแผน · D=ดำเนินการ · C=ตรวจสอบ/ติดตาม · A=ปรับปรุงพัฒนา · R=ผลลัพธ์ | S = 15×ค่าเฉลี่ย + 25 (คำนวณเมื่อกรอกครบ 5 ช่อง) · ระบบบันทึกอัตโนมัติเมื่อกรอก</p>
    <span id="sv_msg"></span>
  </div>${cards}`;

  $('view').querySelectorAll('input[type=number]').forEach(inp=>{
    inp.onchange=async()=>{
      let val=inp.value===''?null:Math.round(Number(inp.value));
      if(val!=null && (val<1||val>5)){ val=Math.min(5,Math.max(1,val)); inp.value=val; }
      const tid=inp.dataset.t, dno=Number(inp.dataset.dno), f=inp.dataset.f;
      const key=tid+'_'+dno; const cur=map[key]||{topic_id:Number(tid),dno};
      cur[f]=val; map[key]=cur;
      const payload={topic_id:Number(tid),dno,p:cur.p??null,d:cur.d??null,c:cur.c??null,a:cur.a??null,r:cur.r??null};
      const {error}=await db.from('scores').upsert(payload,{onConflict:'topic_id,dno'});
      const m=$('sv_msg');
      if(error){ m.innerHTML='<div class="msg err">บันทึกไม่สำเร็จ: '+esc(error.message)+'</div>'; }
      else{ m.innerHTML='<div class="msg ok">บันทึกแล้ว</div>'; setTimeout(()=>m.innerHTML='',1200); }
      const sv=sOfRow(cur); const cell=$('view').querySelector(`[data-s="${key}"]`);
      if(cell) cell.textContent = sv==null?'-':sv.toFixed(1);
    };
  });
}

/* ============ GROUP: ผลของกลุ่ม ============ */
async function viewGroupResult(){
  const {data:topics}=await db.from('topics').select('id').eq('group_id',ST.groupId);
  const ids=(topics||[]).map(t=>t.id);
  let scores=[]; if(ids.length){ const r=await db.from('scores').select('*').in('topic_id',ids); scores=r.data||[]; }
  const perDist=DISTRICTS.map(dc=>{
    const ss=scores.filter(s=>s.dno===dc.no).map(sOfRow).filter(x=>x!=null);
    return {name:dc.name, s: ss.length? ss.reduce((a,b)=>a+b,0)/ss.length : null};
  });
  const valid=perDist.filter(d=>d.s!=null).map(d=>d.s);
  const avg=valid.length? valid.reduce((a,b)=>a+b,0)/valid.length : null;
  $('view').innerHTML=`<div class="card">
    <h2>ผลคะแนนส่วนที่ 2 (PDCA) ของกลุ่มท่าน รายอำเภอ</h2>
    <p class="hint">ค่าเฉลี่ย S ของทุกประเด็นในกลุ่ม แยกตามอำเภอ (0–100)</p>
    <table><thead><tr><th class="name">อำเภอ</th><th>คะแนน S ของกลุ่ม</th></tr></thead>
    <tbody>${perDist.map(d=>`<tr><td class="name">${esc(d.name)}</td><td>${d.s==null?'-':d.s.toFixed(2)}</td></tr>`).join('')}
    <tr style="font-weight:700;background:#f4f7f9"><td class="name">เฉลี่ยทั้งกลุ่ม</td><td>${avg==null?'-':avg.toFixed(2)}</td></tr>
    </tbody></table></div>`;
}

/* ============ GROUP: ข้อมูลกลุ่ม ============ */
async function viewInfo(){
  const {data:g}=await db.from('groups').select('*').eq('id',ST.groupId).single();
  $('view').innerHTML=`<div class="card">
    <h2>ข้อมูลกลุ่มงาน</h2>
    <p class="hint">กำหนดผู้ประสานงานหลักและเมลล์กลางของกลุ่ม (ผู้ดูแลระบบใช้อ้างอิงในการประสานงาน)</p>
    <label class="fld">ชื่อกลุ่มงาน</label><input value="${esc(g.name)}" disabled>
    <label class="fld">ผู้ประสานงานหลัก</label><input id="g_co" value="${esc(g.coordinator||'')}">
    <label class="fld">เมลล์กลางของกลุ่มงาน</label><input id="g_mail" value="${esc(g.central_email||'')}">
    <div id="g_msg"></div>
    <button class="btn" id="g_save" style="margin-top:14px">บันทึก</button>
  </div>`;
  $('g_save').onclick=async()=>{
    const {error}=await db.from('groups').update({coordinator:$('g_co').value.trim(),central_email:$('g_mail').value.trim()}).eq('id',ST.groupId);
    $('g_msg').innerHTML=error?'<div class="msg err">บันทึกไม่สำเร็จ</div>':'<div class="msg ok">บันทึกแล้ว</div>';
  };
}

/* ============ ADMIN: บัญชี/กลุ่มงาน ============ */
async function viewAccounts(){
  const {data:groups}=await db.from('groups').select('*').order('id');
  const {data:tc}=await db.from('topics').select('group_id');
  const count={}; (tc||[]).forEach(t=>count[t.group_id]=(count[t.group_id]||0)+1);
  const rows=(groups||[]).map(g=>`
    <tr>
      <td>${g.id}</td>
      <td class="name">${esc(g.name)}<div style="color:#667085;font-size:12.5px">ผู้ใช้: group${g.id}</div></td>
      <td>${count[g.id]||0}</td>
      <td><span class="pill ${g.topics_locked?'lock':'open'}">${g.topics_locked?'ล็อก':'เปิด'}</span></td>
      <td class="name"><input data-co="${g.id}" value="${esc(g.coordinator||'')}" placeholder="ผู้ประสานงาน" style="width:140px"></td>
      <td class="name"><input data-mail="${g.id}" value="${esc(g.central_email||'')}" placeholder="เมลล์กลาง" style="width:170px"></td>
      <td style="white-space:nowrap">
        <button class="btn sec sm" data-save="${g.id}">บันทึก</button>
        <button class="btn sec sm" data-lock="${g.id}">${g.topics_locked?'ปลดล็อก':'ล็อก'}</button>
      </td>
    </tr>`).join('');
  $('view').innerHTML=`<div class="card">
    <h2>บัญชีและกลุ่มงาน (15 กลุ่ม)</h2>
    <p class="hint">ชื่อผู้ใช้ของแต่ละกลุ่มคือ <b>group1…group15</b> (รหัสผ่านตั้งใน Supabase > Authentication) · กด “ล็อก” เมื่อปิดรับการเพิ่มประเด็นและเริ่มให้คะแนน</p>
    <div id="ac_msg"></div>
    <table><thead><tr><th>#</th><th class="name">กลุ่มงาน</th><th>ประเด็น</th><th>สถานะ</th><th class="name">ผู้ประสานงาน</th><th class="name">เมลล์กลาง</th><th>จัดการ</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
  $('view').querySelectorAll('[data-save]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.save;
    const {error}=await db.from('groups').update({
      coordinator:$('view').querySelector(`[data-co="${id}"]`).value.trim(),
      central_email:$('view').querySelector(`[data-mail="${id}"]`).value.trim()}).eq('id',id);
    $('ac_msg').innerHTML=error?'<div class="msg err">บันทึกไม่สำเร็จ</div>':'<div class="msg ok">บันทึกกลุ่ม '+id+' แล้ว</div>';
  });
  $('view').querySelectorAll('[data-lock]').forEach(b=>b.onclick=async()=>{
    const id=b.dataset.lock;
    const {data:g}=await db.from('groups').select('topics_locked').eq('id',id).single();
    await db.from('groups').update({topics_locked:!g.topics_locked}).eq('id',id);
    viewAccounts();
  });
}

/* ============ ADMIN: กรอก KPI 60% + น้ำหนัก ============ */
async function viewKpi(){
  const {data:kpi}=await db.from('kpi_scores').select('*');
  const map={}; (kpi||[]).forEach(k=>map[k.dno]=k.percent);
  $('view').innerHTML=`<div class="card">
    <h2>ส่วนที่ 1 — ร้อยละผ่านเกณฑ์ Health KPI (60%)</h2>
    <p class="hint">กรอกร้อยละผ่านตัวชี้วัดของแต่ละอำเภอ (0–100) ผู้ดูแลระบบกรอกเอง</p>
    <div class="kpi-grid">
      ${DISTRICTS.map(dc=>`<div class="kbox"><div class="t">${esc(dc.name)}</div>
        <input type="number" min="0" max="100" step="0.01" data-kpi="${dc.no}" value="${map[dc.no]??''}"></div>`).join('')}
    </div>
    <div id="kpi_msg"></div>
    <button class="btn" id="kpi_save" style="margin-top:16px">บันทึก KPI</button>
  </div>
  <div class="card">
    <h2>น้ำหนักการประเมิน</h2>
    <div class="row">
      <div><label class="fld">ส่วนที่ 1 (KPI) %</label><input type="number" id="w1" value="${ST.weights.w1}"></div>
      <div><label class="fld">ส่วนที่ 2 (PDCA) %</label><input type="number" id="w2" value="${ST.weights.w2}"></div>
      <div><button class="btn sec" id="w_save">บันทึกน้ำหนัก</button></div>
    </div><div id="w_msg"></div>
  </div>`;
  $('kpi_save').onclick=async()=>{
    const rows=DISTRICTS.map(dc=>{
      const v=$('view').querySelector(`[data-kpi="${dc.no}"]`).value;
      return {dno:dc.no, percent:v===''?null:Number(v)};
    }).filter(r=>r.percent!=null);
    const {error}=await db.from('kpi_scores').upsert(rows,{onConflict:'dno'});
    $('kpi_msg').innerHTML=error?'<div class="msg err">บันทึกไม่สำเร็จ: '+esc(error.message)+'</div>':'<div class="msg ok">บันทึกแล้ว</div>';
  };
  $('w_save').onclick=async()=>{
    const w1=Number($('w1').value), w2=Number($('w2').value);
    const {error}=await db.from('settings').update({weight1:w1,weight2:w2}).eq('id',1);
    if(!error){ ST.weights={w1,w2}; $('w_msg').innerHTML='<div class="msg ok">บันทึกแล้ว</div>'; }
    else $('w_msg').innerHTML='<div class="msg err">บันทึกไม่สำเร็จ</div>';
  };
}

/* ============ ADMIN: ผลรวม 60/40 ============ */
async function viewResults(){
  const [{data:groups},{data:topics},{data:kpi}]=await Promise.all([
    db.from('groups').select('id,name'),
    db.from('topics').select('id,group_id'),
    db.from('kpi_scores').select('*'),
  ]);
  const ids=(topics||[]).map(t=>t.id);
  let scores=[]; if(ids.length){ const r=await db.from('scores').select('*').in('topic_id',ids); scores=r.data||[]; }
  const topicGroup={}; (topics||[]).forEach(t=>topicGroup[t.id]=t.group_id);
  const kpiMap={}; (kpi||[]).forEach(k=>kpiMap[k.dno]=Number(k.percent));
  const w1=ST.weights.w1/100, w2=ST.weights.w2/100;

  const rows=DISTRICTS.map(dc=>{
    // part2 = ค่าเฉลี่ย S ของแต่ละกลุ่ม (เฉพาะกลุ่มที่มีประเด็นให้คะแนนในอำเภอนี้)
    const byGroup={};
    scores.filter(s=>s.dno===dc.no).forEach(s=>{
      const sv=sOfRow(s); if(sv==null) return;
      const g=topicGroup[s.topic_id]; (byGroup[g]=byGroup[g]||[]).push(sv);
    });
    const groupS=Object.values(byGroup).map(arr=>arr.reduce((a,b)=>a+b,0)/arr.length);
    const part2 = groupS.length? groupS.reduce((a,b)=>a+b,0)/groupS.length : null;
    const part1 = kpiMap[dc.no]!=null? kpiMap[dc.no] : null;
    let total=null;
    if(part1!=null && part2!=null) total=part1*w1+part2*w2;
    const g=gradeOf(total);
    return {name:dc.name, part1, part2, total, g, ng:groupS.length};
  });
  const done=rows.filter(r=>r.total!=null).map(r=>r.total);
  const avg=done.length? done.reduce((a,b)=>a+b,0)/done.length : null;

  $('view').innerHTML=`<div class="card">
    <h2>ผลการประเมินรวม 60/40 รายอำเภอ</h2>
    <p class="hint">รวม = (KPI × ${ST.weights.w1}%) + (PDCA × ${ST.weights.w2}%) · เกรด: ดีเยี่ยม ≥90 · ดีมาก 80–89.99 · ดี 50–79.99 · ต้องปรับปรุง &lt;50</p>
    <table>
      <thead><tr><th class="name">อำเภอ</th><th>ส่วนที่ 1<br>KPI (${ST.weights.w1}%)</th><th>ส่วนที่ 2<br>PDCA (${ST.weights.w2}%)</th><th>คะแนนรวม</th><th>ระดับ</th><th>กลุ่มที่ประเมิน</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr>
          <td class="name">${esc(r.name)}</td>
          <td>${r.part1==null?'-':r.part1.toFixed(2)}</td>
          <td>${r.part2==null?'-':r.part2.toFixed(2)}</td>
          <td class="big" style="font-size:18px">${r.total==null?'-':r.total.toFixed(2)}</td>
          <td>${r.g?`<span class="pill ${r.g.c}">${r.g.t}</span>`:'-'}</td>
          <td>${r.ng}/15</td></tr>`).join('')}
        <tr style="font-weight:700;background:#f4f7f9"><td class="name">เฉลี่ยทั้งจังหวัด</td><td></td><td></td><td>${avg==null?'-':avg.toFixed(2)}</td><td></td><td></td></tr>
      </tbody>
    </table>
    <button class="btn sec sm" id="csv" style="margin-top:14px">ดาวน์โหลด CSV</button>
  </div>`;
  $('csv').onclick=()=>{
    const head=['อำเภอ','KPI_'+ST.weights.w1,'PDCA_'+ST.weights.w2,'รวม','ระดับ'];
    const lines=[head.join(',')].concat(rows.map(r=>[r.name,r.part1??'',r.part2==null?'':r.part2.toFixed(2),r.total==null?'':r.total.toFixed(2),r.g?r.g.t:''].join(',')));
    const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ผลประเมินคปสอ2570.csv'; a.click();
  };
}

init();
