/* Shared application state, DOM references, caches, and network helpers.
   These are kept in one file so the other scripts can depend on a single
   source of truth for app configuration and mutable state. */

var STRUCTURE_CATEGORY_ID = 65;
var DEPLOYABLE_CATEGORY_ID = 22;
var ESI_IDS_URL = 'https://esi.evetech.net/latest/universe/ids/';
var ESI_NAMES_URL = 'https://esi.evetech.net/latest/universe/names/';
var ESI_CHARACTER_URL = 'https://esi.evetech.net/latest/characters/';
var ZKILL_API_BASE = 'https://zkillboard.com/api';
var ENTITY_TYPE_CONFIG = {
  corporation: { apiModifier: 'corporationID', zkillPath: 'corporation' },
  alliance: { apiModifier: 'allianceID', zkillPath: 'alliance' }
};

var ZKILL_REQUESTS_PER_MINUTE = 50;
var ESI_REQUESTS_PER_MINUTE = 90;
var REQUEST_INTERVALS_MS = {
  zkill: Math.ceil(60000 / ZKILL_REQUESTS_PER_MINUTE),
  esi: Math.ceil(60000 / ESI_REQUESTS_PER_MINUTE)
};
var CACHE_TTL_MS = 60 * 60 * 1000;
var CACHE_MAX_ENTRIES = 50;
var LOCAL_STORAGE_CACHE_KEY = 'eveThreatCache';
var LOCAL_STORAGE_UI_KEY = 'eveThreatUiState';

var SPACE_ORDER = [
  ['a', 'all'],
  ['h', 'highsec'],
  ['l', 'lowsec'],
  ['n', 'nullsec'],
  ['w', 'wormhole']
];

var reqPerMinEl = document.getElementById('reqPerMin');
if (reqPerMinEl) reqPerMinEl.textContent = `${ZKILL_REQUESTS_PER_MINUTE} zKill / ${ESI_REQUESTS_PER_MINUTE} ESI`;

var systemThreatGaugeEl = document.getElementById('systemThreatGauge');
var systemThreatPercentEl = document.getElementById('systemThreatPercent');
var systemThreatTextEl = document.getElementById('systemThreatText');
var systemThreatArrowEl = document.getElementById('systemThreatArrow');
var namesEl = document.getElementById('names');
var monthsBackEl = document.getElementById('monthsBack');
var highThreatKillsEl = document.getElementById('highThreatKills');
var highThreatGanksEl = document.getElementById('highThreatGanks');
var spaceFilterEl = document.getElementById('spaceFilter');
var autoScanOnPasteEl = document.getElementById('autoScanOnPaste');
var includeStructuresEl = document.getElementById('includeStructures');
var includeDeployablesEl = document.getElementById('includeDeployables');
var includePaddingEl = document.getElementById('includePadding');
var analyzeBtn = document.getElementById('analyzeBtn');
var shareBtn = document.getElementById('shareBtn');
var clearBtn = document.getElementById('clearBtn');
var statusEl = document.getElementById('status');
var shareStatusEl = document.getElementById('shareStatus');
var resultsBody = document.getElementById('resultsBody');
var scanStatusToastEl = document.getElementById('scanStatusToast');
var scanStatusToastMessageEl = document.getElementById('scanStatusToastMessage');

var sumPilots = document.getElementById('sumPilots');
var sumThreats = document.getElementById('sumThreats');
var sumKills = document.getElementById('sumKills');
var sumGanks = document.getElementById('sumGanks');
var intelSummaryEl = document.getElementById('intelSummary');
var globalRowHoverCardEl = document.getElementById('globalRowHoverCard');
var controlColumnEl = document.getElementById('controlColumn');
var controlDrawerToggleEl = document.getElementById('controlDrawerToggle');
var controlDrawerMetaEl = document.getElementById('controlDrawerMeta');
var controlDrawerBackdropEl = document.getElementById('controlDrawerBackdrop');

var typeCache = new Map();
var pilotSummaryCache = new Map();
var entitySummaryCache = new Map();
var characterInfoCache = new Map();
var requestQueueState = {
  zkill: { nextAvailableAt: 0 },
  esi: { nextAvailableAt: 0 }
};
var entityScanQueue = Promise.resolve();
var currentAnalysisToken = 0;
var hoveredRowEl = null;
var statusToastMode = 'idle';
var statusToastHideTimer = 0;
var SHARE_TOAST_DURATION_MS = 2200;

/* Basic UI messaging and persistence helpers. */


function setStatus(message) {
  statusEl.textContent = message;
  syncStatusToast(message);
}


function clearStatusToastHideTimer() {
  if (!statusToastHideTimer) return;
  window.clearTimeout(statusToastHideTimer);
  statusToastHideTimer = 0;
}


function syncStatusToast(message) {
  if (!scanStatusToastEl || !scanStatusToastMessageEl) return;
  scanStatusToastMessageEl.textContent = message || '';
  if (!message) {
    scanStatusToastEl.classList.remove('status-toast--visible', 'status-toast--active');
    scanStatusToastEl.setAttribute('aria-hidden', 'true');
    return;
  }

  if (statusToastMode === 'idle' && !scanStatusToastEl.classList.contains('status-toast--visible')) {
    scanStatusToastEl.setAttribute('aria-hidden', 'true');
    return;
  }

  scanStatusToastEl.classList.add('status-toast--visible');
  scanStatusToastEl.classList.toggle('status-toast--active', statusToastMode === 'scan');
  scanStatusToastEl.setAttribute('aria-hidden', 'false');
}


function showScanStatusToast(message, active = false) {
  clearStatusToastHideTimer();
  statusToastMode = active ? 'scan' : 'share';
  syncStatusToast(message || statusEl.textContent || '');
}


function hideScanStatusToast(delayMs = 0) {
  if (statusToastMode === 'scan') {
    statusToastMode = 'idle';
  }
  hideStatusToast(delayMs);
}


function showShareStatusToast(message, delayMs = SHARE_TOAST_DURATION_MS) {
  if (statusToastMode === 'scan') return;
  clearStatusToastHideTimer();
  statusToastMode = 'share';
  syncStatusToast(message || '');
  hideStatusToast(delayMs);
}


function hideStatusToast(delayMs = 0) {
  clearStatusToastHideTimer();
  if (statusToastMode !== 'scan') {
    statusToastMode = 'idle';
  }
  if (!scanStatusToastEl) return;

  const hide = () => {
    statusToastMode = 'idle';
    scanStatusToastEl.classList.remove('status-toast--visible', 'status-toast--active');
    scanStatusToastEl.setAttribute('aria-hidden', 'true');
  };

  if (delayMs > 0) {
    statusToastHideTimer = window.setTimeout(hide, delayMs);
    return;
  }

  hide();
}


function setShareStatus(message, options = {}) {
  if (shareStatusEl) shareStatusEl.textContent = message;
  if (options.showToast === false || !message) return;
  showShareStatusToast(message, options.toastDurationMs);
}


function saveCacheToLocalStorage() {
  try {
    prunePilotCache();
    const serializedPilots = Object.fromEntries(pilotSummaryCache.entries());
    const serializedEntities = Object.fromEntries(
      [...entitySummaryCache.entries()].map(([key, entry]) => [
        key,
        {
          cachedAt: entry.cachedAt,
          entityType: entry.entityType,
          entityId: entry.entityId,
          zkillUrl: entry.zkillUrl,
          months: entry.months || {}
        }
      ])
    );
    localStorage.setItem(LOCAL_STORAGE_CACHE_KEY, JSON.stringify({
      pilots: serializedPilots,
      entities: serializedEntities
    }));
  } catch (error) {
    console.warn('Failed to save pilot cache to localStorage.', error);
  }
}


function loadCacheFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CACHE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw);
    pilotSummaryCache.clear();
    entitySummaryCache.clear();

    const pilotEntries = (parsed && typeof parsed === 'object' && parsed.pilots && typeof parsed.pilots === 'object')
      ? parsed.pilots
      : parsed;
    const entityEntries = (parsed && typeof parsed === 'object' && parsed.entities && typeof parsed.entities === 'object')
      ? parsed.entities
      : {};

    for (const [key, entry] of Object.entries(pilotEntries || {})) {
      if (!entry || typeof entry !== 'object') continue;
      pilotSummaryCache.set(key, entry);
    }

    for (const [key, entry] of Object.entries(entityEntries || {})) {
      if (!entry || typeof entry !== 'object') continue;
      entitySummaryCache.set(key, {
        cachedAt: entry.cachedAt,
        entityType: entry.entityType,
        entityId: entry.entityId,
        zkillUrl: entry.zkillUrl,
        months: entry.months || {},
        pendingPromise: null
      });
    }

    prunePilotCache();
    return pilotSummaryCache.size > 0 || entitySummaryCache.size > 0;
  } catch (error) {
    console.warn('Failed to load pilot cache from localStorage.', error);
    return false;
  }
}


function getUiState() {
  return {
    names: namesEl.value || '',
    monthsBack: monthsBackEl.value,
    spaceFilter: spaceFilterEl.value,
    highThreatKills: highThreatKillsEl.value,
    highThreatGanks: highThreatGanksEl.value,
    autoScanOnPaste: autoScanOnPasteEl ? autoScanOnPasteEl.checked : false,
    includeStructures: includeStructuresEl.checked,
    includeDeployables: includeDeployablesEl.checked,
    includePadding: includePaddingEl ? includePaddingEl.checked : true
  };
}


function saveUiStateToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_STORAGE_UI_KEY, JSON.stringify(getUiState()));
  } catch (error) {
    console.warn('Failed to save UI state to localStorage.', error);
  }
}


function loadUiStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_UI_KEY);
    if (!raw) return false;

    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') return false;

    if (typeof state.names === 'string') namesEl.value = state.names;
    if (state.monthsBack) monthsBackEl.value = String(state.monthsBack);
    if (state.spaceFilter) spaceFilterEl.value = String(state.spaceFilter);
    if (state.highThreatKills !== undefined) highThreatKillsEl.value = String(state.highThreatKills);
    if (state.highThreatGanks !== undefined) highThreatGanksEl.value = String(state.highThreatGanks);
    else if (state.highThreatPods !== undefined) highThreatGanksEl.value = String(state.highThreatPods);
    if (typeof state.autoScanOnPaste === 'boolean' && autoScanOnPasteEl) autoScanOnPasteEl.checked = state.autoScanOnPaste;
    if (typeof state.includeStructures === 'boolean') includeStructuresEl.checked = state.includeStructures;
    if (typeof state.includeDeployables === 'boolean') includeDeployablesEl.checked = state.includeDeployables;
    if (typeof state.includePadding === 'boolean' && includePaddingEl) includePaddingEl.checked = state.includePadding;
    return true;
  } catch (error) {
    console.warn('Failed to load UI state from localStorage.', error);
    return false;
  }
}


function clearLocalStorageState() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_CACHE_KEY);
    localStorage.removeItem(LOCAL_STORAGE_UI_KEY);
  } catch (error) {
    console.warn('Failed to clear localStorage state.', error);
  }
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function getServiceKeyForUrl(url) {
  const normalized = String(url || '').toLowerCase();
  if (normalized.includes('zkillboard.com')) return 'zkill';
  return 'esi';
}


async function waitForRequestSlot(serviceKey = 'esi') {
  const queue = requestQueueState[serviceKey] || requestQueueState.esi;
  const intervalMs = REQUEST_INTERVALS_MS[serviceKey] || REQUEST_INTERVALS_MS.esi;
  const now = Date.now();
  const waitMs = Math.max(0, queue.nextAvailableAt - now);
  if (waitMs > 0) await sleep(waitMs);
  queue.nextAvailableAt = Math.max(queue.nextAvailableAt, Date.now()) + intervalMs;
}


function normalizeNames(raw) {
  return [...new Set(
    raw
      .split(/\r?\n/)
      .map(v => v.trim())
      .filter(Boolean)
  )];
}



function formatUtcDateTime(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  });
}


function getHoursSince(value) {
  if (!value) return Infinity;
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return Infinity;
  return ms / (1000 * 60 * 60);
}


function formatShortDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}


function getDaysSince(value) {
  if (!value) return Infinity;
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return Infinity;
  return ms / (1000 * 60 * 60 * 24);
}


function getActivityBadge(lastKillAt, hasKills = false) {
  const days = getDaysSince(lastKillAt);
  if (!hasKills || !Number.isFinite(days) || days === Infinity) {
    return { label: 'No kills in window', tone: 'neutral' };
  }
  const dateLabel = `Last kill ${formatShortDate(lastKillAt)}`;
  if (days < 7) return { label: dateLabel, tone: 'danger' };
  if (days <= 14) return { label: dateLabel, tone: 'warm' };
  return { label: dateLabel, tone: 'safe' };
}


function getRecencyWeight(lastKillAt) {
  const hours = getHoursSince(lastKillAt);
  if (hours <= 48) return 3;
  if (hours <= 24 * 7) return 2;
  if (hours <= 24 * 30) return 1;
  return 0;
}


function hashString(value) {
  const input = String(value || '');
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}


function getNameColorStyle(name) {
  if (!name) return '';
  const hash = hashString(name);
  const hue = hash % 360;
  const sat = 55 + (hash % 18);
  const light = 58 + (hash % 8);
  return `border-color: hsla(${hue}, ${sat}%, ${light}%, 0.45); background: hsla(${hue}, ${sat}%, ${light}%, 0.16); color: hsl(${hue}, ${Math.max(45, sat - 8)}%, 85%);`;
}


function buildThreatExplanation(entry, counts, thresholds, spaceFilter, options, activityLabel, corpName, allianceName, groupSignals = []) {
  const includeStructures = options.includeStructures !== false;
  const includeDeployables = options.includeDeployables !== false;
  const includePadding = options.includePadding !== false;
  const lines = [
    `${counts.kills} filtered kill${counts.kills === 1 ? '' : 's'} in ${spaceFilter}.`,
    `${counts.ganks} gank${counts.ganks === 1 ? '' : 's'}.`,
    `${activityLabel}`
  ];

  if (counts.lastKillAt) lines.push(`Most recent kill: ${formatUtcDateTime(counts.lastKillAt)}.`);
  if (corpName) lines.push(`Corporation: ${corpName}.`);
  if (allianceName) lines.push(`Alliance: ${allianceName}.`);
  if (!includeStructures && counts.structures > 0) lines.push(`Ignored ${counts.structures} structure kill${counts.structures === 1 ? '' : 's'}.`);
  if (!includeDeployables && counts.deployables > 0) lines.push(`Ignored ${counts.deployables} deployable kill${counts.deployables === 1 ? '' : 's'}.`);
  if (!includePadding && counts.padding > 0) lines.push(`Ignored ${counts.padding} padding kill${counts.padding === 1 ? '' : 's'}.`);
  if (!includePadding && counts.paddingGanks > 0) lines.push(`Ignored ${counts.paddingGanks} padding gank${counts.paddingGanks === 1 ? '' : 's'}.`);
  if (counts.kills >= thresholds.highThreatKills) lines.push(`Crossed kill threshold (${thresholds.highThreatKills}).`);
  if (counts.ganks >= thresholds.highThreatGanks) lines.push(`Crossed gank threshold (${thresholds.highThreatGanks}).`);
  for (const signal of groupSignals) lines.push(signal);
  return lines.join(' ');
}


function getRetryDelayMs(response, attempt) {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return Math.max(seconds * 1000, 10000);
  }
  const jitter = Math.floor(Math.random() * 1000);
  return 10000 * Math.pow(2, attempt) + jitter;
}

// Centralized fetch wrapper with per-service pacing and 429 retry handling.

async function fetchJson(url, options = {}, attempt = 0) {
  const serviceKey = getServiceKeyForUrl(url);
  await waitForRequestSlot(serviceKey);

  const response = await fetch(url, options);
  if (response.status === 429 && attempt < 5) {
    const delayMs = getRetryDelayMs(response, attempt);
    const queue = requestQueueState[serviceKey] || requestQueueState.esi;
    queue.nextAvailableAt = Math.max(queue.nextAvailableAt, Date.now() + delayMs);
    const serviceLabel = serviceKey === 'zkill' ? 'zKillboard' : 'ESI';
    setStatus(`${serviceLabel} rate limited. Cooling down for ${Math.ceil(delayMs / 1000)}s...`);
    await sleep(delayMs);
    return fetchJson(url, options, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText} - ${text.slice(0, 180)}`);
  }
  return response.json();
}


function touchPilotCacheEntry(cacheKey) {
  const existing = pilotSummaryCache.get(cacheKey);
  if (!existing) return;
  pilotSummaryCache.delete(cacheKey);
  pilotSummaryCache.set(cacheKey, existing);
}


function evictOldestPilotCacheEntries() {
  while (pilotSummaryCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = pilotSummaryCache.keys().next().value;
    if (oldestKey === undefined) break;
    pilotSummaryCache.delete(oldestKey);
  }
}


function prunePilotCache() {
  const now = Date.now();
  for (const [key, entry] of pilotSummaryCache.entries()) {
    if (!entry || !entry.cachedAt || (now - entry.cachedAt) > CACHE_TTL_MS) {
      pilotSummaryCache.delete(key);
    }
  }
  evictOldestPilotCacheEntries();
}


function buildPilotCacheKey(name) {
  return String(name || '').trim().toLowerCase();
}


function buildEntityCacheKey(entityType, entityId) {
  return `${String(entityType || '').toLowerCase()}:${Number(entityId) || 0}`;
}


function getEntityTypeConfig(entityType) {
  return ENTITY_TYPE_CONFIG[String(entityType || '').toLowerCase()] || null;
}


function getEntityZkillUrl(entityType, entityId) {
  const config = getEntityTypeConfig(entityType);
  const safeId = Number(entityId) || 0;
  if (!config || !safeId) return '#';
  return `https://zkillboard.com/${config.zkillPath}/${safeId}/`;
}


function makeEmptyCounts() {
  return {
    all: { kills: 0, ganks: 0, structures: 0, deployables: 0, padding: 0, paddingGanks: 0, lastKillAt: null },
    highsec: { kills: 0, ganks: 0, structures: 0, deployables: 0, padding: 0, paddingGanks: 0, lastKillAt: null },
    lowsec: { kills: 0, ganks: 0, structures: 0, deployables: 0, padding: 0, paddingGanks: 0, lastKillAt: null },
    nullsec: { kills: 0, ganks: 0, structures: 0, deployables: 0, padding: 0, paddingGanks: 0, lastKillAt: null },
    wormhole: { kills: 0, ganks: 0, structures: 0, deployables: 0, padding: 0, paddingGanks: 0, lastKillAt: null }
  };
}


function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}


function getShortMonthKey(monthKey) {
  const [year, month] = String(monthKey).split('-');
  return `${String(year).slice(2)}-${Number(month)}`;
}


function expandShortMonthKey(shortKey) {
  const [yy, month] = String(shortKey).split('-');
  return `20${String(yy).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
}


function getNeededMonths(monthsBack) {
  const requests = [];
  const now = new Date();

  for (let offset = 0; offset <= monthsBack; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    requests.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      monthKey: getMonthKey(d.getUTCFullYear(), d.getUTCMonth() + 1)
    });
  }

  return requests;
}


async function resolveCharacterIds(names) {
  const data = await fetchJson(ESI_IDS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(names)
  });

  const byName = new Map();
  for (const entry of (data.characters || [])) {
    byName.set(entry.name, entry.id);
  }

  return names.map(name => ({
    name,
    characterId: byName.get(name) || null
  }));
}


async function resolveCharacterNames(characterIds) {
  const uniqueIds = [...new Set(
    (characterIds || [])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
  )];

  if (!uniqueIds.length) return new Map();

  const data = await fetchJson(ESI_NAMES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(uniqueIds)
  });

  const byId = new Map();
  for (const entry of (Array.isArray(data) ? data : [])) {
    if (!entry || entry.category !== 'character') continue;
    if (!Number.isFinite(Number(entry.id))) continue;
    byId.set(Number(entry.id), String(entry.name || entry.id));
  }

  return byId;
}



async function getCharacterInfo(characterId) {
  if (!characterId) return null;
  if (characterInfoCache.has(characterId)) return characterInfoCache.get(characterId);

  const promise = fetchJson(`${ESI_CHARACTER_URL}${characterId}/`).catch(() => null);
  characterInfoCache.set(characterId, promise);
  return promise;
}


async function resolveEntityNamesById(ids) {
  const uniqueIds = [...new Set(
    (ids || [])
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
  )];

  if (!uniqueIds.length) return new Map();

  const data = await fetchJson(ESI_NAMES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(uniqueIds)
  });

  const byId = new Map();
  for (const entry of (Array.isArray(data) ? data : [])) {
    if (!entry || !Number.isFinite(Number(entry.id))) continue;
    byId.set(Number(entry.id), String(entry.name || entry.id));
  }

  return byId;
}


function getKillCategoryId(kill) {
  const labels = Array.isArray(kill?.zkb?.labels) ? kill.zkb.labels : [];
  const catLabel = labels.find(label => typeof label === 'string' && label.startsWith('cat:'));
  if (!catLabel) return null;
  const value = Number(catLabel.slice(4));
  return Number.isFinite(value) ? value : null;
}


function hasKillLabel(kill, expectedLabel) {
  const labels = Array.isArray(kill?.zkb?.labels) ? kill.zkb.labels : [];
  return labels.includes(expectedLabel);
}


function classifyKillSpace(kill) {
  const labels = Array.isArray(kill?.zkb?.labels) ? kill.zkb.labels : [];
  const flags = { all: true };

  for (const label of labels) {
    if (label === 'loc:highsec') { flags.highsec = true; return flags; }
    if (label === 'loc:lowsec') { flags.lowsec = true; return flags; }
    if (label === 'loc:nullsec') { flags.nullsec = true; return flags; }
    if (label === 'loc:w-space') { flags.wormhole = true; return flags; }
  }

  return flags;
}


async function fetchCharacterKillsForMonth(characterId, year, month, maxPages = 1) {
  const allKills = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${ZKILL_API_BASE}/kills/characterID/${characterId}/year/${year}/month/${month}/page/${page}/`;
    const pageData = await fetchJson(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'EVE Local Threat Report'
      }
    });

    if (!Array.isArray(pageData) || pageData.length === 0) break;
    allKills.push(...pageData);
    if (pageData.length < 200) break;
  }

  const seen = new Set();
  return allKills.filter(kill => {
    const key = String(kill.killmail_id || '') + ':' + String(kill.zkb && kill.zkb.hash ? kill.zkb.hash : '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


async function fetchEntityKillsForMonth(entityType, entityId, year, month, maxPages = 1) {
  const config = getEntityTypeConfig(entityType);
  const safeId = Number(entityId) || 0;
  if (!config || !safeId) return [];

  const allKills = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${ZKILL_API_BASE}/kills/${config.apiModifier}/${safeId}/year/${year}/month/${month}/page/${page}/`;
    const pageData = await fetchJson(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'EVE Local Threat Report'
      }
    });

    if (!Array.isArray(pageData) || pageData.length === 0) break;
    allKills.push(...pageData);
    if (pageData.length < 200) break;
  }

  const seen = new Set();
  return allKills.filter(kill => {
    const key = String(kill.killmail_id || '') + ':' + String(kill.zkb && kill.zkb.hash ? kill.zkb.hash : '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Reduce raw zKill killmail data into counts for each supported space bucket.

async function summarizeKillsForMonth(kills) {
  const counts = makeEmptyCounts();

  for (const kill of kills) {
    const labels = Array.isArray(kill?.zkb?.labels) ? kill.zkb.labels : [];
    const isGanked = labels.includes('ganked');
    const categoryId = getKillCategoryId(kill);
    const isStructure = categoryId === STRUCTURE_CATEGORY_ID;
    const isDeployable = categoryId === DEPLOYABLE_CATEGORY_ID;
    const isPadding = hasKillLabel(kill, 'padding');
    const spaceFlags = classifyKillSpace(kill);
    const killTime = kill.killmail_time || null;

    for (const [, key] of SPACE_ORDER) {
      if (spaceFlags[key]) {
        counts[key].kills += 1;
        if (isGanked) counts[key].ganks += 1;
        if (isStructure) counts[key].structures += 1;
        if (isDeployable) counts[key].deployables += 1;
        if (isPadding) counts[key].padding += 1;
        if (isPadding && isGanked) counts[key].paddingGanks += 1;

        if (killTime) {
          const existing = counts[key].lastKillAt;
          if (!existing || new Date(killTime).getTime() > new Date(existing).getTime()) {
            counts[key].lastKillAt = killTime;
          }
        }
      }
    }
  }

  return counts;
}


function ensurePilotCacheEntry(pilot) {
  const cacheKey = buildPilotCacheKey(pilot.name);
  let entry = pilotSummaryCache.get(cacheKey);

  if (!entry) {
    entry = {
      cachedAt: Date.now(),
      name: pilot.name,
      characterId: pilot.characterId || null,
      zkillUrl: pilot.characterId ? `https://zkillboard.com/character/${pilot.characterId}/` : '#',
      corpId: null,
      corpName: '',
      allianceId: null,
      allianceName: '',
      months: {}
    };
    pilotSummaryCache.set(cacheKey, entry);
  } else {
    entry.cachedAt = Date.now();
    entry.name = pilot.name;
    entry.characterId = pilot.characterId || entry.characterId || null;
    entry.zkillUrl = entry.characterId ? `https://zkillboard.com/character/${entry.characterId}/` : '#';
    entry.corpId = entry.corpId || null;
    entry.corpName = entry.corpName || '';
    entry.allianceId = entry.allianceId || null;
    entry.allianceName = entry.allianceName || '';
  }

  touchPilotCacheEntry(cacheKey);
  evictOldestPilotCacheEntries();
  saveCacheToLocalStorage();
  return entry;
}


function ensureEntityCacheEntry(entityType, entityId) {
  const cacheKey = buildEntityCacheKey(entityType, entityId);
  let entry = entitySummaryCache.get(cacheKey);

  if (!entry) {
    entry = {
      cachedAt: Date.now(),
      entityType: String(entityType || '').toLowerCase(),
      entityId: Number(entityId) || null,
      zkillUrl: getEntityZkillUrl(entityType, entityId),
      months: {},
      pendingPromise: null
    };
    entitySummaryCache.set(cacheKey, entry);
  } else {
    entry.cachedAt = Date.now();
    entry.entityType = String(entityType || '').toLowerCase();
    entry.entityId = Number(entityId) || entry.entityId || null;
    entry.zkillUrl = getEntityZkillUrl(entityType, entityId);
  }

  return entry;
}


async function ensurePilotProfileCached(entry) {
  if (!entry?.characterId) return entry;
  if (entry.corpId || entry.corpName || entry.allianceId || entry.allianceName) return entry;

  const characterInfo = await getCharacterInfo(entry.characterId);
  if (characterInfo) {
    entry.corpId = Number(characterInfo.corporation_id) || null;
    entry.allianceId = Number(characterInfo.alliance_id) || null;
    const entityNames = await resolveEntityNamesById([entry.corpId, entry.allianceId]);
    entry.corpName = entityNames.get(entry.corpId) || '';
    entry.allianceName = entityNames.get(entry.allianceId) || '';
    entry.cachedAt = Date.now();
    saveCacheToLocalStorage();
  }

  return entry;
}


function getEntitySummaryEntry(entityType, entityId) {
  if (!entityType || !entityId) return null;
  const cacheKey = buildEntityCacheKey(entityType, entityId);
  const entry = entitySummaryCache.get(cacheKey);
  if (!entry) return null;
  const cacheExpired = !entry.cachedAt || (Date.now() - entry.cachedAt) > CACHE_TTL_MS;
  if (cacheExpired) {
    entitySummaryCache.delete(cacheKey);
    return null;
  }
  return entry;
}


function isEntitySummaryPending(entityType, entityId) {
  const entry = getEntitySummaryEntry(entityType, entityId);
  return Boolean(entry && entry.pendingPromise);
}


async function ensureEntityMonthsCached(entityType, entityId, monthsBack, entityLabel = '') {
  const cacheKey = buildEntityCacheKey(entityType, entityId);
  const existing = entitySummaryCache.get(cacheKey);
  const cacheExpired = !existing || !existing.cachedAt || (Date.now() - existing.cachedAt) > CACHE_TTL_MS;

  if (cacheExpired && existing) entitySummaryCache.delete(cacheKey);

  const entry = ensureEntityCacheEntry(entityType, entityId);
  if (!entry.entityId) return entry;
  if (entry.pendingPromise) {
    await entry.pendingPromise;
    return entry;
  }

  const neededMonths = getNeededMonths(monthsBack);
  const missingMonths = neededMonths.filter(m => !entry.months[m.monthKey]);
  if (missingMonths.length === 0) return entry;

  const queuedPromise = entityScanQueue.then(async () => {
    for (let i = 0; i < missingMonths.length; i++) {
      const monthInfo = missingMonths[i];
      const label = entityLabel || `${entry.entityType} ${entry.entityId}`;
      setStatus(`Scanning ${label} on zKill (${i + 1}/${missingMonths.length} month(s) needed)...`);
      const kills = await fetchEntityKillsForMonth(entry.entityType, entry.entityId, monthInfo.year, monthInfo.month, 1);
      const counts = await summarizeKillsForMonth(kills);
      entry.months[monthInfo.monthKey] = counts;
      entry.cachedAt = Date.now();
      saveCacheToLocalStorage();
    }
  });

  entityScanQueue = queuedPromise.catch(() => {});
  entry.pendingPromise = queuedPromise;

  try {
    await queuedPromise;
  } finally {
    if (entry.pendingPromise === queuedPromise) entry.pendingPromise = null;
  }

  return entry;
}

// Populate the per-pilot month buckets on demand so repeated scans can reuse cached summaries.

async function ensurePilotMonthsCached(pilot, monthsBack, pilotCounts) {
  const cacheKey = buildPilotCacheKey(pilot.name);
  const existing = pilotSummaryCache.get(cacheKey);
  const cacheExpired = !existing || !existing.cachedAt || (Date.now() - existing.cachedAt) > CACHE_TTL_MS;

  if (cacheExpired && existing) pilotSummaryCache.delete(cacheKey);

  const entry = ensurePilotCacheEntry(pilot);

  if (!pilot.characterId) return entry;

  const neededMonths = getNeededMonths(monthsBack);
  const missingMonths = neededMonths.filter(m => !entry.months[m.monthKey]);

  if (missingMonths.length === 0) return entry;

  for (let i = 0; i < missingMonths.length; i++) {
    const monthInfo = missingMonths[i];
    setStatus(`Pilot ${pilotCounts} • Pulling zKill for ${pilot.name} (${i + 1}/${missingMonths.length} month(s) needed)... pacing requests to about ${ZKILL_REQUESTS_PER_MINUTE} per minute.`);
    const kills = await fetchCharacterKillsForMonth(pilot.characterId, monthInfo.year, monthInfo.month, 1);
    const counts = await summarizeKillsForMonth(kills);
    entry.months[monthInfo.monthKey] = counts;
    entry.cachedAt = Date.now();
    saveCacheToLocalStorage();
  }

  touchPilotCacheEntry(cacheKey);
  evictOldestPilotCacheEntries();
  return entry;
}


function getCountsForMonths(entry, monthsBack, spaceFilter, options = {}) {
  const totals = { kills: 0, ganks: 0, structures: 0, deployables: 0, padding: 0, paddingGanks: 0, excludedKills: 0, lastKillAt: null };
  const neededMonths = getNeededMonths(monthsBack);
  const includeStructures = options.includeStructures !== false;
  const includeDeployables = options.includeDeployables !== false;
  const includePadding = options.includePadding !== false;

  for (const monthInfo of neededMonths) {
    const monthCounts = entry.months[monthInfo.monthKey];
    if (!monthCounts) continue;
    const bucket = monthCounts[spaceFilter] || { kills: 0, ganks: 0, structures: 0, deployables: 0, padding: 0, paddingGanks: 0 };
    const structures = Number(bucket.structures || 0);
    const deployables = Number(bucket.deployables || 0);
    const padding = Number(bucket.padding || 0);
    const paddingGanks = Number(bucket.paddingGanks || 0);
    const excludedStructures = includeStructures ? 0 : structures;
    const excludedDeployables = includeDeployables ? 0 : deployables;
    const excludedPadding = includePadding ? 0 : padding;
    const excludedPaddingGanks = includePadding ? 0 : paddingGanks;

    totals.kills += Math.max(0, Number(bucket.kills || 0) - excludedStructures - excludedDeployables - excludedPadding);
    totals.ganks += Math.max(0, Number(bucket.ganks || 0) - excludedPaddingGanks);
    totals.structures += structures;
    totals.deployables += deployables;
    totals.padding += padding;
    totals.paddingGanks += paddingGanks;
    totals.excludedKills += excludedStructures + excludedDeployables + excludedPadding;
    if (bucket.lastKillAt) {
      if (!totals.lastKillAt || new Date(bucket.lastKillAt).getTime() > new Date(totals.lastKillAt).getTime()) {
        totals.lastKillAt = bucket.lastKillAt;
      }
    }
  }

  return totals;
}

// Convert cached raw counts into the UI-friendly row model used by rendering and sharing.

function summarizePilotFromCache(entry, monthsBack, thresholds, spaceFilter, options = {}, context = {}) {
  const counts = getCountsForMonths(entry, monthsBack, spaceFilter, options);
  const corpEntityEntry = entry.corpId ? getEntitySummaryEntry('corporation', entry.corpId) : null;
  const allianceEntityEntry = entry.allianceId ? getEntitySummaryEntry('alliance', entry.allianceId) : null;
  const corpEntityCounts = (corpEntityEntry && !corpEntityEntry.pendingPromise && Object.keys(corpEntityEntry.months || {}).length > 0)
    ? getCountsForMonths(corpEntityEntry, monthsBack, spaceFilter, options)
    : null;
  const allianceEntityCounts = (allianceEntityEntry && !allianceEntityEntry.pendingPromise && Object.keys(allianceEntityEntry.months || {}).length > 0)
    ? getCountsForMonths(allianceEntityEntry, monthsBack, spaceFilter, options)
    : null;
  const includeStructures = options.includeStructures !== false;
  const includeDeployables = options.includeDeployables !== false;
  const includePadding = options.includePadding !== false;
  const activity = getActivityBadge(counts.lastKillAt, counts.kills > 0 || counts.ganks > 0);
  const recencyWeight = getRecencyWeight(counts.lastKillAt);
  const weightedThreatScore = (counts.kills + (counts.ganks * 2)) + recencyWeight;

  let threat = 'low';
  let notes = `No recent kill activity in selected month range (${spaceFilter}).`;

  if (counts.kills >= thresholds.highThreatKills || counts.ganks >= thresholds.highThreatGanks) {
    threat = 'high';
    notes = counts.ganks >= thresholds.highThreatGanks
      ? `Recent gank activity stands out in ${spaceFilter}.`
      : `High recent PvP kill count in ${spaceFilter}.`;
  } else if (weightedThreatScore > 0) {
    threat = 'warning';
    notes = counts.ganks > 0
      ? `Recent activity detected in ${spaceFilter}, but below the high-threat threshold.`
      : `Recent kills detected in ${spaceFilter}, but below the high-threat threshold.`;
  }

  const filteredBits = [];
  if (!includeStructures && counts.structures > 0) {
    filteredBits.push(`${counts.structures} structure kill${counts.structures === 1 ? '' : 's'}`);
  }
  if (!includeDeployables && counts.deployables > 0) {
    filteredBits.push(`${counts.deployables} deployable kill${counts.deployables === 1 ? '' : 's'}`);
  }
  if (!includePadding && counts.padding > 0) {
    filteredBits.push(`${counts.padding} padding kill${counts.padding === 1 ? '' : 's'}`);
  }
  if (filteredBits.length) {
    notes += ` Filtered out ${filteredBits.join(' and ')}.`;
  }

  const groupSignals = [];
  const corpGroupCount = entry.corpId ? Number(context.corpCounts?.get(entry.corpId) || 0) : 0;
  const allianceGroupCount = entry.allianceId ? Number(context.allianceCounts?.get(entry.allianceId) || 0) : 0;
  const fleetSignals = Array.isArray(context.fleetSignals) ? context.fleetSignals : [];
  const fleetSignal = fleetSignals.find(signal => signal.memberIds?.includes(entry.characterId));

  if (corpGroupCount >= 2 && entry.corpName) {
    groupSignals.push(`${corpGroupCount} pilots share corporation ${entry.corpName}.`);
  } else if (allianceGroupCount >= 3 && entry.allianceName) {
    groupSignals.push(`${allianceGroupCount} pilots share alliance ${entry.allianceName}.`);
  }
  if (fleetSignal) {
    groupSignals.push(fleetSignal.label);
  }
  if (corpEntityCounts && entry.corpName) {
    groupSignals.push(`Corporation zKill activity: ${corpEntityCounts.kills} filtered kill${corpEntityCounts.kills === 1 ? '' : 's'} and ${corpEntityCounts.ganks} gank${corpEntityCounts.ganks === 1 ? '' : 's'} in ${spaceFilter}.`);
  }
  if (allianceEntityCounts && entry.allianceName) {
    groupSignals.push(`Alliance zKill activity: ${allianceEntityCounts.kills} filtered kill${allianceEntityCounts.kills === 1 ? '' : 's'} and ${allianceEntityCounts.ganks} gank${allianceEntityCounts.ganks === 1 ? '' : 's'} in ${spaceFilter}.`);
  }

  // Convert existing threshold-based threat logic into a 0-100 score.
  // Kills = 45 points, ganks = 40 points, recency = 15 points.
  const killThreshold = Math.max(1, Number(thresholds.highThreatKills) || 1);
  const gankThreshold = Math.max(0, Number(thresholds.highThreatGanks) || 0);

  const killProgress = Math.min(counts.kills / killThreshold, 1);
  const gankProgress = gankThreshold > 0
    ? Math.min(counts.ganks / gankThreshold, 1)
    : (counts.ganks > 0 ? 1 : 0);
  const recencyProgress = Math.min(Math.max(recencyWeight / 3, 0), 1);

  const threatPercent = Math.max(0, Math.min(
    Math.round((killProgress * 45) + (gankProgress * 40) + (recencyProgress * 15)),
    100
  ));

  const threatExplanation = buildThreatExplanation(
    entry,
    counts,
    thresholds,
    spaceFilter,
    options,
    `Threat score: ${threatPercent}/100.`,
    entry.corpName,
    entry.allianceName,
    groupSignals
  );

  const externalIntelBits = [];
  if (corpEntityCounts && entry.corpName) {
    externalIntelBits.push(`Corp activity ${corpEntityCounts.kills}/${corpEntityCounts.ganks}`);
  }
  if (allianceEntityCounts && entry.allianceName) {
    externalIntelBits.push(`Alliance activity ${allianceEntityCounts.kills}/${allianceEntityCounts.ganks}`);
  }

  const entityIntelPending = (
    (entry.corpId && !corpEntityEntry) ||
    (entry.allianceId && !allianceEntityEntry) ||
    isEntitySummaryPending('corporation', entry.corpId) ||
    isEntitySummaryPending('alliance', entry.allianceId)
  );

  if (externalIntelBits.length) {
    notes += ` ${externalIntelBits.join('. ')}.`;
  }

  return {
    name: entry.name,
    found: Boolean(entry.characterId),
    characterId: entry.characterId,
    kills: counts.kills,
    gankCount: counts.ganks,
    zkillUrl: entry.zkillUrl || '#',
    threat,
    threatPercent,
    notes: entry.characterId ? notes : 'Character name could not be resolved in ESI.',
    activityLabel: activity.label,
    activityTone: activity.tone,
    lastKillAt: counts.lastKillAt,
    corpName: entry.corpName || '',
    corpId: entry.corpId || null,
    corpZkillUrl: entry.corpId ? getEntityZkillUrl('corporation', entry.corpId) : '#',
    corpActivity: corpEntityCounts ? {
      kills: corpEntityCounts.kills,
      ganks: corpEntityCounts.ganks
    } : null,
    allianceName: entry.allianceName || '',
    allianceId: entry.allianceId || null,
    allianceZkillUrl: entry.allianceId ? getEntityZkillUrl('alliance', entry.allianceId) : '#',
    allianceActivity: allianceEntityCounts ? {
      kills: allianceEntityCounts.kills,
      ganks: allianceEntityCounts.ganks
    } : null,
    corpGroupCount,
    allianceGroupCount,
    fleetSignal: fleetSignal ? fleetSignal.shortLabel : '',
    threatExplanation,
    entityIntelPending
  };
}


function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

