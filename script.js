'use strict';

/* ==========================================================================
   Menstrual Cycle Calculator - Vanilla JavaScript
   Organized into 17 sections:
     1. Constants & DOM references
     2. Date utilities (timezone-safe)
     3. Application state
     4. Calculation functions
     5. Results / timeline rendering
     6. Calendar rendering
     7. IndexedDB database layer
     8. Cycle history
     9. Dashboard rendering
     10. Validation
     11. UI helpers (toast, modal, loading)
     12. Dark mode
     13. Notifications
     14. Export / Import
     15. Edit cycle
     16. Form preferences
     17. PWA & init
   ========================================================================== */

/* 1. Constants & DOM references
   ========================================================================== */
const DB_NAME = 'CycleCareDB';
const DB_VERSION = 1;
const DB_STORE = 'cycles';
const THEME_KEY = 'cycleCareTheme';
const FORM_PREFS_KEY = 'cycleCareFormPrefs';
const PERIOD_NOTIF_KEY = 'cycleCarePeriodNotif';
const OVULATION_NOTIF_KEY = 'cycleCareOvulationNotif';

const PHASE_KEYS = {
  MENSTRUAL: 'menstrual',
  FOLLICULAR: 'follicular',
  OVULATION: 'ovulation',
  LUTEAL: 'luteal'
};

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const form = document.getElementById('cycleForm');
const lastPeriodInput = document.getElementById('lastPeriodDate');
const cycleLengthInput = document.getElementById('cycleLength');
const periodDurationInput = document.getElementById('periodDuration');
const dateError = document.getElementById('dateError');
const cycleError = document.getElementById('cycleError');
const durationError = document.getElementById('durationError');

const resultsSection = document.getElementById('results');
const timelineSection = document.getElementById('timelineSection');
const resultDateLine = document.getElementById('resultDateLine');
const resultNextPeriod = document.getElementById('resultNextPeriod');
const resultOvulation = document.getElementById('resultOvulation');
const resultFertileWindow = document.getElementById('resultFertileWindow');
const resultCycleDay = document.getElementById('resultCycleDay');
const resultPhase = document.getElementById('resultPhase');
const resultDuration = document.getElementById('resultDuration');
const saveCycleBtn = document.getElementById('saveCycleBtn');

const timelineMenstrual = document.getElementById('timelineMenstrual');
const timelineFollicular = document.getElementById('timelineFollicular');
const timelineOvulation = document.getElementById('timelineOvulation');
const timelineLuteal = document.getElementById('timelineLuteal');

const calendarTitle = document.getElementById('calendarTitle');
const calendarGrid = document.getElementById('calendarGrid');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const calendarHint = document.getElementById('calendarHint');

const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const historyEmpty = document.getElementById('historyEmpty');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const clearDataBtn = document.getElementById('clearDataBtn');

const dashboardEmpty = document.getElementById('dashboardEmpty');
const dashboardBody = document.getElementById('dashboardBody');
const statTotal = document.getElementById('statTotal');
const statAvgLength = document.getElementById('statAvgLength');
const statAvgDuration = document.getElementById('statAvgDuration');
const statNextPeriod = document.getElementById('statNextPeriod');
const cycleChart = document.getElementById('cycleChart');

const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');

const installBtn = document.getElementById('installAppBtn');
const themeToggle = document.getElementById('themeToggle');

const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

const editModalOverlay = document.getElementById('editModalOverlay');
const editCycleForm = document.getElementById('editCycleForm');
const editCycleLength = document.getElementById('editCycleLength');
const editPeriodDuration = document.getElementById('editPeriodDuration');
const editModalCancel = document.getElementById('editModalCancel');
const editModalSave = document.getElementById('editModalSave');

const loadingOverlay = document.getElementById('loadingOverlay');

const updateBanner = document.getElementById('updateBanner');
const updateBtn = document.getElementById('updateBtn');
const updateDismiss = document.getElementById('updateDismiss');

const periodNotifToggle = document.getElementById('periodNotifToggle');
const ovulationNotifToggle = document.getElementById('ovulationNotifToggle');
const notifPermissionNote = document.getElementById('notifPermissionNote');

const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

/* 2. Date utilities (timezone-safe)
   --------------------------------------------------------------------------
   All dates are stored as local-midnight Date objects. We never parse ISO
   strings with `new Date('YYYY-MM-DD')` (which is interpreted as UTC and can
   shift the day). Instead we build dates from year/month/day components.
   ========================================================================== */

function parseDateString(str) {
  const [year, month, day] = String(str).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + mm + '-' + dd;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(a, b) {
  // Whole-day difference between two local-midnight dates.
  // Math.round guards against DST offsets (23h / 25h days).
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function todayAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDate(date) {
  // e.g. "August 28, 2026"
  return MONTHS_FULL[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
}

function formatDateShort(date) {
  // e.g. "Aug 28"
  return MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate();
}

function formatDaysLabel(days) {
  return days === 1 ? '1 day' : days + ' days';
}

/* 3. Application state
   ========================================================================== */
const state = {
  calculated: false,
  lastPeriod: null,
  cycleLength: 28,
  periodDuration: 5,
  nextPeriod: null,
  ovulation: null,
  fertileStart: null,
  fertileEnd: null,
  cycleDay: null,
  phaseKey: null,
  ovulationCycleDay: null
};

// Calendar view is stored as { year, month (0-indexed) }
const calendarView = (() => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
})();

let deferredInstallPrompt = null;
let modalResolve = null;
let editingRecordId = null;

/* 4. Calculation functions
   ========================================================================== */

/**
 * Next period is the last period start date advanced by the average
 * cycle length.
 */
function calculateNextPeriod(lastPeriod, cycleLength) {
  return addDays(lastPeriod, cycleLength);
}

/**
 * Ovulation is estimated as 14 days before the next expected period.
 */
function calculateOvulation(nextPeriod) {
  return addDays(nextPeriod, -14);
}

/**
 * The fertile window spans the 5 days before ovulation through
 * ovulation day itself.
 */
function calculateFertileWindow(ovulation) {
  return {
    start: addDays(ovulation, -5),
    end: ovulation
  };
}

/**
 * Current cycle day = (today - last period start) + 1.
 * Returns null if the period has not started yet, so we never
 * surface negative or unrealistic values.
 */
function calculateCycleDay(lastPeriod, today) {
  const day = daysBetween(lastPeriod, today) + 1;
  return day < 1 ? null : day;
}

/**
 * Determine the estimated phase.
 *
 * Positions inside the cycle:
 *   Menstrual  : day 1 through periodDuration
 *   Ovulation  : the ovulation day itself
 *   Luteal     : after ovulation until the cycle ends
 *   Follicular : everything between menstruation and ovulation
 *
 * If today is past the expected next period (delayed cycle) we wrap the
 * day back into the cycle so the phase estimate stays meaningful.
 */
function determineCyclePhase(cycleDay, cycleLength, periodDuration, ovulationCycleDay) {
  if (cycleDay === null) return null;

  let day = cycleDay;
  if (day > cycleLength) {
    day = ((day - 1) % cycleLength) + 1;
  }

  if (day <= periodDuration) return PHASE_KEYS.MENSTRUAL;
  if (day === ovulationCycleDay) return PHASE_KEYS.OVULATION;
  if (day > ovulationCycleDay) return PHASE_KEYS.LUTEAL;
  return PHASE_KEYS.FOLLICULAR;
}

/**
 * Run the full calculation for the current form values, store the
 * results in `state`, persist the form prefs and schedule reminders.
 */
function calculateCycle(e) {
  if (e) e.preventDefault();
  if (!validateForm()) return;

  const lastPeriod = parseDateString(lastPeriodInput.value);
  const cycleLength = Number(cycleLengthInput.value);
  const periodDuration = Number(periodDurationInput.value);
  const today = todayAtMidnight();

  const nextPeriod = calculateNextPeriod(lastPeriod, cycleLength);
  const ovulation = calculateOvulation(nextPeriod);
  const fertile = calculateFertileWindow(ovulation);
  const cycleDay = calculateCycleDay(lastPeriod, today);
  const ovulationCycleDay = daysBetween(lastPeriod, ovulation) + 1;
  const phaseKey = determineCyclePhase(cycleDay, cycleLength, periodDuration, ovulationCycleDay);

  state.calculated = true;
  state.lastPeriod = lastPeriod;
  state.cycleLength = cycleLength;
  state.periodDuration = periodDuration;
  state.nextPeriod = nextPeriod;
  state.ovulation = ovulation;
  state.fertileStart = fertile.start;
  state.fertileEnd = fertile.end;
  state.cycleDay = cycleDay;
  state.phaseKey = phaseKey;
  state.ovulationCycleDay = ovulationCycleDay;

  saveFormPrefs();
  scheduleNotifications();

  renderResults();
  renderTimeline();
  generateCalendar(calendarView.year, calendarView.month);

  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* 5. Results / timeline rendering
   ========================================================================== */
const PHASE_LABELS = {
  [PHASE_KEYS.MENSTRUAL]: 'Menstrual Phase',
  [PHASE_KEYS.FOLLICULAR]: 'Follicular Phase',
  [PHASE_KEYS.OVULATION]: 'Ovulation',
  [PHASE_KEYS.LUTEAL]: 'Luteal Phase'
};

function renderResults() {
  resultDateLine.textContent = 'Based on a cycle starting ' + formatDate(state.lastPeriod) + '.';
  resultNextPeriod.textContent = formatDate(state.nextPeriod);
  resultOvulation.textContent = formatDate(state.ovulation);
  resultFertileWindow.textContent = formatDateShort(state.fertileStart) + ' - ' + formatDateShort(state.fertileEnd);
  resultCycleDay.textContent = state.cycleDay === null ? '—' : 'Day ' + state.cycleDay;
  resultPhase.textContent = PHASE_LABELS[state.phaseKey] || '—';
  resultDuration.textContent = formatDaysLabel(state.periodDuration);

  showElement(resultsSection);
}

function renderTimeline() {
  const { periodDuration, cycleLength, ovulationCycleDay, phaseKey } = state;

  timelineMenstrual.textContent = 'Days 1 - ' + periodDuration;
  timelineFollicular.textContent = 'Days ' + (periodDuration + 1) + ' - ' + (ovulationCycleDay - 1);
  timelineOvulation.textContent = 'Day ' + ovulationCycleDay;
  timelineLuteal.textContent = 'Days ' + (ovulationCycleDay + 1) + ' - ' + cycleLength;

  // Highlight the user's estimated current phase and set aria-current.
  document.querySelectorAll('.timeline-phase').forEach(function (el) {
    const isActive = el.dataset.phase === phaseKey;
    el.classList.toggle('active', isActive);
    if (isActive) {
      el.setAttribute('aria-current', 'step');
    } else {
      el.removeAttribute('aria-current');
    }
  });

  showElement(timelineSection);
}

function showElement(el) {
  el.hidden = false;
  el.classList.remove('fade-in');
  void el.offsetWidth; // restart the animation
  el.classList.add('fade-in');
}

/* 6. Calendar rendering
   ========================================================================== */

/**
 * Render a month into the calendar grid. Sundays are the first column.
 * Highlights are applied when a calculation has been performed.
 */
function generateCalendar(year, month) {
  calendarTitle.textContent = MONTHS_FULL[month] + ' ' + year;

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmpty = firstOfMonth.getDay(); // 0 (Sun) to 6 (Sat)

  const todayKey = toDateKey(todayAtMidnight());

  // Build a lookup of highlighted day keys for this month.
  const highlights = {};
  if (state.calculated) {
    // Period days, fertile days and ovulation for the current and
    // neighbouring cycles, so highlights appear even when a highlight
    // range crosses into the displayed month from another one.
    for (let cycle = -2; cycle <= 10; cycle++) {
      const periodStart = addDays(state.lastPeriod, cycle * state.cycleLength);
      const periodEnd = addDays(periodStart, state.periodDuration - 1);
      const ovulation = addDays(periodStart, state.cycleLength - 14);
      const fertileStart = addDays(ovulation, -5);

      let d = periodStart;
      while (d <= periodEnd) {
        addHighlight(highlights, d, 'period');
        d = addDays(d, 1);
      }
      d = fertileStart;
      while (d <= ovulation) {
        addHighlight(highlights, d, d === ovulation ? 'ovulation' : 'fertile');
        d = addDays(d, 1);
      }
    }
  }

  // Clear previous cells.
  calendarGrid.innerHTML = '';

  // Empty placeholder cells before the 1st of the month.
  for (let i = 0; i < leadingEmpty; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day empty';
    calendarGrid.appendChild(cell);
  }

  // One cell per day of the month.
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    cell.textContent = day;

    const key = toDateKey(date);

    if (highlights[key]) {
      if (highlights[key] === 'period') cell.classList.add('period-day');
      else if (highlights[key] === 'fertile') cell.classList.add('fertile-day');
      else if (highlights[key] === 'ovulation') cell.classList.add('ovulation-day');
    }
    if (key === todayKey) cell.classList.add('today');

    cell.setAttribute('aria-label', MONTHS_FULL[month] + ' ' + day + (highlights[key] ? ', ' + highlights[key] : ''));
    calendarGrid.appendChild(cell);
  }

  calendarHint.textContent = state.calculated
    ? 'Showing your estimates for ' + MONTHS_FULL[month] + ' ' + year + '.'
    : 'Run a calculation to highlight your cycle on the calendar.';
}

/**
 * Store a highlight for a date, giving ovulation priority over fertile
 * and fertile priority over period when ranges overlap.
 */
function addHighlight(lookup, date, type) {
  const key = toDateKey(date);
  const priority = { period: 1, fertile: 2, ovulation: 3 };
  if (!lookup[key] || priority[type] > priority[lookup[key]]) {
    lookup[key] = type;
  }
}

function changeMonth(delta) {
  calendarView.month += delta;
  if (calendarView.month < 0) {
    calendarView.month = 11;
    calendarView.year--;
  } else if (calendarView.month > 11) {
    calendarView.month = 0;
    calendarView.year++;
  }
  generateCalendar(calendarView.year, calendarView.month);
}

/* 7. IndexedDB database layer
   --------------------------------------------------------------------------
   Cycle records are persisted in a browser database (IndexedDB). Everything
   stays client-side - no server, no network requests. Records are stored as
   objects keyed by id with the shape:
     { id, lastPeriod: 'YYYY-MM-DD', cycleLength, periodDuration, savedAt }
   All operations use async/await and try/catch with error toasts.
   ========================================================================== */

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise(function (resolve, reject) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        const store = db.createObjectStore(DB_STORE, { keyPath: 'id' });
        store.createIndex('lastPeriod', 'lastPeriod', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };

    request.onerror = function (event) {
      reject(event.target.error);
    };
  });

  return dbPromise;
}

/** Insert or update a record in the database. */
async function dbAddRecord(record) {
  try {
    const db = await openDatabase();
    return await new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(record);
      tx.oncomplete = function () { resolve(record); };
      tx.onerror = function () { reject(tx.error); };
    });
  } catch (err) {
    showToast('Failed to save record. Please try again.', 'error');
    throw err;
  }
}

/** Fetch every record from the database. */
async function dbGetAllRecords() {
  try {
    const db = await openDatabase();
    return await new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).getAll();
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  } catch (err) {
    showToast('Failed to read records.', 'error');
    throw err;
  }
}

/** Delete a single record by id. */
async function dbDeleteRecord(id) {
  try {
    const db = await openDatabase();
    return await new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  } catch (err) {
    showToast('Failed to delete record.', 'error');
    throw err;
  }
}

/** Remove every record from the database. */
async function dbClearAllRecords() {
  try {
    const db = await openDatabase();
    return await new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  } catch (err) {
    showToast('Failed to clear records.', 'error');
    throw err;
  }
}

/**
 * One-time migration for users who had records saved under the old
 * localStorage approach. Moves them into IndexedDB, then removes the
 * legacy key. Resolves with the number of migrated records.
 */
async function migrateLegacyData() {
  let legacy = [];
  try {
    legacy = JSON.parse(localStorage.getItem('cycleCalculatorHistory') || '[]');
  } catch (err) {
    legacy = [];
  }
  localStorage.removeItem('cycleCalculatorHistory');
  if (!legacy.length) return 0;

  try {
    const db = await openDatabase();
    return await new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      legacy.forEach(function (record) {
        store.put(record);
      });
      tx.oncomplete = function () { resolve(legacy.length); };
      tx.onerror = function () { reject(tx.error); };
    });
  } catch (err) {
    showToast('Failed to migrate legacy data.', 'error');
    throw err;
  }
}

/**
 * Sort records newest-first by the date they were saved.
 */
function sortRecordsNewestFirst(records) {
  return records.slice().sort(function (a, b) {
    return a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0;
  });
}

/* 8. Cycle history
   ========================================================================== */

/**
 * Save the current calculation to the database, preventing duplicate
 * entries for the same last-period date.
 */
async function saveCycle() {
  if (!state.calculated) return;
  const lastPeriodKey = toDateKey(state.lastPeriod);

  try {
    const records = await dbGetAllRecords();
    const duplicate = records.find(function (r) { return r.lastPeriod === lastPeriodKey; });
    if (duplicate) {
      const overwrite = await showModal(
        'Duplicate Entry',
        'A cycle starting on ' + formatDate(state.lastPeriod) + ' is already saved. Do you want to update it?',
        false
      );
      if (!overwrite) return;
      // Update existing record
      const updated = Object.assign({}, duplicate, { cycleLength: state.cycleLength, periodDuration: state.periodDuration });
      await dbAddRecord(updated);
    } else {
      const record = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        lastPeriod: lastPeriodKey,
        cycleLength: state.cycleLength,
        periodDuration: state.periodDuration,
        savedAt: toDateKey(todayAtMidnight())
      };
      await dbAddRecord(record);
    }
    await loadCycleHistory();
    await renderDashboard();
    showToast('Cycle saved to your database.');
    const original = saveCycleBtn.textContent;
    saveCycleBtn.textContent = '\u2713 Saved';
    saveCycleBtn.disabled = true;
    setTimeout(function () {
      saveCycleBtn.textContent = original;
      saveCycleBtn.disabled = false;
    }, 1800);
  } catch (err) {
    showToast('Failed to save cycle.', 'error');
  }
}

/**
 * Render the saved cycle history list from the database. Each item gets
 * an edit button and a delete button.
 */
async function loadCycleHistory() {
  try {
    showLoading();
    const records = await dbGetAllRecords();
    records = sortRecordsNewestFirst(records);

    historyList.innerHTML = '';
    historyEmpty.hidden = records.length > 0;
    clearHistoryBtn.hidden = records.length === 0;
    exportBtn.hidden = records.length === 0;
    historyCount.textContent = records.length === 1
      ? '1 saved cycle.'
      : records.length + ' saved cycles.';

    records.forEach(function (record) {
      const item = document.createElement('li');
      item.className = 'history-item';

      const info = document.createElement('div');
      info.className = 'history-item-info';

      const dateEl = document.createElement('span');
      dateEl.className = 'history-item-date';
      dateEl.textContent = 'Period: ' + formatDate(parseDateString(record.lastPeriod));

      const metaEl = document.createElement('span');
      metaEl.className = 'history-item-meta';
      metaEl.textContent = 'Cycle: ' + record.cycleLength + ' days \u2022 Period: ' + record.periodDuration + ' days';

      const savedEl = document.createElement('span');
      savedEl.className = 'history-item-saved';
      savedEl.textContent = 'Saved ' + formatDate(parseDateString(record.savedAt));

      info.appendChild(dateEl);
      info.appendChild(metaEl);
      info.appendChild(savedEl);

      const actions = document.createElement('div');
      actions.className = 'history-item-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'history-edit';
      editBtn.setAttribute('aria-label', 'Edit saved cycle from ' + formatDate(parseDateString(record.lastPeriod)));
      editBtn.textContent = '\u270E';
      editBtn.addEventListener('click', function () {
        openEditModal(record);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'history-delete';
      deleteBtn.setAttribute('aria-label', 'Delete saved cycle from ' + formatDate(parseDateString(record.lastPeriod)));
      deleteBtn.textContent = '\u2715';
      deleteBtn.addEventListener('click', function () {
        deleteCycle(record.id, record);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(info);
      item.appendChild(actions);
      historyList.appendChild(item);
    });
  } catch (err) {
    showToast('Failed to load cycle history.', 'error');
  } finally {
    hideLoading();
  }
}

/**
 * Remove a single saved record by id (after custom confirmation).
 */
async function deleteCycle(id, record) {
  const label = record && record.lastPeriod ? formatDate(parseDateString(record.lastPeriod)) : 'this cycle';
  const confirmed = await showModal('Delete Cycle', 'Are you sure you want to delete the cycle starting on ' + label + '? This cannot be undone.');
  if (!confirmed) return;

  try {
    showLoading();
    await dbDeleteRecord(id);
    await loadCycleHistory();
    await renderDashboard();
    showToast('Cycle deleted.', 'status');
  } catch (err) {
    showToast('Failed to delete cycle.', 'error');
  } finally {
    hideLoading();
  }
}

/**
 * Wipe the entire cycle database (after custom confirmation).
 */
async function clearAllData() {
  const confirmed = await showModal(
    'Clear All Data',
    'Are you sure you want to delete all saved cycle data? This cannot be undone.'
  );
  if (!confirmed) return;

  try {
    showLoading();
    await dbClearAllRecords();
    await loadCycleHistory();
    await renderDashboard();
    showToast('All saved data has been cleared.', 'status');
  } catch (err) {
    showToast('Failed to clear data.', 'error');
  } finally {
    hideLoading();
  }
}

/* 9. Dashboard rendering
   ========================================================================== */

/**
 * Recompute the dashboard stats and chart from all records in the
 * database. Est. Next Period uses the average cycle length.
 */
async function renderDashboard() {
  try {
    const records = await dbGetAllRecords();
    const hasData = records.length > 0;
    dashboardEmpty.hidden = hasData;
    dashboardBody.hidden = !hasData;
    if (!hasData) return;

    statTotal.textContent = records.length;

    const avgLength = records.reduce(function (sum, r) { return sum + r.cycleLength; }, 0) / records.length;
    const avgDuration = records.reduce(function (sum, r) { return sum + r.periodDuration; }, 0) / records.length;
    statAvgLength.textContent = formatDaysLabel(Math.round(avgLength));
    statAvgDuration.textContent = formatDaysLabel(Math.round(avgDuration));

    // Use average cycle length for Est. Next Period (consistent with other stats)
    const latest = sortRecordsNewestFirst(records)[0];
    const nextPeriod = calculateNextPeriod(parseDateString(latest.lastPeriod), Math.round(avgLength));
    statNextPeriod.textContent = formatDate(nextPeriod);

    renderChart(records);
  } catch (err) {
    showToast('Failed to load dashboard data.', 'error');
  }
}

/**
 * Render a simple bar chart of the last 10 saved cycle lengths.
 * Bar heights are scaled between the min (21) and max (45) allowed
 * cycle lengths. The newest record appears on the right.
 */
function renderChart(records) {
  const chartRecords = sortRecordsNewestFirst(records).slice(0, 10).reverse();

  cycleChart.innerHTML = '';

  chartRecords.forEach(function (record) {
    const col = document.createElement('div');
    col.className = 'chart-col';

    const value = document.createElement('span');
    value.className = 'chart-bar-value';
    value.textContent = record.cycleLength;

    const track = document.createElement('div');
    track.className = 'chart-bar-track';

    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    const MIN = 21;
    const MAX = 45;
    const ratio = Math.min(Math.max((record.cycleLength - MIN) / (MAX - MIN), 0), 1);
    const height = 12 + ratio * 82; // 12% - 94% of the track height
    bar.style.height = height + '%';
    bar.setAttribute('aria-label', 'Cycle length ' + record.cycleLength + ' days');
    bar.setAttribute('title', record.cycleLength + ' days');
    track.appendChild(bar);

    const label = document.createElement('span');
    label.className = 'chart-bar-label';
    label.textContent = formatDateShort(parseDateString(record.lastPeriod));

    col.appendChild(value);
    col.appendChild(track);
    col.appendChild(label);
    cycleChart.appendChild(col);
  });
}

/* 10. Validation
   ========================================================================== */
function setFieldError(errorEl, inputEl, message) {
  errorEl.textContent = message;
  inputEl.setAttribute('aria-invalid', 'true');
}

function clearFieldError(errorEl, inputEl) {
  errorEl.textContent = '';
  inputEl.removeAttribute('aria-invalid');
}

function isWholeNumber(value) {
  return Number.isInteger(value);
}

function validateForm() {
  let valid = true;

  // Last period start date
  const dateValue = lastPeriodInput.value;
  if (!dateValue) {
    setFieldError(dateError, lastPeriodInput, 'Please select your last period start date.');
    valid = false;
  } else {
    const lastPeriod = parseDateString(dateValue);
    if (lastPeriod > todayAtMidnight()) {
      setFieldError(dateError, lastPeriodInput, 'The last period date cannot be in the future.');
      valid = false;
    } else {
      clearFieldError(dateError, lastPeriodInput);
    }
  }

  // Average cycle length (21 - 45 days)
  const cycleValue = Number(cycleLengthInput.value);
  if (!Number.isFinite(cycleValue) || !isWholeNumber(cycleValue)) {
    setFieldError(cycleError, cycleLengthInput, 'Please enter a whole number of days.');
    valid = false;
  } else if (cycleValue < 21 || cycleValue > 45) {
    setFieldError(cycleError, cycleLengthInput, 'Cycle length must be between 21 and 45 days.');
    valid = false;
  } else {
    clearFieldError(cycleError, cycleLengthInput);
  }

  // Period duration (1 - 10 days)
  const durationValue = Number(periodDurationInput.value);
  if (!Number.isFinite(durationValue) || !isWholeNumber(durationValue)) {
    setFieldError(durationError, periodDurationInput, 'Please enter a whole number of days.');
    valid = false;
  } else if (durationValue < 1 || durationValue > 10) {
    setFieldError(durationError, periodDurationInput, 'Period duration must be between 1 and 10 days.');
    valid = false;
  } else {
    clearFieldError(durationError, periodDurationInput);
  }

  return valid;
}

/* 11. UI helpers (toast, modal, loading)
   ========================================================================== */
function showToast(message, type) {
  const toast = document.createElement('div');
  const normalizedType = type === 'error' ? 'error' : 'success';
  toast.className = 'toast toast-' + normalizedType;
  toast.textContent = message;
  // Use role="alert" for errors, role="status" for neutral/success.
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  document.body.appendChild(toast);

  requestAnimationFrame(function () {
    toast.classList.add('show');
  });

  setTimeout(function () {
    toast.classList.remove('show');
    setTimeout(function () {
      toast.remove();
    }, 300);
  }, 2600);
}

function showModal(title, message, isDanger) {
  return new Promise(function (resolve) {
    modalResolve = resolve;
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalOverlay.hidden = false;
    modalOverlay.setAttribute('aria-hidden', 'false');
    modalConfirm.className = 'btn ' + (isDanger === false ? 'btn-primary' : 'btn-danger');
    requestAnimationFrame(function () { modalOverlay.classList.add('visible'); });
    modalConfirm.focus();
  });
}

function closeModal(result) {
  modalOverlay.classList.remove('visible');
  setTimeout(function () {
    modalOverlay.hidden = true;
    modalOverlay.setAttribute('aria-hidden', 'true');
  }, 200);
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

function showLoading() {
  loadingOverlay.hidden = false;
  loadingOverlay.setAttribute('aria-hidden', 'false');
}

function hideLoading() {
  loadingOverlay.hidden = true;
  loadingOverlay.setAttribute('aria-hidden', 'true');
}

/* 12. Dark mode
   ========================================================================== */
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

/* 13. Notifications
   ========================================================================== */
function requestNotificationPermission() {
  if (!('Notification' in window)) {
    notifPermissionNote.textContent = 'Notifications are not supported in this browser.';
    return;
  }
  if (Notification.permission === 'granted') {
    notifPermissionNote.textContent = 'Notifications are enabled.';
  } else if (Notification.permission === 'denied') {
    notifPermissionNote.textContent = 'Notifications are blocked. Please enable them in your browser settings.';
  } else {
    notifPermissionNote.textContent = 'Enable notifications to receive reminders.';
  }
}

async function togglePeriodNotification() {
  if (!('Notification' in window)) {
    showToast('Notifications not supported in this browser.', 'error');
    periodNotifToggle.checked = false;
    return;
  }
  if (periodNotifToggle.checked) {
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('Notification permission denied.', 'error');
        periodNotifToggle.checked = false;
        return;
      }
    }
    localStorage.setItem(PERIOD_NOTIF_KEY, 'true');
    showToast('Period reminder enabled.');
  } else {
    localStorage.removeItem(PERIOD_NOTIF_KEY);
  }
}

async function toggleOvulationNotification() {
  if (!('Notification' in window)) {
    showToast('Notifications not supported in this browser.', 'error');
    ovulationNotifToggle.checked = false;
    return;
  }
  if (ovulationNotifToggle.checked) {
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('Notification permission denied.', 'error');
        ovulationNotifToggle.checked = false;
        return;
      }
    }
    localStorage.setItem(OVULATION_NOTIF_KEY, 'true');
    showToast('Ovulation reminder enabled.');
  } else {
    localStorage.removeItem(OVULATION_NOTIF_KEY);
  }
}

function scheduleNotifications() {
  if (!state.calculated || !('Notification' in window) || Notification.permission !== 'granted') return;

  // Clear existing scheduled notifications
  if (window._periodNotifTimer) clearTimeout(window._periodNotifTimer);
  if (window._ovulationNotifTimer) clearTimeout(window._ovulationNotifTimer);

  const now = new Date();

  if (localStorage.getItem(PERIOD_NOTIF_KEY) && state.nextPeriod) {
    const periodNotifDate = addDays(state.nextPeriod, -2);
    const periodDelay = periodNotifDate.getTime() - now.getTime();
    if (periodDelay > 0 && periodDelay < 30 * 24 * 60 * 60 * 1000) {
      window._periodNotifTimer = setTimeout(function () {
        new Notification('CycleCare Reminder', {
          body: 'Your period is estimated to start in 2 days.',
          icon: 'icons/icon-192.png'
        });
      }, periodDelay);
    }
  }

  if (localStorage.getItem(OVULATION_NOTIF_KEY) && state.ovulation) {
    const ovNotifDate = addDays(state.ovulation, -1);
    const ovDelay = ovNotifDate.getTime() - now.getTime();
    if (ovDelay > 0 && ovDelay < 30 * 24 * 60 * 60 * 1000) {
      window._ovulationNotifTimer = setTimeout(function () {
        new Notification('CycleCare Reminder', {
          body: 'Your estimated ovulation is tomorrow.',
          icon: 'icons/icon-192.png'
        });
      }, ovDelay);
    }
  }
}

/* 14. Export / Import
   ========================================================================== */
async function exportData() {
  try {
    const records = await dbGetAllRecords();
    const data = JSON.stringify(records, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cyclecare-backup-' + toDateKey(todayAtMidnight()) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported successfully.');
  } catch (err) {
    showToast('Failed to export data.', 'error');
  }
}

function importData() {
  importFile.click();
}

async function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    showLoading();
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) throw new Error('Invalid format');

    let imported = 0;
    for (const record of records) {
      if (record.lastPeriod && record.cycleLength && record.periodDuration) {
        await dbAddRecord({
          id: record.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          lastPeriod: record.lastPeriod,
          cycleLength: record.cycleLength,
          periodDuration: record.periodDuration,
          savedAt: record.savedAt || toDateKey(todayAtMidnight())
        });
        imported++;
      }
    }

    await loadCycleHistory();
    await renderDashboard();
    showToast('Imported ' + imported + ' cycle(s) successfully.');
  } catch (err) {
    showToast('Failed to import data. Please check the file format.', 'error');
  } finally {
    hideLoading();
  }
  importFile.value = '';
}

/* 15. Edit cycle
   ========================================================================== */
function openEditModal(record) {
  editingRecordId = record.id;
  editCycleLength.value = record.cycleLength;
  editPeriodDuration.value = record.periodDuration;
  editModalOverlay.hidden = false;
  editModalOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(function () { editModalOverlay.classList.add('visible'); });
  editCycleLength.focus();
}

function closeEditModal() {
  editModalOverlay.classList.remove('visible');
  setTimeout(function () {
    editModalOverlay.hidden = true;
    editModalOverlay.setAttribute('aria-hidden', 'true');
  }, 200);
  editingRecordId = null;
}

async function saveEditCycle(e) {
  e.preventDefault();
  const cycleLen = Number(editCycleLength.value);
  const periodDur = Number(editPeriodDuration.value);

  if (cycleLen < 21 || cycleLen > 45 || periodDur < 1 || periodDur > 10) {
    showToast('Please enter valid values.', 'error');
    return;
  }

  try {
    showLoading();
    const records = await dbGetAllRecords();
    const record = records.find(function (r) { return r.id === editingRecordId; });
    if (record) {
      record.cycleLength = cycleLen;
      record.periodDuration = periodDur;
      await dbAddRecord(record);
      await loadCycleHistory();
      await renderDashboard();
      showToast('Cycle updated.');
    }
  } catch (err) {
    showToast('Failed to update cycle.', 'error');
  } finally {
    hideLoading();
  }
  closeEditModal();
}

/* 16. Form preferences
   ========================================================================== */
function saveFormPrefs() {
  const prefs = {
    lastPeriod: lastPeriodInput.value,
    cycleLength: cycleLengthInput.value,
    periodDuration: periodDurationInput.value
  };
  localStorage.setItem(FORM_PREFS_KEY, JSON.stringify(prefs));
}

function restoreFormPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(FORM_PREFS_KEY));
    if (prefs) {
      if (prefs.lastPeriod) lastPeriodInput.value = prefs.lastPeriod;
      if (prefs.cycleLength) cycleLengthInput.value = prefs.cycleLength;
      if (prefs.periodDuration) periodDurationInput.value = prefs.periodDuration;
    }
  } catch (e) {}
}

/* 17. PWA: install prompt, service worker & init
   ========================================================================== */

/**
 * Enables the "Install App" button, registers the service worker so the
 * app can be installed and used offline, and watches for version updates.
 */
async function setupPWA() {
  let registration = null;

  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    try {
      registration = await navigator.serviceWorker.register('sw.js');

      // Check for updates every 60 seconds.
      setInterval(function () { registration.update(); }, 60000);

      registration.addEventListener('updatefound', function () {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', function () {
          if (newWorker.state === 'activated') {
            updateBanner.hidden = false;
          }
        });
      });
    } catch (err) {
      // SW unavailable; the app still works, just without offline support.
    }
  }

  updateBtn.addEventListener('click', function () {
    window.location.reload();
  });
  updateDismiss.addEventListener('click', function () {
    updateBanner.hidden = true;
  });

  // Skip the install button if already running as an installed app.
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
  if (navigator.standalone) return;

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    installBtn.hidden = true;
    deferredInstallPrompt = null;
  });

  installBtn.addEventListener('click', function () {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function () {
      deferredInstallPrompt = null;
      installBtn.hidden = true;
    });
  });
}

async function init() {
  // 1. Only allow past dates for the last period.
  lastPeriodInput.max = toDateKey(todayAtMidnight());

  // 2. Restore form preferences.
  restoreFormPrefs();

  // 3. Init theme.
  initTheme();

  // 4. Bind all event listeners.
  form.addEventListener('submit', calculateCycle);
  form.addEventListener('input', saveFormPrefs);

  prevMonthBtn.addEventListener('click', function () { changeMonth(-1); });
  nextMonthBtn.addEventListener('click', function () { changeMonth(1); });

  saveCycleBtn.addEventListener('click', saveCycle);
  clearHistoryBtn.addEventListener('click', clearAllData);
  clearDataBtn.addEventListener('click', clearAllData);

  themeToggle.addEventListener('click', toggleTheme);

  modalCancel.addEventListener('click', function () { closeModal(false); });
  modalConfirm.addEventListener('click', function () { closeModal(true); });
  modalOverlay.addEventListener('click', function (event) {
    if (event.target === modalOverlay) closeModal(false);
  });

  editModalCancel.addEventListener('click', closeEditModal);
  editCycleForm.addEventListener('submit', saveEditCycle);
  editModalOverlay.addEventListener('click', function (event) {
    if (event.target === editModalOverlay) closeEditModal();
  });

  exportBtn.addEventListener('click', exportData);
  importBtn.addEventListener('click', importData);
  importFile.addEventListener('change', handleImportFile);

  periodNotifToggle.addEventListener('change', togglePeriodNotification);
  ovulationNotifToggle.addEventListener('change', toggleOvulationNotification);

  // Clear an error as soon as the user edits the field again.
  [lastPeriodInput, cycleLengthInput, periodDurationInput].forEach(function (input) {
    input.addEventListener('input', function () {
      const errorEl = input === lastPeriodInput ? dateError : input === cycleLengthInput ? cycleError : durationError;
      clearFieldError(errorEl, input);
    });
  });

  // Mobile navigation toggle.
  navToggle.addEventListener('click', function () {
    const open = navMenu.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
  });

  // Close the mobile menu after choosing a destination.
  navMenu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      navMenu.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  // Escape key closes either modal.
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (!modalOverlay.hidden) closeModal(false);
      if (!editModalOverlay.hidden) closeEditModal();
    }
  });

  // 5. Set up PWA.
  await setupPWA();

  // 6. Migrate legacy data.
  const migrated = await migrateLegacyData();
  if (migrated > 0) {
    showToast('Migrated ' + migrated + ' previously saved cycle(s) to the database.', 'status');
  }

  // 7. Render calendar.
  generateCalendar(calendarView.year, calendarView.month);

  // 8. Load history and dashboard.
  await Promise.all([loadCycleHistory(), renderDashboard()]);

  // 9. Init notification toggles from localStorage.
  periodNotifToggle.checked = localStorage.getItem(PERIOD_NOTIF_KEY) === 'true';
  ovulationNotifToggle.checked = localStorage.getItem(OVULATION_NOTIF_KEY) === 'true';
  requestNotificationPermission();

  // 10. Schedule notifications if calculated data exists.
  if (lastPeriodInput.value) {
    const lastPeriod = parseDateString(lastPeriodInput.value);
    const cycleLength = Number(cycleLengthInput.value);
    const periodDuration = Number(periodDurationInput.value);

    state.calculated = true;
    state.lastPeriod = lastPeriod;
    state.cycleLength = cycleLength;
    state.periodDuration = periodDuration;
    state.nextPeriod = calculateNextPeriod(lastPeriod, cycleLength);
    state.ovulation = calculateOvulation(state.nextPeriod);
    state.fertileStart = addDays(state.ovulation, -5);
    state.fertileEnd = state.ovulation;
    state.cycleDay = calculateCycleDay(lastPeriod, todayAtMidnight());
    state.ovulationCycleDay = daysBetween(lastPeriod, state.ovulation) + 1;
    state.phaseKey = determineCyclePhase(state.cycleDay, cycleLength, periodDuration, state.ovulationCycleDay);

    scheduleNotifications();
  }
}

document.addEventListener('DOMContentLoaded', init);