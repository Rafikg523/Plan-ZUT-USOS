import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseGroups, parseWeekPlan, termForDate } from '../server.mjs';

test('wyznacza cykl dydaktyczny', () => {
  assert.equal(termForDate('2026-10-01'),'2026/2027-Z');
  assert.equal(termForDate('2027-03-01'),'2026/2027-L');
});

test('parsuje wpis planu USOSweb', () => {
  const html=`<b>2026-10-05 - 2026-10-11</b><usos-timetable><div><div><h4>Poniedziałek</h4></div><timetable-day><timetable-entry style="grid-row-start: g1015; grid-row-end: g1145" name="Algorytmy" name-id="IIN-S1-3-X>ABC-LB" color="2"><div slot="info">LB, gr.&nbsp;2 (205)</div><span slot="dialog-info"><a href="?zaj_cyk_id=42&gr_nr=2">ćwiczenia laboratoryjne, grupa 2</a></span><div slot="dialog-person">Jan Kowalski,</div><span slot="dialog-place">Sala 205, budynek: WI [WI]</span></timetable-entry></timetable-day></div></usos-timetable>`;
  const result=parseWeekPlan(html,'2026-10-05');
  assert.equal(result.events.length,1);
  const event=result.events[0];
  assert.deepEqual(
    {date:event.date,start:event.start,end:event.end,courseName:event.courseName,group:event.group,lecturers:event.lecturers,room:event.room,programKey:event.programKey},
    {date:'2026-10-05',start:'10:15',end:'11:45',courseName:'Algorytmy',group:'2',lecturers:'Jan Kowalski',room:'205',programKey:'IIN-S1'}
  );
});

test('odnajduje wszystkie grupy z planu semestralnego', () => {
  const entry=(group,teacher)=>`<timetable-entry name="Seminarium" name-id="IIN-S1-3-X>ABC-SM"><div slot="info">SM, gr.&nbsp;${group}</div><span slot="dialog-info">seminarium, grupa ${group}</span><div slot="dialog-person">${teacher},</div></timetable-entry>`;
  const groups=parseCourseGroups(`<usos-timetable>${entry('1','Anna Nowak')}${entry('2','Jan Kowalski')}${entry('2','Jan Kowalski')}</usos-timetable>`);
  assert.deepEqual(groups.map(group=>({group:group.group,lecturers:group.lecturers})),[{group:'1',lecturers:'Anna Nowak'},{group:'2',lecturers:'Jan Kowalski'}]);
});
