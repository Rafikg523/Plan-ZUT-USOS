import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionFromText, selectionToText } from '../public/group-selection.js';

test('TXT shows original and selected groups and can be loaded again', () => {
  const forms = [
    { name: 'Matematyka dyskretna', form: 'wykład', code: 'IIN-S1-MAT-WK', fromGroups: ['1'], toGroups: ['1'] },
    { name: 'Programowanie', form: 'laboratorium', code: 'IIN-S1-PRO-LB', fromGroups: ['1'], toGroups: ['2', '3'] },
    { name: 'Seminarium', form: 'seminarium', code: 'IIN-S1-SEM-SM', fromGroups: ['4'], toGroups: [] },
  ];
  const text = selectionToText('123456', forms);
  assert.match(text, /Z grupy \(plan USOS\)\tNa grupę \(wybór\)/);
  assert.match(text, /Programowanie\tlaboratorium\tIIN-S1-PRO-LB\tgr\. 1\tgr\. 2; gr\. 3/);
  assert.match(text, /Seminarium\tseminarium\tIIN-S1-SEM-SM\tgr\. 4\tbrak \(ukryto\)/);
  assert.deepEqual(selectionFromText(text), { album: '123456', groups: [
    { name: 'Matematyka dyskretna', form: 'wykład', code: 'IIN-S1-MAT-WK', group: '1' },
    { name: 'Programowanie', form: 'laboratorium', code: 'IIN-S1-PRO-LB', group: '2' },
    { name: 'Programowanie', form: 'laboratorium', code: 'IIN-S1-PRO-LB', group: '3' },
  ] });
});

test('TXT loader rejects unrelated or damaged files', () => {
  assert.throws(() => selectionFromText('dowolny tekst'), /nie jest plik/);
  assert.throws(() => selectionFromText(selectionToText('123456', []).replace('Numer albumu: 123456', 'Numer albumu: abc')), /nieprawidłowy format/);
});

test('TXT loader accepts files exported before the change', () => {
  const old = 'Plan USOS ZUT — wybrane grupy\nNumer albumu: 123456\n\nPrzedmiot\tForma\tKod przedmiotu\tNumer grupy\nProgramowanie\tlaboratorium\tIIN-S1-PRO-LB\t3\n';
  assert.deepEqual(selectionFromText(old).groups, [{ name: 'Programowanie', form: 'laboratorium', code: 'IIN-S1-PRO-LB', group: '3' }]);
});
