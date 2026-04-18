/* High-level scan orchestration, rerendering, and startup event wiring. */

// Resolve names, progressively load pilot summaries, and rerender as data arrives.
async function collectResultsFromCurrentInputs(showProgress = true) {
  const analysisToken = ++currentAnalysisToken;
  const names = normalizeNames(namesEl.value);
  if (!names.length) {
    renderResults([]);
    sumPilots.textContent = '0';
    sumThreats.textContent = '0';
    sumKills.textContent = '0';
    sumGanks.textContent = '0';
    if (showProgress) setStatus('Paste at least one pilot name first.');
    return;
  }

  const monthsBack = Number(monthsBackEl.value);
  const thresholds = {
    highThreatKills: Math.max(1, Number(highThreatKillsEl.value) || 3),
    highThreatGanks: Math.max(0, Number(highThreatGanksEl.value) || 1)
  };
  const spaceFilter = spaceFilterEl.value;
  const filterOptions = {
    includeStructures: includeStructuresEl.checked,
    includeDeployables: includeDeployablesEl.checked,
    includePadding: includePaddingEl ? includePaddingEl.checked : true
  };

  prunePilotCache();
  if (showProgress) setStatus(`Resolving ${names.length} pilot name(s) through ESI...`);
  const pilots = await resolveCharacterIds(names);
  if (analysisToken !== currentAnalysisToken) return;

  const progressiveRows = pilots.map((pilot, index) => ({
    name: pilot.name,
    characterId: pilot.characterId || null,
    zkillUrl: pilot.characterId ? `https://zkillboard.com/character/${pilot.characterId}/` : '#',
    threat: 'warning',
    kills: 0,
    gankCount: 0,
    notes: pilot.characterId ? 'Waiting for zKill data...' : 'Character name could not be resolved in ESI.',
    isLoading: Boolean(pilot.characterId),
    loadingStage: pilot.characterId ? 'queued' : 'done',
    profilePending: false,
    inputOrder: index
  }));
  renderResults(progressiveRows);

  const loadedEntries = [];
  const profileTasks = [];
  let reusedFullyCached = 0;
  let fetchedNewMonthBuckets = 0;

  const rerenderProgressive = () => {
    if (analysisToken !== currentAnalysisToken) return;
    const groupContext = buildGroupContext(loadedEntries);
    const finalizedRows = loadedEntries.map((entry) => {
      const row = summarizePilotFromCache(entry, monthsBack, thresholds, spaceFilter, filterOptions, groupContext);
      row.profilePending = !(entry.corpName || entry.allianceName || entry.corpId || entry.allianceId);
      row.inputOrder = names.findIndex(name => buildPilotCacheKey(name) === buildPilotCacheKey(entry.name));
      return row;
    });

    const unresolvedRows = progressiveRows.filter(row => !row.characterId);
    const loadingRows = progressiveRows.filter(
      row => row.characterId && !loadedEntries.some(entry => entry.characterId === row.characterId)
    );
    renderResults([...finalizedRows, ...loadingRows, ...unresolvedRows]);
  };

  for (let index = 0; index < pilots.length; index++) {
    const pilot = pilots[index];
    const placeholder = progressiveRows[index];
    if (placeholder.characterId) {
      placeholder.loadingStage = 'zkill';
      rerenderProgressive();
    }

    const cacheKey = buildPilotCacheKey(pilot.name);
    const existing = pilotSummaryCache.get(cacheKey);
    const beforeMonths = existing ? Object.keys(existing.months || {}).length : 0;

    const entry = await ensurePilotMonthsCached(pilot, monthsBack, `${index + 1}/${pilots.length}`);
    if (analysisToken !== currentAnalysisToken) return;

    const afterMonths = Object.keys(entry.months || {}).length;
    if (afterMonths > beforeMonths) fetchedNewMonthBuckets += (afterMonths - beforeMonths);
    else reusedFullyCached += 1;

    loadedEntries.push(entry);
    rerenderProgressive();

    if (entry.characterId && !(entry.corpName || entry.allianceName || entry.corpId || entry.allianceId)) {
      const profileTask = ensurePilotProfileCached(entry)
        .then(() => {
          if (analysisToken !== currentAnalysisToken) return;
          rerenderProgressive();
          return hydrateEntityIntelForEntry(entry, monthsBack, () => {
            if (analysisToken !== currentAnalysisToken) return;
            rerenderProgressive();
          });
        })
        .catch(error => console.error(error));
      profileTasks.push(profileTask);
    } else if (entry.corpId || entry.allianceId) {
      const entityTask = hydrateEntityIntelForEntry(entry, monthsBack, () => {
        if (analysisToken !== currentAnalysisToken) return;
        rerenderProgressive();
      });
      if (entityTask) profileTasks.push(entityTask);
    }
  }

  const unresolved = progressiveRows.filter(r => !r.characterId).length;
  if (showProgress) {
    setStatus(`zKill scan done. ${loadedEntries.length} pilot(s) shown. ${reusedFullyCached} pilot cache hit(s). ${fetchedNewMonthBuckets} new month bucket(s) fetched.${unresolved ? ` ${unresolved} name(s) could not be resolved.` : ''} Filling in corp/alliance intel...`);
  }

  await Promise.allSettled(profileTasks);
  if (analysisToken !== currentAnalysisToken) return;
  rerenderProgressive();

  if (showProgress) {
    setStatus(`Done. ${loadedEntries.length} pilot(s) shown. ${reusedFullyCached} pilot cache hit(s). ${fetchedNewMonthBuckets} new month bucket(s) fetched.${unresolved ? ` ${unresolved} name(s) could not be resolved.` : ''}`);
  }
}

async function analyze() {
  analyzeBtn.disabled = true;
  if (shareBtn) shareBtn.disabled = true;
  clearBtn.disabled = true;
  showScanStatusToast('Starting scan...', true);
  setStatus('Starting scan...');
  setShareStatus('');

  try {
    await collectResultsFromCurrentInputs(true);
    saveUiStateToLocalStorage();
    saveCacheToLocalStorage();
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  } finally {
    showScanStatusToast(statusEl.textContent || 'Scan complete.', false);
    hideScanStatusToast(2400);
    analyzeBtn.disabled = false;
    if (shareBtn) shareBtn.disabled = false;
    clearBtn.disabled = false;
    if (isCompactControlDrawerLayout()) closeControlDrawer();
  }
}

function rerenderFromCacheOnly() {
  const names = normalizeNames(namesEl.value);
  if (!names.length) {
    renderResults([]);
    sumPilots.textContent = '0';
    sumThreats.textContent = '0';
    sumKills.textContent = '0';
    sumGanks.textContent = '0';
    return;
  }

  const monthsBack = Number(monthsBackEl.value);
  const thresholds = {
    highThreatKills: Math.max(1, Number(highThreatKillsEl.value) || 3),
    highThreatGanks: Math.max(0, Number(highThreatGanksEl.value) || 1)
  };
  const spaceFilter = spaceFilterEl.value;
  const filterOptions = {
    includeStructures: includeStructuresEl.checked,
    includeDeployables: includeDeployablesEl.checked,
    includePadding: includePaddingEl ? includePaddingEl.checked : true
  };

  const entries = [];
  for (const name of names) {
    const entry = pilotSummaryCache.get(buildPilotCacheKey(name));
    if (!entry) continue;
    entries.push(entry);
  }

  const groupContext = buildGroupContext(entries);
  const results = entries.map(entry => summarizePilotFromCache(entry, monthsBack, thresholds, spaceFilter, filterOptions, groupContext));

  for (const entry of entries) {
    const entityTask = hydrateEntityIntelForEntry(entry, monthsBack, () => {
      rerenderFromCacheOnly();
    });
  }

  if (results.length > 0) {
    renderResults(results);
    setStatus('Updated view from cached month summaries.');
  } else {
    renderResults([]);
  }
}

function syncNamesInputUi() {
  prunePilotCache();
  saveUiStateToLocalStorage();
  setShareStatus('');
  updateControlDrawerSummary();
}

function replaceNamesFromBulkPaste(rawText) {
  const normalizedNames = normalizeNames(rawText);
  if (!normalizedNames.length) return false;

  namesEl.value = normalizedNames.join('\n');
  syncNamesInputUi();
  rerenderFromCacheOnly();
  hideGlobalRowHoverCard();
  namesEl.focus();
  namesEl.setSelectionRange(0, namesEl.value.length);
  setStatus(`Loaded ${normalizedNames.length} pilot(s) from paste. Press Scan Local to refresh intel.`);
  return true;
}

function hydrateEntityIntelForEntry(entry, monthsBack, rerender) {
  const tasks = [];
  if (entry?.corpId && (!getEntitySummaryEntry('corporation', entry.corpId) || isEntitySummaryPending('corporation', entry.corpId))) {
    tasks.push(ensureEntityMonthsCached('corporation', entry.corpId, monthsBack, entry.corpName || `corporation ${entry.corpId}`));
  }
  if (entry?.allianceId && (!getEntitySummaryEntry('alliance', entry.allianceId) || isEntitySummaryPending('alliance', entry.allianceId))) {
    tasks.push(ensureEntityMonthsCached('alliance', entry.allianceId, monthsBack, entry.allianceName || `alliance ${entry.allianceId}`));
  }
  if (!tasks.length) return null;

  return Promise.allSettled(tasks)
    .then(() => {
      rerender();
    })
    .catch(error => console.error(error));
}

function shouldHandleRosterPaste(rawText) {
  if (!rawText || !/[\r\n]/.test(rawText)) return false;
  return normalizeNames(rawText).length > 0;
}

async function handleBulkRosterPaste(rawText, options = {}) {
  if (!replaceNamesFromBulkPaste(rawText)) return false;
  const autoScan = options.forceAutoScan || (autoScanOnPasteEl && autoScanOnPasteEl.checked);
  if (autoScan) await analyze();
  return true;
}

// Persist UI changes so the tool can recover its last-used settings after refreshes.
namesEl.addEventListener('input', () => {
  syncNamesInputUi();
});

namesEl.addEventListener('paste', (event) => {
  const pastedText = event.clipboardData ? event.clipboardData.getData('text') : '';
  if (!shouldHandleRosterPaste(pastedText)) return;

  const existingNames = normalizeNames(namesEl.value);
  const hasExistingRoster = existingNames.length > 0;
  const hasSelection = namesEl.selectionStart !== namesEl.selectionEnd;

  if (!hasExistingRoster || hasSelection) return;

  const incomingNames = normalizeNames(pastedText);
  const incomingText = incomingNames.join('\n');
  const currentText = existingNames.join('\n');
  if (!incomingText || incomingText === currentText) {
    event.preventDefault();
    namesEl.focus();
    namesEl.setSelectionRange(0, namesEl.value.length);
    if (incomingText === currentText) {
      setStatus(`Local roster already matches the pasted list (${incomingNames.length} pilot(s)).`);
    }
    return;
  }

  event.preventDefault();
  handleBulkRosterPaste(pastedText).catch(error => {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  });
});

monthsBackEl.addEventListener('change', () => {
  saveUiStateToLocalStorage();
  rerenderFromCacheOnly();
  setShareStatus('');
});

highThreatKillsEl.addEventListener('input', () => {
  saveUiStateToLocalStorage();
  rerenderFromCacheOnly();
  setShareStatus('');
});

highThreatGanksEl.addEventListener('input', () => {
  saveUiStateToLocalStorage();
  rerenderFromCacheOnly();
  setShareStatus('');
});

spaceFilterEl.addEventListener('change', () => {
  saveUiStateToLocalStorage();
  rerenderFromCacheOnly();
  setShareStatus('');
});

includeStructuresEl.addEventListener('change', () => {
  saveUiStateToLocalStorage();
  rerenderFromCacheOnly();
  setShareStatus('');
});

includeDeployablesEl.addEventListener('change', () => {
  saveUiStateToLocalStorage();
  rerenderFromCacheOnly();
  setShareStatus('');
});

if (includePaddingEl) includePaddingEl.addEventListener('change', () => {
  saveUiStateToLocalStorage();
  rerenderFromCacheOnly();
  setShareStatus('');
});

if (autoScanOnPasteEl) autoScanOnPasteEl.addEventListener('change', () => {
  saveUiStateToLocalStorage();
  setShareStatus('');
});

function flashButtonState(button, className = "is-confirmed", ms = 900) {
  if (!button) return;
  button.classList.add(className);
  window.setTimeout(() => {
    button.classList.remove(className);
  }, ms);
}

function isCompactControlDrawerLayout() {
  return window.matchMedia('(max-width: 1280px), (max-aspect-ratio: 10/11) and (max-width: 1500px)').matches;
}

function updateControlDrawerSummary() {
  if (!controlDrawerMetaEl) return;
  const count = normalizeNames(namesEl.value).length;
  const base = count ? `${count} pilot${count === 1 ? '' : 's'} loaded` : 'No pilots loaded';
  controlDrawerMetaEl.textContent = document.body.classList.contains('control-drawer-open')
    ? `${base} • Tap to close`
    : `${base} • Tap to open`;
}

function openControlDrawer() {
  if (!isCompactControlDrawerLayout()) return;
  document.body.classList.add('control-drawer-open');
  if (controlDrawerToggleEl) controlDrawerToggleEl.setAttribute('aria-expanded', 'true');
  if (controlDrawerBackdropEl) controlDrawerBackdropEl.setAttribute('aria-hidden', 'false');
  updateControlDrawerSummary();
}

function closeControlDrawer() {
  document.body.classList.remove('control-drawer-open');
  if (controlDrawerToggleEl) controlDrawerToggleEl.setAttribute('aria-expanded', 'false');
  if (controlDrawerBackdropEl) controlDrawerBackdropEl.setAttribute('aria-hidden', 'true');
  updateControlDrawerSummary();
}

function syncControlDrawerLayout() {
  if (!isCompactControlDrawerLayout()) {
    closeControlDrawer();
    return;
  }
  updateControlDrawerSummary();
}

analyzeBtn.addEventListener('click', ()=>{
  analyze();
  flashButtonState(analyzeBtn);
});
if (shareBtn) shareBtn.addEventListener('click', ()=>{
  copyShareLink();
  flashButtonState(shareBtn);
});

if (controlDrawerToggleEl) {
  controlDrawerToggleEl.addEventListener('click', () => {
    if (document.body.classList.contains('control-drawer-open')) closeControlDrawer();
    else openControlDrawer();
  });
}

if (controlDrawerBackdropEl) {
  controlDrawerBackdropEl.addEventListener('click', closeControlDrawer);
}

clearBtn.addEventListener('click', () => {
  flashButtonState(clearBtn);
  namesEl.value = '';
  location.hash = '';
  setStatus('');
  hideScanStatusToast();
  setShareStatus('');
  pilotSummaryCache.clear();
  entitySummaryCache.clear();
  clearLocalStorageState();
  renderResults([]);
  sumPilots.textContent = '0';
  sumThreats.textContent = '0';
  sumKills.textContent = '0';
  sumGanks.textContent = '0';
  hideGlobalRowHoverCard();
  updateControlDrawerSummary();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('control-drawer-open')) {
    closeControlDrawer();
  }
});

window.addEventListener('paste', (event) => {
  const pastedText = event.clipboardData ? event.clipboardData.getData('text') : '';
  if (!shouldHandleRosterPaste(pastedText)) return;
  if (event.defaultPrevented) return;
  if (event.target === namesEl) return;

  event.preventDefault();
  handleBulkRosterPaste(pastedText).catch(error => {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  });
});

window.addEventListener('resize', syncControlDrawerLayout);

window.addEventListener('hashchange', () => {
  loadSharePayloadFromHash()
    .catch(error => {
      console.error(error);
      setShareStatus('Could not load shared scan data from the link.');
    })
    .finally(() => {
      updateControlDrawerSummary();
    });
});

window.addEventListener('storage', (event) => {
  if (event.key === LOCAL_STORAGE_CACHE_KEY) {
    loadCacheFromLocalStorage();
    rerenderFromCacheOnly();
    updateControlDrawerSummary();
  }

  if (event.key === LOCAL_STORAGE_UI_KEY) {
    const hadHash = String(location.hash || '').startsWith('#scan=');
    if (!hadHash) {
      loadUiStateFromLocalStorage();
      rerenderFromCacheOnly();
      updateControlDrawerSummary();
    }
  }
});

// Boot sequence: restore local state, then optionally hydrate from a shared hash URL.
loadCacheFromLocalStorage();
const hadSavedUiState = loadUiStateFromLocalStorage();

loadSharePayloadFromHash()
  .catch(error => {
    console.error(error);
    setShareStatus('Could not load shared scan data from the link.');
  })
  .finally(() => {
    updateControlDrawerSummary();
  });

if (!String(location.hash || '').startsWith('#scan=') && hadSavedUiState) {
  rerenderFromCacheOnly();
}

function updateControlDrawerSummary() {
  if (!controlDrawerMetaEl) return;
  const count = normalizeNames(namesEl.value).length;
  const base = count ? `${count} pilot${count === 1 ? '' : 's'} loaded` : 'No pilots loaded';
  controlDrawerMetaEl.textContent = document.body.classList.contains('control-drawer-open')
    ? `${base} | tap to close`
    : `${base} | tap to open`;
}

syncControlDrawerLayout();
updateControlDrawerSummary();
