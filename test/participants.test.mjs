import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParticipants, participantListUrl, nextParticipantPage, fetchParticipants } from '../server.mjs';

const person = (id, name) => `<a href="kontroler.php?_action=katalog2/osoby/pokazOsobe&amp;os_id=${id}">${name}</a>`;

// Structure from the saved ZUT page; all names and identifiers are synthetic.
const roster = (rows, range = '1..2', count = 2) => `<table><tr><td>Prowadzący:</td><td>${person(9, 'Prowadzący Testowy')}</td></tr></table>
  <success-box>Do listy studentów mają dostęp uczestnicy oraz prowadzący grup.</success-box>
  <table class="wrnav"><tbody><tr><td colspan="6"><table-nav-bar current-elements-number="${range}" elements-count="${count}"></table-nav-bar>
  <table role="presentation"><tr><td>Sortuj wg</td><td><select><option>nazwiska</option></select></td></tr></table></td></tr>
  <tr><th>Lp.</th><th><div><a>Nazwisko&nbsp;<span><usos-icon icon-name="arrow_drop_up"></usos-icon></span></a></div></th><th><a>Imiona</a></th><th>Informacja</th><th>Stan</th></tr>
  ${rows.map(([id, surname, given], i) => `<tr class="odd_row"><td>${i + 1}</td><td>${person(id, surname)}</td><td>${given}</td><td colspan="2">aktywny</td></tr>`).join('')}
  </tbody></table><table><tr><td>Liczba osób w grupie:</td><td>${count}</td></tr></table>`;

test('reads the ZUT roster without a heading and combines given names and surnames', () => {
  assert.deepEqual(parseParticipants(roster([[1, 'Nowak', 'Anna Maria'], [2, 'Kowalski', 'Jan']])), {
    available: true, total: 2, participants: [{name: 'Anna Maria Nowak'}, {name: 'Jan Kowalski'}],
  });
});

test('fetches every roster page, retaining different people with identical names', async () => {
  const requests = [];
  const result = await fetchParticipants('123', '422', async url => {
    requests.push(new URL(url));
    return requests.length === 1
      ? roster([[1, 'Nowak', 'Anna']], '1..1')
      : roster([[2, 'Nowak', 'Anna']], '2..2');
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('tab_limit'), '500');
  assert.equal(requests[1].searchParams.get('tab_offset'), '1');
  assert.equal(requests[1].searchParams.get('gr_nr'), '422');
  assert.deepEqual(result.participants, [{name: 'Anna Nowak'}, {name: 'Anna Nowak'}]);
});

test('does not silently return a partial list if later pages fail', async () => {
  let calls = 0;
  await assert.rejects(fetchParticipants('123', '422', async () => ++calls === 1
    ? roster([[1, 'Nowak', 'Anna']], '1..1') : '<p>Brak dostępu</p>'), /całej listy/);
  assert.equal(nextParticipantPage(roster([], '1..2'), 'https://usosweb.zut.edu.pl/kontroler.php'), null);
  assert.throws(() => nextParticipantPage(roster([], '1..1'), 'https://usosweb.zut.edu.pl/kontroler.php?tab_offset=1'), /kolejnej strony/);
});

test('extracts participants without including teachers or later sections', () => {
  const result = parseParticipants(`<table><tr><td>Liczba osób w grupie:</td><td>3</td></tr>
    <tr><td>Prowadzący:</td><td>${person(1, 'Teacher')}</td></tr></table>
    <h2>Uczestnicy grupy</h2><table><tr><td>${person(2, 'Anna &amp; Jan')}</td></tr>
    <tr><td>${person(3, 'Ala Nowak')}${person(3, 'Ala Nowak')}</td></tr></table>
    <h2>Prowadzący</h2>${person(4, 'Other Teacher')}`);
  assert.deepEqual(result, { available: true, total: 3, participants: [{ name: 'Anna & Jan' }, { name: 'Ala Nowak' }] });
});

test('supports participant lists in a table row', () => {
  const result = parseParticipants(`<tr><td>Studenci:</td><td>${person(2, 'Anna Nowak')}</td></tr>
    <tr><td>Prowadzący:</td><td>${person(1, 'Teacher')}</td></tr>`);
  assert.deepEqual(result.participants, [{ name: 'Anna Nowak' }]);
});

test('distinguishes unavailable lists from explicitly empty groups', () => {
  assert.deepEqual(parseParticipants(`<h2>Uczestnicy</h2><p>Brak uprawnień</p>`), { available: false, total: null, participants: [] });
  assert.equal(parseParticipants('<tr><td>Liczba osób w grupie:</td><td>0</td></tr>').available, true);
  assert.equal(parseParticipants(person(1, 'Teacher')).available, false);
});

test('only follows participant links on the USOS origin', () => {
  const base = 'https://usosweb.zut.edu.pl/kontroler.php?_action=group';
  assert.equal(participantListUrl('<a href="https://example.com/kontroler.php">Lista studentów</a>', base), null);
  assert.equal(participantListUrl('<a href="javascript:alert(1)">Lista studentów</a>', base), null);
  assert.equal(participantListUrl('<a href="?list=1&amp;group=2">Lista studentów</a>', base)?.href,
    'https://usosweb.zut.edu.pl/kontroler.php?list=1&group=2');
});
