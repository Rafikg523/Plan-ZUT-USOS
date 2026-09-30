import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionFromText, selectionToText } from '../public/group-selection.js';

test('TXT lists readable subjects and groups and can be loaded again', () => {
  const groups = [
    { name: 'Matematyka dyskretna', form: 'wykład', code: 'IIN-S1-MAT-WK', group: '1' },
    { name: 'Programowanie', form: 'laboratorium', code: 'IIN-S1-PRO-LB', group: '3' },
  ];
  const text = selectionToText('123456', groups);
  assert.match(text, /Matematyka dyskretna\twykład\tIIN-S1-MAT-WK\t1/);
  assert.deepEqual(selectionFromText(text), { album: '123456', groups });
});

test('TXT loader rejects unrelated or damaged files', () => {
  assert.throws(() => selectionFromText('dowolny tekst'), /nie jest plik/);
  assert.throws(() => selectionFromText(selectionToText('123456', []).replace('Numer albumu: 123456', 'Numer albumu: abc')), /nieprawidłowy format/);
});
