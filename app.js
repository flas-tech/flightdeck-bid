const $=id=>document.getElementById(id);
const key='flightdeck-bid-v1';
const preset=await fetch('./presets/pdk.json').then(r=>{if(!r.ok)throw Error('Cannot load preset');return r.json()});
const pilots=Array.from({length:12},(_,i)=>({id:`P${i+1}`,name:`Demo Pilot ${String(i+1).padStart(2,'0')}`,qualifications:i%3===0?['G280 PIC','G550 SIC']:i%3===1?['G550 PIC']:['G280 SIC']}));
function fresh(){return {policy:structuredClone(preset),pilots,requests:[],training:[]}}
let state;try{state=JSON.parse(localStorage.getItem(key))||fresh();if(!state.policy||!Array.isArray(state.requests))state=fresh()}catch{state=fresh()}
let role='Employee',view='Calendar';
function persist(){localStorage.setItem(key,JSON.stringify(state))}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function days(){const [y,m]=$('month').value.split('-').map(Number);return Array.from({length:new Date(y,m,0).getDate()},(_,i)=>`${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`)}
function approvedCount(date){return new Set(state.requests.filter(r=>r.date===date&&r.status==='approved'&&state.policy.countedCodes.includes(r.code)).map(r=>r.pilot)).size}
function render(){
$('identity').textContent=`${role} · ${view}`;
$('summary').textContent=`${state.pilots.length} fictional pilots | Absence cap: ${state.policy.absenceCap} | ${state.requests.length} requests`;
$('pilot').innerHTML=state.pilots.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.qualifications.join(', '))})</option>`).join('');
$('code').innerHTML=state.policy.codes.map(c=>`<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('');
$('policy').value=JSON.stringify(state.policy,null,2);
const ds=days();
if(view==='Staffing grid')$('schedule').innerHTML='<table><tr><th>Pilot</th>'+ds.map(d=>`<th>${d.slice(-2)}</th>`).join('')+'</tr>'+state.pilots.map(p=>'<tr><th>'+esc(p.name)+'</th>'+ds.map(d=>'<td>'+state.requests.filter(r=>r.pilot===p.id&&r.date===d).map(r=>esc(r.code)+(r.status==='pending'?' ?':'')).join(', ')+'</td>').join('')+'</tr>').join('')+'</table>';
else if(view==='Dashboard')$('schedule').innerHTML=`<p>Pending: ${state.requests.filter(r=>r.status==='pending').length} · Approved: ${state.requests.filter(r=>r.status==='approved').length}</p><p>No duty assignments or staffing solver implemented yet.</p>`;
else $('schedule').innerHTML='<table><tr><th>Date</th><th>Approved counted absences</th><th>Requests</th></tr>'+ds.map(d=>`<tr><td>${d}</td><td>${approvedCount(d)} / ${state.policy.absenceCap}</td><td>${state.requests.filter(r=>r.date===d).map(r=>`${esc(r.pilot)} ${esc(r.code)} (${esc(r.status)})`).join(' · ')||'—'}</td></tr>`).join('')+'</table>';
$('requests').innerHTML='<table><tr><th>Pilot</th><th>Date</th><th>Code</th><th>Status</th><th>Actions</th></tr>'+state.requests.map((r,i)=>`<tr><td>${esc(r.pilot)}</td><td>${esc(r.date)}</td><td>${esc(r.code)}</td><td>${esc(r.status)}</td><td>${role!=='Employee'&&r.status==='pending'?`<button data-approve="${i}">Approve</button>`:''}<button data-delete="${i}">Remove</button></td></tr>`).join('')+'</table>';
checks();
}
function checks(){const notes=[...state.policy.unresolved];for(const d of days())if(approvedCount(d)>state.policy.absenceCap)notes.push(`${d}: approved absence cap exceeded`);notes.push('Weekly U checks are not run until week definition and U meaning are confirmed.');notes.push('Training buffer checks and qualification coverage are not implemented in this scaffold.');$('checks').innerHTML=notes.map(n=>`<li>${esc(n)}</li>`).join('')}
$('request').onsubmit=e=>{e.preventDefault();const r={pilot:$('pilot').value,date:$('date').value,code:$('code').value,status:'pending'};if(state.requests.some(x=>x.pilot===r.pilot&&x.date===r.date)){$('notice').textContent='A request already exists for this pilot and date.';return}state.requests.push(r);persist();render();$('notice').textContent='Pending request saved locally; not yet awarded.'};
$('requests').onclick=e=>{const a=e.target.dataset.approve,d=e.target.dataset.delete;if(a!==undefined){if(role==='Employee')return;const r=state.requests[Number(a)];if(state.policy.countedCodes.includes(r.code)&&approvedCount(r.date)>=state.policy.absenceCap){$('notice').textContent='Approval blocked: pool absence cap reached.';return}r.status='approved'}else if(d!==undefined){if(!confirm('Remove this demo request?'))return;state.requests.splice(Number(d),1)}else return;persist();render()};
$('save').onclick=()=>{try{const p=JSON.parse($('policy').value);if(!Number.isInteger(p.absenceCap)||p.absenceCap<0||!Array.isArray(p.codes)||!p.codes.length||!p.codes.every(c=>typeof c.code==='string'&&typeof c.name==='string')||!Array.isArray(p.countedCodes)||!Array.isArray(p.unresolved))throw Error('Invalid required policy fields');state.policy=p;persist();render();$('notice').textContent='Policy saved. Run checks after changes.'}catch(e){$('notice').textContent=e.message}};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='flightdeck-bid-demo.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$('reset').onclick=()=>{if(confirm('Reset all local demo data?')){state=fresh();persist();render()}};
$('check').onclick=checks;$('month').onchange=()=>{if($('month').value)render()};$('switch').onclick=()=>$('entry').showModal();$('enter').onclick=()=>{role=$('role').value;view=$('view').value;$('entry').close();render()};render();$('entry').showModal();
