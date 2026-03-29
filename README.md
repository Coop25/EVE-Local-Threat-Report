# 🚀 EVE Local Threat Report

A frontend-only tool for analyzing **EVE Online local chat** and identifying potentially dangerous pilots using **zKillboard** and **ESI** data.

---

## 🧠 What It Does

Paste a list of pilot names, and this tool will:

* Resolve character names → IDs via ESI
* Pull recent kill data from zKillboard
* Analyze:

  * Kill activity
  * Gank behavior
  * Recency of activity
  * Space type (highsec / lowsec / nullsec / wormhole)
* Detect:

  * Shared corporations
  * Shared alliances
  * Possible active groups
* Generate:

  * Threat classification (Low / Warning / High)
  * Threat % score (0–100)
  * System-wide threat level gauge

---

## ⚡ Features

### 🔍 Pilot Analysis

* Kill counts filtered by space type
* Gank detection via zKill labels
* Configurable thresholds:

  * High threat kills
  * High threat ganks

### 📊 Threat Scoring

Each pilot gets:

* Threat level (Low / Warning / High)
* Threat % score based on:

  * kills
  * ganks (weighted higher)
  * recency

### 🌡️ System Threat Gauge

Aggregates all pilots into a single system-wide risk level:

* Weighs high-threat pilots heavily
* Boosts for gank-heavy activity
* Boosts for grouped pilots (corp/alliance)

### 👥 Group Intelligence

* Detects multiple pilots in same corp/alliance
* Highlights shared groups in local
* Identifies potential active clusters

### ⚡ Smart Caching

* Caches pilot results (1 hour TTL)
* Reduces API calls
* Helps avoid rate limits

### 🔗 Shareable Scans

* Encode scan into a URL
* Share local intel instantly

---

## 🧱 Tech Stack

* **Vanilla JavaScript (no framework)**
* **zKillboard API**
* **EVE ESI API**
* Runs entirely in the browser

---

## 📁 Project Structure

```bash
/src
  /js
    core.js        # API calls, caching, processing
    render.js      # UI rendering
    share.js       # share link encoding/decoding
    app.js         # main logic + event handling

  /css
    styles.css

/assets
  logo.png
  favicon-32.png
  favicon-64.png

index.html
```

---

## 🚦 How It Works

### 1. Input

User pastes pilot names (one per line)

### 2. Resolution

Names → Character IDs via:

```
POST /universe/ids
```

### 3. Data Fetching

Pulls monthly kill data from zKillboard:

```
/api/kills/characterID/{id}/year/{year}/month/{month}
```

### 4. Processing

Kills are analyzed for:

* Space type (`loc:*`)
* Ganks (`"ganked"` label)
* Category (structures / deployables)

### 5. Scoring

Each pilot gets:

* Kill-based score
* Gank-weighted score
* Recency bonus

### 6. Aggregation

System threat is calculated from:

* Individual threat %
* High-threat presence
* Gank volume
* Grouped pilots

---

## ⚠️ Rate Limiting (Important)

This app includes built-in request pacing:

| Service    | Limit       |
| ---------- | ----------- |
| zKillboard | ~50 req/min |
| ESI        | ~90 req/min |

* Uses a shared request queue
* Handles `429` responses with backoff

👉 **Do not remove this logic** — it prevents API bans.

---

## 🧩 Key Concepts

### Threat Levels

* **Low** → No recent activity
* **Warning** → Some activity
* **High** → Exceeds thresholds

### Threat %

Normalized score (0–100) based on:

* kills
* ganks (higher weight)
* recency

### System Threat

Overall system danger:

* Not a prediction model
* Heuristic based on local activity

---

## 🚫 Limitations

* Not real-time combat intel
* Not a true “fleet detection” system
* Depends on zKillboard data availability
* Heuristic-based (not predictive AI)

---

## 💡 Future Ideas

* Sort / filter UI controls
* Highlight grouped pilots in table
* Spike detection (kills in last 24h)
* Backend for persistent share links
* ESI enrichment (security status, etc.)

---

## 🛠️ Development Notes

* No build step required
* Runs directly in browser
* Keep logic modular (avoid large monolithic files)
* Prefer incremental refactors

---

## 📜 Disclaimer

This tool provides **heuristic threat analysis**, not guaranteed predictions.
Always use in combination with in-game awareness.

---

## ❤️ Contributing

Feel free to fork, modify, and improve.

If you add features:

* keep performance in mind
* respect API rate limits
* maintain existing behavior unless intentional

---

## 🛰️ Fly Safe

Or… don’t 😉
