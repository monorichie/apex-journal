"""
APEX Journal — MT5 Sync Agent
==============================
Connects to your Exness MetaTrader 5 terminal, pulls trade history,
and pushes it to your GitHub repository so your APEX Journal
at GitHub Pages can read it automatically.

Setup:
  1. pip install MetaTrader5 pandas requests
  2. Set your GitHub token and repo below
  3. Run: python mt5_sync.py --watch

Your journal at https://USERNAME.github.io/apex-journal/ will
auto-load your trades on every page visit.
"""

import argparse, json, os, sys, time, base64, hashlib
from datetime import datetime, timedelta
from pathlib import Path

try:
    import MetaTrader5 as mt5
except ImportError:
    print("\n  [!] Run: pip install MetaTrader5"); sys.exit(1)
try:
    import pandas as pd
except ImportError:
    print("\n  [!] Run: pip install pandas"); sys.exit(1)
try:
    import requests
except ImportError:
    print("\n  [!] Run: pip install requests"); sys.exit(1)


# ═══════════════════════════════════════════════════════════
#  CONFIGURATION — Edit these values
# ═══════════════════════════════════════════════════════════

GITHUB_TOKEN = ""       # Your GitHub Personal Access Token
GITHUB_REPO  = ""       # Format: "username/apex-journal"
DATA_FILE    = "public/trades.json"  # Path in repo
MT5_PATH     = None     # Set if MT5 is in a non-default location
SYNC_INTERVAL = 120     # Seconds between syncs in watch mode

# Lot size rules (for rule compliance tracking)
LOT_CAPS = {"XAUUSD": 0.02, "USOIL": 0.02, "USDJPY": 0.15}


# ═══════════════════════════════════════════════════════════
#  MT5 CONNECTION
# ═══════════════════════════════════════════════════════════

def connect_mt5():
    kwargs = {"path": MT5_PATH} if MT5_PATH else {}
    if not mt5.initialize(**kwargs):
        print(f"  ✗ Failed to connect to MT5: {mt5.last_error()}")
        return None
    info = mt5.account_info()
    if not info:
        mt5.shutdown()
        return None
    print(f"  ✓ MT5 connected — {info.login} @ {info.server}")
    print(f"    Balance: ${info.balance:.2f} | Equity: ${info.equity:.2f}")
    return info


def fetch_trades():
    info = connect_mt5()
    if not info:
        return None, None

    account = {
        "login": info.login, "server": info.server, "name": info.name,
        "balance": round(info.balance, 2), "equity": round(info.equity, 2),
        "leverage": info.leverage
    }

    deals = mt5.history_deals_get(datetime.now() - timedelta(days=36500), datetime.now())
    mt5.shutdown()

    if not deals or len(deals) == 0:
        return [], account

    df = pd.DataFrame(list(deals), columns=deals[0]._asdict().keys())
    trades = []

    for pos_id in df[df["position_id"] > 0]["position_id"].unique():
        pos = df[df["position_id"] == pos_id].sort_values("time")
        entries = pos[pos["entry"] == 0]
        exits = pos[pos["entry"].isin([1, 3])]
        if len(entries) == 0:
            continue

        e = entries.iloc[0]
        x = exits.iloc[0] if len(exits) > 0 else None
        symbol = e["symbol"].replace("m", "").replace("M", "").upper()

        # Asset type detection
        asset = "Forex"
        if any(s in symbol for s in ["XAUUSD", "XAGUSD", "XPTUSD"]): asset = "Commodity"
        elif any(s in symbol for s in ["BTCUSD", "ETHUSD"]): asset = "Crypto"
        elif any(s in symbol for s in ["US30", "NAS100"]): asset = "Index"
        elif any(s in symbol for s in ["OIL", "USOIL", "BRENT"]): asset = "Commodity"

        trade = {
            "id": f"mt5_{int(e['order'])}",
            "ticker": symbol,
            "assetType": asset,
            "direction": "Long" if e["type"] == 0 else "Short",
            "entryPrice": round(float(e["price"]), 5),
            "exitPrice": round(float(x["price"]), 5) if x is not None else None,
            "quantity": float(e["volume"]),
            "entryDate": datetime.utcfromtimestamp(e["time"]).strftime("%Y-%m-%dT%H:%M"),
            "exitDate": datetime.utcfromtimestamp(x["time"]).strftime("%Y-%m-%dT%H:%M") if x is not None else None,
            "stopLoss": None,
            "takeProfit": None,
            "profit": round(float(sum(pos["profit"])), 2),
            "commission": round(float(sum(pos["commission"])), 2),
            "swap": round(float(sum(pos["swap"])), 2),
            "tags": [],
            "emotion": "",
            "setup": "",
            "notes": "",
            "playbook": "",
            "source": "mt5"
        }
        trades.append(trade)

    return trades, account


# ═══════════════════════════════════════════════════════════
#  GITHUB SYNC
# ═══════════════════════════════════════════════════════════

def get_github_file():
    """Get current trades.json from GitHub (if exists)."""
    url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{DATA_FILE}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
    r = requests.get(url, headers=headers)
    if r.status_code == 200:
        data = r.json()
        content = base64.b64decode(data["content"]).decode("utf-8")
        return json.loads(content), data["sha"]
    return None, None


def push_to_github(trades_data):
    """Push trades.json to GitHub repo."""
    url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{DATA_FILE}"
    headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}

    content = json.dumps(trades_data, indent=2)
    encoded = base64.b64encode(content.encode("utf-8")).decode("utf-8")

    # Check if file exists to get SHA
    _, sha = get_github_file()

    payload = {
        "message": f"Sync trades — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "content": encoded,
        "branch": "main"
    }
    if sha:
        payload["sha"] = sha

    r = requests.put(url, headers=headers, json=payload)
    if r.status_code in [200, 201]:
        print(f"  ✓ Pushed to GitHub ({len(trades_data.get('trades', []))} trades)")
        return True
    else:
        print(f"  ✗ GitHub push failed: {r.status_code} — {r.text[:200]}")
        return False


def merge_trades(mt5_trades, existing_data):
    """Merge MT5 trades with existing data, preserving manual edits (notes, tags, emotions)."""
    existing = existing_data.get("trades", []) if existing_data else []
    existing_map = {t["id"]: t for t in existing}

    merged = []
    mt5_ids = set()

    for t in mt5_trades:
        mt5_ids.add(t["id"])
        if t["id"] in existing_map:
            # Preserve manual edits from the journal
            old = existing_map[t["id"]]
            t["tags"] = old.get("tags", [])
            t["emotion"] = old.get("emotion", "")
            t["setup"] = old.get("setup", "")
            t["notes"] = old.get("notes", "")
            t["playbook"] = old.get("playbook", "")
        merged.append(t)

    # Keep any manually-added trades that aren't from MT5
    for t in existing:
        if t["id"] not in mt5_ids and t.get("source") != "mt5":
            merged.append(t)

    return merged


# ═══════════════════════════════════════════════════════════
#  SYNC LOGIC
# ═══════════════════════════════════════════════════════════

def sync_once():
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"\n  [{ts}] Syncing...")

    # 1. Fetch from MT5
    mt5_trades, account = fetch_trades()
    if mt5_trades is None:
        print("  ✗ MT5 connection failed — is MT5 running?")
        return False

    print(f"  Fetched {len(mt5_trades)} trades from MT5")

    # 2. Get existing data from GitHub
    existing, _ = get_github_file()

    # 3. Merge (preserve journal edits)
    merged = merge_trades(mt5_trades, existing)

    # 4. Build data payload
    data = {
        "trades": merged,
        "account": account,
        "lastSync": datetime.now().isoformat(),
        "syncedFrom": "mt5_sync_agent",
        "rules": LOT_CAPS
    }

    # 5. Push to GitHub
    ok = push_to_github(data)

    if ok:
        wins = len([t for t in merged if (t.get("profit") or 0) > 0])
        losses = len([t for t in merged if (t.get("profit") or 0) < 0])
        total_pnl = sum(t.get("profit", 0) or 0 for t in merged)
        print(f"  Summary: {len(merged)} trades | {wins}W/{losses}L | P&L: ${total_pnl:.2f}")

    return ok


def watch_mode():
    print(f"\n  {'═' * 50}")
    print(f"  APEX JOURNAL — MT5 SYNC AGENT")
    print(f"  {'═' * 50}")
    print(f"  Repo:     {GITHUB_REPO}")
    print(f"  Interval: every {SYNC_INTERVAL}s")
    print(f"  Press Ctrl+C to stop")

    while True:
        try:
            sync_once()
            print(f"  Next sync in {SYNC_INTERVAL}s...")
            time.sleep(SYNC_INTERVAL)
        except KeyboardInterrupt:
            print(f"\n  Stopped.")
            break
        except Exception as e:
            print(f"  Error: {e}")
            time.sleep(30)


# ═══════════════════════════════════════════════════════════
#  SETUP WIZARD
# ═══════════════════════════════════════════════════════════

def setup_wizard():
    """Interactive setup if config is empty."""
    global GITHUB_TOKEN, GITHUB_REPO

    print(f"\n  {'═' * 50}")
    print(f"  APEX JOURNAL — FIRST-TIME SETUP")
    print(f"  {'═' * 50}")

    if not GITHUB_TOKEN:
        print(f"\n  You need a GitHub Personal Access Token.")
        print(f"  1. Go to: https://github.com/settings/tokens")
        print(f"  2. Click 'Generate new token (classic)'")
        print(f"  3. Name it 'APEX Journal Sync'")
        print(f"  4. Check the 'repo' scope")
        print(f"  5. Click 'Generate token' and copy it")
        GITHUB_TOKEN = input("\n  Paste your token: ").strip()

    if not GITHUB_REPO:
        GITHUB_REPO = input("  Your repo (e.g. username/apex-journal): ").strip()

    # Save config
    config = {"token": GITHUB_TOKEN, "repo": GITHUB_REPO}
    config_path = Path(__file__).parent / ".apex-config.json"
    config_path.write_text(json.dumps(config))
    print(f"\n  ✓ Config saved to {config_path}")
    print(f"  (Delete this file to reconfigure)\n")


def load_config():
    global GITHUB_TOKEN, GITHUB_REPO
    config_path = Path(__file__).parent / ".apex-config.json"
    if config_path.exists() and not GITHUB_TOKEN:
        config = json.loads(config_path.read_text())
        GITHUB_TOKEN = config.get("token", "")
        GITHUB_REPO = config.get("repo", "")


# ═══════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="APEX Journal MT5 Sync Agent")
    parser.add_argument("--watch", action="store_true", help="Continuous sync mode")
    parser.add_argument("--interval", type=int, default=SYNC_INTERVAL, help="Sync interval in seconds")
    parser.add_argument("--setup", action="store_true", help="Run setup wizard")
    args = parser.parse_args()

    global SYNC_INTERVAL
    SYNC_INTERVAL = args.interval

    load_config()

    if args.setup or not GITHUB_TOKEN or not GITHUB_REPO:
        setup_wizard()

    if not GITHUB_TOKEN or not GITHUB_REPO:
        print("  ✗ Missing GitHub config. Run: python mt5_sync.py --setup")
        sys.exit(1)

    if args.watch:
        watch_mode()
    else:
        sync_once()
        print(f"\n  Done! Your journal will show the trades on next page load.")
        print(f"  Run with --watch for continuous sync.\n")


if __name__ == "__main__":
    main()
