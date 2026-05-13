'use strict';

let scheduleData = null;
let activeLines      = new Set(['SKM', 'PR']);
let selectedDayOffset = 0;
let manualTime        = null; // null = tryb live, 'HH:MM' = tryb planowania

const MAX_OFFSET = 6;

async function loadSchedule() {
  try {
    const r = await fetch('schedule.json');
    scheduleData = await r.json();
    renderAll();
  } catch (err) {
    console.error('Failed to load schedule:', err);
    document.getElementById('routes').innerHTML =
      '<p class="load-error">Błąd ładowania rozkładu. Sprawdź połączenie z internetem.</p>';
  }
}

// ── Helpers ────────────────────────────────────────────────

function getSelectedDate() {
  const d = new Date();
  d.setDate(d.getDate() + selectedDayOffset);
  return d;
}

function getDayType(date) {
  const d = date.getDay();
  if (d === 0) return 'sunday';
  if (d === 6) return 'saturday';
  return 'weekday';
}

const DAY_LABELS = { weekday: 'dzień roboczy', saturday: 'sobota', sunday: 'niedziela' };
const SHORT_DAYS  = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

function getDayLabel() {
  if (selectedDayOffset === 0) return 'Dziś';
  if (selectedDayOffset === 1) return 'Jutro';
  const d = getSelectedDate();
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getLiveTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function getEffectiveNowMin() {
  const t = manualTime ?? getLiveTimeStr();
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── Schedule generation ────────────────────────────────────

function findNextMin(intervals, fromMin) {
  let cur = fromMin;
  for (let i = 0; i < 120; i++) {
    const block = intervals.find(b => {
      const f = timeToMinutes(b.from);
      const t = b.to === '24:00' ? 24 * 60 : timeToMinutes(b.to);
      return cur >= f && cur < t;
    });
    if (!block) {
      const next = intervals.find(b => timeToMinutes(b.from) > cur);
      if (!next) return null;
      cur = timeToMinutes(next.from);
      continue;
    }
    const bFrom = timeToMinutes(block.from);
    const bTo   = block.to === '24:00' ? 24 * 60 : timeToMinutes(block.to);
    const elapsed = cur - bFrom;
    const steps = elapsed <= 0 ? 0 : Math.ceil(elapsed / block.interval);
    let next = bFrom + steps * block.interval;
    if (next <= cur) next += block.interval;
    if (next < bTo) return next;
    cur = bTo;
  }
  return null;
}

function generateDirect(routeKey, intervalKey, dayType, nowMin, count) {
  const route = scheduleData.routes[routeKey];
  if (!route) return [];

  const exact = route.departures?.[dayType];
  if (exact) {
    const result = [];
    for (const t of exact) {
      if (result.length >= count) break;
      const m = timeToMinutes(t);
      if (m > nowMin) {
        result.push({
          departureTime:  t,
          arrivalTime:    minutesToTime(m + route.duration),
          duration:       route.duration,
          minutesFromNow: m - nowMin,
          line:           route.line,
          transfer:       null,
        });
      }
    }
    return result;
  }

  const intervals = scheduleData.intervals?.[intervalKey]?.[dayType];
  if (!intervals) return [];

  const result = [];
  let cur = nowMin;
  while (result.length < count) {
    const next = findNextMin(intervals, cur);
    if (next === null) break;
    result.push({
      departureTime:  minutesToTime(next),
      arrivalTime:    minutesToTime(next + route.duration),
      duration:       route.duration,
      minutesFromNow: next - nowMin,
      line:    route.line,
      transfer: null,
    });
    cur = next + 1;
  }
  return result;
}

function generateTransfer(gen, dayType, nowMin, count) {
  const leg1Route = scheduleData.routes[gen.leg1.routeKey];
  const leg2Route = scheduleData.routes[gen.leg2.routeKey];
  if (!leg1Route || !leg2Route) return [];
  const prIntervals = scheduleData.intervals?.[gen.leg2.intervalKey]?.[dayType];
  if (!prIntervals) return [];

  const skmDeps = generateDirect(gen.leg1.routeKey, gen.leg1.intervalKey, dayType, nowMin, count + 5);
  const result  = [];

  for (const dep of skmDeps) {
    if (result.length >= count) break;
    const depMin         = timeToMinutes(dep.departureTime);
    const transferArrMin = depMin + leg1Route.duration;
    const prMin          = findNextMin(prIntervals, transferArrMin + gen.minTransfer);
    if (prMin === null) continue;
    const arrMin  = prMin + leg2Route.duration;
    const waitMin = prMin - transferArrMin;
    result.push({
      departureTime:  dep.departureTime,
      arrivalTime:    minutesToTime(arrMin),
      duration:       arrMin - depMin,
      minutesFromNow: dep.minutesFromNow,
      line:    'SKM+PR',
      transfer: {
        at:                gen.transferAt,
        leg1ArrivalTime:   minutesToTime(transferArrMin),
        leg2DepartureTime: minutesToTime(prMin),
        waitMin,
      },
    });
  }
  return result;
}

function isLineVisible(line) {
  if (line === 'SKM')    return activeLines.has('SKM');
  if (line === 'PR')     return activeLines.has('PR');
  if (line === 'SKM+PR') return activeLines.has('PR');
  return true;
}

function getCardDepartures(config, count = 5) {
  const dayType = getDayType(getSelectedDate());
  const nowMin  = getEffectiveNowMin();
  const all = [];

  for (const gen of config.generators) {
    const batch = gen.type === 'direct'
      ? generateDirect(gen.routeKey, gen.intervalKey, dayType, nowMin, count + 3)
      : generateTransfer(gen, dayType, nowMin, count + 3);
    all.push(...batch);
  }

  all.sort((a, b) => a.minutesFromNow - b.minutesFromNow);
  return all.filter(d => isLineVisible(d.line)).slice(0, count);
}

// ── Route config ───────────────────────────────────────────

const ROUTE_CONFIGS = [
  {
    key: 'oliwa-chylonia',
    label: 'Z Oliwy do domu',
    desc: 'Gdańsk Oliwa → Gdynia Chylonia',
    icon: 'home',
    from: 'Gdańsk Oliwa',
    to: 'Gdynia Chylonia',
    generators: [
      { type: 'direct', routeKey: 'oliwa-chylonia-skm', intervalKey: 'skm' },
      { type: 'direct', routeKey: 'oliwa-chylonia-pr',  intervalKey: 'pr'  },
    ],
  },
  {
    key: 'chylonia-oliwa',
    label: 'Z Chyloni do Oliwy',
    desc: 'Gdynia Chylonia → Gdańsk Oliwa',
    icon: 'home',
    from: 'Gdynia Chylonia',
    to: 'Gdańsk Oliwa',
    generators: [
      { type: 'direct', routeKey: 'chylonia-oliwa-skm', intervalKey: 'skm' },
      { type: 'direct', routeKey: 'chylonia-oliwa-pr',  intervalKey: 'pr'  },
    ],
  },
  {
    key: 'przymorze-chylonia',
    label: 'Z Przymorza do domu',
    desc: 'Gdańsk Przymorze-Uniwersytet → Gdynia Chylonia',
    icon: 'home',
    from: 'Gdańsk Przymorze-Uniwersytet',
    to: 'Gdynia Chylonia',
    generators: [
      { type: 'direct', routeKey: 'przymorze-chylonia', intervalKey: 'skm' },
    ],
  },
  {
    key: 'przymorze-zaspa',
    label: 'Na siłownię',
    desc: 'Gdańsk Przymorze-Uniwersytet → Gdańsk Zaspa',
    icon: 'gym',
    from: 'Gdańsk Przymorze-Uniwersytet',
    to: 'Gdańsk Zaspa',
    generators: [
      { type: 'direct', routeKey: 'przymorze-zaspa', intervalKey: 'skm' },
    ],
  },
  {
    key: 'zaspa-chylonia',
    label: 'Z Zaspy do domu',
    desc: 'Gdańsk Zaspa → Gdynia Chylonia',
    icon: 'home',
    from: 'Gdańsk Zaspa',
    to: 'Gdynia Chylonia',
    generators: [
      { type: 'direct', routeKey: 'zaspa-chylonia-skm', intervalKey: 'skm' },
      {
        type: 'transfer',
        leg1:        { routeKey: 'zaspa-oliwa',       intervalKey: 'skm' },
        minTransfer: 3,
        leg2:        { routeKey: 'oliwa-chylonia-pr', intervalKey: 'pr'  },
        transferAt:  'Gdańsk Oliwa',
      },
    ],
  },
];

// ── Rendering ──────────────────────────────────────────────

const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  gym:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16M18 4v16M3 8h3M3 16h3M18 8h3M18 16h3M9 12h6"/></svg>`,
};

function formatCountdown(min) {
  if (min <= 0) return 'teraz';
  if (min === 1) return 'za 1 min';
  if (min < 60) return `za ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `za ${h}h` : `za ${h}h ${m}m`;
}

function urgencyClass(min) {
  if (min <= 2) return 'now';
  if (min <= 8) return 'soon';
  return '';
}

function buildTransferHTML(t) {
  const shortAt = t.at.replace('Gdańsk ', '');
  return `<div class="dep-transfer">
    <span class="t-seg">SKM → ${shortAt} <strong>${t.leg1ArrivalTime}</strong></span>
    <span class="t-dot">·</span>
    <span class="t-seg">czeka <strong class="t-wait">${t.waitMin}&nbsp;min</strong></span>
    <span class="t-dot">·</span>
    <span class="t-seg">PR <strong>${t.leg2DepartureTime}</strong></span>
  </div>`;
}

function buildDepartureHTML(d, isFirst, showCountdown) {
  const firstCls  = isFirst ? ' first' : '';
  const badgeCls  = d.line.replace('+', '-');
  const urgency   = showCountdown ? urgencyClass(d.minutesFromNow) : '';
  const cd        = showCountdown ? formatCountdown(d.minutesFromNow) : '';

  const countdownHTML = showCountdown
    ? `<span class="dep-countdown ${urgency}">${cd}</span>`
    : '';

  const transferHTML = d.transfer ? buildTransferHTML(d.transfer) : '';

  return `<div class="departure${firstCls}">
    <div class="dep-main">
      <span class="line-badge line-${badgeCls}">${d.line}</span>
      <div class="dep-journey">
        <div class="dep-times-row">
          <span class="dep-time">${d.departureTime}</span>
          <span class="dep-sep">→</span>
          <span class="dep-arrival">${d.arrivalTime}</span>
          <span class="dep-dot">·</span>
          <span class="dep-duration">${d.duration}&nbsp;min</span>
        </div>
        ${transferHTML}
      </div>
    </div>
    ${countdownHTML}
  </div>`;
}

function buildRouteCard(config) {
  // Countdown only when viewing today in live mode
  const showCountdown = selectedDayOffset === 0 && manualTime === null;
  const departures    = getCardDepartures(config);
  const selectedDate = getSelectedDate();
  const dd   = String(selectedDate.getDate()).padStart(2, '0');
  const mm   = String(selectedDate.getMonth() + 1).padStart(2, '0');
  const yyyy = selectedDate.getFullYear();
  const timeStr = manualTime ?? getLiveTimeStr();
  const jdUrl = `https://jakdojade.pl/trojmiasto/trasa?fn=${encodeURIComponent(config.from)}&tn=${encodeURIComponent(config.to)}&t=${timeStr}&d=${dd}.${mm}.${yyyy}`;

  let departuresHTML;
  if (departures.length === 0) {
    const msg = activeLines.size === 0
      ? 'Wybierz przynajmniej jedną linię w filtrze powyżej.'
      : 'Brak odjazdów o tej porze. Sprawdź na Jakdojadę.';
    departuresHTML = `<div class="empty">${msg}</div>`;
  } else {
    departuresHTML = departures
      .map((d, i) => buildDepartureHTML(d, i === 0, showCountdown))
      .join('');
  }

  return `<article class="route-card">
    <div class="route-header">
      <div class="route-icon icon-${config.icon}">${ICONS[config.icon]}</div>
      <div class="route-info">
        <h2>${config.label}</h2>
        <p>${config.desc}</p>
      </div>
      <a class="btn-jd" href="${jdUrl}" target="_blank" rel="noopener noreferrer">Jakdojadę&nbsp;↗</a>
    </div>
    <div class="departures">${departuresHTML}</div>
  </article>`;
}

// ── Status update ──────────────────────────────────────────

function updateStatus() {
  const liveTime   = getLiveTimeStr();
  const displayTime = manualTime ?? liveTime;
  const isManual    = manualTime !== null;
  const selectedDate = getSelectedDate();

  // Time display
  document.getElementById('time-display').textContent = displayTime;
  document.getElementById('time-display').classList.toggle('manual', isManual);
  document.getElementById('live-indicator').className = isManual ? 'manual-dot' : 'live-dot';
  document.getElementById('time-reset').hidden = !isManual;

  // Day switcher
  document.getElementById('day-label').textContent = getDayLabel();
  document.getElementById('day-type').textContent  = DAY_LABELS[getDayType(selectedDate)];
  document.getElementById('day-prev').disabled     = selectedDayOffset <= 0;
  document.getElementById('day-next').disabled     = selectedDayOffset >= MAX_OFFSET;
}

function renderAll() {
  if (!scheduleData) return;
  document.getElementById('routes').innerHTML = ROUTE_CONFIGS.map(buildRouteCard).join('');
  updateStatus();
}

// ── Event listeners ────────────────────────────────────────

// Time picker
// Kliknięcie przycisku → showPicker() (Chrome/Firefox/Safari 16+)
// Fallback: input jest nakładką z opacity 0.001 → iOS tap działa bezpośrednio
document.getElementById('time-btn').addEventListener('click', () => {
  const input = document.getElementById('time-input');
  input.value = manualTime ?? getLiveTimeStr();
  try { input.showPicker(); } catch (_) { input.focus(); }
});

document.getElementById('time-input').addEventListener('change', (e) => {
  manualTime = e.target.value || null;
  renderAll();
});

document.getElementById('time-reset').addEventListener('click', () => {
  manualTime = null;
  renderAll();
});

// Day navigation
document.getElementById('day-prev').addEventListener('click', () => {
  if (selectedDayOffset > 0) { selectedDayOffset--; renderAll(); }
});
document.getElementById('day-next').addEventListener('click', () => {
  if (selectedDayOffset < MAX_OFFSET) { selectedDayOffset++; renderAll(); }
});

// Filter chips
document.querySelectorAll('.filter-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const line = btn.dataset.line;
    if (activeLines.has(line)) {
      activeLines.delete(line);
      btn.classList.remove('active');
    } else {
      activeLines.add(line);
      btn.classList.add('active');
    }
    renderAll();
  });
});

// Auto-refresh co minutę + po powrocie do zakładki
setInterval(() => { if (manualTime === null) renderAll(); }, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderAll();
});

loadSchedule();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(console.error);
  });
}
