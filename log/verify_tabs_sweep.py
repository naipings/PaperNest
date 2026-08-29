"""Locate the 候选论文 tab by sweeping y positions, then capture each tab."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from research_ui import click, ensure_psutil, find_app, grab, maximize, minimize_cursor

OUT = Path(__file__).parent / "verify-multiturn"
OUT.mkdir(exist_ok=True)

NAV_RESEARCH = (60, 280)
COMPLETED_SESSION = (637, 997)

ensure_psutil()
minimize_cursor()
hwnd = find_app()
maximize(hwnd)
click(hwnd, *NAV_RESEARCH, wait=2.0)
click(hwnd, *COMPLETED_SESSION, wait=2.5)
grab(hwnd, OUT / "10_completed_selected.png")
for y in (300, 320, 340, 360, 390):
    click(hwnd, 1102, y, wait=1.2)
    grab(hwnd, OUT / f"11_try_y{y}.png")
