import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutDayEvents } from '../public/event-layout.js';

const item = (start, end, isAlt = false) => ({ event: { start, end }, isAlt });

test('identical and nested events receive separate columns, including previews', () => {
  const result = layoutDayEvents([
    item('09:00', '12:00'), item('09:00', '12:00', true), item('10:00', '11:00'),
  ]);
  assert.deepEqual(result.map(e => [e.column, e.columns]), [[0, 3], [1, 3], [2, 3]]);
  assert.equal(result[1].isAlt, true);
});

test('connected collisions reuse columns and later events return to full width', () => {
  const result = layoutDayEvents([
    item('11:00', '12:00'), item('09:00', '10:00'),
    item('09:30', '10:30'), item('10:00', '11:00'),
  ]);
  assert.deepEqual(result.map(e => [e.column, e.columns]), [[0, 2], [1, 2], [0, 2], [0, 1]]);
});

test('adjacent classes do not collide', () => {
  assert.deepEqual(layoutDayEvents([item('09:00', '10:00'), item('10:00', '11:00')])
    .map(e => e.columns), [1, 1]);
  assert.deepEqual(layoutDayEvents([]), []);
});

test('minimum card heights cannot cover short neighboring events', () => {
  const result = layoutDayEvents([item('09:00', '09:10'), item('09:10', '09:20')]);
  assert.deepEqual(result.map(e => [e.column, e.columns]), [[0, 2], [1, 2]]);
});
