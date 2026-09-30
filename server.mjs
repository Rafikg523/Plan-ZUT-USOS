import http from 'node:http';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const USOS = 'https://usosweb.zut.edu.pl/kontroler.php';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 PlanUSOS/1.0';
const PORT = Number(process.env.PORT || 4173);

function decodeHtml(value = '') {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–' };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name] ?? all);
}

function stripTags(value = '') {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function extractForms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((match) => {
    const tag = match[1];
    const fields = {};
    for (const input of match[2].matchAll(/<input\b([^>]*)>/gi)) {
      const name = attr(input[1], 'name');
      if (name) fields[name] = attr(input[1], 'value');
    }
    return { id: attr(tag, 'id'), name: attr(tag, 'name'), action: attr(tag, 'action'), method: attr(tag, 'method') || 'GET', fields };
  });
}

class CookieJar {
  constructor() { this.byDomain = new Map(); }
  store(url, headers) {
    const host = new URL(url).hostname;
    const bucket = this.byDomain.get(host) || new Map();
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const line of values) {
      const pair = line.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) bucket.set(pair.slice(0, index), pair.slice(index + 1));
    }
    this.byDomain.set(host, bucket);
  }
  header(url) {
    const host = new URL(url).hostname;
    const pairs = [];
    for (const [domain, bucket] of this.byDomain) {
      if (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)) {
        for (const [key, value] of bucket) pairs.push(`${key}=${value}`);
      }
    }
    return pairs.join('; ');
  }
  importCookies(cookies) {
    for (const cookie of cookies) {
      const domain = String(cookie.domain || '').replace(/^\./, '');
      if (!domain || !cookie.name) continue;
      const bucket = this.byDomain.get(domain) || new Map();
      bucket.set(cookie.name, cookie.value || '');
      this.byDomain.set(domain, bucket);
    }
  }
}

class UsosSession {
  constructor(login, password) {
    this.login = login;
    this.password = password;
    this.jar = new CookieJar();
    this.authenticated = false;
    this.loginPromise = null;
    this.album = '';
  }

  setCredentials(login, password) {
    this.login = login;
    this.password = password;
    this.jar = new CookieJar();
    this.authenticated = false;
    this.album = '';
  }

  async request(url, options = {}, redirects = 12) {
    const headers = new Headers(options.headers || {});
    headers.set('user-agent', USER_AGENT);
    headers.set('accept-language', 'pl-PL,pl;q=0.9,en;q=0.7');
    const cookie = this.jar.header(url);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(url, { ...options, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    this.jar.store(url, response.headers);
    if ([301, 302, 303, 307, 308].includes(response.status) && redirects > 0) {
      const location = response.headers.get('location');
      if (!location) return response;
      const next = new URL(location, url).toString();
      const preserve = response.status === 307 || response.status === 308;
      return this.request(next, preserve ? options : { method: 'GET' }, redirects - 1);
    }
    return response;
  }

  async submitForm(form, baseUrl, extra = {}) {
    const body = new URLSearchParams({ ...form.fields, ...extra });
    return this.request(new URL(form.action, baseUrl).toString(), {
      method: form.method.toUpperCase() === 'GET' ? 'GET' : 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.method.toUpperCase() === 'GET' ? undefined : body,
    });
  }

  async loginToUsos() {
    if (!this.login || !this.password) throw new Error('Podaj login i hasło do USOS ZUT.');
    this.jar = new CookieJar();

    const home = `${USOS}?_action=home/index`;
    const gateResponse = await this.request(home);
    const gateHtml = await gateResponse.text();
    if (gateHtml.includes('logout-url=')) { this.authenticated = true; return; }

    const loginUrlMatch = gateHtml.match(/login-url=['"]([^'"]+)/i) || gateHtml.match(/href=['"]([^'"]*_action=logowaniecas\/index[^'"]*)/i);
    if (!loginUrlMatch) throw new Error('USOSweb nie zwrócił odnośnika logowania.');
    const brokerResponse = await this.request(decodeHtml(loginUrlMatch[1]));
    const brokerHtml = await brokerResponse.text();
    const samlRequestForm = extractForms(brokerHtml).find((form) => form.fields.SAMLRequest);
    if (!samlRequestForm) throw new Error('Nie rozpoznano formularza SSO ZUT (SAMLRequest).');

    const adfsResponse = await this.submitForm(samlRequestForm, brokerResponse.url || loginUrlMatch[1]);
    const adfsHtml = await adfsResponse.text();
    const loginForm = extractForms(adfsHtml).find((form) => form.id === 'loginForm' || 'AuthMethod' in form.fields);
    if (!loginForm) throw new Error('Nie rozpoznano formularza logowania ZUT.');

    const authResponse = await this.submitForm(loginForm, adfsResponse.url, {
      UserName: this.login,
      Password: this.password,
      AuthMethod: 'FormsAuthentication',
    });
    const authHtml = await authResponse.text();
    if (/incorrect|nieprawidł|błędn|errorText/i.test(authHtml) && !authHtml.includes('SAMLResponse')) throw new Error('Logowanie nie powiodło się. Sprawdź login i hasło ZUT.');
    const samlResponseForm = extractForms(authHtml).find((form) => form.fields.SAMLResponse);
    if (!samlResponseForm) throw new Error('SSO ZUT nie zwróciło odpowiedzi SAML.');

    const finalResponse = await this.submitForm(samlResponseForm, authResponse.url);
    const finalHtml = await finalResponse.text();
    if (!finalHtml.includes('logout-url=') && !finalHtml.includes('Mój plan zajęć')) throw new Error('USOSweb odrzucił sesję po logowaniu.');
    this.authenticated = true;
  }

  async ensureLogin(force = false) {
    if (force) this.authenticated = false;
    if (this.authenticated) return;
    if (!this.loginPromise) this.loginPromise = this.loginToUsos().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  async getHtml(url) {
    await this.ensureLogin();
    let response = await this.request(url);
    let html = await response.text();
    if (response.status === 403 || html.includes('Wymagane zalogowanie')) {
      this.authenticated = false;
      throw new Error('Sesja USOS wygasła. Zaloguj się ponownie przez ZUT.');
    }
    if (!response.ok) throw new Error(`USOSweb zwrócił błąd HTTP ${response.status}.`);
    return html;
  }
}

export function isoDate(date) { return date.toISOString().slice(0, 10); }
function localDate(value) { return new Date(`${value}T12:00:00Z`); }
function addDays(value, days) { const date = typeof value === 'string' ? localDate(value) : new Date(value); date.setUTCDate(date.getUTCDate() + days); return date; }
function mondayOf(value) { const date = localDate(value); const day = date.getUTCDay(); return addDays(date, day === 0 ? -6 : 1 - day); }

function programInfo(code) {
  const bits = code.split('-');
  const short = bits.slice(0, 2).join('-') || 'INNE';
  const mode = bits[1] || '';
  const labels = { S1: 'stacjonarne · I stopień', S2: 'stacjonarne · II stopień', N1: 'niestacjonarne · I stopień', N2: 'niestacjonarne · II stopień' };
  return { key: short, label: labels[mode] ? `${short} · ${labels[mode]}` : short };
}

export function parseWeekPlan(html, fallbackMonday) {
  const range = html.match(/(20\d{2}-\d{2}-\d{2})\s*-\s*(20\d{2}-\d{2}-\d{2})/);
  const weekStart = range?.[1] || isoDate(mondayOf(fallbackMonday));
  const table = html.match(/<usos-timetable\b[^>]*>([\s\S]*?)<\/usos-timetable>/i)?.[1] || '';
  const events = [];
  const days = [...table.matchAll(/<div>\s*<div><h4>([^<]+)<\/h4><\/div>\s*<timetable-day>([\s\S]*?)<\/timetable-day>\s*<\/div>/gi)];
  for (const [dayIndex, day] of days.entries()) {
    // Kody ZUT zawierają znak ">" wewnątrz name-id, więc zwykłe [^>]*
    // urwałoby znacznik w połowie wartości atrybutu.
    for (const entry of day[2].matchAll(/<timetable-entry\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/timetable-entry>/gi)) {
      const tag = entry[1];
      const body = entry[2];
      const start = tag.match(/grid-row-start:\s*g(\d{2})(\d{2})/i);
      const end = tag.match(/grid-row-end:\s*g(\d{2})(\d{2})/i);
      const details = stripTags(body.match(/slot=["']dialog-info["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
      const detailMatch = details.match(/^(.*?),\s*grupa\s*(\S+)/i);
      const groupUrl = body.match(/slot=["']dialog-info["'][\s\S]*?href=['"]([^'"]+)/i)?.[1] || '';
      const teacherBlock = body.match(/slot=["']dialog-person["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
      const placeBlock = body.match(/slot=["']dialog-place["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
      const place = stripTags(placeBlock);
      const room = place.match(/Sala\s+([^,]+)/i)?.[1]?.trim() || '';
      const building = place.match(/\[([^\]]+)]/)?.[1] || '';
      const courseCode = attr(tag, 'name-id');
      const info = stripTags(body.match(/slot=["']info["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
      const shortType = info.split(',')[0].trim();
      const program = programInfo(courseCode);
      events.push({
        id: `${isoDate(addDays(weekStart, dayIndex))}-${start?.[1] || '00'}${start?.[2] || '00'}-${courseCode}-${detailMatch?.[2] || ''}-${room}`,
        date: isoDate(addDays(weekStart, dayIndex)),
        dayName: stripTags(day[1]),
        start: start ? `${start[1]}:${start[2]}` : '',
        end: end ? `${end[1]}:${end[2]}` : '',
        courseName: attr(tag, 'name'), courseCode,
        programKey: program.key, programLabel: program.label,
        type: detailMatch?.[1] || shortType, typeShort: shortType,
        group: detailMatch?.[2] || info.match(/gr\.\s*(\S+)/i)?.[1] || '',
        lecturers: stripTags(teacherBlock).replace(/,\s*$/, ''), room, building,
        groupUrl: decodeHtml(groupUrl),
        classId: groupUrl.match(/zaj_cyk_id=(\d+)/)?.[1] || '',
        color: attr(tag, 'color') || '1',
      });
    }
  }
  const unique = new Map(events.map((event) => [[event.date, event.start, event.end, event.courseCode, event.group, event.room].join('|'), event]));
  return { weekStart, weekEnd: range?.[2] || isoDate(addDays(weekStart, 6)), events: [...unique.values()] };
}

export function parseCourseGroups(html) {
  const table = html.match(/<usos-timetable\b[^>]*>([\s\S]*?)<\/usos-timetable>/i)?.[1] || '';
  const groups = new Map();
  for (const entry of table.matchAll(/<timetable-entry\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/timetable-entry>/gi)) {
    const tag = entry[1];
    const body = entry[2];
    const details = stripTags(body.match(/slot=["']dialog-info["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const detailMatch = details.match(/^(.*?),\s*grupa\s*(\S+)/i);
    const info = stripTags(body.match(/slot=["']info["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const group = detailMatch?.[2] || info.match(/gr\.\s*(\S+)/i)?.[1] || '';
    if (!group) continue;
    const teacherBlock = body.match(/slot=["']dialog-person["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const lecturer = stripTags(teacherBlock).replace(/,\s*$/, '');
    const groupUrl = body.match(/slot=["']dialog-info["'][\s\S]*?href=['"]([^'"]+)/i)?.[1] || '';
    const current = groups.get(group) || {
      group,
      classId: groupUrl.match(/zaj_cyk_id=(\d+)/)?.[1] || '',
      courseName: attr(tag, 'name'),
      courseCode: attr(tag, 'name-id'),
      type: detailMatch?.[1] || info.split(',')[0].trim(),
      lecturers: new Set(),
    };
    if (lecturer) current.lecturers.add(lecturer);
    groups.set(group, current);
  }
  return [...groups.values()].map((group) => ({ ...group, lecturers: [...group.lecturers].join(', ') }));
}

function termForDate(value) {
  const date = localDate(value); const year = date.getUTCFullYear(); const month = date.getUTCMonth() + 1;
  return month >= 8 ? `${year}/${year + 1}-Z` : month <= 2 ? `${year - 1}/${year}-Z` : `${year - 1}/${year}-L`;
}

const session = new UsosSession('', '');
let browserAuthPromise = null;

async function availableBrowser() {
  const candidates = ['/usr/bin/brave', '/usr/bin/brave-browser', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error('Nie znaleziono obsługiwanej przeglądarki (Brave, Chrome lub Chromium).');
}

function freeLocalPort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function cdpCommand(webSocketUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Przekroczono czas komunikacji z przeglądarką.')); }, 8_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timer); socket.close();
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Nie udało się połączyć z oknem logowania.')); });
  });
}

async function authenticateInBrowser() {
  if (browserAuthPromise) return browserAuthPromise;
  browserAuthPromise = (async () => {
    const executable = await availableBrowser();
    const port = await freeLocalPort();
    const profile = await mkdtemp(join(tmpdir(), 'plan-usos-auth-'));
    const child = spawn(executable, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--new-window',
      `${USOS}?_action=home/index`,
    ], { stdio: 'ignore' });
    const started = Date.now();
    let loginRedirectStarted = false;
    try {
      while (Date.now() - started < 5 * 60_000) {
        if (child.exitCode !== null) throw new Error('Okno logowania zostało zamknięte przed zalogowaniem.');
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        let pages;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
          pages = await response.json();
        } catch { continue; }
        const page = pages.find((item) => item.type === 'page' && item.url.includes('usosweb.zut.edu.pl'));
        if (!page?.webSocketDebuggerUrl) continue;
        let check;
        try {
          check = await cdpCommand(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
            expression: 'document.documentElement.outerHTML.includes("logout-url=")', returnByValue: true,
          });
        } catch { continue; }
        if (!check?.result?.value) {
          if (!loginRedirectStarted) {
            try {
              const redirect = await cdpCommand(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
                expression: `(() => {
                  const link = document.querySelector('a[href*="_action=logowaniecas/index"]');
                  if (!link) return false;
                  link.click();
                  return true;
                })()`,
                returnByValue: true,
              });
              loginRedirectStarted = Boolean(redirect?.result?.value);
            } catch {}
          }
          continue;
        }
        const cookieResult = await cdpCommand(page.webSocketDebuggerUrl, 'Network.getAllCookies');
        session.jar = new CookieJar();
        session.jar.importCookies(cookieResult.cookies || []);
        session.authenticated = true;
        const homeHtml = await session.getHtml(`${USOS}?_action=home/index`);
        session.album = homeHtml.match(/Numer albumu:[\s\S]{0,250}?<b>\s*(\d+)/i)?.[1] || '';
        if (!session.album) throw new Error('Zalogowano, ale USOSweb nie udostępnił numeru albumu.');
        return { authenticated: true, defaultAlbum: session.album };
      }
      throw new Error('Upłynął czas logowania do ZUT.');
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM');
      setTimeout(() => rm(profile, { recursive: true, force: true }).catch(() => {}), 1_500);
    }
  })().finally(() => { browserAuthPromise = null; });
  return browserAuthPromise;
}

async function mapPool(items, limit, work) {
  const output = new Array(items.length); let index = 0;
  async function runner() { while (index < items.length) { const current = index++; output[current] = await work(items[current], current); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return output;
}

export async function fetchSchedule(start, end, onProgress = () => {}, getHtml = url => session.getHtml(url)) {
  const first = mondayOf(start); const last = localDate(end); const weeks = [];
  for (let date = first; date <= last; date = addDays(date, 7)) weeks.push(isoDate(date));
  if (weeks.length > 30) throw new Error('Zakres może obejmować maksymalnie 30 tygodni.');
  let completed = 0;
  onProgress(completed, weeks.length);
  const parsed = await mapPool(weeks, 4, async (week) => {
    const url = new URL(USOS); url.searchParams.set('_action', 'home/plan'); url.searchParams.set('plan_division', 'week'); url.searchParams.set('plan_week_sel_week', week);
    const result = parseWeekPlan(await getHtml(url), week);
    onProgress(++completed, weeks.length);
    return result;
  });
  const events = parsed.flatMap((week) => week.events).filter((event) => event.date >= start && event.date <= end);
  return { start, end, events, weeks: weeks.length, fetchedAt: new Date().toISOString() };
}

async function fetchAlternatives(courseCode, date) {
  const url = new URL(USOS);
  url.searchParams.set('_action', 'katalog2/przedmioty/pokazPlanZajecPrzedmiotu');
  url.searchParams.set('cdyd_kod', termForDate(date));
  url.searchParams.set('plan_division', 'week');
  url.searchParams.set('plan_week_sel_week', date);
  url.searchParams.set('prz_kod', courseCode);
  const parsed = parseWeekPlan(await session.getHtml(url), date);
  return { courseCode, date, events: parsed.events };
}

export function parseParticipants(html) {
  const totalMatch = html.match(/<td\b[^>]*>\s*Liczba osób w grupie:\s*<\/td>\s*<td\b[^>]*>\s*(\d+)/i);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  const label = /^(?:(?:Lista\s+)?(?:uczestników|uczestnikow|uczestnicy|studentów|studentow|studenci))(?:\s+(?:zajęć|grupy))?\s*[:(\d\s)]*$/i;
  const sections = [];
  for (const match of html.matchAll(/<(h[1-6]|td|th|legend)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (!label.test(stripTags(match[2]))) continue;
    const tail = html.slice(match.index + match[0].length);
    sections.push(match[1].toLowerCase() === 'td' || match[1].toLowerCase() === 'th'
      ? tail.split(/<\/tr>/i)[0]
      : tail.split(/<h[1-6]\b|<footer\b|<usos-footer\b/i)[0]);
  }
  const people = new Map();
  // USOS renders the roster as a sortable table, without a participants heading.
  // Only read rows following its name-column headers; teacher links live elsewhere.
  for (const header of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const headings = [...header[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(cell => stripTags(cell[1]));
    const surnameColumn = headings.findIndex(value => /^Nazwisko\b/i.test(value));
    const givenColumn = headings.findIndex(value => /^Imiona?\b/i.test(value));
    if (surnameColumn < 0 || givenColumn < 0) continue;
    const body = html.slice(header.index + header[0].length).split(/<\/table>/i)[0];
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]);
      const surname = cells[surnameColumn] || '', given = stripTags(cells[givenColumn] || '');
      const link = [...surname.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
        .find(match => attr(match[1], 'href').includes('katalog2/osoby/pokazOsobe'));
      const id = link && attr(link[1], 'href').match(/os_id(?:=|:)(\d+)/)?.[1];
      const family = link && stripTags(link[2]);
      if (id && family && given) people.set(id, { name: `${given} ${family}` });
    }
  }
  for (const section of sections) {
    for (const match of section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(match[1], 'href');
      if (!href.includes('katalog2/osoby/pokazOsobe')) continue;
      const id = href.match(/os_id(?:=|:)(\d+)/)?.[1];
      const name = stripTags(match[2]);
      if (id && name && !people.has(id)) people.set(id, { name });
    }
  }
  return { available: people.size > 0 || total === 0, participants: [...people.values()], total };
}

export function participantListUrl(html, base) {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/(?:lista|pokaż|zobacz).*?(?:uczestnik|student)|^(?:uczestnicy|studenci)$/i.test(stripTags(match[2]))) continue;
    try {
      const url = new URL(attr(match[1], 'href'), base);
      if (url.origin === new URL(USOS).origin && url.pathname === '/kontroler.php' && url.href !== String(base)) return url;
    } catch { /* Ignore malformed links. */ }
  }
  return null;
}

export function nextParticipantPage(html, base) {
  const navigation = html.match(/<table-nav-bar\b[^>]*\bcurrent-elements-number=["'][^"']+["'][^>]*>/i)?.[0];
  if (!navigation) return null;
  const range = attr(navigation, 'current-elements-number').match(/^(\d+)\.\.(\d+)$/);
  const count = Number(attr(navigation, 'elements-count'));
  if (!range || Number(range[2]) >= count) return null;
  const url = new URL(base);
  const offset = Number(range[2]);
  if (offset <= Number(url.searchParams.get('tab_offset') || 0)) throw new Error('Nie udało się odczytać kolejnej strony uczestników.');
  url.searchParams.set('tab_offset', String(offset));
  return url;
}

export async function fetchParticipants(classId, group, getHtml = url => session.getHtml(url)) {
  const url = new URL(USOS);
  url.searchParams.set('_action', 'katalog2/przedmioty/pokazZajecia');
  url.searchParams.set('zaj_cyk_id', classId);
  url.searchParams.set('gr_nr', group);
  url.searchParams.set('tab_limit', '500');
  url.searchParams.set('tab_offset', '0');
  const html = await getHtml(url);
  const result = parseParticipants(html);
  if (result.available) {
    let next = nextParticipantPage(html, url), pages = 1;
    while (next) {
      if (++pages > 100) throw new Error('Lista uczestników przekracza obsługiwany rozmiar.');
      const pageHtml = await getHtml(next), page = parseParticipants(pageHtml);
      if (!page.available || !page.participants.length) throw new Error('Nie udało się odczytać całej listy uczestników.');
      result.participants.push(...page.participants);
      next = nextParticipantPage(pageHtml, next);
    }
    return result;
  }
  const listUrl = participantListUrl(html, url);
  if (!listUrl) return result;
  const list = parseParticipants(await getHtml(listUrl));
  return { ...list, total: list.total ?? result.total };
}

async function fetchCourseGroups(courseCode, date) {
  const url = new URL(USOS);
  url.searchParams.set('_action', 'katalog2/przedmioty/pokazPlanZajecPrzedmiotu');
  url.searchParams.set('cdyd_kod', termForDate(date));
  url.searchParams.set('plan_division', 'semester');
  url.searchParams.set('prz_kod', courseCode);
  const groups = parseCourseGroups(await session.getHtml(url));
  return { courseCode, groups };
}

export async function fetchCourseSchedule(courseCode, start, end, getHtml = url => session.getHtml(url)) {
  const first = mondayOf(start); const last = localDate(end); const weeks = [];
  for (let current = first; current <= last; current = addDays(current, 7)) weeks.push(isoDate(current));
  if (weeks.length > 30) throw new Error('Zakres może obejmować maksymalnie 30 tygodni.');
  const parsed = await mapPool(weeks, 4, async (week) => {
    const url = new URL(USOS);
    url.searchParams.set('_action', 'katalog2/przedmioty/pokazPlanZajecPrzedmiotu');
    url.searchParams.set('cdyd_kod', termForDate(week));
    url.searchParams.set('plan_division', 'week');
    url.searchParams.set('plan_week_sel_week', week);
    url.searchParams.set('prz_kod', courseCode);
    return parseWeekPlan(await getHtml(url), week);
  });
  const events = parsed.flatMap((week) => week.events).filter((event) => event.date >= start && event.date <= end);
  return { courseCode, start, end, events };
}

async function fetchGroupSchedule(courseCode, group, start, end) {
  const result = await fetchCourseSchedule(courseCode, start, end);
  return { ...result, group, events: result.events.filter(event => event.group === group) };
}

async function fetchCourseData(courseCode, start, end) {
  const result = await fetchCourseSchedule(courseCode, start, end);
  const groups = new Map();
  for (const event of result.events) {
    const group = groups.get(event.group) || { group: event.group, classId: event.classId, courseCode, courseName: event.courseName, type: event.type, lecturers: new Set() };
    if (event.lecturers) group.lecturers.add(event.lecturers);
    groups.set(event.group, group);
  }
  return { ...result, groups: [...groups.values()].map(group => ({ ...group, lecturers: [...group.lecturers].join(', ') })) };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function validDate(value) { return /^20\d{2}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(localDate(value).valueOf()); }

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/api/config') {
      return json(res, 200, { authenticated: session.authenticated, defaultAlbum: session.album });
    }
    if (url.pathname === '/api/auth/browser' && req.method === 'POST') {
      return json(res, 200, await authenticateInBrowser());
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      session.setCredentials('', '');
      return json(res, 200, { authenticated: false });
    }
    if (url.pathname === '/api/schedule') {
      const start = url.searchParams.get('start'); const end = url.searchParams.get('end');
      if (!session.authenticated) return json(res, 401, { error: 'Najpierw zaloguj się do USOS ZUT.' });
      if (!validDate(start) || !validDate(end) || start > end) return json(res, 400, { error: 'Podaj poprawny zakres dat.' });
      if (url.searchParams.get('stream') === '1') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        const send = message => res.write(`${JSON.stringify(message)}\n`);
        try {
          const schedule = await fetchSchedule(start, end, (completed, total) => send({ kind: 'progress', completed, total }));
          send({ kind: 'result', schedule });
        } catch (error) { send({ kind: 'error', error: error.message }); }
        return res.end();
      }
      return json(res, 200, await fetchSchedule(start, end));
    }
    if (url.pathname === '/api/alternatives') {
      const code = url.searchParams.get('courseCode'); const date = url.searchParams.get('date');
      if (!code || code.length > 160 || !validDate(date)) return json(res, 400, { error: 'Brak kodu przedmiotu lub daty.' });
      return json(res, 200, await fetchAlternatives(code, date));
    }
    if (url.pathname === '/api/group-participants') {
      if (!session.authenticated) return json(res, 401, { error: 'Najpierw zaloguj się do USOS ZUT.' });
      const classId = url.searchParams.get('classId'), group = url.searchParams.get('group');
      if (!/^\d{1,20}$/.test(classId || '') || !/^\d{1,10}$/.test(group || '')) return json(res, 400, { error: 'Niepoprawny identyfikator zajęć lub grupy.' });
      res.setHeader('Cache-Control', 'no-store');
      return json(res, 200, await fetchParticipants(classId, group));
    }
    if (url.pathname === '/api/course-data') {
      if (!session.authenticated) return json(res, 401, { error: 'Najpierw zaloguj się do USOS ZUT.' });
      const code = url.searchParams.get('courseCode'), start = url.searchParams.get('start'), end = url.searchParams.get('end');
      if (!code || code.length > 160 || !validDate(start) || !validDate(end) || start > end) return json(res, 400, { error: 'Niepoprawny przedmiot lub zakres dat.' });
      return json(res, 200, await fetchCourseData(code, start, end));
    }
    if (url.pathname === '/api/course-groups') {
      const code = url.searchParams.get('courseCode'); const date = url.searchParams.get('date');
      if (!code || code.length > 160 || !validDate(date)) return json(res, 400, { error: 'Brak kodu przedmiotu lub daty.' });
      return json(res, 200, await fetchCourseGroups(code, date));
    }
    if (url.pathname === '/api/group-schedule') {
      const code = url.searchParams.get('courseCode'); const group = url.searchParams.get('group');
      const start = url.searchParams.get('start'); const end = url.searchParams.get('end');
      if (!code || code.length > 160 || !group || group.length > 40 || !validDate(start) || !validDate(end) || start > end) return json(res, 400, { error: 'Niepoprawne dane grupy lub zakres dat.' });
      return json(res, 200, await fetchGroupSchedule(code, group, start, end));
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[\w./-]+$/.test(path) || path.includes('..')) return json(res, 404, { error: 'Nie znaleziono.' });
    const data = await readFile(join(PUBLIC, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (error) {
    console.error(`[${new Date().toISOString()}]`, error.message);
    json(res, 500, { error: error.message || 'Nieoczekiwany błąd serwera.' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Plan USOS: http://127.0.0.1:${PORT}`));
}

export { programInfo, termForDate };
