function minutes(time) {
  const [hour, minute] = String(time).split(':').map(Number);
  return hour * 60 + minute;
}

export function overlapMinutes(first, second) {
  if (first.date !== second.date || first.courseCode === second.courseCode) return 0;
  return Math.max(0, Math.min(minutes(first.end), minutes(second.end)) - Math.max(minutes(first.start), minutes(second.start)));
}

export function planShape(events) {
  const days = new Map();
  for (const event of events) {
    if (!days.has(event.date)) days.set(event.date, []);
    days.get(event.date).push([minutes(event.start), minutes(event.end)]);
  }
  let gapMinutes = 0, singleDays = 0;
  for (const meetings of days.values()) {
    if (meetings.length === 1) singleDays++;
    meetings.sort((a, b) => a[0] - b[0]);
    let occupiedUntil = meetings[0][1];
    for (const [start, end] of meetings.slice(1)) {
      gapMinutes += Math.max(0, start - occupiedUntil);
      occupiedUntil = Math.max(occupiedUntil, end);
    }
  }
  const occupiedDays = days.size;
  // A free day and a day without a lone class are useful enough to trade
  // against a short gap, while long gaps still matter across the semester.
  const shapeScore = gapMinutes + occupiedDays * 90 + singleDays * 120;
  return { gapMinutes, occupiedDays, singleDays, shapeScore };
}

function comparePlans(a, b) {
  return a.strict - b.strict || a.allowed - b.allowed || a.shapeScore - b.shapeScore || a.gapMinutes - b.gapMinutes || a.occupiedDays - b.occupiedDays || a.singleDays - b.singleDays || a.groups.map(g => g.group).join('|').localeCompare(b.groups.map(g => g.group).join('|'));
}

// Each choice contains one group for one course form. Compare every actual meeting
// in the selected date range, including alternating-week classes.
export function generatePlans(choices, allowedForms = new Set(), limit = 3) {
  if (!choices.length) return [];
  const ordered = [...choices].sort((a, b) => a.options.length - b.options.length);
  if (ordered.some(choice => !choice.options.length)) return [];
  let beam = [{ groups: [], events: [], strict: 0, allowed: 0, ...planShape([]) }];
  for (const choice of ordered) {
    const next = [];
    for (const partial of beam) for (const option of choice.options) {
      let strict = partial.strict, allowed = partial.allowed;
      for (const event of option.events) for (const existing of partial.events) {
        const overlap = overlapMinutes(event, existing);
        if (!overlap) continue;
        if (allowedForms.has(event.courseCode) || allowedForms.has(existing.courseCode)) allowed += overlap;
        else strict += overlap;
      }
      const events = [...partial.events, ...option.events];
      next.push({ groups: [...partial.groups, { code: choice.code, group: option.group }], events, strict, allowed, ...planShape(events) });
    }
    next.sort(comparePlans);
    beam = next.slice(0, 300);
  }
  return beam.slice(0, limit).map(plan => ({ ...plan, events: plan.events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)) }));
}
