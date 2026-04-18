/* Rendering helpers for the results table, intel summary, and hover card. */

// Render the small threat badge used in the table.
function threatPill(threat) {
  const cls =
    threat === 'high' ? 'high' :
    threat === 'warning' ? 'warning' :
    'low';

  const label =
    threat === 'high' ? 'HIGH' :
    threat === 'warning' ? 'WARNING' :
    'LOW';

  return `<span class="threat-pill ${cls}">${label}</span>`;
}

function threatInfoButton(explanation) {
  return `
    <span class="threat-tooltip" tabindex="0" aria-label="Threat explanation">
      ?
      <span class="tooltip-content"><strong>Why this threat level</strong>${escapeHtml(explanation)}</span>
    </span>
  `;
}

// Render the top-of-table group intel summary that calls out shared corps and fleets.
function renderIntelSummary(rows) {
  if (!intelSummaryEl) return;

  const fleetRows = rows.filter(row => row.fleetSignal);
  const sharedCorpRows = rows.filter(row => row.corpGroupCount >= 2 && row.corpName);
  const sharedAllianceRows = rows.filter(row => row.allianceGroupCount >= 2 && row.allianceName);
  const topFleet = fleetRows[0];

  if (!fleetRows.length && !sharedCorpRows.length && !sharedAllianceRows.length) {
    intelSummaryEl.innerHTML = '';
    intelSummaryEl.classList.add('hidden');
    return;
  }

  const seenCorpNames = new Set();
  const uniqueCorpRows = sharedCorpRows.filter(row => {
    if (seenCorpNames.has(row.corpName)) return false;
    seenCorpNames.add(row.corpName);
    return true;
  });

  const seenAllianceNames = new Set();
  const uniqueAllianceRows = sharedAllianceRows.filter(row => {
    if (seenAllianceNames.has(row.allianceName)) return false;
    seenAllianceNames.add(row.allianceName);
    return true;
  });

  const parts = [];

  if (topFleet) {
    parts.push(`<div><span>Possible fleet detected: ${escapeHtml(topFleet.fleetSignal)}.</span></div>`);
  }

  const groupTags = [];

  for (const row of uniqueCorpRows) {
    const style = escapeHtml(getNameColorStyle(row.corpName));
    groupTags.push(
      `<a class="mini-pill-link" href="${escapeHtml(row.corpZkillUrl || '#')}" target="_blank" rel="noopener noreferrer"><span class="mini-pill profile shared-group-pill" style="${style}">${row.corpGroupCount}x Corp: ${escapeHtml(row.corpName)}</span></a>`
    );
  }

  for (const row of uniqueAllianceRows) {
    const style = escapeHtml(getNameColorStyle(row.allianceName));
    groupTags.push(
      `<a class="mini-pill-link" href="${escapeHtml(row.allianceZkillUrl || '#')}" target="_blank" rel="noopener noreferrer"><span class="mini-pill alliance shared-group-pill" style="${style}">${row.allianceGroupCount}x Alliance: ${escapeHtml(row.allianceName)}</span></a>`
    );
  }

  if (groupTags.length) {
    parts.push(`
      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
        <span><strong>Shared groups in local:</strong></span>
        ${groupTags.join(' ')}
      </div>
    `);
  }

  intelSummaryEl.innerHTML = parts.join(' ');
  intelSummaryEl.classList.remove('hidden');
}

// Render the full result table and the headline summary counters.
function renderResults(rows) {
  hideGlobalRowHoverCard();

  if (!rows.length) {
    resultsBody.innerHTML = `<tr><td colspan="4" class="note">Results will appear here.</td></tr>`;
    renderIntelSummary([]);
    if (systemThreatGaugeEl) systemThreatGaugeEl.classList.add('hidden');
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    if (!!a.isLoading !== !!b.isLoading) return a.isLoading ? 1 : -1;

    const threatRank = { high: 2, warning: 1, low: 0 };
    const leftThreat = threatRank[a.threat] ?? -1;
    const rightThreat = threatRank[b.threat] ?? -1;
    if (rightThreat !== leftThreat) return rightThreat - leftThreat;

    if ((b.threatPercent || 0) !== (a.threatPercent || 0)) {
      return (b.threatPercent || 0) - (a.threatPercent || 0);
    }

    if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
    if ((b.gankCount || 0) !== (a.gankCount || 0)) return (b.gankCount || 0) - (a.gankCount || 0);

    return (a.inputOrder || 0) - (b.inputOrder || 0);
  });

  resultsBody.innerHTML = sorted.map(row => {
    const intelBits = [];
    const rowClasses = ['row-enter'];
    if (row.isLoading) rowClasses.push('row-loading');

    if (row.isLoading) {
      if (row.loadingStage === 'queued') intelBits.push('<span class="mini-pill loading">Queued for zKill</span>');
      if (row.loadingStage === 'zkill') intelBits.push('<span class="mini-pill loading">Pulling zKill…</span>');
    } else {
      // intelBits.push(`<span class="mini-pill ${escapeHtml(row.activityTone || 'neutral')}">${escapeHtml(row.activityLabel || 'No kills in window')}</span>`);
      if (row.profilePending) intelBits.push('<span class="mini-pill pending">Fetching corp/alliance…</span>');
    }

    if (row.corpName) {
      const corpStyle = escapeHtml(getNameColorStyle(row.corpName));
      const corpLabel = row.corpGroupCount >= 2
        ? `${row.corpGroupCount}x Corp: ${row.corpName}`
        : `Corp: ${row.corpName}`;
      const corpActivity = row.corpActivity
        ? ` (${Number(row.corpActivity.kills || 0)}K/${Number(row.corpActivity.ganks || 0)}G)`
        : '';
      const corpTitle = row.corpActivity
        ? `${row.corpName}: ${Number(row.corpActivity.kills || 0)} kills and ${Number(row.corpActivity.ganks || 0)} ganks in the selected scan window.`
        : `${row.corpName} zKillboard page`;
      intelBits.push(`<a class="mini-pill-link" href="${escapeHtml(row.corpZkillUrl || '#')}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(corpTitle)}" aria-label="${escapeHtml(corpTitle)}"><span class="mini-pill profile" style="${corpStyle}">${escapeHtml(corpLabel + corpActivity)}</span></a>`);
    }

    if (row.allianceName) {
      const allianceStyle = escapeHtml(getNameColorStyle(row.allianceName));
      const allianceLabel = row.allianceGroupCount >= 2
        ? `${row.allianceGroupCount}x Alliance: ${row.allianceName}`
        : `Alliance: ${row.allianceName}`;
      const allianceActivity = row.allianceActivity
        ? ` (${Number(row.allianceActivity.kills || 0)}K/${Number(row.allianceActivity.ganks || 0)}G)`
        : '';
      const allianceTitle = row.allianceActivity
        ? `${row.allianceName}: ${Number(row.allianceActivity.kills || 0)} kills and ${Number(row.allianceActivity.ganks || 0)} ganks in the selected scan window.`
        : `${row.allianceName} zKillboard page`;
      intelBits.push(`<a class="mini-pill-link" href="${escapeHtml(row.allianceZkillUrl || '#')}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(allianceTitle)}" aria-label="${escapeHtml(allianceTitle)}"><span class="mini-pill alliance" style="${allianceStyle}">${escapeHtml(allianceLabel + allianceActivity)}</span></a>`);
    }

    if (row.fleetSignal) {
      intelBits.push(`<span class="mini-pill group">${escapeHtml(row.fleetSignal)}</span>`);
    }

    const pilotName = row.name || (row.characterId ? String(row.characterId) : 'Unknown pilot');
    const nameHref = row.zkillUrl || '#';
    const killsMarkup = row.isLoading ? '<span class="metric muted">…</span>' : `<span class="metric">${Number(row.kills || 0)}</span>`;
    const ganksMarkup = row.isLoading ? '<span class="metric muted">…</span>' : `<span class="metric">${Number(row.gankCount || 0)}</span>`;

    const threatMarkup = row.isLoading
      ? `<div class="threat-readout threat-readout--loading">
      <span class="threat-pill threat-pill--loading">SCANNING</span>
    </div>` : `<div class="threat-readout">
      ${threatPill(row.threat)}
      <span class="threat-percent">${Number(row.threatPercent || 0)}%</span>
    </div>`;

    const hoverThreat = row.isLoading
      ? 'Waiting for zKill data to explain this row.'
      : (row.hoverThreatExplanation || row.threatExplanation || 'Threat explanation not available yet.');
    const hoverNotes = row.isLoading
      ? (row.notes || 'Waiting for zKill data...')
      : (row.hoverNotes || row.notes || 'No extra notes available.');

    return `
      <tr class="data-row ${rowClasses.join(' ')}" data-hover-threat="${escapeHtml(hoverThreat)}" data-hover-notes="${escapeHtml(hoverNotes)}">
        <td class="row-tooltip-anchor">
          <div class="pilot-cell">
            <a class="pilot-name-link" href="${escapeHtml(nameHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pilotName)}</a>
          </div>
        </td>
        <td>${killsMarkup}</td>
        <td>${ganksMarkup}</td>
        <td>${threatMarkup}</td>
      </tr>
      <tr class="intel-row ${row.isLoading ? 'row-loading' : ''}">
        <td colspan="4" class="intel-cell">
          <div class="intel-tags intel-tags-row">${intelBits.join('')}</div>
        </td>
      </tr>
    `;
  }).join('');

  const finishedRows = sorted.filter(row => !row.isLoading);
  sumPilots.textContent = String(sorted.length);
  sumThreats.textContent = String(finishedRows.filter(r => r.threat !== 'low').length);
  sumKills.textContent = String(finishedRows.reduce((acc, row) => acc + Number(row.kills || 0), 0));
  sumGanks.textContent = String(finishedRows.reduce((acc, row) => acc + Number(row.gankCount || 0), 0));
  renderIntelSummary(finishedRows);
  renderSystemThreatGauge(finishedRows);
}

// Global hover card helpers keep long explanations outside the table cells.
function buildGlobalHoverCardHtml(row) {
  if (!row) return '';
  const threat = row.dataset.hoverThreat || 'Threat explanation not available yet.';
  const notes = row.dataset.hoverNotes || 'No extra notes available.';
  return `
    <div class="tooltip-section">
      <strong>Why this threat level</strong>
      <div class="tooltip-copy">${threat}</div>
    </div>
    <div class="tooltip-section">
      <strong>Scan notes</strong>
      <div class="tooltip-copy">${notes}</div>
    </div>
  `;
}

function hideGlobalRowHoverCard() {
  hoveredRowEl = null;
  if (!globalRowHoverCardEl) return;
  globalRowHoverCardEl.classList.remove('visible');
  globalRowHoverCardEl.setAttribute('aria-hidden', 'true');
}

function positionGlobalRowHoverCard(row) {
  if (!row || !globalRowHoverCardEl) return;
  const rowRect = row.getBoundingClientRect();
  const popupRect = globalRowHoverCardEl.getBoundingClientRect();
  const gap = 10;
  const margin = 8;
  let top = rowRect.bottom + gap;
  if (top + popupRect.height > window.innerHeight - margin) {
    top = rowRect.top - popupRect.height - gap;
  }
  if (top < margin) {
    top = Math.max(margin, Math.min(window.innerHeight - popupRect.height - margin, rowRect.bottom + gap));
  }
  let left = rowRect.left + 8;
  if (left + popupRect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - popupRect.width - margin);
  }
  globalRowHoverCardEl.style.top = `${top}px`;
  globalRowHoverCardEl.style.left = `${left}px`;
}

function showGlobalRowHoverCard(row) {
  if (!row || !globalRowHoverCardEl) return;
  hoveredRowEl = row;
  globalRowHoverCardEl.innerHTML = buildGlobalHoverCardHtml(row);
  globalRowHoverCardEl.classList.add('visible');
  globalRowHoverCardEl.setAttribute('aria-hidden', 'false');
  positionGlobalRowHoverCard(row);
}

// Wire up the hover-card behavior once the rendering helpers are loaded.
resultsBody.addEventListener('mousemove', (event) => {
  const row = event.target.closest('tr[data-hover-threat]');
  if (!row || !resultsBody.contains(row)) {
    hideGlobalRowHoverCard();
    return;
  }
  if (hoveredRowEl !== row) {
    showGlobalRowHoverCard(row);
    return;
  }
  positionGlobalRowHoverCard(row);
});

resultsBody.addEventListener('mouseleave', () => {
  hideGlobalRowHoverCard();
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.pilot-name-link')) {
    hideGlobalRowHoverCard();
  }
});

window.addEventListener('blur', hideGlobalRowHoverCard);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hideGlobalRowHoverCard();
});

window.addEventListener('scroll', () => {
  if (hoveredRowEl && document.body.contains(hoveredRowEl)) positionGlobalRowHoverCard(hoveredRowEl);
  else hideGlobalRowHoverCard();
}, true);

window.addEventListener('resize', () => {
  if (hoveredRowEl && document.body.contains(hoveredRowEl)) positionGlobalRowHoverCard(hoveredRowEl);
  else hideGlobalRowHoverCard();
});

function calculateSystemThreat(rows) {
  const finishedRows = rows.filter(row => !row.isLoading);
  if (!finishedRows.length) {
    return {
      percent: 0,
      label: 'No data yet',
      tone: 'safe'
    };
  }

  const totalPilots = finishedRows.length;
  const highRows = finishedRows.filter(row => row.threat === 'high');
  const warningRows = finishedRows.filter(row => row.threat === 'warning');
  const groupedRows = finishedRows.filter(row =>
    Number(row.corpGroupCount || 0) >= 2 || Number(row.allianceGroupCount || 0) >= 2
  );

  // Weight dangerous pilots much more heavily than zero-threat pilots.
  // Low rows still count, but they barely drag the system score down.
  const weightedThreatSum = finishedRows.reduce((sum, row) => {
    const percent = Number(row.threatPercent || 0);

    if (row.threat === 'high') return sum + (percent * 1.35);
    if (row.threat === 'warning') return sum + (percent * 1.0);
    return sum + (percent * 0.2);
  }, 0);

  const weightedAverage = weightedThreatSum / totalPilots;

  // Strongest pilot should heavily influence the system.
  const topThreat = Math.max(...finishedRows.map(row => Number(row.threatPercent || 0)), 0);

  // Ganks should matter more than generic kills for "how unsafe is local right now".
  const totalGanks = finishedRows.reduce((sum, row) => sum + Number(row.gankCount || 0), 0);
  const gankPressure = Math.min(25, totalGanks * 0.12);

  // Grouped presence should increase danger, especially if the dangerous pilot is grouped.
  const groupedPressure = Math.min(15, groupedRows.length * 3);

  // High and warning pilots add explicit system pressure.
  const highPressure = highRows.length * 12;
  const warningPressure = warningRows.length * 5;

  let systemPercent = Math.round(
    (weightedAverage * 0.45) +
    (topThreat * 0.30) +
    gankPressure +
    groupedPressure +
    highPressure +
    warningPressure
  );

  systemPercent = Math.max(0, Math.min(systemPercent, 100));

  let label = 'Relatively safe';
  let tone = 'safe';

  if (systemPercent >= 80) {
    label = 'Significant threat in system';
    tone = 'high';
  } else if (systemPercent >= 60) {
    label = 'Dangerous hostile presence';
    tone = 'high';
  } else if (systemPercent >= 35) {
    label = 'Use caution';
    tone = 'warning';
  }

  return {
    percent: systemPercent,
    label,
    tone
  };
}

function renderSystemThreatGauge(rows) {
  if (!systemThreatGaugeEl || !systemThreatPercentEl || !systemThreatTextEl || !systemThreatArrowEl) return;

  const result = calculateSystemThreat(rows);

  systemThreatPercentEl.textContent = `${result.percent}%`;
  systemThreatTextEl.textContent = result.label;
  systemThreatArrowEl.style.left = `${result.percent}%`;

  systemThreatGaugeEl.classList.remove('hidden', 'safe', 'warning', 'high');
  systemThreatGaugeEl.classList.add(result.tone);
}
