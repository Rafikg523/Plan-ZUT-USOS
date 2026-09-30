const header = 'Plan USOS ZUT — wybrane grupy';
const oldColumns = 'Przedmiot\tForma\tKod przedmiotu\tNumer grupy';
const columns = 'Przedmiot\tForma\tKod przedmiotu\tZ grupy (plan USOS)\tNa grupę (wybór)';
const clean = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const groupList = groups => groups.length ? groups.map(group => group ? `gr. ${clean(group)}` : '(bez numeru)').join('; ') : 'brak (ukryto)';

function parseGroupList(value) {
  if (value === 'brak (ukryto)') return [];
  return value.split('; ').map(item => {
    if (item === '(bez numeru)') return '';
    if (!item.startsWith('gr. ') || !item.slice(4)) throw new Error('Plik wyboru grup zawiera nieprawidłowy numer grupy.');
    return item.slice(4);
  });
}

export function selectionToText(album, forms) {
  const rows = forms.map(form => [clean(form.name), clean(form.form), clean(form.code), groupList(form.fromGroups), groupList(form.toGroups)].join('\t'));
  return [header, `Numer albumu: ${clean(album)}`, '', columns, ...rows, ''].join('\n');
}

export function selectionFromText(text) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== header) throw new Error('To nie jest plik wyboru grup z Plan USOS ZUT.');
  const album = lines[1]?.match(/^Numer albumu: (\d+)$/)?.[1];
  if (!album || ![columns, oldColumns].includes(lines[3])) throw new Error('Plik wyboru grup ma nieprawidłowy format.');
  const groups = lines.slice(4).filter(Boolean).flatMap(line => {
    const parts = line.split('\t');
    if (parts.length !== (lines[3] === columns ? 5 : 4) || !parts[2]) throw new Error('Plik wyboru grup zawiera nieprawidłowy wiersz.');
    const selected = lines[3] === columns ? parseGroupList(parts[4]) : [parts[3]];
    return selected.map(group => ({ name: parts[0], form: parts[1], code: parts[2], group }));
  });
  return { album, groups };
}
