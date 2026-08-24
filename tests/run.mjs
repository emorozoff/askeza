/* askeza 2 — автотесты.
   Запуск:  node tests/run.mjs
   Поднимает статику, гоняет приложение в Chromium, проверяет чистые функции
   и все пользовательские сценарии, кладёт скриншоты в tests/shots/. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'shots');
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}/`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
               '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? '  \x1b[2m' + extra + '\x1b[0m' : '')); }
}
function eq(name, got, want) { ok(name, got === want, got === want ? '' : `получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`); }
function group(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }

const ISO = ms => new Date(Date.now() - ms).toISOString();
const DAY = 86400e3;

// приложение с одной привычкой: hours назад
const seed = (over = {}) => ({
  v: 2, quoteIdx: 0, activeId: 'h1',
  habits: [{
    id: 'h1', name: 'Курение', kind: 'smoking', color: '#ff453a',
    startedAt: ISO(3 * DAY + 5 * 3600e3),
    vow: null, history: [{ t: 'start', at: ISO(3 * DAY + 5 * 3600e3) }],
    ...over,
  }],
});

await new Promise(r => server.listen(PORT, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
fs.mkdirSync(SHOTS, { recursive: true });

const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },      // iPhone 15 Pro
  deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = n => page.screenshot({ path: path.join(SHOTS, n + '.png') });
const reload = async () => { await page.goto(BASE); await page.waitForFunction(() => !!window.__askeza); };

/** Празднований в приложении нет — заглушка осталась, чтобы не править вызовы. */
async function dismissCel() {}
const tap = sel => page.click(sel);
/** Подставляет состояние «как из хранилища» и открывает нужную привычку. */
async function setState(s) {
  await page.evaluate(st => {
    window.__askeza.set(st);
    if (st.activeId) window.__askeza.openHabit(st.activeId);   // корень — список, тесту нужна привычка
  }, s);
  await page.waitForTimeout(600);
}

try {

/* ═══════════════ 1. Чистые функции ═══════════════ */
group('1. Чистые функции');
await reload();
const A = () => page.evaluate(() => ({ ok: true }));

const pl = await page.evaluate(() =>
  [1, 2, 5, 11, 21, 22, 25, 101, 111, 114].map(n => n + ' ' + window.__askeza.plural(n, 'день', 'дня', 'дней')));
eq('плюрализация 1', pl[0], '1 день');
eq('плюрализация 2', pl[1], '2 дня');
eq('плюрализация 5', pl[2], '5 дней');
eq('плюрализация 11', pl[3], '11 дней');
eq('плюрализация 21', pl[4], '21 день');
eq('плюрализация 22', pl[5], '22 дня');
eq('плюрализация 101', pl[7], '101 день');
eq('плюрализация 111', pl[8], '111 дней');
eq('плюрализация 114', pl[9], '114 дней');

// баг v1: 364 дня показывались как «12 месяцев» при нуле лет
const bd = await page.evaluate(() => {
  const now = new Date(2026, 6, 29, 12, 0, 0);
  const a = new Date(now.getTime() - 364 * 86400e3);
  return window.__askeza.breakdown(a, now);
});
ok('364 дня не дают 12 месяцев', bd.mo < 12, `получено ${bd.y}г ${bd.mo}мес ${bd.d}дн`);

const cal = await page.evaluate(() => {
  const from = new Date(2025, 0, 31, 10, 0, 0);   // 31 января
  const to   = new Date(2025, 1, 28, 10, 0, 0);   // 28 февраля
  return window.__askeza.breakdown(from, to);
});
ok('календарная разбивка на границе месяца корректна', cal.y === 0 && cal.mo === 0 && cal.d === 28,
   JSON.stringify(cal));

// баг v1: локальная дата собиралась через toISOString (UTC) и уезжала на сутки
const ld = await page.evaluate(() => {
  const d = new Date(2026, 6, 29, 1, 30);
  return { local: window.__askeza.localDate(d), utc: d.toISOString().split('T')[0] };
});
eq('localDate даёт локальную дату', ld.local, '2026-07-29');

// кривые
const curves = await page.evaluate(() => {
  const out = {};
  for (const k of ['smoking', 'alcohol', 'weed']) {
    const f = window.__askeza.CURVES[k];
    out[k] = {
      anchorsHit: window.__askeza.CRAVING[k].every(([d, v]) => Math.abs(f(d * 86400) - v) < 0.5),
      monotone: (() => { let prev = 1e9; for (let d = 0; d <= 3650; d += 0.5) { const v = f(d * 86400); if (v > prev + 1e-6) return false; prev = v; } return true; })(),
      start: f(0), end: f(3650 * 86400),
    };
  }
  return out;
});
for (const k of ['smoking', 'alcohol', 'weed']) {
  ok(`кривая ${k}: проходит через опорные точки`, curves[k].anchorsHit);
  ok(`кривая ${k}: монотонно убывает`, curves[k].monotone);
  ok(`кривая ${k}: старт 100%, финиш > 0`, curves[k].start === 100 && curves[k].end > 0,
     `${curves[k].start} → ${curves[k].end}`);
}
// курение: исправленный пик первых суток
const sm = await page.evaluate(() => [0, 1, 3, 7, 14, 30].map(d => +window.__askeza.craving('smoking', d * 86400).toFixed(0)));
ok('курение: тяга на 1-й день ещё около пика (было 71% в v1)', sm[1] >= 90, `1 день = ${sm[1]}%`);
ok('курение: к 14 дню тяга около половины', sm[4] > 40 && sm[4] < 60, `14 дней = ${sm[4]}%`);

// зоны
const zones = await page.evaluate(() => [100, 95, 80, 60, 30, 15, 5].map(v => window.__askeza.zoneOf(v).label));
ok('зона на 100% — «Пик тяги», а не «Тяга нарастает»', zones[0] === 'Пик тяги', zones[0]);
ok('зоны не содержат «нарастает» на убывающей кривой', !zones.some(z => /нараста/i.test(z)), zones.join(', '));

// экранирование
const escaped = await page.evaluate(() => window.__askeza.esc('<img src=x onerror=alert(1)> "кавычки"'));
ok('esc() экранирует HTML', !escaped.includes('<img') && escaped.includes('&lt;img'), escaped);

// определение типа при переносе
const kinds = await page.evaluate(() => ({
  smoke: window.__askeza.guessKind('Курение'),
  vape: window.__askeza.guessKind('Вейп'),
  alc: window.__askeza.guessKind('Алкоголь'),
  nonalc: window.__askeza.guessKind('Безалкогольное пиво'),
  weed: window.__askeza.guessKind('Марихуана'),
  other: window.__askeza.guessKind('Соцсети'),
}));
eq('тип: Курение', kinds.smoke, 'smoking');
eq('тип: Вейп', kinds.vape, 'smoking');
eq('тип: Алкоголь', kinds.alc, 'alcohol');
eq('тип: «Безалкогольное пиво» НЕ алкоголь', kinds.nonalc, 'custom');
eq('тип: Соцсети — своя', kinds.other, 'custom');

/* ═══════════════ 2. Пустой экран и добавление ═══════════════ */
group('2. Пустой экран и добавление привычки');
await page.evaluate(() => { localStorage.clear(); });
await reload();
ok('пустой экран показан', await page.locator('.empty h2').isVisible());
await shot('01-empty');

await page.click('[data-act="add"]');
await page.waitForSelector('#p-add.on');
ok('страница добавления открылась', await page.locator('#p-add.on').isVisible());
ok('кнопка заблокирована, пока не выбран тип', await page.locator('#p-add .btn').isDisabled());

await page.click('[data-act="pickKind"][data-arg="custom"]');
await page.waitForTimeout(200);
ok('для своей привычки появилось поле названия', await page.locator('#a-name').isVisible());
ok('для своей привычки появился выбор цвета', await page.locator('#p-add .col').first().isVisible());
await page.fill('#a-name', 'Соцсети');
await page.waitForTimeout(120);
ok('кнопка разблокировалась после ввода названия', !(await page.locator('#p-add .btn').isDisabled()));
await shot('02-add-custom');

// БАГ v1 №1.2: отмена и повторное открытие оставляли грязное состояние
await page.click('[data-act="closeAdd"]');
await page.waitForTimeout(450);
await page.click('[data-act="add"]');
await page.waitForSelector('#p-add.on');
await page.waitForTimeout(200);
ok('после отмены и повторного открытия поле названия очищено',
   (await page.locator('#a-name').count()) === 0);
ok('после отмены и повторного открытия нет выбранного типа',
   (await page.locator('#p-add .kind.on').count()) === 0);
ok('после отмены и повторного открытия кнопка снова заблокирована',
   await page.locator('#p-add .btn').isDisabled());

// дата в будущем должна отвергаться
await page.click('[data-act="pickKind"][data-arg="smoking"]');
await page.waitForTimeout(200);
const future = new Date(Date.now() + 3 * DAY);
await page.evaluate(d => {
  const el = document.getElementById('a-date');
  el.value = d; el.dispatchEvent(new Event('change'));
}, `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`);
await page.waitForTimeout(150);
ok('дата в будущем блокирует кнопку', await page.locator('#p-add .btn').isDisabled());
ok('дата в будущем объясняется текстом', (await page.locator('#a-note').innerText()).includes('не наступил'));

await page.click('[data-act="quickWhen"][data-arg="yesterday"]');
await page.waitForTimeout(200);
ok('быстрый выбор «Вчера» разблокировал кнопку', !(await page.locator('#p-add .btn').isDisabled()));
await page.click('[data-act="saveNew"]');
await page.waitForTimeout(700);
ok('привычка создана и открылась главная', await page.locator('.h-name').isVisible());
eq('название взято из пресета', (await page.locator('.h-name').innerText()).trim(), 'Курение');

/* ═══════════════ 3. Главный экран ═══════════════ */
group('3. Главный экран');
await setState(seed());
await page.waitForTimeout(900);
ok('название привычки видно', await page.locator('.h-name').isVisible());
ok('строка «свободен с» видна', (await page.locator('.h-since').innerText()).includes('свободен с'));
eq('крупное число дней — герой экрана', (await page.locator('#big').innerText()).trim(), '3');
ok('подпись под числом — «дня»', (await page.locator('.hero-unit').innerText()).trim() === 'дня');
ok('кольца вокруг числа нет', (await page.locator('.ring, .ring-wrap, svg.ring').count()) === 0);
ok('карточка тяги видна', await page.locator('.craving').isVisible());
ok('одометр отрисован', (await page.locator('.obar').count()) >= 3);
ok('полосок на концах баров нет',
   await page.evaluate(() => getComputedStyle(document.querySelector('.obar-fill'), '::after').content) === 'none');
ok('карточки фазы нет', (await page.locator('.phase-rank').count()) === 0);
ok('кнопки «Тянет» нет', (await page.locator('.sos-btn').count()) === 0);
ok('карточки истории нет', !(await page.locator('.row-title').allInnerTexts()).includes('История'));
ok('цитата видна', await page.locator('.quote').isVisible());

// БАГ v1 №1.6: «1 дней» / «2 часов» / «1 секунд»
const labels = await page.locator('.obar').evaluateAll(els =>
  els.map(e => e.querySelector('.obar-n').textContent + ' ' + e.querySelector('.obar-l').textContent));
const badPlural = labels.filter(l => /^1 (дней|часов|минут|секунд|месяцев|лет)$/.test(l));
ok('нет «1 дней» / «1 часов» в одометре', badPlural.length === 0, labels.join(' | '));
const bad21 = labels.filter(l => /^(2[1-9]|[3-9]1) (дня|часа|минуты|секунды)$/.test(l));
ok('нет ошибок плюрализации на 21–29', bad21.length === 0, labels.join(' | '));
console.log('    \x1b[2mодометр: ' + labels.join(' · ') + '\x1b[0m');

const craving1 = await page.locator('#cv').innerText();
await page.waitForTimeout(500);
const craving2 = await page.locator('#cv').innerText();
ok('счётчик тяги живой (значение меняется)', craving1 !== craving2, `${craving1} → ${craving2}`);
const zoneTxt = await page.locator('#cv-zone').innerText();
ok('зона тяги подписана', zoneTxt.length > 0, zoneTxt);
await shot('03-home-no-vow');

// фон подкрашивается цветом привычки
const glow = await page.evaluate(() => getComputedStyle(document.getElementById('glow')).color);
eq('фон подкрашен цветом привычки', glow, 'rgb(255, 69, 58)');
/* ═══════════════ 6. Редактирование ═══════════════ */
group('6. Редактирование (баг v1: минус сутки)');
await setState(seed());
await page.waitForTimeout(600);
const before = await page.evaluate(() => window.__askeza.active().startedAt);
await page.click('[data-act="habitMenu"]');
await page.waitForTimeout(400);
await page.click('[data-act="edit"]');
await page.waitForSelector('#p-add.on');
await page.waitForTimeout(300);
const shownDate = await page.locator('#e-date').inputValue();
const shownTime = await page.locator('#e-time').inputValue();
const expect = await page.evaluate(s => {
  const d = new Date(s);
  return { d: window.__askeza.localDate(d), t: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') };
}, before);
eq('в форму подставлена локальная дата', shownDate, expect.d);
eq('в форму подставлено локальное время', shownTime, expect.t);
await shot('08-edit');
await page.click('[data-act="saveEdit"]');
await page.waitForTimeout(900);
const after = await page.evaluate(() => window.__askeza.active().startedAt);
const drift = Math.abs(new Date(after) - new Date(before)) / 1000;
ok('сохранение без правок НЕ сдвигает дату', drift < 61, `сдвиг ${Math.round(drift)} сек`);

// переименование не ломает тип
await page.click('[data-act="habitMenu"]'); await page.waitForTimeout(400);
await page.click('[data-act="edit"]'); await page.waitForTimeout(400);
await page.fill('#e-name', 'Сигареты');
await page.click('[data-act="saveEdit"]');
await page.waitForTimeout(900);
const renamed = await page.evaluate(() => {
  const h = window.__askeza.active();
  return { name: h.name, kind: h.kind, hasCurve: window.__askeza.hasCurve(h.kind) };
});
eq('название изменилось', renamed.name, 'Сигареты');
eq('тип привычки сохранён при переименовании', renamed.kind, 'smoking');
ok('кривая тяги не потерялась после переименования', renamed.hasCurve);
ok('график по-прежнему доступен', await page.locator('.craving').isVisible());

/* ═══════════════ 7. Экранирование ввода ═══════════════ */
group('7. Экранирование пользовательского ввода');
await setState({
  v: 2, quoteIdx: 0, activeId: 'h1',
  habits: [{
    id: 'h1', name: `<img src=x onerror="window.__XSS=1"> "кавычки" & <b>жирный</b>`,
    kind: 'custom', color: '#2aabee', startedAt: ISO(2 * DAY), vow: null,
    history: [{ t: 'start', at: ISO(2 * DAY) }],
  }],
});
await page.waitForTimeout(800);
ok('скрипт из названия не выполнился', await page.evaluate(() => !window.__XSS));
ok('в DOM не появился инъектированный <img>', (await page.locator('.h-name img').count()) === 0);
ok('в DOM не появился инъектированный <b>', (await page.locator('.h-name b').count()) === 0);
const shownName = await page.locator('.h-name').innerText();
ok('название показано как текст', shownName.includes('<img') && shownName.includes('"кавычки"'), shownName);
await page.click('[data-act="backToList"]');
await page.waitForTimeout(400);
ok('в списке тоже нет инъекции', (await page.locator('#list img').count()) === 0);
ok('в подписи карточки нет инъекции', (await page.locator('.hcard[aria-label] img').count()) === 0);
const cardName = await page.locator('.hname').first().innerText();
ok('название на карточке — текст', cardName.includes('<img'), cardName);
await shot('09-xss-safe');
await page.click('.hcard');
await page.waitForTimeout(500);

/* ═══════════════ 8. Своя привычка ═══════════════ */
group('8. Своя привычка');
ok('у своей привычки нет карточки тяги', (await page.locator('.craving').count()) === 0);
ok('у своей привычки есть одометр', (await page.locator('.obar').count()) > 0);
ok('у своей привычки есть число дней', await page.locator('#big').isVisible());
ok('у своей привычки есть цитата', await page.locator('.quote').isVisible());

/* ═══════════════ 9. График ═══════════════ */
group('9. График');
await setState(seed());
await page.waitForTimeout(700);
await page.click('.craving');
await page.waitForSelector('#p-chart.on');
await page.waitForTimeout(1300);
ok('страница графика открылась', await page.locator('#p-chart.on').isVisible());
ok('живое число тяги показано', (await page.locator('#ch-num').innerText()).includes('%'));
ok('мотивирующая строка есть', (await page.locator('#ch-mot').innerText()).length > 5);
eq('кнопок диапазона шесть', await page.locator('#p-chart .rb').count(), 6);

const drawn = await page.evaluate(() => {
  const c = document.getElementById('ch-static');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 12) n++;
  return { pixels: n, w: c.width, h: c.height };
});
ok('статический слой графика отрисован', drawn.pixels > 4000, `непрозрачных пикселей: ${drawn.pixels}`);
const dpr = await page.evaluate(() => {
  const c = document.getElementById('ch-static');
  return { ratio: c.width / c.getBoundingClientRect().width, devicePixelRatio };
});
ok('канвас учитывает реальный devicePixelRatio (в v1 был жёсткий ×2)',
   Math.abs(dpr.ratio - Math.min(dpr.devicePixelRatio, 3)) < 0.15, `ratio=${dpr.ratio.toFixed(2)} dpr=${dpr.devicePixelRatio}`);

// живой слой должен обновляться сам (пульсация), статический — нет
const liveA = await page.evaluate(() => document.getElementById('ch-live').toDataURL().length);
await page.waitForTimeout(700);
const liveB = await page.evaluate(() => document.getElementById('ch-live').toDataURL().length);
ok('точка «ты здесь» пульсирует на отдельном слое', liveA !== liveB);
await shot('10-chart');

await page.click('[data-act="chRange"][data-arg="3650"]');
await page.waitForTimeout(1100);
ok('диапазон 10 лет активировался', await page.locator('[data-act="chRange"][data-arg="3650"].on').isVisible());
const t10 = await page.evaluate(() => {
  const c = document.getElementById('ch-static'), ctx = c.getContext('2d');
  const d = ctx.getImageData(Math.floor(c.width * 0.72), 0, Math.floor(c.width * 0.28), c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 12) n++;
  return n;
});
ok('правая часть 10-летнего графика подписана и размечена', t10 > 250, `пикселей справа: ${t10}`);
await shot('11-chart-10y');

await page.click('[data-act="chInfo"]');
await page.waitForTimeout(600);
ok('научное пояснение раскрывается', await page.locator('#ch-body.on').isVisible());
const note = await page.locator('#ch-body').innerText();
ok('пояснение про курение говорит о пике, а не о подъёме', /пик/i.test(note), note.slice(0, 70));

// нижняя часть не уезжает под home-индикатор
const chBox = await page.locator('#p-chart .ch-info').boundingBox();
const vh = await page.evaluate(() => innerHeight);
ok('блок пояснения помещается в экран', chBox && chBox.y + chBox.height <= vh + 1,
   chBox ? `низ на ${Math.round(chBox.y + chBox.height)} из ${vh}` : 'нет блока');
await page.click('[data-act="closeChart"]');
await page.waitForTimeout(500);
/* ═══════════════ 13. Несколько привычек ═══════════════ */
group('13. Несколько привычек');
await setState({
  v: 2, quoteIdx: 0, activeId: 'h1',
  habits: [
    { id: 'h1', name: 'Курение', kind: 'smoking', color: '#ff453a', startedAt: ISO(40 * DAY), vow: null, history: [{ t: 'start', at: ISO(40 * DAY) }] },
    { id: 'h2', name: 'Алкоголь', kind: 'alcohol', color: '#ff9f0a', startedAt: ISO(8 * DAY), vow: { days: 30, startedAt: ISO(8 * DAY), endsAt: ISO(-22 * DAY), status: 'active' }, history: [{ t: 'start', at: ISO(8 * DAY) }] },
    { id: 'h3', name: 'Соцсети', kind: 'custom', color: '#bf5af2', startedAt: ISO(2 * 3600e3), vow: null, history: [{ t: 'start', at: ISO(2 * 3600e3) }] },
  ],
});
await page.waitForTimeout(900);
await page.click('[data-act="backToList"]');
await page.waitForTimeout(500);
ok('список — корневой экран', await page.locator('#list.list').isVisible());
ok('экран привычки спрятан', !(await page.locator('#home').isVisible()));
eq('в списке три карточки', await page.locator('.hcard').count(), 3);
const names = await page.locator('.hname').allInnerTexts();
eq('порядок карточек — как в данных', names.join('|'), 'Курение|Алкоголь|Соцсети');
const nums = await page.locator('.hdays').allInnerTexts();
eq('на карточке дни серии', nums[0].trim(), '40 дней');
eq('привычке младше суток показан 0 дней', nums[2].trim(), '0 дней');
ok('нет ошибок плюрализации в списке', !nums.some(s => /\b1 (дней|дня)\b/.test(s)), nums.join(' | '));
eq('у карточки восемь делений', await page.locator('.hrow').first().locator('.hseg').count(), 8);
await shot('16-list');
await page.click('.hcard[data-id="h2"]');
await page.waitForTimeout(1300);
eq('переключение на другую привычку сработало', (await page.locator('.h-name').innerText()).trim(), 'Алкоголь');
ok('у алкоголя своя кривая тяги', await page.locator('.craving').isVisible());
eq('у алкоголя своё число дней', (await page.locator('#big').innerText()).trim(), '8');
await shot('17-alcohol');

await page.click('[data-act="backToList"]'); await page.waitForTimeout(400);
await page.click('.hcard[data-id="h3"]');
await page.waitForTimeout(1000);
eq('переключение на свою привычку', (await page.locator('.h-name').innerText()).trim(), 'Соцсети');
ok('у своей привычки одометр без графика', (await page.locator('.craving').count()) === 0 && (await page.locator('.obar').count()) > 0);
/* ═══════════════ 15. Перенос из askeza 1 ═══════════════ */
group('15. Перенос из askeza 1 (старое приложение не трогаем)');
const v1data = {
  habits: [
    { id: 'old1', name: 'Курение', emoji: '🚭', color: '#ff453a', quitDate: new Date(Date.now() - 100 * DAY).toISOString(), bestStreak: 40, oldTokens: [{ rank: 'XV', label: '1 день', date: '3 мар' }] },
    { id: 'old2', name: 'Соцсети', emoji: '', color: '#2aabee', quitDate: new Date(Date.now() - 5 * DAY).toISOString(), bestStreak: 0, oldTokens: [] },
  ],
};
// это сценарий ЧИСТОЙ установки — значит и контекст браузера нужен чистый
const ctxFresh = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU' });
const pf = await ctxFresh.newPage();
const errFresh = [];
pf.on('pageerror', e => errFresh.push(String(e)));
await pf.goto(BASE + 'manifest.webmanifest');
await pf.evaluate(v1 => localStorage.setItem('askeza_data', JSON.stringify(v1)), v1data);
await pf.goto(BASE);
await pf.waitForFunction(() => !!window.__askeza);
await pf.waitForTimeout(1700);
const migrated = await pf.evaluate(() => window.__askeza.S.habits.map(h => ({ name: h.name, kind: h.kind, hist: h.history.length })));
eq('перенесены обе привычки', migrated.length, 2);
eq('тип «Курение» определён', migrated[0].kind, 'smoking');
eq('тип «Соцсети» — своя', migrated[1].kind, 'custom');
ok('старые жетоны попали в журнал', migrated[0].hist >= 2, String(migrated[0].hist));
const v1untouched = await pf.evaluate(() => localStorage.getItem('askeza_data'));
eq('данные старого приложения НЕ изменены', v1untouched, JSON.stringify(v1data));
eq('экрана празднований в приложении нет', await pf.locator('#cel').count(), 0);
eq('перенос проходит без ошибок JS', errFresh.length, 0, errFresh.join('; '));
await pf.screenshot({ path: path.join(SHOTS, '19-migrated.png') });
await ctxFresh.close();
/* ═══════════════ 17. Доступность и производительность ═══════════════ */
group('17. Доступность и производительность');
const vp = await page.evaluate(() => document.querySelector('meta[name=viewport]').content);
ok('зум не заблокирован', !/user-scalable\s*=\s*no/.test(vp), vp);
ok('viewport-fit=cover для выреза', /viewport-fit=cover/.test(vp));
const aria = await page.evaluate(() => Array.from(document.querySelectorAll('.icon-btn,.back-btn')).every(b => b.getAttribute('aria-label')));
ok('у иконочных кнопок есть aria-label', aria);
const ext = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => !r.name.startsWith(location.origin)).map(r => r.name));
eq('нет внешних сетевых запросов (шрифты и т.п.)', ext.length, 0, ext.join(', '));
const fonts = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
ok('используется системный шрифт', /system|SF Pro/i.test(fonts), fonts);

// фоновая пауза — считаем на экране привычки, где живёт счётчик тяги
await setState(seed());
await page.waitForTimeout(700);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
const s1 = await page.locator('#cv').innerText();
await page.waitForTimeout(900);
const s2 = await page.locator('#cv').innerText();
ok('в фоне счётчик останавливается (экономит батарею)', s1 === s2, `${s1} → ${s2}`);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(700);
const s3 = await page.locator('#cv').innerText();
ok('после возврата счётчик снова живой', s3 !== s2);

// уважение prefers-reduced-motion
const ctx2 = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'ru-RU' });
const p2 = await ctx2.newPage();
const err2 = [];
p2.on('pageerror', e => err2.push(String(e)));
await p2.goto(BASE);
await p2.waitForFunction(() => !!window.__askeza);
await p2.evaluate(st => { window.__askeza.set(st); window.__askeza.openHabit(st.activeId); }, seed());
await p2.waitForTimeout(1200);
ok('при reduced-motion приложение работает', await p2.locator('.h-name').isVisible());
eq('при reduced-motion нет ошибок', err2.length, 0, err2.join('; '));
await p2.screenshot({ path: path.join(SHOTS, '20-reduced-motion.png') });
await ctx2.close();

/* ═══════════════ 18. Устойчивость ═══════════════ */
group('18. Устойчивость');
await reload();
await page.evaluate(() => window.__askeza.set({ v: 2, activeId: 'zzz', habits: [{ id: 'a', name: 'Тест' }] }));
await page.waitForTimeout(700);
ok('битая привычка без полей не роняет приложение', await page.locator('.hcard, .empty h2').first().isVisible());
const repaired = await page.evaluate(() => window.__askeza.S.habits[0]);
eq('битой привычке проставлен тип', repaired.kind, 'custom');
ok('битой привычке проставлена дата старта', !!repaired.startedAt);
ok('список не падает на битой привычке', await page.locator('#list .hcard').isVisible());
ok('у битой привычки есть полоса делений', (await page.locator('#list .hseg').count()) === 8);
await page.evaluate(() => window.__askeza.set({ v: 2, habits: [], activeId: null }));
await page.waitForTimeout(500);
ok('пустое состояние показывает экран приветствия', await page.locator('.empty h2').isVisible());

// длинное название не ломает вёрстку
await setState(seed({ name: 'Очень длинное название привычки которое точно не помещается в одну строку' }));
await page.waitForTimeout(800);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('длинное название не вызывает горизонтальную прокрутку', overflow <= 1, `перелив ${overflow}px`);
await shot('21-long-name');

// многолетняя серия
await setState(seed({ startedAt: ISO(1200 * DAY) }));
await page.waitForTimeout(900);
ok('многолетняя серия отображается', await page.locator('.h-name').isVisible());
const bars = await page.locator('.obar').count();
ok('одометр показывает годы и месяцы', bars >= 5, `полос: ${bars}`);
const yearLbl = (await page.locator('.obar-l').allInnerTexts())[0];
ok('единица «год/года/лет» просклонена', /год|года|лет/.test(yearLbl), yearLbl);
await shot('22-long-streak');
/* ═══════════════ 20. Скроллинг и порно ═══════════════ */
group('20. Новые привычки: скроллинг и порно');
for (const [kind, title] of [['scroll', 'Скроллинг'], ['porn', 'Порно']]) {
  await setState({
    v: 2, quoteIdx: 0, activeId: 'x1',
    habits: [{ id: 'x1', name: title, kind, color: '#5e9eff', startedAt: ISO(10 * DAY), vow: null,
      history: [{ t: 'start', at: ISO(10 * DAY) }] }],
  });
  await page.waitForTimeout(700);
  eq(`${title}: экран открылся`, (await page.locator('.h-name').innerText()).trim(), title);
  eq(`${title}: карточки тяги НЕТ`, await page.locator('.craving').count(), 0);
  ok(`${title}: одометр есть`, (await page.locator('.obar').count()) > 0);
  eq(`${title}: число дней`, (await page.locator('#big').innerText()).trim(), '10');
  ok(`${title}: кривой тяги в коде нет`, await page.evaluate(k => !window.__askeza.hasCurve(k), kind));
  await page.screenshot({ path: path.join(SHOTS, `24-${kind}.png`) });
}

/* ═══════════════ 21. Режим сна ═══════════════ */
group('21. Режим сна — добавление');
await page.evaluate(() => window.__askeza.set({ v: 2, habits: [], activeId: null }));
await page.waitForTimeout(700);
await page.click('.empty [data-act="add"]');
await page.waitForSelector('#p-add.on');
await page.waitForTimeout(300);
eq('в списке типов семь карточек', await page.locator('#p-add .kind').count(), 7);
await page.click('[data-act="pickKind"][data-arg="sleep"]');
await page.waitForTimeout(400);
ok('появилось поле времени подъёма', await page.locator('#a-wake').isVisible());
eq('поля даты отказа нет — режим начинается сегодня', await page.locator('#a-date').count(), 0);
eq('время подъёма по умолчанию 07:00', await page.locator('#a-wake').inputValue(), '07:00');
ok('кнопка активна сразу', !(await page.locator('#p-add .btn').isDisabled()));
await page.screenshot({ path: path.join(SHOTS, '25-add-sleep.png') });
await page.click('[data-act="saveNew"]');
await page.waitForTimeout(1200);
const made = await page.evaluate(() => {
  const h = window.__askeza.active();
  return { name: h.name, kind: h.kind, daily: !!h.daily, wake: h.daily && h.daily.wakeBy, isDaily: window.__askeza.isDaily(h) };
});
eq('создан «Режим сна»', made.name, 'Режим сна');
eq('тип sleep', made.kind, 'sleep');
ok('привычка помечена как режим', made.isDaily && made.daily);
eq('цель подъёма сохранена', made.wake, '07:00');

group('21б. Главный экран режима');
ok('одометра нет', (await page.locator('.obar').count()) === 0);
ok('карточки тяги нет', (await page.locator('.craving').count()) === 0);
ok('есть кнопка «Я проснулся»', await page.locator('[data-act="wake"]').isVisible());
ok('в шапке указана цель', (await page.locator('.h-since').innerText()).includes('подъём до 07:00'));
eq('календарь на пять недель', await page.locator('.cal-d').count(), 35);
eq('шапка дней недели', await page.locator('.cal-h span').count(), 7);
eq('сегодняшний день подсвечен', await page.locator('.cal-d.today').count(), 1);
eq('три показателя', await page.locator('.dstat .hs').count(), 3);
ok('кольца нет и здесь', (await page.locator('.ring, .ring-wrap').count()) === 0);
eq('серия начинается с нуля', (await page.locator('#big').innerText()).trim(), '0');
eq('подпись — «дней подряд»', (await page.locator('.hero-unit').innerText()).trim(), 'дней подряд');
await page.screenshot({ path: path.join(SHOTS, '26-sleep-home.png') });

group('21в. Отметка подъёма');
await page.evaluate(() => { window.__askeza.active().daily.wakeBy = '23:59'; window.__askeza.renderHome(false); });
await page.waitForTimeout(400);
await page.click('[data-act="wake"]');
await page.waitForTimeout(1200);
const afterWake = await page.evaluate(() => {
  const A = window.__askeza, h = A.active();
  return { streak: A.streakDays(h), check: A.checksOf(h)[A.today()], ev: h.history.filter(e => e.t === 'wake').length };
});
eq('серия стала 1', afterWake.streak, 1);
ok('день отмечен как «вовремя»', afterWake.check && afterWake.check.ok);
ok('записано фактическое время', /^\d\d:\d\d$/.test(afterWake.check.at), afterWake.check.at);
eq('событие попало в историю', afterWake.ev, 1);
ok('кнопка сменилась на статус', await page.locator('.ci-done').isVisible());
ok('видно «Встал вовремя»', (await page.locator('.ci-t').innerText()).includes('вовремя'));
eq('в календаре появился засчитанный день', await page.locator('.cal-d.ok').count(), 1);
await page.screenshot({ path: path.join(SHOTS, '27-sleep-checked.png') });

await page.click('[data-act="redoToday"]');
await page.waitForTimeout(500);
ok('открылся выбор действия для сегодня', await page.locator('#sheet-bd.on').isVisible());
await page.click('[data-act="timeDay"]');
await page.waitForTimeout(700);
ok('открылась страница дня', await page.locator('#p-day.on').isVisible());
await page.evaluate(() => { window.__askeza.active().daily.wakeBy = '07:00'; });
await page.fill('#d-time', '09:41');
await page.click('[data-act="saveDay"]');
await page.waitForTimeout(1200);
const over = await page.evaluate(() => {
  const A = window.__askeza, h = A.active();
  return { streak: A.streakDays(h), check: A.checksOf(h)[A.today()], ev: h.history.filter(e => e.t === 'oversleep').length,
           wake: h.history.filter(e => e.t === 'wake').length };
});
eq('поздний подъём обнулил серию', over.streak, 0);
ok('день помечен как проспанный', over.check && !over.check.ok);
eq('время сохранено', over.check.at, '09:41');
eq('событие «проспал» записано', over.ev, 1);
eq('прошлая отметка того же дня заменена, а не продублирована', over.wake, 0);
ok('на экране «Проспал»', (await page.locator('.ci-t').innerText()).includes('Проспал'));
eq('в календаре день красный', await page.locator('.cal-d.miss').count(), 1);

group('21г. Серия, пропуски и отметка задним числом');
await page.evaluate(() => {
  const A = window.__askeza, t = A.today(), checks = {};
  for (let i = 0; i < 7; i++) checks[A.shiftDay(t, -i)] = { ok: true, at: '06:30' };
  const start = new Date(Date.now() - 30 * 86400e3).toISOString();
  A.set({ v: 2, activeId: 's1', habits: [{ id: 's1', name: 'Режим сна', kind: 'sleep', color: '#7c8cff',
    startedAt: start, vow: null, daily: { wakeBy: '07:00', checks }, history: [{ t: 'start', at: start }] }] });
  A.openHabit('s1');
});
await page.waitForTimeout(900);
await dismissCel();
eq('семь отметок подряд — серия 7', await page.evaluate(() => window.__askeza.streakDays(window.__askeza.active())), 7);
eq('в кольце 7', (await page.locator('#big').innerText()).trim(), '7');
eq('в календаре семь засчитанных дней', await page.locator('.cal-d.ok').count(), 7);
const stats = await page.evaluate(() => window.__askeza.dailyStats(window.__askeza.active()));
eq('вовремя: 7', stats.ok, 7);
eq('средний подъём посчитан', stats.avg, '06:30');
ok('средний подъём виден на экране', (await page.locator('.dstat').innerText()).includes('06:30'));

await page.evaluate(() => {
  const A = window.__askeza, h = A.active();
  delete h.daily.checks[A.shiftDay(A.today(), -3)];
  A.renderHome(false);
});
await page.waitForTimeout(500);
eq('пропуск обрывает серию на третьем дне', await page.evaluate(() => window.__askeza.streakDays(window.__askeza.active())), 3);
ok('появилась карточка «не отмечено»', await page.locator('.ask').isVisible());
await page.screenshot({ path: path.join(SHOTS, '28-sleep-backfill.png') });
await dismissCel();   // укоротившаяся серия могла отпраздновать свою веху
await page.click('[data-act="backfill"][data-arg$="|1"]');
await page.waitForTimeout(1100);
await dismissCel();
eq('отметка задним числом восстановила серию', await page.evaluate(() => window.__askeza.streakDays(window.__askeza.active())), 7);
ok('карточка исчезла', (await page.locator('.ask').count()) === 0);

const openBounded = await page.evaluate(() => {
  const A = window.__askeza;
  const start = new Date(Date.now() - 86400e3).toISOString();
  return A.openDays({ startedAt: start, daily: { wakeBy: '07:00', checks: {} } }, 3).length;
});
ok('задним числом не спрашивает про дни до начала режима', openBounded <= 1, `дней: ${openBounded}`);
group('21ж. Переключение между режимом и отказом');
await page.evaluate(() => {
  const A = window.__askeza, t = A.today(), checks = {};
  for (let i = 0; i < 4; i++) checks[A.shiftDay(t, -i)] = { ok: true, at: '06:15' };
  const s0 = new Date(Date.now() - 20 * 86400e3).toISOString();
  A.set({ v: 2, activeId: 's1', habits: [
    { id: 's1', name: 'Режим сна', kind: 'sleep', color: '#7c8cff', startedAt: s0, vow: null,
      daily: { wakeBy: '07:00', checks }, history: [{ t: 'start', at: s0 }] },
    { id: 'k1', name: 'Курение', kind: 'smoking', color: '#ff453a', startedAt: s0, vow: null,
      history: [{ t: 'start', at: s0 }] },
  ] });
  A.openHabit('s1');
});
await page.waitForTimeout(900);
await dismissCel();
for (let i = 0; i < 3; i++) {
  await tap('[data-act="backToList"]'); await page.waitForTimeout(400);
  await tap('.hcard[data-id="k1"]'); await page.waitForTimeout(900);
  await dismissCel();
  ok(`переключение на отказ (${i + 1}): одометр вернулся`, (await page.locator('.obar').count()) > 0);
  ok(`переключение на отказ (${i + 1}): тяга вернулась`, await page.locator('.craving').isVisible());
  await tap('[data-act="backToList"]'); await page.waitForTimeout(400);
  await tap('.hcard[data-id="s1"]'); await page.waitForTimeout(900);
  await dismissCel();
  ok(`переключение на режим (${i + 1}): календарь вернулся`, (await page.locator('.cal-d').count()) === 35);
  ok(`переключение на режим (${i + 1}): одометра нет`, (await page.locator('.obar').count()) === 0);
}
await page.waitForTimeout(2500);
ok('после переключений экран не мигает перерисовкой', (await page.locator('.cal-d').count()) === 35);

group('21з. Режим переживает перезагрузку');
await reload();
await page.waitForTimeout(1100);
const reloaded = await page.evaluate(() => {
  const A = window.__askeza, h = A.S.habits.find(x => x.kind === 'sleep');
  return { has: !!h, wake: h && h.daily && h.daily.wakeBy, checks: h && Object.keys(h.daily.checks).length, streak: h && A.streakDays(h) };
});
ok('режим сохранился', reloaded.has);
eq('цель подъёма сохранилась', reloaded.wake, '07:00');
eq('отметки сохранились', reloaded.checks, 4);
eq('серия пересчиталась после перезагрузки', reloaded.streak, 4);


/* ═══════════════ 19. Ошибки на консоли ═══════════════ */
{   // отдельная область: имена не конфликтуют с остальным прогоном
  /* ═══════════════ 22. Список привычек ═══════════════ */
  group('22. Список: полоса прогресса');
  
  const segAt = d => page.evaluate(days => {
    const A = window.__askeza;
    return A.segFills({ id: 'x', kind: 'smoking', startedAt: new Date(Date.now() - days * 86400e3).toISOString() });
  }, d);
  
  const g2 = await segAt(2);
  eq('2 дня: первое деление взято', g2[0], 1);
  ok('2 дня: второе деление наполовину', Math.abs(g2[1] - 0.5) < 0.01, String(g2[1]));
  eq('2 дня: третье деление пустое', g2[2], 0);
  const g86 = await segAt(86);
  eq('86 дней: пять делений взяты', g86.filter(x => x === 1).length, 5);
  ok('86 дней: шестое почти дошло', g86[5] > 0.9 && g86[5] < 1, String(g86[5]));
  const g400 = await segAt(400);
  ok('после года полоса полная', g400.every(x => x === 1), g400.join(','));
  const g0 = await segAt(1 / 24);
  ok('через час первое деление тронулось', g0[0] > 0.03 && g0[0] < 0.06, String(g0[0]));
  
  const labels = await page.evaluate(() => {
    const A = window.__askeza, mk = d => ({ id: 'x', kind: 'smoking', startedAt: new Date(Date.now() - d * 86400e3 - 3600e3).toISOString() });
    return [40, 365, 405, 730].map(d => A.cardDays(mk(d)));
  });
  eq('до года — дни', labels[0], '40 дней');
  eq('ровно год — «1 год»', labels[1], '1 год');
  eq('год с хвостом', labels[2], '1 год 40 дней');
  eq('два года', labels[3], '2 года');
  
  group('22б. Список: свайп, действия, порядок');
  
  /** Синтетический жест: касание, пауза, серия сдвигов, отпускание. */
  async function gesture(sel, moves, holdMs = 0) {
    await page.evaluate(async ({ sel, moves, holdMs }) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const x0 = Math.round(r.left + r.width / 2), y0 = Math.round(r.top + r.height / 2);
      const fire = (type, x, y) => {
        const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        const list = type === 'touchend' ? [] : [t];
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: [t] }));
      };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      fire('touchstart', x0, y0);
      if (holdMs) await wait(holdMs);
      let last = [0, 0];
      for (const m of moves) { fire('touchmove', x0 + m[0], y0 + m[1]); last = m; await wait(20); }
      fire('touchend', x0 + last[0], y0 + last[1]);
    }, { sel, moves, holdMs });
  }
  const swipeLeft = sel => gesture(sel, [[-12, 0], [-45, 0], [-90, 0], [-130, 2], [-150, 2]]);
  
  await setState({
    v: 2, quoteIdx: 0, activeId: 'a1',
    habits: [
      { id: 'a1', name: 'Алкоголь', kind: 'alcohol', color: '#ff9f0a', startedAt: ISO(2 * DAY), vow: null, history: [{ t: 'start', at: ISO(2 * DAY) }] },
      { id: 'a2', name: 'Марихуана', kind: 'weed', color: '#4cd964', startedAt: ISO(86 * DAY), vow: null, history: [{ t: 'start', at: ISO(86 * DAY) }] },
      { id: 'a3', name: 'Курение', kind: 'smoking', color: '#ff453a', startedAt: ISO(242 * DAY), vow: null, history: [{ t: 'start', at: ISO(242 * DAY) }] },
    ],
  });
  await page.evaluate(() => window.__askeza.goList());
  await page.waitForTimeout(500);
  eq('открыт список', await page.evaluate(() => window.__askeza.view), 'list');
  const sliver = await page.evaluate(() => {
    const A = window.__askeza;
    A.S.habits[0].startedAt = new Date(Date.now() - 90e3).toISOString();
    A.goList();
    return document.querySelector('.hrow .hseg i').style.width;
  });
  ok('через полторы минуты полоска уже видна', parseFloat(sliver) >= 4, sliver);
  await setState({ v: 2, quoteIdx: 0, activeId: 'a1', habits: await page.evaluate(() => window.__askeza.S.habits) });
  await page.evaluate(() => window.__askeza.goList());
  await page.waitForTimeout(400);
  eq('кнопок-ручек на карточке больше нет', await page.locator('.hcard .grip, .hcard .chev').count(), 0);
  
  await swipeLeft('.hrow[data-id="a2"] .hcard');
  await page.waitForTimeout(500);
  ok('свайп влево открыл действия', await page.locator('.hrow[data-id="a2"].open').count() === 1);
  const shift = await page.evaluate(() => {
    const c = document.querySelector('.hrow[data-id="a2"] .hcard');
    return new DOMMatrix(getComputedStyle(c).transform).m41;
  });
  ok('карточка уехала влево', shift < -100, String(shift));
  ok('соседняя карточка на месте', await page.locator('.hrow[data-id="a1"].open').count() === 0);
  ok('кнопка «Удалить» видна', await page.locator('.hrow[data-id="a2"] .hact.del').isVisible());
  await shot('31-list-swipe');
  
  // тап по другой карточке только закрывает открытую — и никуда не ведёт
  await gesture('.hrow[data-id="a1"] .hcard', []);
  await page.click('.hrow[data-id="a1"] .hcard');
  await page.waitForTimeout(500);
  eq('тап мимо закрыл действия', await page.locator('.hrow.open').count(), 0);
  eq('и не увёл с экрана списка', await page.evaluate(() => window.__askeza.view), 'list');
  
  // свайп → «Изменить» открывает нужную привычку
  await swipeLeft('.hrow[data-id="a3"] .hcard');
  await page.waitForTimeout(450);
  await page.locator('.hrow[data-id="a3"] .hact:not(.del)').tap();
  await page.waitForSelector('#p-add.on');
  await page.waitForTimeout(400);
  eq('«Изменить» открыл именно эту привычку', await page.locator('#e-name').inputValue(), 'Курение');
  await page.click('[data-act="closeAdd"]');
  await page.waitForTimeout(450);
  
  // свайп → «Удалить» спрашивает и удаляет
  await swipeLeft('.hrow[data-id="a3"] .hcard');
  await page.waitForTimeout(450);
  await page.locator('.hrow[data-id="a3"] .hact.del').tap();
  await page.waitForTimeout(450);
  ok('удаление спрашивает подтверждение', (await page.locator('#sheet').innerText()).includes('безвозвратно'));
  await page.click('[data-act="del"]');
  await page.waitForTimeout(600);
  eq('привычка удалена', await page.evaluate(() => window.__askeza.S.habits.length), 2);
  eq('после удаления остались в списке', await page.evaluate(() => window.__askeza.view), 'list');
  
  // долгий тап и перетаскивание меняют порядок
  const step = await page.evaluate(() => document.querySelector('.hrow').offsetHeight + 10);
  await gesture('.hrow[data-id="a1"] .hcard', [[0, step * 0.4], [0, step * 0.8], [2, step], [2, step]], 520);
  await page.waitForTimeout(700);
  const order = await page.evaluate(() => window.__askeza.S.habits.map(h => h.id));
  eq('перетаскивание переставило карточку', order.join(','), 'a2,a1');
  const shownOrder = await page.locator('.hname').allInnerTexts();
  eq('список перерисован в новом порядке', shownOrder.join(','), 'Марихуана,Алкоголь');
  await page.reload();
  await page.waitForFunction(() => !!window.__askeza);
  await page.waitForTimeout(600);
  eq('новый порядок пережил перезагрузку',
     (await page.evaluate(() => window.__askeza.S.habits.map(h => h.id))).join(','), 'a2,a1');
  
  // карточка ведёт на экран привычки, стрелка возвращает
  await page.click('.hcard[data-id="a1"]');
  await page.waitForTimeout(900);
  await dismissCel();
  eq('тап по карточке открыл привычку', (await page.locator('.h-name').innerText()).trim(), 'Алкоголь');
  await page.click('[data-act="backToList"]');
  await page.waitForTimeout(500);
  ok('стрелка вернула в список', await page.locator('#list.list').isVisible());
  
}

/* ═══════════════ 22. Убранное не возвращается ═══════════════ */
{
  group('22. Аскезы, фазы, «Тянет», история и экспорт убраны');
  await setState(seed());
  await page.waitForTimeout(700);

  const api = await page.evaluate(() => Object.keys(window.__askeza));
  ok('аскез нет в API', !api.includes('vowInfo'), api.join(','));
  ok('фаз нет в API', !api.includes('phaseAt') && !api.includes('PHASE_SOURCE'));
  ok('экспорта нет в API', !api.includes('exportJSON') && !api.includes('applyImport'));
  ok('вех нет в API', !api.includes('MILESTONES') && !api.includes('DAILY_MS') && !api.includes('checkProgress'), api.join(','));

  eq('экрана празднования нет', await page.locator('#cel').count(), 0);
  eq('вехи в журнал не пишутся',
     await page.evaluate(() => window.__askeza.S.habits.some(h => h.history.some(e => e.t === 'milestone'))), false);

  eq('страницы аскезы нет', await page.locator('#p-vow').count(), 0);
  eq('страницы фаз нет', await page.locator('#p-phases').count(), 0);
  eq('страницы истории нет', await page.locator('#p-history').count(), 0);
  eq('страницы данных нет', await page.locator('#p-data').count(), 0);
  eq('экрана «Тянет» нет', await page.locator('#sos').count(), 0);

  eq('кнопок обета нет', await page.locator('[data-act="vow"], .vow-cta').count(), 0);
  eq('кнопки «Тянет» нет', await page.locator('[data-act="sos"], .sos-btn').count(), 0);
  eq('поле vow в данные не пишется',
     await page.evaluate(() => 'vow' in window.__askeza.S.habits[0]), false);

  await page.click('[data-act="habitMenu"]');
  await page.waitForTimeout(450);
  const menu = (await page.locator('#sheet').innerText()).replace(/\n/g, ' | ');
  ok('в меню нет аскезы', !/Аскеза|обет/i.test(menu), menu);
  ok('в меню нет истории', !/История/i.test(menu), menu);
  ok('в меню осталось изменить', /Изменить/.test(menu), menu);
  ok('в меню осталось записать срыв', /Записать срыв/.test(menu), menu);
  ok('в меню осталось удалить', /Удалить привычку/.test(menu), menu);
  await page.click('[data-act="closeSheet"]');
  await page.waitForTimeout(400);
  await shot('32-habit-clean');

  await page.click('[data-act="backToList"]');
  await page.waitForTimeout(500);
  ok('в списке нет кнопки «Данные и копии»',
     !(await page.locator('#list').innerText()).includes('Данные и копии'));

  // срыв больше не упоминает аскезу и по-прежнему работает
  await page.click('.hcard');
  await page.waitForTimeout(800);
  await dismissCel();
  await page.click('[data-act="habitMenu"]'); await page.waitForTimeout(420);
  await page.click('[data-act="relapseAsk"]'); await page.waitForTimeout(500);
  const warn = await page.locator('#sheet').innerText();
  ok('предупреждение о срыве не говорит про аскезу', !/аскез/i.test(warn), warn.replace(/\n/g, ' '));
  await page.click('[data-act="relapse"]'); await page.waitForTimeout(800);
  await dismissCel();
  eq('срыв обнулил счётчик', (await page.locator('#big').innerText()).trim(), '0');
  eq('срыв записан в журнал',
     await page.evaluate(() => window.__askeza.S.habits[0].history.filter(e => e.t === 'relapse').length), 1);

  // Приложение не кладёт записей в историю браузера. Пустышка через pushState
  // давала жест «назад», но Safari показывал вместо неё белый экран на несколько
  // секунд: снимка для записи, добавленной в том же документе, у него нет.
  await reload();
  await page.waitForTimeout(900);
  eq('приложение не кладёт записей в историю браузера',
     await page.evaluate(() => history.state), null);
  ok('обработчика popstate нет',
     await page.evaluate(() => { let hit = false;
       const h = () => { hit = true; }; window.addEventListener('popstate', h);
       window.dispatchEvent(new PopStateEvent('popstate'));
       window.removeEventListener('popstate', h);
       return hit && window.__askeza.view === 'list'; }));
}

/* ═══════════════ 23. Загрузка по ссылке ═══════════════ */
{
  group('23. Ссылка #seed=');

  const mkSeed = obj => Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const link = mkSeed({ habits: [
    { name: 'Алкоголь', kind: 'alcohol', startedAt: '2026-08-22T02:00:00' },
    { name: 'NoFap', kind: 'porn', startedAt: '2026-08-17T02:20:00' },
  ] });

  // разбор полезной нагрузки
  const parsed = await page.evaluate(h => {
    const hs = window.__askeza.parseSeed('#seed=' + h);
    return hs && hs.map(x => ({ name: x.name, kind: x.kind, color: x.color, at: x.startedAt }));
  }, link);
  eq('в ссылке две привычки', parsed.length, 2);
  eq('имя прочитано', parsed[0].name, 'Алкоголь');
  eq('тип прочитан', parsed[1].kind, 'porn');
  ok('цвет подставлен по типу', parsed[0].color === '#ff9f0a', parsed[0].color);
  ok('время без пояса прочитано как местное',
     new Date(parsed[0].at).getHours() === 2, parsed[0].at);

  ok('битая ссылка не разбирается', await page.evaluate(() => window.__askeza.parseSeed('#seed=%%%') === null));
  ok('пустой список не принимается',
     await page.evaluate(() => window.__askeza.parseSeed('#seed=' + btoa('{"habits":[]}')) === null));
  ok('обычный хеш игнорируется', await page.evaluate(() => window.__askeza.parseSeed('#chart') === null));

  // сценарий целиком: открыли ссылку, подтвердили, привычки встали
  await setState(seed());
  await page.waitForTimeout(500);
  await page.evaluate(h => { location.hash = '#seed=' + h; window.__askeza.seedFromLink(); }, link);
  await page.waitForTimeout(500);
  ok('спрошено подтверждение', await page.locator('#sheet-bd.on').isVisible());
  ok('сказано, сколько привычек и что заменится',
     /2 привычки .*заменят/i.test(await page.locator('#sheet').innerText()),
     (await page.locator('#sheet').innerText()).replace(/\n/g, ' '));
  eq('до подтверждения данные не тронуты',
     await page.evaluate(() => window.__askeza.S.habits.length), 1);
  eq('хеш из адреса убран сразу', await page.evaluate(() => location.hash), '');

  await page.click('[data-act="seedApply"]');
  await page.waitForTimeout(900);
  await dismissCel();
  const after = await page.evaluate(() => window.__askeza.S.habits.map(h => h.name));
  eq('загрузились обе привычки', after.join(','), 'Алкоголь,NoFap');
  eq('старое заменено, а не добавлено', after.length, 2);
  eq('после загрузки открыт список', await page.evaluate(() => window.__askeza.view), 'list');
  eq('в списке две карточки', await page.locator('.hcard').count(), 2);
  ok('вехи прошлого не сыплют празднованиями', (await page.locator('#cel.on').count()) === 0);
  ok('дата пережила перезагрузку', await page.evaluate(() =>
    new Date(window.__askeza.S.habits[0].startedAt).getHours() === 2));

  // отмена оставляет всё как было
  await setState(seed());
  await page.waitForTimeout(500);
  await page.evaluate(h => { location.hash = '#seed=' + h; window.__askeza.seedFromLink(); }, link);
  await page.waitForTimeout(500);
  await page.click('[data-act="closeSheet"]');
  await page.waitForTimeout(500);
  eq('отказ ничего не меняет', await page.evaluate(() => window.__askeza.S.habits.length), 1);
}

group('19. Ошибки исполнения');
ok('за весь прогон не было ошибок JS', errors.length === 0, errors.slice(0, 5).join('  ;;  '));

} catch (e) {
  fail++; fails.push('ИСКЛЮЧЕНИЕ: ' + e.message);
  console.log('\n\x1b[31mИсключение в тестах:\x1b[0m', e);
  try { await page.screenshot({ path: path.join(SHOTS, 'crash.png') }); } catch {}
}

console.log('\n' + '─'.repeat(52));
console.log(`\x1b[1mИтог:\x1b[0m \x1b[32m${pass} прошло\x1b[0m` + (fail ? `, \x1b[31m${fail} упало\x1b[0m` : ''));
if (fails.length) { console.log('\nУпавшие:'); fails.forEach(f => console.log('  • ' + f)); }
console.log('Скриншоты: tests/shots/');

await browser.close();
server.close();
process.exit(fail ? 1 : 0);
