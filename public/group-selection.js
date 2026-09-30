const header = 'Plan USOS ZUT — wybrane grupy';

export function selectionToText(album, groups) {
  const clean = value => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const rows = groups.map(group => [group.name, group.form, group.code, group.group].map(clean).join('\t'));
  return [header, `Numer albumu: ${clean(album)}`, '', 'Przedmiot\tForma\tKod przedmiotu\tNumer grupy', ...rows, ''].join('\n');
}

export function selectionFromText(text) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== header) throw new Error('To nie jest plik wyboru grup z Plan USOS ZUT.');
  const album = lines[1]?.match(/^Numer albumu: (\d+)$/)?.[1];
  if (!album || lines[3] !== 'Przedmiot\tForma\tKod przedmiotu\tNumer grupy') throw new Error('Plik wyboru grup ma nieprawidłowy format.');
  const groups = lines.slice(4).filter(Boolean).map(line => {
    const parts = line.split('\t');
    if (parts.length !== 4 || !parts[2]) throw new Error('Plik wyboru grup zawiera nieprawidłowy wiersz.');
    return { name: parts[0], form: parts[1], code: parts[2], group: parts[3] };
  });
  return { album, groups };
}
