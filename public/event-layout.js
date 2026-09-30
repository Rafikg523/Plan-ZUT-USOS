const minutes = value => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

// Lay out one day, including the minimum visible height of short events.
export function layoutDayEvents(items) {
  const entries = items.map(item => {
    const start = minutes(item.event.start);
    const height = Math.max(27, (minutes(item.event.end) - start) / 60 * 64 - 3);
    return { ...item, top: (start - 7 * 60) / 60 * 64, height };
  }).sort((a, b) => a.top - b.top || b.height - a.height);
  let group = [], laneEnds = [], groupEnd = -Infinity;
  const finishGroup = () => {
    for (const entry of group) entry.columns = laneEnds.length;
  };
  for (const entry of entries) {
    if (entry.top >= groupEnd) {
      finishGroup();
      group = [];
      laneEnds = [];
    }
    let column = laneEnds.findIndex(end => end <= entry.top);
    if (column === -1) column = laneEnds.length;
    entry.column = column;
    laneEnds[column] = entry.top + entry.height;
    groupEnd = Math.max(...laneEnds);
    group.push(entry);
  }
  finishGroup();
  return entries;
}
