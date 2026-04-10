/* Share-link encoding/decoding plus group-level intel helpers. */


    function sanitizeNameForShare(name) {
      return String(name || '')
        .replaceAll('_', '__')
        .replaceAll(' ', '_');
    }


    function unsanitizeNameFromShare(name) {
      let result = '';
      for (let i = 0; i < name.length; i++) {
        const ch = name[i];
        if (ch === '_') {
          if (name[i + 1] === '_') {
            result += '_';
            i += 1;
          } else {
            result += ' ';
          }
        } else {
          result += ch;
        }
      }
      return result;
    }

// Compact month serialization keeps shared URLs reasonably short while preserving cached summaries.

    function encodeMonthBucketCompact(monthKey, data) {
      const parts = [getShortMonthKey(monthKey)];
      const allKills = Number(data?.all?.kills || 0);
      const allGanks = Number(data?.all?.ganks || data?.all?.pods || 0);
      const allStructures = Number(data?.all?.structures || 0);
      const allDeployables = Number(data?.all?.deployables || 0);
      const allLastKillAt = data?.all?.lastKillAt ? new Date(data.all.lastKillAt).getTime() : 0;
      if (allKills || allGanks || allStructures || allDeployables || allLastKillAt) parts.push(`a${allKills}-${allGanks}-${allStructures}-${allDeployables}-${allLastKillAt}`);

      for (const [shortKey, longKey] of SPACE_ORDER.slice(1)) {
        const kills = Number(data?.[longKey]?.kills || 0);
        const ganks = Number(data?.[longKey]?.ganks || data?.[longKey]?.pods || 0);
        const structures = Number(data?.[longKey]?.structures || 0);
        const deployables = Number(data?.[longKey]?.deployables || 0);
        const lastKillAt = data?.[longKey]?.lastKillAt ? new Date(data[longKey].lastKillAt).getTime() : 0;
        if (kills || ganks || structures || deployables || lastKillAt) parts.push(`${shortKey}${kills}-${ganks}-${structures}-${deployables}-${lastKillAt}`);
      }

      return parts.join('_');
    }


    function encodeMonthBuckets(months) {
      const keys = Object.keys(months || {}).sort().reverse();
      return keys
        .map(monthKey => encodeMonthBucketCompact(monthKey, months[monthKey]))
        .filter(Boolean)
        .join('.');
    }


    function decodeMonthBuckets(str) {
      const months = {};
      if (!str) return months;

      for (const rawEntry of String(str).split('.')) {
        if (!rawEntry) continue;

        const segments = rawEntry.split('_');
        const monthShort = segments.shift();
        if (!monthShort) continue;

        const monthKey = expandShortMonthKey(monthShort);
        const bucket = makeEmptyCounts();

        for (const seg of segments) {
          const tag = seg.slice(0, 1);
          const rest = seg.slice(1);
          const [killsRaw, ganksRaw, structuresRaw, deployablesRaw, lastKillAtRaw] = rest.split('-');
          const kills = Number(killsRaw || 0);
          const ganks = Number(ganksRaw || 0);
          const structures = Number(structuresRaw || 0);
          const deployables = Number(deployablesRaw || 0);
          const lastKillAtMs = Number(lastKillAtRaw || 0);
          const lastKillAt = Number.isFinite(lastKillAtMs) && lastKillAtMs > 0 ? new Date(lastKillAtMs).toISOString() : null;

          if (tag === 'a') bucket.all = { kills, ganks, structures, deployables, lastKillAt };
          if (tag === 'h') bucket.highsec = { kills, ganks, structures, deployables, lastKillAt };
          if (tag === 'l') bucket.lowsec = { kills, ganks, structures, deployables, lastKillAt };
          if (tag === 'n') bucket.nullsec = { kills, ganks, structures, deployables, lastKillAt };
          if (tag === 'w') bucket.wormhole = { kills, ganks, structures, deployables, lastKillAt };
        }

        months[monthKey] = bucket;
      }

      return months;
    }


    function serializePilotEntry(entry) {
      return [
        entry.characterId || '',
        entry.corpId || '',
        entry.allianceId || '',
        encodeMonthBuckets(entry.months || {})
      ].join('~');
    }


    function deserializePilotEntry(serialized) {
      const parts = String(serialized).split('~');
      if (parts.length < 2) return null;

      const legacyFormat = parts.length === 2;
      const characterId = parts[0] ? Number(parts[0]) : null;
      const corpId = legacyFormat ? null : (parts[1] ? Number(parts[1]) : null);
      const allianceId = legacyFormat ? null : (parts[2] ? Number(parts[2]) : null);
      const monthsPart = legacyFormat ? (parts[1] || '') : (parts.slice(3).join('~') || '');
      const safeCharacterId = Number.isFinite(characterId) ? characterId : null;
      const safeCorpId = Number.isFinite(corpId) ? corpId : null;
      const safeAllianceId = Number.isFinite(allianceId) ? allianceId : null;

      return {
        cachedAt: Date.now(),
        name: safeCharacterId ? String(safeCharacterId) : 'Unknown Pilot',
        characterId: safeCharacterId,
        zkillUrl: safeCharacterId ? `https://zkillboard.com/character/${safeCharacterId}/` : '#',
        corpId: safeCorpId,
        corpName: '',
        allianceId: safeAllianceId,
        allianceName: '',
        months: decodeMonthBuckets(monthsPart)
      };
    }

// Build the hash payload from the pilots currently shown in the UI.

    function buildSharePayloadFromCurrentView() {
      const names = normalizeNames(namesEl.value);
      if (!names.length) return '';

      const pilots = [];
      const seenCharacterIds = new Set();
      for (const name of names) {
        const entry = pilotSummaryCache.get(buildPilotCacheKey(name));
        if (!entry || !entry.characterId || seenCharacterIds.has(entry.characterId)) continue;
        seenCharacterIds.add(entry.characterId);
        pilots.push(serializePilotEntry(entry));
      }
      if (!pilots.length) return '';

      const settings = [
        `m=${monthsBackEl.value}`,
        `s=${spaceFilterEl.value}`,
        `k=${highThreatKillsEl.value}`,
        `p=${highThreatGanksEl.value}`,
        `st=${includeStructuresEl.checked ? '1' : '0'}`,
        `dp=${includeDeployablesEl.checked ? '1' : '0'}`
      ].join('&');

      return `${settings}&d=${pilots.join('!')}`;
    }

// Hydrate the UI and cache from a shared link when someone opens a #scan URL.

    async function loadSharePayloadFromHash() {
      const hash = String(location.hash || '');
      if (!hash.startsWith('#scan=')) return false;

      const raw = hash.slice(6);
      const params = new URLSearchParams(raw);
      const monthsBack = params.get('m');
      const spaceFilter = params.get('s');
      const highKills = params.get('k');
      const highGanks = params.get('p');
      const includeStructures = params.get('st');
      const includeDeployables = params.get('dp');
      const data = params.get('d');

      if (monthsBack) monthsBackEl.value = monthsBack;
      if (spaceFilter) spaceFilterEl.value = spaceFilter;
      if (highKills) highThreatKillsEl.value = highKills;
      if (highGanks) highThreatGanksEl.value = highGanks;
      if (includeStructures !== null && includeStructuresEl) includeStructuresEl.checked = includeStructures !== '0';
      if (includeDeployables !== null && includeDeployablesEl) includeDeployablesEl.checked = includeDeployables !== '0';

      if (!data) return false;

      const importedEntries = [];
      for (const piece of data.split('!')) {
        if (!piece) continue;
        const entry = deserializePilotEntry(piece);
        if (!entry || !entry.characterId) continue;
        importedEntries.push(entry);
      }

      if (!importedEntries.length) return false;

      pilotSummaryCache.clear();
      for (const entry of importedEntries) {
        pilotSummaryCache.set(buildPilotCacheKey(entry.name), entry);
      }
      evictOldestPilotCacheEntries();
      saveCacheToLocalStorage();

      const fallbackNames = importedEntries.map(entry => entry.name);
      const renderFallback = () => {
        namesEl.value = fallbackNames.join('\n');
        rerenderFromCacheOnly();
      };

      let namesResolvedQuickly = false;
      let fallbackRendered = false;

      const resolveNamesPromise = Promise.all([
        resolveCharacterNames(importedEntries.map(entry => entry.characterId)),
        resolveEntityNamesById(importedEntries.flatMap(entry => [entry.corpId, entry.allianceId]))
      ])
        .then(([idToName, entityNames]) => {
          for (const entry of importedEntries) {
            const resolvedName = idToName.get(entry.characterId);
            if (resolvedName) {
              pilotSummaryCache.delete(buildPilotCacheKey(entry.name));
              entry.name = resolvedName;
            }

            entry.corpName = entityNames.get(entry.corpId) || entry.corpName || '';
            entry.allianceName = entityNames.get(entry.allianceId) || entry.allianceName || '';
            pilotSummaryCache.set(buildPilotCacheKey(entry.name), entry);
          }

          evictOldestPilotCacheEntries();
          namesEl.value = importedEntries.map(entry => entry.name).join('\n');

          if (fallbackRendered || namesResolvedQuickly) {
            rerenderFromCacheOnly();
            setShareStatus('Loaded shared scan data from the link.');
          }

          return true;
        })
        .catch(error => {
          console.error(error);
          return false;
        });

      const quickResult = await Promise.race([
        resolveNamesPromise,
        sleep(1500).then(() => false)
      ]);

      if (quickResult) {
        namesResolvedQuickly = true;
        namesEl.value = importedEntries.map(entry => entry.name).join('\n');
        rerenderFromCacheOnly();
        setShareStatus('Loaded shared scan data from the link.');
        return true;
      }

      fallbackRendered = true;
      renderFallback();
      setShareStatus('Loaded shared scan data from the link. Pilot names are still resolving...');
      resolveNamesPromise.then(resolved => {
        if (resolved) {
          setShareStatus('Loaded shared scan data from the link.');
        } else {
          setShareStatus('Loaded shared scan data from the link. Some pilot names could not be resolved.');
        }
      });

      return true;
    }


    async function shortenUrl(longUrl) {
      const res = await fetch(
        `https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}`
      );
      const data = await res.json();
      return data.shorturl;
    }

// Copy a scan link to the clipboard, with optional shortening through is.gd.

    async function copyShareLink() {
      const payload = buildSharePayloadFromCurrentView();
      if (!payload) {
        setShareStatus('Run a scan first so there is data to share.');
        return;
      }

      const shareUrl = `${location.origin}${location.pathname}#scan=${payload}`;
      try {
        const shortUrl = await shortenUrl(shareUrl);
        await navigator.clipboard.writeText(shortUrl);
        setShareStatus(`Share link copied. Length: ${shareUrl.length} characters.`);
      } catch (error) {
        setShareStatus(`Could not copy automatically. Use this link: ${shareUrl}`);
        console.error(error);
      }
    }

// Group context powers the 'possible fleet' and 'shared corp/alliance' signals.


    function buildGroupContext(entries) {
      const corpCounts = new Map();
      const allianceCounts = new Map();

      for (const entry of entries) {
        if (entry?.corpId) corpCounts.set(entry.corpId, (corpCounts.get(entry.corpId) || 0) + 1);
        if (entry?.allianceId) allianceCounts.set(entry.allianceId, (allianceCounts.get(entry.allianceId) || 0) + 1);
      }

      const fleetSignals = [];
      for (const [corpId, count] of corpCounts.entries()) {
        if (count < 2) continue;
        const members = entries.filter(entry => entry.corpId === corpId);
        const hotMembers = members.filter(entry => getHoursSince(getCountsForMonths(entry, Number(monthsBackEl.value), spaceFilterEl.value, {
          includeStructures: includeStructuresEl.checked,
          includeDeployables: includeDeployablesEl.checked
        }).lastKillAt) <= 24 * 7);

        if (hotMembers.length >= 2) {
          const corpName = members[0]?.corpName || 'shared corporation';
          fleetSignals.push({
            shortLabel: `Possible fleet: ${hotMembers.length} together`,
            label: `${hotMembers.length} recently active pilots share corporation ${corpName}, which may indicate a fleet or camp.`,
            memberIds: hotMembers.map(member => member.characterId)
          });
        }
      }

      return { corpCounts, allianceCounts, fleetSignals };
    }

