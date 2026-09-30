import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCourseSchedule } from '../server.mjs';

test('downloads each week once for all groups and respects the requested date range', async () => {
  const requests = [];
  const result = await fetchCourseSchedule('TEST-LB', '2026-10-06', '2026-10-12', async url => {
    requests.push(new URL(url));
    const week = url.searchParams.get('plan_week_sel_week');
    const entry = group => `<timetable-entry style="grid-row-start: g1000; grid-row-end: g1130" name="Test" name-id="TEST-LB"><div slot="info">LB, gr. ${group}</div><span slot="dialog-info"><a href="?zaj_cyk_id=123&gr_nr=${group}">laboratorium, grupa ${group}</a></span></timetable-entry>`;
    return `<b>${week} - 2026-10-18</b><usos-timetable><div><div><h4>Poniedziałek</h4></div><timetable-day>${entry('1')}${entry('2')}</timetable-day></div></usos-timetable>`;
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(result.events.map(event => [event.date, event.group]), [['2026-10-12', '1'], ['2026-10-12', '2']]);
  assert.ok(requests.every(url => !url.searchParams.has('gr_nr')));
});

test('reports failed downloads rather than caching incomplete schedules', async () => {
  await assert.rejects(fetchCourseSchedule('TEST', '2026-10-05', '2026-10-11', async () => { throw new Error('offline'); }), /offline/);
});
