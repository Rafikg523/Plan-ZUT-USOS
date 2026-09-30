import { layoutDayEvents } from './event-layout.js';
import { generatePlans } from './plan-generator.js';
import { selectionFromText, selectionToText } from './group-selection.js';

const $ = (selector) => document.querySelector(selector);
const defaultFormColors = { WK:'#2463d4', CW:'#159675', LB:'#805bd4', LE:'#d55e51', LK:'#d55e51', PR:'#d58c1e', PS:'#d58c1e', SM:'#148aa8', KN:'#bd4f91' };
const state = {
  authenticated: false,
  events: [], range: null, visibleMonday: null,
  alternatives: new Map(), alternativeLoading: new Set(), alternativeQueued: new Set(), groupSchedules: new Map(), preloadPromise: null,
  hiddenOwn: new Set(), selectedAlternatives: new Set(), previews: new Map(),
  eventLookup: new Map(),
  album: '', selectionVersion: 0, selectedForms: new Set(), allowedForms: new Set(), generated: [], activePlan: null, savedView: false, activeTab: 'calendar',
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
  state.album=album;
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
    state.events=data.events;state.range={start,end};state.alternatives.clear();state.alternativeLoading.clear();state.alternativeQueued.clear();state.groupSchedules.clear();state.hiddenOwn.clear();state.selectedAlternatives.clear();state.previews.clear();state.selectionVersion=0;state.generated=[];state.activePlan=null;state.savedView=false;state.activeTab='calendar';
    state.selectedForms=new Set(data.events.map(e=>e.courseCode));state.allowedForms.clear();
    const today=iso(new Date());state.visibleMonday=monday(today>=start&&today<=end?today:start);
    const background=preloadAlternatives();state.preloadPromise=background;
    $('#hero').hidden=true;$('#workspace').hidden=false;render();$('#workspace').scrollIntoView({behavior:'smooth',block:'start'});
    const saved=localStorage.getItem(selectionStorageKey());
    if(saved)void restoreSelection(JSON.parse(saved)).catch(error=>toast(error.message,true));
    toast(`Pobrano Twój plan z ${data.weeks} tygodni. Inne grupy pobierają się w tle.`);
    void background.catch(error=>toast(error.message,true));
  }catch(error){toast(error.message,true)}finally{loading(false)}
});

function render(){renderWorkspaceTab();renderCalendar();renderTree();renderColorSettings();renderGenerator();renderSavedPlans()}
function displayDate(d){return`${d.getDate()} ${months[d.getMonth()]}`}
function eventColor(event){const key=event.typeShort||event.type;return state.formColors[key]||colors[Math.abs([...key].reduce((n,c)=>n+c.charCodeAt(0),0))%colors.length]}
function ownKey(event){return`${event.courseCode}|${event.group}`}
function isLecture(event){return event.typeShort?.toUpperCase()==='WK'||/^wykład/i.test(event.type||'')}
function groupLabel(group){return group?`gr. ${group}`:'Brak numeru grupy'}
function selectionStorageKey(){return`usos-group-selection-v1:${state.album}`}
function selectedGroupEntries(){
  const own=new Set(state.events.filter(event=>!state.hiddenOwn.has(ownKey(event))).map(ownKey));
  return [...new Set([...own,...state.selectedAlternatives])].map(key=>{
    const split=key.lastIndexOf('|'),code=key.slice(0,split),group=key.slice(split+1);
    const event=state.events.find(item=>item.courseCode===code);
    return event?{name:event.courseName,form:event.type||event.typeShort,code,group}:null;
  }).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,'pl')||a.form.localeCompare(b.form,'pl')||a.group.localeCompare(b.group,'pl'));
}
function rememberSelection(){
  state.selectionVersion++;
  if(!state.album)return;
  try{localStorage.setItem(selectionStorageKey(),JSON.stringify(selectedGroupEntries()))}catch{toast('Nie udało się zapisać wyboru grup w tej przeglądarce.',true)}
}
async function restoreSelection(groups){
  if(!Array.isArray(groups))throw new Error('Zapis wyboru grup jest nieprawidłowy.');
  const range=state.range,version=state.selectionVersion,chosen=new Set(groups.map(group=>`${group.code}|${group.group}`));
  state.hiddenOwn=new Set(state.events.filter(event=>!chosen.has(ownKey(event))).map(ownKey));
  state.selectedAlternatives.clear();state.previews.clear();renderTree();renderCalendar();
  if(state.preloadPromise)await state.preloadPromise;
  if(state.range!==range||state.selectionVersion!==version)return 0;
  const own=new Set(state.events.map(ownKey));
  const extra=groups.filter(group=>chosen.has(`${group.code}|${group.group}`)&&!own.has(`${group.code}|${group.group}`));
  for(const code of new Set(extra.map(group=>group.code)))if(state.events.some(event=>event.courseCode===code)&&!state.groupSchedules.has(code))await loadAlternatives(code);
  if(state.range!==range||state.selectionVersion!==version)return 0;
  let restored=0;
  for(const group of extra){
    const key=`${group.code}|${group.group}`,canonical=state.events.find(event=>event.courseCode===group.code);
    const events=state.groupSchedules.get(group.code)?.filter(event=>event.group===group.group)||[];
    if(!canonical||!events.length)continue;
    state.selectedAlternatives.add(key);
    state.previews.set(key,events.map(event=>({...event,courseName:canonical.courseName,type:canonical.type,typeShort:canonical.typeShort,programKey:canonical.programKey,programLabel:canonical.programLabel,color:canonical.color})));
    restored++;
  }
  renderTree();renderCalendar();
  return restored;
}

function renderCalendar(){
  $('#workspace').classList.toggle('plan-view',Boolean(state.activePlan)||state.activeTab==='generator');
  const start=monday(state.visibleMonday||new Date()),end=addDays(start,4),today=iso(new Date());
  $('#range-title').textContent=`${displayDate(start)} – ${displayDate(end)} ${end.getFullYear()}`;
  const headers=dayNames.map((name,i)=>{const d=addDays(start,i),active=iso(d)===today?'active':'';return`<div class="${active}"><span>${name}</span><b>${d.getDate()}</b></div>`}).join('');
  const weekEvents=(state.activePlan?.events||state.events).filter(e=>e.date>=iso(start)&&e.date<=iso(end)&&(state.activePlan||!state.hiddenOwn.has(ownKey(e))));
  const previews=state.activePlan?[]:[...state.previews.values()].flat().filter(e=>e.date>=iso(start)&&e.date<=iso(end));
  const all=[...weekEvents.map(event=>({event,isAlt:false})),...previews.map(event=>({event,isAlt:true}))];
  const timeLabels=Array.from({length:14},(_,i)=>`<span class="time" style="top:${i*64}px">${String(i+7).padStart(2,'0')}:00</span>`).join('');
  state.eventLookup.clear();
  const columns=dayNames.map((_,i)=>`<div class="day-col">${layoutDayEvents(all.filter(item=>item.event.date===iso(addDays(start,i)))).map(item=>eventCard(item)).join('')}</div>`).join('');
  $('#calendar').innerHTML=`<div class="cal-head"><div></div>${headers}</div><div class="cal-body"><div class="time-col">${timeLabels}</div>${columns}</div>`;
  $('#calendar-empty').hidden=all.length>0;
  document.querySelectorAll('.event[data-event]').forEach(card=>card.addEventListener('click',()=>showEventDetails(state.eventLookup.get(card.dataset.event))));
}

function eventCard({event,top,height,column,columns}){
  const color=eventColor(event);
  const key=`event-${state.eventLookup.size}`;state.eventLookup.set(key,event);
  return`<article class="event" data-event="${key}" style="top:${top}px;height:${height}px;left:calc(${column/columns*100}% + 5px);right:calc(${(columns-column-1)/columns*100}% + 5px);--event:${color}" title="${escapeHtml(`${event.start}–${event.end} · ${event.courseName}`)} — kliknij, aby zobaczyć szczegóły"><div class="event-time">${event.start}–${event.end}</div><div class="event-name">${escapeHtml(event.courseName)}</div><div class="event-meta">${escapeHtml(`${event.typeShort} · ${groupLabel(event.group)}${event.room?' · '+event.room:''}`)}</div></article>`;
}

let participantRequest = 0;
async function loadParticipants(event){
  const request = ++participantRequest;
  const status = $('#participants-status'), list = $('#participants-list');
  list.replaceChildren();list.hidden=true;
  status.textContent='Pobieram listę uczestników…';
  const classId=event.classId||state.alternatives.get(event.courseCode)?.find(group=>group.group===event.group)?.classId;
  if(!classId||!event.group){status.textContent='Lista uczestników jest niedostępna dla tych zajęć.';return;}
  try{
    const data=await api(`/api/group-participants?classId=${encodeURIComponent(classId)}&group=${encodeURIComponent(event.group)}`);
    if(request!==participantRequest)return;
    if(!data.available){status.textContent=`${data.total!==null?`Liczba osób w grupie: ${data.total}. `:''}Nie udało się odczytać listy uczestników z USOS.`;return;}
    status.textContent=data.participants.length?`Widoczni uczestnicy: ${data.participants.length}${data.total!==null?` · Osób w grupie: ${data.total}`:''}`:'Brak uczestników w grupie.';
    for(const person of data.participants){const li=document.createElement('li');li.textContent=person.name;list.append(li);}
    list.hidden=!data.participants.length;
  }catch(error){if(request===participantRequest)status.textContent=`Nie udało się pobrać listy uczestników. ${error.message}`;}
}

function showEventDetails(event){
  if(!event)return;const d=date(event.date);
  $('#detail-name').textContent=event.courseName;$('#detail-time').textContent=`${dayNames[d.getDay()-1]||event.dayName}, ${d.getDate()} ${months[d.getMonth()]} · ${event.start}–${event.end}`;
  $('#detail-type').textContent=event.type||event.typeShort;$('#detail-group').textContent=groupLabel(event.group);$('#detail-teacher').textContent=event.lecturers||'Nie podano';
  $('#detail-room').textContent=event.room?`${event.room}${event.building?' · '+event.building:''}`:'Nie podano';$('#detail-code').textContent=event.courseCode;$('#event-dialog').showModal();
  loadParticipants(event);
}
$('#event-dialog').addEventListener('close',()=>{participantRequest++;$('#participants-list').replaceChildren();});
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
    const lectures=state.events.filter(event=>event.programKey===key&&isLecture(event));
    const allLecturesHidden=lectures.length>0&&lectures.every(event=>state.hiddenOwn.has(ownKey(event)));
    const subjects=[...p.subjects.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,'pl')).map(([subjectKey,s])=>{
      const subjectTreeKey=`subject:${key}:${subjectKey}`,subjectOpen=openKeys.has(subjectTreeKey)||Boolean(query);
      const badges=[...s.forms.values()].map(form=>{
        const own=new Set(state.events.filter(event=>event.programKey===key&&event.courseCode===form.code&&!state.hiddenOwn.has(ownKey(event))).map(event=>event.group)).size;
        const alternatives=[...state.selectedAlternatives].filter(groupKey=>groupKey.startsWith(`${form.code}|`)).length;
        const count=own+alternatives,status=count===0?'none':count===1?'one':'many';
        return`<span class="form-badge ${status}" title="${escapeHtml(`${form.type||form.short}: ${count} zaznaczonych grup`)}" aria-label="${escapeHtml(`${form.type||form.short}: ${count} zaznaczonych grup`)}">${escapeHtml(form.short||form.type)}</span>`;
      }).join('');
      return`<details class="subject" data-tree-key="${escapeHtml(subjectTreeKey)}" ${subjectOpen?'open':''}><summary><span class="subject-name">${escapeHtml(s.name)}</span><span class="subject-forms">${badges}</span></summary>${[...s.forms.values()].map(form=>formHtml(form,openKeys)).join('')}</details>`;
    }).join('');
    return`<details class="program" data-tree-key="${escapeHtml(programTreeKey)}" ${programOpen?'open':''}><summary class="${lectures.length?'has-lectures':''}">${escapeHtml(key)}<small>${escapeHtml(p.label.replace(key+' · ',''))} · ${p.subjects.size} przedm.</small>${lectures.length?`<button class="program-lectures" type="button" data-program="${escapeHtml(key)}">${allLecturesHidden?'Pokaż wszystkie wykłady':'Ukryj wszystkie wykłady'}</button>`:''}</summary>${subjects}</details>`;
  }).join('');
  document.querySelectorAll('.program-lectures').forEach(button=>button.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();
    const lectures=state.events.filter(event=>event.programKey===button.dataset.program&&isLecture(event));
    const hide=!lectures.every(event=>state.hiddenOwn.has(ownKey(event)));
    for(const event of lectures){if(hide)state.hiddenOwn.add(ownKey(event));else state.hiddenOwn.delete(ownKey(event))}
    if(hide)for(const [key,events] of state.previews){if(events.some(event=>event.programKey===button.dataset.program&&isLecture(event))){state.previews.delete(key);state.selectedAlternatives.delete(key)}}
    rememberSelection();renderTree();renderCalendar();
  }));
  document.querySelectorAll('.own-toggle').forEach(input=>input.addEventListener('change',()=>{input.checked?state.hiddenOwn.delete(input.dataset.key):state.hiddenOwn.add(input.dataset.key);rememberSelection();renderTree();renderCalendar()}));
  document.querySelectorAll('.alt-toggle').forEach(input=>input.addEventListener('change',()=>toggleAlternative(input.dataset.key,input.checked)));
  document.querySelectorAll('.alt-load').forEach(button=>button.addEventListener('click',()=>loadAlternatives(button.dataset.code,button.dataset.date,true)));
  sidebar.scrollTop=previousScroll;
}

function formHtml(form,openKeys=new Set()){
  let alternatives='';const cached=state.alternatives.get(form.code),firstDate=[...form.groups.values()][0]?.[0]?.date||iso(state.visibleMonday);
  const groups=[...form.groups.entries()].map(([number,events])=>{const teachers=[...new Set(events.map(e=>e.lecturers).filter(Boolean))].join(', ')||'Prowadzący niepodany',key=`${form.code}|${number}`;return`<div class="group"><label><input class="own-toggle" type="checkbox" data-key="${escapeHtml(key)}" ${state.hiddenOwn.has(key)?'':'checked'}><span><b>${escapeHtml(groupLabel(number))} | ${escapeHtml(teachers)}</b></span></label></div>`}).join('');
  if(cached)alternatives=alternativesHtml(form.code,cached);
  else if(state.alternativeLoading.has(form.code)||state.alternativeQueued.has(form.code))alternatives='<p class="form-note">Pobieram inne grupy…</p>';
  else alternatives=`<button class="alt-load" data-code="${escapeHtml(form.code)}" data-date="${firstDate}">Ponów pobieranie innych grup</button>`;
  const treeKey=`form:${form.code}`;
  return`<details class="form" data-tree-key="${escapeHtml(treeKey)}" ${openKeys.has(treeKey)?'open':''}><summary>${escapeHtml(form.type||form.short)} <small>· ${escapeHtml(form.code)}</small></summary>${groups}<div class="alternatives">${alternatives}</div></details>`;
}

function alternativesHtml(code,groups){
  const ownGroups=new Set(state.events.filter(e=>e.courseCode===code).map(e=>e.group));
  const alternatives=groups.filter(group=>!ownGroups.has(group.group));
  if(!alternatives.length)return'<p class="form-note">Brak innych grup.</p>';
  return alternatives.map(group=>{const key=`${code}|${group.group}`,teachers=group.lecturers||'Prowadzący niepodany',selected=state.selectedAlternatives.has(key);return`<div class="alt-choice ${selected?'selected':''}"><label><input class="alt-toggle" type="checkbox" data-key="${escapeHtml(key)}" ${selected?'checked':''}><span><b>${escapeHtml(groupLabel(group.group))} | ${escapeHtml(teachers)}</b></span></label></div>`}).join('');
}

async function loadAlternatives(code,sampleDate,notify=false){
  if(state.alternativeLoading.has(code))return false;
  const range=state.range;
  state.alternativeQueued.delete(code);
  state.alternativeLoading.add(code);
  if(notify)renderTree();
  try{
    const result=await api(`/api/course-data?courseCode=${encodeURIComponent(code)}&start=${range.start}&end=${range.end}`);
    if(state.range!==range)return false;
    state.groupSchedules.set(code,result.events);
    state.alternatives.set(code,result.groups);
    if(notify)toast('Pobrano wszystkie grupy i ich terminy.');
    return true;
  }catch(error){if(notify&&state.range===range)toast(error.message,true);return false}
  finally{if(state.range===range){state.alternativeLoading.delete(code);if(notify)renderTree()}}
}

async function preloadAlternatives(){
  const range=state.range;
  const codes=[...new Set(state.events.map(event=>event.courseCode))];
  state.alternativeQueued=new Set(codes);
  let completed=0,failed=0;
  const progress=()=>{
    const status=$('#groups-progress');
    status.hidden=!codes.length;
    status.textContent=completed<codes.length
      ?`Pobieram inne grupy w tle: ${completed}/${codes.length}. Możesz korzystać z planu.`
      :failed?`Nie pobrano grup dla ${failed} przedmiotów. Ponów pobieranie w ich sekcjach.`:'Wszystkie grupy są gotowe.';
  };
  progress();
  await mapPool(codes,2,async code=>{
    if(state.range!==range)return;
    if(!await loadAlternatives(code))failed++;
    if(state.range!==range)return;
    completed++;
    progress();renderTree();
  });
  return failed;
}

function toggleAlternative(key,checked){
  if(checked){
    const split=key.lastIndexOf('|'),code=key.slice(0,split),group=key.slice(split+1);
    const cached=state.groupSchedules.get(code);
    if(!cached){toast('Terminy grup nie zostały pobrane. Ponów pobieranie w sekcji przedmiotu.',true);renderTree();return;}
    state.selectedAlternatives.add(key);
    const canonical=state.events.find(event=>event.courseCode===code);
    const normalized=cached.filter(event=>event.group===group).map(event=>canonical?{...event,courseName:canonical.courseName,type:canonical.type,typeShort:canonical.typeShort,programKey:canonical.programKey,programLabel:canonical.programLabel,color:canonical.color}:event);
    state.previews.set(key,normalized);
    const visibleStart=iso(monday(state.visibleMonday)),visibleEnd=iso(addDays(monday(state.visibleMonday),6));
    if(normalized.length&&!normalized.some(event=>event.date>=visibleStart&&event.date<=visibleEnd)){
      state.visibleMonday=monday(normalized[0].date);toast('Pokazuję pierwszy termin zaznaczonej grupy.');
    }
  }else{state.selectedAlternatives.delete(key);state.previews.delete(key)}
  rememberSelection();renderTree();renderCalendar();
}

const savedKey='usos-saved-plans-v1';
function renderWorkspaceTab(){
  if(state.savedView)state.activeTab='calendar';
  const generator=state.activeTab==='generator';
  $('#generator-tab').hidden=state.savedView;
  $('#calendar-tab').setAttribute('aria-selected',String(!generator));
  $('#generator-tab').setAttribute('aria-selected',String(generator));
  $('#calendar-panel').hidden=generator;
  $('#generator').hidden=!generator;
  const mount=generator?$('#generator-calendar-mount'):$('#calendar-panel');
  mount.append($('#calendar-content'));
  $('#workspace').classList.toggle('generator-tab',generator);
  $('#workspace').classList.toggle('plan-view',Boolean(state.activePlan)||generator);
}
$('#calendar-tab').addEventListener('click',()=>{state.activeTab='calendar';renderWorkspaceTab()});
$('#generator-tab').addEventListener('click',()=>{state.activeTab='generator';renderWorkspaceTab()});
function savedPlans(){try{const plans=JSON.parse(localStorage.getItem(savedKey)||'[]');return Array.isArray(plans)?plans:[]}catch{return []}}
function setSavedPlans(plans){localStorage.setItem(savedKey,JSON.stringify(plans))}
function formList(){
  const forms=new Map();
  for(const event of state.events)if(!forms.has(event.courseCode))forms.set(event.courseCode,{code:event.courseCode,name:event.courseName,type:event.type||event.typeShort});
  return [...forms.values()].sort((a,b)=>a.name.localeCompare(b.name,'pl')||a.type.localeCompare(b.type,'pl'));
}
function renderGenerator(){
  if(state.savedView)return;
  $('#generator-forms').innerHTML=formList().map(form=>`<div class="generator-form"><label><input type="checkbox" class="form-select" data-code="${escapeHtml(form.code)}" ${state.selectedForms.has(form.code)?'checked':''}><span><b>${escapeHtml(form.name)}</b><small>${escapeHtml(form.type)} · ${escapeHtml(form.code)}</small></span></label><label class="overlap-option"><input type="checkbox" class="form-allow" data-code="${escapeHtml(form.code)}" ${state.allowedForms.has(form.code)?'checked':''} ${state.selectedForms.has(form.code)?'':'disabled'}>Może nachodzić na inne</label></div>`).join('');
  renderGeneratedResults();
  $('#save-plan').disabled=!state.events.length&&!state.activePlan;
}
function renderGeneratedResults(){
  const box=$('#generated-results');
  box.hidden=!state.generated.length&&!state.activePlan;
  if(!state.generated.length&&state.activePlan){box.innerHTML='<p>Otwarty zapisany plan.</p>';return}
  box.innerHTML=`<div class="result-head"><b>Propozycje planu</b><button data-plan="manual">Pokaż mój plan</button></div>${state.generated.map((plan,index)=>`<button class="plan-result ${state.activePlan===plan?'active':''}" data-plan="${index}"><b>Wariant ${index+1}</b><span>${plan.strict?`Kolizje: ${plan.strict} min`:'Bez niedopuszczonych kolizji'}${plan.allowed?` · dopuszczone: ${plan.allowed} min`:''}</span><span>Okienka: ${plan.gapMinutes} min · dni z zajęciami: ${plan.occupiedDays} · dni z pojedynczymi zajęciami: ${plan.singleDays}</span><small>${plan.groups.map(group=>`${escapeHtml(state.events.find(e=>e.courseCode===group.code)?.courseName||group.code)} (${escapeHtml(state.events.find(e=>e.courseCode===group.code)?.typeShort||'')}, gr. ${escapeHtml(group.group)})`).join(' · ')}</small></button>`).join('')}`;
}
function groupOptions(code){
  const canonical=state.events.find(event=>event.courseCode===code);
  const combined=[...state.events.filter(event=>event.courseCode===code),...(state.groupSchedules.get(code)||[]).filter(event=>event.courseCode===code)];
  const byGroup=new Map();
  for(const event of combined){
    if(!event.group)continue;
    const normalized=canonical?{...event,courseName:canonical.courseName,type:canonical.type,typeShort:canonical.typeShort,programKey:canonical.programKey,programLabel:canonical.programLabel}:event;
    if(!byGroup.has(event.group))byGroup.set(event.group,new Map());
    byGroup.get(event.group).set([event.date,event.start,event.end,event.courseCode,event.group].join('|'),normalized);
  }
  return [...byGroup].map(([group,events])=>({group,events:[...events.values()]}));
}
function visiblePlan(){
  if(state.activePlan)return state.activePlan;
  const events=[...state.events.filter(event=>!state.hiddenOwn.has(ownKey(event))),...[...state.previews.values()].flat()];
  return {events,groups:[...new Set(events.map(event=>ownKey(event)))].map(key=>{const split=key.lastIndexOf('|');return{code:key.slice(0,split),group:key.slice(split+1)}}),strict:0,allowed:0};
}
async function runGenerator(){
  const codes=[...state.selectedForms];
  if(!codes.length){toast('Zaznacz przynajmniej jedną formę zajęć.',true);return}
  const range=state.range;
  const missing=codes.filter(code=>!state.groupSchedules.has(code));
  if(missing.length){
    loading(true,`Pobieram terminy grup: 0/${missing.length}`);
    let done=0;
    try{await mapPool(missing,2,async code=>{await loadAlternatives(code);done++;$('#loading-note').textContent=`Pobieram terminy grup: ${done}/${missing.length}`})}
    finally{loading(false)}
  }
  if(state.range!==range)return;
  const choices=codes.map(code=>({code,options:groupOptions(code)}));
  const unavailable=choices.filter(choice=>!choice.options.length);
  if(unavailable.length){toast(`Brak terminów dla ${unavailable.map(choice=>choice.code).join(', ')}.`,true);return}
  state.generated=generatePlans(choices,state.allowedForms);
  state.activePlan=state.generated[0]||null;
  if(state.activePlan?.events.length)state.visibleMonday=monday(state.activePlan.events[0].date);
  renderCalendar();renderGeneratedResults();$('#save-plan').disabled=!state.events.length&&!state.activePlan;
  if(missing.some(code=>!state.groupSchedules.has(code)))toast('Części grup nie udało się pobrać. Użyto dostępnych terminów.',true);
  else toast(`Wygenerowano ${state.generated.length} warianty.`);
}
function renderSavedPlans(){
  const plans=savedPlans();
  const list=plans.map(plan=>`<div class="saved-plan"><span><b>${escapeHtml(plan.name)}</b><small>${escapeHtml(plan.range?.start||'')} – ${escapeHtml(plan.range?.end||'')} · ${plan.events.length} terminów</small></span><button data-open-saved="${escapeHtml(plan.id)}">Otwórz</button><button data-delete-saved="${escapeHtml(plan.id)}" aria-label="Usuń plan ${escapeHtml(plan.name)}">Usuń</button></div>`).join('');
  $('#saved-plans').innerHTML=list||'<p>Nie masz jeszcze zapisanych planów.</p>';
  $('#saved-home-list').innerHTML=list;
  $('#saved-home').hidden=!plans.length||!$('#workspace').hidden;
}
function openSavedPlan(id){
  const plan=savedPlans().find(item=>item.id===id);
  if(!plan)return;
  state.savedView=true;state.activeTab='calendar';state.activePlan=plan;state.generated=[];state.events=plan.events;state.range=plan.range;
  state.visibleMonday=monday(plan.events[0]?.date||plan.range?.start||new Date());
  $('#hero').hidden=true;$('#workspace').hidden=false;
  render();$('#workspace').scrollIntoView({behavior:'smooth',block:'start'});
}
$('#generator-forms').addEventListener('change',event=>{
  const code=event.target.dataset.code;
  if(event.target.classList.contains('form-select')){event.target.checked?state.selectedForms.add(code):state.selectedForms.delete(code);if(!event.target.checked)state.allowedForms.delete(code);state.generated=[];state.activePlan=null;renderGenerator();renderCalendar()}
  if(event.target.classList.contains('form-allow')){event.target.checked?state.allowedForms.add(code):state.allowedForms.delete(code);state.generated=[];state.activePlan=null;renderGenerator();renderCalendar()}
});
$('#generate-plans').addEventListener('click',()=>void runGenerator().catch(error=>{loading(false);toast(error.message,true)}));
$('#generated-results').addEventListener('click',event=>{
  const button=event.target.closest('[data-plan]');if(!button)return;
  state.activePlan=button.dataset.plan==='manual'?null:state.generated[Number(button.dataset.plan)];
  if(state.activePlan?.events.length)state.visibleMonday=monday(state.activePlan.events[0].date);
  renderCalendar();renderGeneratedResults();$('#save-plan').disabled=!state.events.length&&!state.activePlan;
});
$('#save-plan').addEventListener('click',()=>{
  const current=visiblePlan();if(!current.events.length){toast('Widoczny plan nie zawiera zajęć.',true);return}
  const name=$('#plan-name').value.trim()||`Plan ${new Date().toLocaleString('pl-PL')}`;
  const plan={id:crypto.randomUUID(),name,range:state.range,events:current.events,groups:current.groups||[],strict:current.strict||0,allowed:current.allowed||0};
  try{setSavedPlans([plan,...savedPlans()]);$('#plan-name').value='';renderSavedPlans();toast('Plan zapisano w tej przeglądarce.')}
  catch{toast('Nie udało się zapisać planu. Pamięć przeglądarki może być pełna.',true)}
});
document.addEventListener('click',event=>{
  const open=event.target.closest('[data-open-saved]'),remove=event.target.closest('[data-delete-saved]');
  if(open)openSavedPlan(open.dataset.openSaved);
  if(remove){setSavedPlans(savedPlans().filter(plan=>plan.id!==remove.dataset.deleteSaved));renderSavedPlans();toast('Usunięto zapisany plan.')}
});
async function changeWeek(days){state.visibleMonday=addDays(state.visibleMonday,days);renderCalendar()}

function renderColorSettings(){
  const types=new Map();for(const event of state.events)types.set(event.typeShort||event.type,event.type||event.typeShort);
  $('#color-options').innerHTML=[...types.entries()].sort().map(([key,name])=>`<label class="color-option"><input type="color" data-form-color="${escapeHtml(key)}" value="${eventColor({typeShort:key,type:key})}"><span>${escapeHtml(key)}<small>${escapeHtml(name)}</small></span></label>`).join('');
  document.querySelectorAll('[data-form-color]').forEach(input=>input.addEventListener('input',()=>{state.formColors[input.dataset.formColor]=input.value;localStorage.setItem('usos-form-colors',JSON.stringify(state.formColors));renderCalendar()}));
}

$('#course-search').addEventListener('input',renderTree);
$('#export-groups').addEventListener('click',()=>{
  if(!state.album){toast('Najpierw pobierz plan dla numeru albumu.',true);return}
  const content=selectionToText(state.album,selectedGroupEntries());
  const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`grupy-${state.album}.txt`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Zapisano wybór grup do pliku TXT.');
});
$('#import-groups').addEventListener('click',()=>$('#import-groups-file').click());
$('#import-groups-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try{
    const selection=selectionFromText(await file.text());
    if(selection.album!==state.album)throw new Error(`Plik dotyczy numeru albumu ${selection.album}, a bieżący plan numeru ${state.album}.`);
    loading(true,'Wczytuję wybrane grupy i ich terminy.');
    const restored=await restoreSelection(selection.groups);
    localStorage.setItem(selectionStorageKey(),JSON.stringify(selection.groups));
    toast(`Wczytano wybór grup z pliku TXT${restored?` (w tym ${restored} innych grup)`:''}.`);
  }catch(error){toast(error.message,true)}finally{loading(false)}
});
$('#prev-week').addEventListener('click',()=>changeWeek(-7));
$('#next-week').addEventListener('click',()=>changeWeek(7));
$('#today').addEventListener('click',()=>{state.visibleMonday=monday(new Date());changeWeek(0)});
$('#change-range').addEventListener('click',()=>{$('#hero').hidden=false;$('#hero').scrollIntoView({behavior:'smooth',block:'start'})});
$('#change-account').addEventListener('click',async()=>{
  try{
    await api('/api/auth/logout',{method:'POST'});
    state.authenticated=false;state.events=[];state.range=null;state.alternatives.clear();state.alternativeLoading.clear();state.alternativeQueued.clear();state.groupSchedules.clear();state.hiddenOwn.clear();state.selectedAlternatives.clear();state.previews.clear();
    showAccount();$('#form-note').textContent='Hasło wpiszesz wyłącznie na stronie login.zut.edu.pl.';$('#workspace').hidden=true;$('#hero').hidden=false;renderSavedPlans();$('#hero').scrollIntoView({behavior:'smooth',block:'start'});
    toast('Wylogowano. Możesz zalogować się na inne konto ZUT.');
  }catch(error){toast(error.message,true)}
});
$('#reset-colors').addEventListener('click',()=>{state.formColors={...defaultFormColors};localStorage.removeItem('usos-form-colors');renderColorSettings();renderCalendar();toast('Przywrócono domyślne kolory.')});
renderSavedPlans();
