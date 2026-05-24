# APEX Trading Journal

A Tradezella-style trading journal with calendar heatmap, 7 analytics reports, strategy playbooks, rule enforcement, and CSV import. Built for forex, crypto, and commodity traders.

![Dashboard](https://img.shields.io/badge/trades-auto--sync-06b6d4) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Dashboard** — P&L, win/loss rate, profit factor, R:R, expectancy, max drawdown, equity curve
- **Calendar** — Monthly P&L heatmap with daily breakdown
- **Journal** — Filterable trade log with expandable details
- **Analytics** — 7 report tabs: Pairs, Time of Day, Day of Week, Hold Time, Strategy, Emotion, Direction
- **Rules** — Data-driven trading rules with violation tracking
- **Playbooks** — Tag trades with strategies (ICT Silver Bullet, London Killzone, etc.)
- **CSV Import** — Auto-maps MetaTrader, Interactive Brokers, and most broker exports
- **Persistent Storage** — Data saved in your browser's localStorage

## Deploy to GitHub Pages

### Step 1: Create a new GitHub repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `apex-journal` (or anything you like)
3. Set it to **Public**
4. Do NOT initialize with README (you already have one)
5. Click **Create repository**

### Step 2: Push the code

Open a terminal in this project folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/apex-journal.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

### Step 3: Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source**, select **GitHub Actions**
4. That's it — the workflow will auto-run on push

### Step 4: Access your journal

After the workflow completes (~1-2 minutes), your journal will be live at:

```
https://YOUR_USERNAME.github.io/apex-journal/
```

Every time you push changes, it auto-redeploys.

## Run Locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`

## Import Trades

1. Export your trade history as CSV from your broker (MetaTrader, Exness, etc.)
2. Click **↑ CSV** in the journal
3. Drop the file — columns auto-map
4. Preview and confirm import

## Tech Stack

- React 18 + Vite
- Recharts (charts)
- PapaParse (CSV parsing)
- localStorage (persistence)
- GitHub Actions (CI/CD)

---

## Connect to Exness MT5 (Auto-Sync)

This is the Tradezella-style broker connection. A small Python script runs on your PC alongside MT5 and pushes your trades to GitHub so the journal loads them automatically.

### One-Time Setup

**1. Get a GitHub Personal Access Token:**
- Go to [github.com/settings/tokens](https://github.com/settings/tokens)
- Click **"Generate new token (classic)"**
- Name it `APEX Journal Sync`
- Check the **`repo`** scope
- Click Generate and **copy the token**

**2. Install Python packages:**
```bash
pip install MetaTrader5 pandas requests
```

**3. Run the setup wizard:**
```bash
python mt5_sync.py --setup
```
It will ask for your token and repo name (e.g. `yourusername/apex-journal`).

### Daily Usage

1. Open MetaTrader 5 and log into your Exness account
2. Double-click **start_sync.bat** (or run `python mt5_sync.py --watch`)
3. The script syncs your trades to GitHub every 2 minutes
4. Open your journal — trades appear automatically

### How It Works

```
MT5 Terminal → Python sync agent → GitHub repo (trades.json) → GitHub Pages journal
```

- The sync agent pulls your complete trade history from MT5
- It pushes a `trades.json` file to your GitHub repo's `public/` folder
- Your journal fetches this file on every page load
- Manual edits (notes, tags, emotions, playbooks) are preserved in localStorage and merged with MT5 data
- Each sync commits to your repo, so you have full version history of your trades
