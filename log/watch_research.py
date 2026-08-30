"""Report the live state of the newest research session: status, DSH events, tools, sources."""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

LIB = Path(r"E:\PaperNest\PaperNestLibrary")


def newest_session() -> dict:
    con = sqlite3.connect(LIB / "research.db")
    con.row_factory = sqlite3.Row
    row = next(con.execute("SELECT * FROM research_sessions ORDER BY created_at DESC LIMIT 1"))
    return dict(row)


def main() -> None:
  if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
  session = newest_session()
    ws = Path(session["workspace_path"])
    print(f"id       : {session['id']}")
    print(f"query    : {session['query']}")
    print(f"status   : {session['status']}")
    print(f"error    : {session['error']}")

    log = ws / ".dsh-session" / "session.jsonl"
    events = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []
    print(f"\nDSH events: {len(events)}")
    print("types     :", dict(Counter(e.get("type", "?") for e in events)))

    print("\n--- tool calls ---")
    for e in events:
        if e.get("type") == "tool/call":
            d = e["data"]
            print(f"  seq {e['seq']:>3} t{d.get('turn')}s{d.get('step')} {d['name']:<20} {d.get('arguments')}")

    print("\n--- tool results (truncated) ---")
    for e in events:
        if e.get("type") == "tool/result":
            text = e["data"]["message"]["content"][0]["content"][0]["text"]
            print(f"  seq {e['seq']:>3} | {text[:220].replace(chr(10), ' / ')}")

    src = ws / "sources.jsonl"
    if src.exists():
        rows = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
        print(f"\nsources: {len(rows)}  kinds={dict(Counter(r['kind'] for r in rows))}")
        for r in rows:
            print(f"  {r['id']} [{r['kind']:<10}] {r['title'][:80]}")

    steps = sorted((ws / "steps").glob("*.json")) if (ws / "steps").is_dir() else []
    print(f"\nsteps: {len(steps)}")

    report = ws / "report.md"
    if report.exists():
        text = report.read_text(encoding="utf-8")
        print(f"\nreport.md: {len(text)} chars")
        if "--full" in sys.argv:
            print(text)
        else:
            print(text[:1500])


if __name__ == "__main__":
    main()
