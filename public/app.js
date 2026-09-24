const $ = (selector) => document.querySelector(selector);
const defaultFormColors = { WK:'#2463d4', CW:'#159675', LB:'#805bd4', LE:'#d55e51', LK:'#d55e51', PR:'#d58c1e', PS:'#d58c1e', SM:'#148aa8', KN:'#bd4f91' };
const state = {
  authenticated: false,
  events: [], range: null, visibleMonday: null,
  alternatives: new Map(), alternativeLoading: new Set(),
  hiddenOwn: new Set(), selectedAlternatives: new Set(), previews: new Map(),
  eventLookup: new Map(),
  formColors: { ...defaultFormColors, ...JSON.parse(localStorage.getItem('usos-form-colors') || '{}') },
};
const colors = ['#2463d4','#805bd4','#159675','#d55e51','#d58c1e','#148aa8','#bd4f91'];
const dayNames = ['Poniedziałek','Wtorek','Środa','Czwartek','Piątek'];
const months = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];

function date(value) { return new Date(`${value}T12:00:00`); }
function iso(value) { const d=typeof value==='string'?date(value):value; return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); }
function addDays(value,amount) { const d=typeof value==='string'?date(value):new Date(value); d.setDate(d.getDate()+amount); return d; }
function monday(value) { const d=typeof value==='string'?date(value):new Date(value); const n=d.getDay(); return addDays(d,n===0?-6:1-n); }
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toast(message,error=false) { const el=$('#toast');el.textContent=message;el.className=`toast show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='toast',4200); }
function loading(on,note='Pobieram plan i porządkuję przedmioty.') { $('#loading').hidden=!on;$('#loading-note').textContent=note; }
async function api(path,options={}) { const response=await fetch(path,options);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Błąd ${response.status}`);return body; }
async function mapPool(items,limit,work) { let index=0;const runners=Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const current=index++;await work(items[current],current)}});await Promise.all(runners); }

function semesterDates(now=new Date()) {
  const year=now.getFullYear(),month=now.getMonth()+1;
  if(month>=8)return[`${year}-09-01`,`${year+1}-02-15`];
  if(month<=2)return[`${year-1}-09-01`,`${year}-02-15`];
  return[`${year}-02-01`,`${year}-07-15`];
}
function setSemester(){const[from,to]=semesterDates();$('#date-from').value=from;$('#date-to').value=to;}
$('#semester').addEventListener('click',setSemester);setSemester();
function showAccount(album=''){
  $('#account-status').classList.toggle('authenticated',state.authenticated);
  $('#account-status span:last-child').textContent=state.authenticated?`Zalogowano · numer albumu ${album}`:'Zalogujesz się na oficjalnej stronie ZUT';
  $('#action-label').textContent=state.authenticated?'Pobierz mój plan':'Zaloguj przez ZUT i pobierz plan';
}
api('/api/config').then(config=>{state.authenticated=config.authenticated;showAccount(config.defaultAlbum);if(state.authenticated)$('#form-note').textContent='Sesja USOS jest aktywna.'}).catch(()=>{});

$('#load-form').addEventListener('submit',async event=>{
  event.preventDefault();const start=$('#date-from').value,end=$('#date-to').value;
  loading(true,'Pierwsze logowanie może potrwać kilkanaście sekund.');
  try{
    if(!state.authenticated){
      loading(true,'Dokończ logowanie w otwartym oknie ZUT…');
      const auth=await api('/api/auth/browser',{method:'POST'});
      state.authenticated=true;showAccount(auth.defaultAlbum);
    }
    loading(true,'Pobieram plan i porządkuję przedmioty.');
    const data=await api(`/api/schedule?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    state.events=data.events;state.range={start,end};state.alternatives.clear();state.alternativeLoading.clear();state.hiddenOwn.clear();state.selectedAlternatives.clear();state.previews.clear();
    const today=iso(new Date());state.visibleMonday=monday(today>=start&&today<=end?today:start);
    $('#hero').hidden=true;$('#workspace').hidden=false;render();$('#workspace').scrollIntoView({behavior:'smooth',block:'start'});
    toast(`Pobrano ${data.events.length} zajęć z ${data.weeks} tygodni.`);preloadAlternatives();
  }catch(error){toast(error.message,true)}finally{loading(false)}
});

function render(){renderCalendar();renderTree();renderColorSettings()}
function displayDate(d){return`${d.getDate()} ${months[d.getMonth()]}`}
function eventColor(event){const key=event.typeShort||event.type;return state.formColors[key]||colors[Math.abs([...key].reduce((n,c)=>n+c.charCodeAt(0),0))%colors.length]}
function ownKey(event){return`${event.courseCode}|${event.group}`}
function groupCode(event){return state.alternatives.get(event.courseCode)?.find(group=>group.group===event.group)?.code||event.group}

function renderCalendar(){
  const start=monday(state.visibleMonday||new Date()),end=addDays(start,4),today=iso(new Date());
  $('#range-title').textContent=`${displayDate(start)} – ${displayDate(end)} ${end.getFullYear()}`;
  const headers=dayNames.map((name,i)=>{const d=addDays(start,i),active=iso(d)===today?'active':'';return`<div class="${active}"><span>${name}</span><b>${d.getDate()}</b></div>`}).join('');
  const weekEvents=state.events.filter(e=>e.date>=iso(start)&&e.date<=iso(end)&&!state.hiddenOwn.has(ownKey(e)));
  const previews=[...state.previews.values()].flat().filter(e=>e.date>=iso(start)&&e.date<=iso(end));
  const all=[...weekEvents.map(event=>({event,isAlt:false})),...previews.map(event=>({event,isAlt:true}))];
  const timeLabels=Array.from({length:14},(_,i)=>`<span class="time" style="top:${i*64}px">${String(i+7).padStart(2,'0')}:00</span>`).join('');
  state.eventLookup.clear();
  const columns=dayNames.map((_,i)=>`<div class="day-col">${all.filter(item=>item.event.date===iso(addDays(start,i))).map(item=>eventCard(item.event,item.isAlt)).join('')}</div>`).join('');
  $('#calendar').innerHTML=`<div class="cal-head"><div></div>${headers}</div><div class="cal-body"><div class="time-col">${timeLabels}</div>${columns}</div>`;
  $('#calendar-empty').hidden=all.length>0;
  document.querySelectorAll('.event[data-event]').forEach(card=>card.addEventListener('click',()=>showEventDetails(state.eventLookup.get(card.dataset.event))));
}

function eventCard(event,isAlt){
  const[sh,sm]=event.start.split(':').map(Number),[eh,em]=event.end.split(':').map(Number);
  const top=((sh-7)*60+sm)/60*64,height=Math.max(27,((eh*60+em)-(sh*60+sm))/60*64-3),color=eventColor(event);
  const key=`event-${state.eventLookup.size}`;state.eventLookup.set(key,event);
  return`<article class="event" data-event="${key}" style="top:${top}px;height:${height}px;--event:${color}" title="Kliknij, aby zobaczyć szczegóły"><div class="event-time">${event.start}–${event.end}</div><div class="event-name">${escapeHtml(event.courseName)}</div><div class="event-meta">${escapeHtml(`${event.typeShort} · ${groupCode(event)}${event.room?' · '+event.room:''}`)}</div></article>`;
}

function showEventDetails(event){
  if(!event)return;const d=date(event.date);
  $('#detail-name').textContent=event.courseName;$('#detail-time').textContent=`${dayNames[d.getDay()-1]||event.dayName}, ${d.getDate()} ${months[d.getMonth()]} · ${event.start}–${event.end}`;
  $('#detail-type').textContent=event.type||event.typeShort;$('#detail-group').textContent=groupCode(event);$('#detail-teacher').textContent=event.lecturers||'Nie podano';
  $('#detail-room').textContent=event.room?`${event.room}${event.building?' · '+event.building:''}`:'Nie podano';$('#detail-code').textContent=event.courseCode;$('#event-dialog').showModal();
}
$('#close-dialog').addEventListener('click',()=>$('#event-dialog').close());
$('#event-dialog').addEventListener('click',event=>{if(event.target===$('#event-dialog'))$('#event-dialog').close()});

function groupTree(events){
  const programs=new Map();
  for(const e of events){
    if(!programs.has(e.programKey))programs.set(e.programKey,{label:e.programLabel,subjects:new Map()});
    const p=programs.get(e.programKey),subjectKey=e.courseName.toLocaleLowerCase('pl');
    if(!p.subjects.has(subjectKey))p.subjects.set(subjectKey,{name:e.courseName,forms:new Map()});
    const s=p.subjects.get(subjectKey),formKey=e.courseCode;
    if(!s.forms.has(formKey))s.forms.set(formKey,{code:e.courseCode,type:e.type,short:e.typeShort,groups:new Map()});
    const f=s.forms.get(formKey);if(!f.groups.has(e.group))f.groups.set(e.group,[]);f.groups.get(e.group).push(e);
  }
  return programs;
}

function renderTree(){
  const tree=$('#course-tree');
  const hadTree=tree.childElementCount>0;
  const openKeys=new Set([...tree.querySelectorAll('details[open][data-tree-key]')].map(detail=>detail.dataset.treeKey));
  const sidebar=$('.sidebar');const previousScroll=sidebar.scrollTop;
  const query=$('#course-search').value.trim().toLocaleLowerCase('pl');
  const filtered=query?state.events.filter(e=>`${e.courseName} ${e.courseCode} ${e.lecturers}`.toLocaleLowerCase('pl').includes(query)):state.events;
  const programs=groupTree(filtered),uniqueSubjects=new Set(state.events.map(e=>e.courseName.toLocaleLowerCase('pl')));$('#course-count').textContent=uniqueSubjects.size;
  if(!filtered.length){tree.innerHTML='<div class="tree-empty">Nie znaleziono przedmiotu.</div>';return}
  tree.innerHTML=[...programs.entries()].map(([key,p])=>{
    const programTreeKey=`program:${key}`,programOpen=openKeys.has(programTreeKey)||(!hadTree&&programs.size<=2)||Boolean(query);
    const subjects=[...p.subjects.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,'pl')).map(([subjectKey,s])=>{
      const subjectTreeKey=`subject:${key}:${subjectKey}`,subjectOpen=openKeys.has(subjectTreeKey)||Boolean(query);
      return`<details class="subject" data-tree-key="${escapeHtml(subjectTreeKey)}" ${subjectOpen?'open':''}><summary>${escapeHtml(s.name)}<span>${s.forms.size} ${s.forms.size===1?'forma':'formy'}</span></summary>${[...s.forms.values()].map(form=>formHtml(form,openKeys)).join('')}</details>`;
    }).join('');
    return`<details class="program" data-tree-key="${escapeHtml(programTreeKey)}" ${programOpen?'open':''}><summary>${escapeHtml(key)}<small>${escapeHtml(p.label.replace(key+' · ',''))} · ${p.subjects.size} przedm.</small></summary>${subjects}</details>`;
  }).join('');
  document.querySelectorAll('.own-toggle').forEach(input=>input.addEventListener('change',()=>{input.checked?state.hiddenOwn.delete(input.dataset.key):state.hiddenOwn.add(input.dataset.key);renderCalendar()}));
  document.querySelectorAll('.alt-toggle').forEach(input=>input.addEventListener('change',()=>toggleAlternative(input.dataset.key,input.checked)));
  document.querySelectorAll('.alt-load').forEach(button=>button.addEventListener('click',()=>loadAlternatives(button.dataset.code,button.dataset.date,true)));
  sidebar.scrollTop=previousScroll;
}

function formHtml(form,openKeys=new Set()){
  let alternatives='';const cached=state.alternatives.get(form.code),firstDate=[...form.groups.values()][0]?.[0]?.date||iso(state.visibleMonday);
  const groups=[...form.groups.entries()].map(([number,events])=>{const teachers=[...new Set(events.map(e=>e.lecturers).filter(Boolean))].join(', ')||'Prowadzący niepodany',key=`${form.code}|${number}`,groupCode=cached?.find(group=>group.group===number)?.code||number;return`<div class="group"><label><input class="own-toggle" type="checkbox" data-key="${escapeHtml(key)}" ${state.hiddenOwn.has(key)?'':'checked'}><span><b>${escapeHtml(groupCode)} | ${escapeHtml(teachers)}</b></span></label></div>`}).join('');
  if(cached)alternatives=alternativesHtml(form.code,cached);
  else if(state.alternativeLoading.has(form.code))alternatives='<p class="form-note">Pobieram inne grupy…</p>';
  else alternatives=`<button class="alt-load" data-code="${escapeHtml(form.code)}" data-date="${firstDate}">Ponów pobieranie innych grup</button>`;
  const treeKey=`form:${form.code}`;
  return`<details class="form" data-tree-key="${escapeHtml(treeKey)}" ${openKeys.has(treeKey)?'open':''}><summary>${escapeHtml(form.type||form.short)} <small>· ${escapeHtml(form.code)}</small></summary>${groups}<div class="alternatives">${alternatives}</div></details>`;
}

function alternativesHtml(code,groups){
  const ownGroups=new Set(state.events.filter(e=>e.courseCode===code).map(e=>e.group));
  const alternatives=groups.filter(group=>!ownGroups.has(group.group));
  if(!alternatives.length)return'<p class="form-note">Brak innych grup.</p>';
  return alternatives.map(group=>{const key=`${code}|${group.group}`,teachers=group.lecturers||'Prowadzący niepodany',selected=state.selectedAlternatives.has(key);return`<div class="alt-choice ${selected?'selected':''}"><label><input class="alt-toggle" type="checkbox" data-key="${escapeHtml(key)}" ${selected?'checked':''}><span><b>${escapeHtml(group.code||group.group)} | ${escapeHtml(teachers)}</b></span></label></div>`}).join('');
}

async function loadAlternatives(code,sampleDate,notify=false){
  if(state.alternativeLoading.has(code))return;state.alternativeLoading.add(code);renderTree();
  try{const result=await api(`/api/course-groups?courseCode=${encodeURIComponent(code)}&date=${encodeURIComponent(sampleDate)}`);state.alternatives.set(code,result.groups);if(notify)toast('Pobrano inne grupy.')}
  catch(error){if(notify)toast(error.message,true)}finally{state.alternativeLoading.delete(code);renderTree()}
}

async function preloadAlternatives(){
  const firstByCode=new Map();for(const event of state.events)if(!firstByCode.has(event.courseCode))firstByCode.set(event.courseCode,event.date);
  for(const code of firstByCode.keys())state.alternativeLoading.add(code);renderTree();
  await mapPool([...firstByCode.entries()],4,async([code,sampleDate])=>{
    try{const result=await api(`/api/course-groups?courseCode=${encodeURIComponent(code)}&date=${encodeURIComponent(sampleDate)}`);state.alternatives.set(code,result.groups)}catch{}finally{state.alternativeLoading.delete(code);renderTree()}
  });
}

async function toggleAlternative(key,checked){
  if(checked)state.selectedAlternatives.add(key);else{state.selectedAlternatives.delete(key);state.previews.delete(key)}
  renderTree();renderCalendar();if(checked)await refreshPreview(key);
}
async function refreshPreview(key){
  const split=key.lastIndexOf('|'),code=key.slice(0,split),group=key.slice(split+1);
  toast('Pobieram terminy wybranej grupy…');
  try{
    const result=await api(`/api/group-schedule?courseCode=${encodeURIComponent(code)}&group=${encodeURIComponent(group)}&start=${state.range.start}&end=${state.range.end}`);
    if(state.selectedAlternatives.has(key)){
      const canonical=state.events.find(event=>event.courseCode===code);
      const normalized=result.events.map(event=>canonical?{...event,courseName:canonical.courseName,type:canonical.type,typeShort:canonical.typeShort,programKey:canonical.programKey,programLabel:canonical.programLabel,color:canonical.color}:event);
      state.previews.set(key,normalized);
      const visibleStart=iso(monday(state.visibleMonday)),visibleEnd=iso(addDays(monday(state.visibleMonday),6));
      if(normalized.length&&!normalized.some(event=>event.date>=visibleStart&&event.date<=visibleEnd)){
        state.visibleMonday=monday(normalized[0].date);toast('Pokazuję pierwszy termin zaznaczonej grupy.');
      }
    }
  }catch(error){toast(error.message,true)}finally{renderCalendar()}
}
async function changeWeek(days){state.visibleMonday=addDays(state.visibleMonday,days);renderCalendar()}

function renderColorSettings(){
  const types=new Map();for(const event of state.events)types.set(event.typeShort||event.type,event.type||event.typeShort);
  $('#color-options').innerHTML=[...types.entries()].sort().map(([key,name])=>`<label class="color-option"><input type="color" data-form-color="${escapeHtml(key)}" value="${eventColor({typeShort:key,type:key})}"><span>${escapeHtml(key)}<small>${escapeHtml(name)}</small></span></label>`).join('');
  document.querySelectorAll('[data-form-color]').forEach(input=>input.addEventListener('input',()=>{state.formColors[input.dataset.formColor]=input.value;localStorage.setItem('usos-form-colors',JSON.stringify(state.formColors));renderCalendar()}));
}

$('#course-search').addEventListener('input',renderTree);
$('#prev-week').addEventListener('click',()=>changeWeek(-7));
$('#next-week').addEventListener('click',()=>changeWeek(7));
$('#today').addEventListener('click',()=>{state.visibleMonday=monday(new Date());changeWeek(0)});
$('#change-range').addEventListener('click',()=>{$('#hero').hidden=false;$('#hero').scrollIntoView({behavior:'smooth',block:'start'})});
$('#change-account').addEventListener('click',async()=>{
  try{
    await api('/api/auth/logout',{method:'POST'});
    state.authenticated=false;state.events=[];state.range=null;state.alternatives.clear();state.alternativeLoading.clear();state.hiddenOwn.clear();state.selectedAlternatives.clear();state.previews.clear();
    showAccount();$('#form-note').textContent='Hasło wpiszesz wyłącznie na stronie login.zut.edu.pl.';$('#workspace').hidden=true;$('#hero').hidden=false;$('#hero').scrollIntoView({behavior:'smooth',block:'start'});
    toast('Wylogowano. Możesz zalogować się na inne konto ZUT.');
  }catch(error){toast(error.message,true)}
});
$('#reset-colors').addEventListener('click',()=>{state.formColors={...defaultFormColors};localStorage.removeItem('usos-form-colors');renderColorSettings();renderCalendar();toast('Przywrócono domyślne kolory.')});
