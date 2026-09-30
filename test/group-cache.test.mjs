import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('preloads group schedules and toggles previews without further network requests', async () => {
  const requests = [];
  const elements = new Map();
  const event = {courseCode: 'TEST', group: '2', date: '2026-10-05', start: '10:00', end: '11:00'};
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout,
    localStorage: { getItem: () => null },
    document: { addEventListener(){}, querySelector: selector => {
      if (!elements.has(selector)) elements.set(selector, {addEventListener(){}, classList:{toggle(){}}, style:{}});
      return elements.get(selector);
    } },
    fetch: async path => {
      requests.push(path);
      return {ok:true, json:async()=>path==='/api/config'?{}:{events:[event], groups:[{group:'2'}]}};
    },
  });
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  vm.runInContext(`renderTree=()=>{};renderCalendar=()=>{};toast=()=>{};
    state.events=[{courseCode:'TEST',group:'1'}];state.range={start:'2026-10-01',end:'2026-10-31'};
    state.visibleMonday=monday('2026-10-05');`, context);
  assert.equal(await vm.runInContext('preloadAlternatives()', context), 0);
  const downloaded = requests.length;
  vm.runInContext("toggleAlternative('TEST|2',true)", context);
  assert.equal(vm.runInContext("state.previews.get('TEST|2').length", context), 1);
  vm.runInContext("toggleAlternative('TEST|2',false);toggleAlternative('TEST|2',true);changeWeek(7)", context);
  assert.equal(requests.length, downloaded);
  assert.equal(requests.filter(path=>path.startsWith('/api/course-data')).length, 1);
});

test('loads groups concurrently in the background and stops the old queue after a range change', async () => {
  const pending = [];
  const elements = new Map();
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout,
    localStorage: { getItem: () => null },
    document: { addEventListener(){}, querySelector: selector => {
      if (!elements.has(selector)) elements.set(selector, {addEventListener(){}, classList:{toggle(){}}});
      return elements.get(selector);
    } },
    fetch: path => path === '/api/config'
      ? Promise.resolve({ok:true,json:async()=>({})})
      : new Promise(resolve => pending.push(() => resolve({ok:true,json:async()=>({events:[],groups:[]})}))),
  });
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInContext(source, context);
  vm.runInContext(`renderTree=()=>{};
    state.events=['A','B','C','D'].map(courseCode=>({courseCode}));
    state.range={start:'2026-10-01',end:'2026-10-31'};`, context);
  const background = vm.runInContext('preloadAlternatives()', context);
  assert.equal(pending.length, 2);
  assert.match(elements.get('#groups-progress').textContent, /0\/4/);
  assert.equal(elements.has('#loading'), false, 'background work must not show the blocking overlay');
  pending[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 3);
  assert.equal(vm.runInContext("state.alternatives.has('A')", context), true);
  assert.match(elements.get('#groups-progress').textContent, /1\/4/);
  vm.runInContext('state.range=null;state.alternatives.clear()', context);
  pending[1]();pending[2]();
  await background;
  assert.equal(pending.length, 3, 'obsolete queued courses must not be requested');
  assert.equal(vm.runInContext('state.alternatives.size', context), 0);
  assert.match(elements.get('#groups-progress').textContent, /1\/4/, 'obsolete results must not update progress');
});
