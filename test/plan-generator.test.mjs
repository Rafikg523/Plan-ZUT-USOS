import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlans, overlapMinutes, planShape } from '../public/plan-generator.js';

const event = (courseCode, date, start, end) => ({ courseCode, date, start, end });

test('calculates overlaps only for simultaneous meetings on the same date', () => {
  const first = event('A', '2026-10-05', '10:00', '11:30');
  assert.equal(overlapMinutes(first, event('B', '2026-10-05', '11:00', '12:00')), 30);
  assert.equal(overlapMinutes(first, event('B', '2026-10-12', '11:00', '12:00')), 0);
});

test('chooses a conflict-free group across the whole date range', () => {
  const choices = [
    { code: 'A', options: [{ group: '1', events: [event('A', '2026-10-05', '10:00', '11:00'), event('A', '2026-10-12', '10:00', '11:00')] }] },
    { code: 'B', options: [
      { group: '1', events: [event('B', '2026-10-12', '10:30', '11:30')] },
      { group: '2', events: [event('B', '2026-10-12', '11:00', '12:00')] },
    ] },
  ];
  const plans = generatePlans(choices);
  assert.equal(plans[0].groups.find(group => group.code === 'B').group, '2');
  assert.equal(plans[0].strict, 0);
  assert.equal(plans[1].strict, 30);
});

test('prioritizes required non-overlapping forms over allowed overlaps', () => {
  const choices = [
    { code: 'A', options: [{ group: '1', events: [event('A', '2026-10-05', '10:00', '11:00')] }] },
    { code: 'B', options: [{ group: '1', events: [event('B', '2026-10-05', '11:00', '12:00')] }] },
    { code: 'C', options: [
      { group: 'strict', events: [event('C', '2026-10-05', '11:30', '12:00')] },
      { group: 'allowed', events: [event('C', '2026-10-05', '10:00', '11:00')] },
    ] },
  ];
  assert.equal(generatePlans(choices, new Set(['A']))[0].groups.find(group => group.code === 'C').group, 'allowed');
  assert.equal(generatePlans(choices)[0].groups.find(group => group.code === 'C').group, 'strict');
});

test('counts actual gaps without treating overlapping classes as a break', () => {
  assert.deepEqual(planShape([
    event('A', '2026-10-05', '09:00', '11:00'),
    event('B', '2026-10-05', '10:00', '12:00'),
    event('C', '2026-10-05', '13:00', '14:00'),
    event('D', '2026-10-06', '09:00', '10:00'),
  ]), { gapMinutes: 60, occupiedDays: 2, singleDays: 1, shapeScore: 360 });
});

test('prefers shorter gaps when occupied and single-class days match', () => {
  const choices = [
    { code: 'A', options: [{ group: '1', events: [event('A', '2026-10-05', '09:00', '10:00')] }] },
    { code: 'B', options: [{ group: '1', events: [event('B', '2026-10-05', '12:00', '13:00')] }] },
    { code: 'C', options: [
      { group: 'short', events: [event('C', '2026-10-05', '10:00', '11:00')] },
      { group: 'long', events: [event('C', '2026-10-05', '14:00', '15:00')] },
    ] },
  ];
  assert.equal(generatePlans(choices)[0].groups.find(group => group.code === 'C').group, 'short');
});

test('prefers an existing class day to a new occupied day', () => {
  const choices = [
    { code: 'A', options: [{ group: '1', events: [event('A', '2026-10-05', '09:00', '10:00')] }] },
    { code: 'B', options: [
      { group: 'monday', events: [event('B', '2026-10-05', '10:00', '11:00')] },
      { group: 'tuesday', events: [event('B', '2026-10-06', '10:00', '11:00')] },
    ] },
  ];
  assert.equal(generatePlans(choices)[0].groups.find(group => group.code === 'B').group, 'monday');
});

test('avoids a lone class when the number of occupied days and gaps are equal', () => {
  const choices = [
    { code: 'A', options: [{ group: '1', events: [event('A', '2026-10-05', '09:00', '10:00')] }] },
    { code: 'B', options: [{ group: '1', events: [event('B', '2026-10-05', '10:00', '11:00')] }] },
    { code: 'C', options: [{ group: '1', events: [event('C', '2026-10-06', '09:00', '10:00')] }] },
    { code: 'D', options: [
      { group: 'lone', events: [event('D', '2026-10-05', '11:00', '12:00')] },
      { group: 'paired', events: [event('D', '2026-10-06', '10:00', '11:00')] },
    ] },
  ];
  assert.equal(generatePlans(choices)[0].groups.find(group => group.code === 'D').group, 'paired');
});
