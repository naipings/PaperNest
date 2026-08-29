"""Verify the multi-turn research UI: tabs, markdown rendering, composer, proposals tab."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from research_ui import click, ensure_psutil, find_app, grab, maximize, minimize_cursor

OUT = Path(__file__).parent / "verify-multiturn"
OUT.mkdir(exist_ok=True)

NAV_RESEARCH = (60, 280)
FIRST_SESSION = (538, 925)
TAB_CONVERSATION = (830, 300)
TAB_TRAJECTORY = (908, 300)
TAB_PROPOSALS = (1012, 300)

ensure_psutil()
minimize_cursor()
hwnd = find_app()
maximize(hwnd)
grab(hwnd, OUT / "00_startup.png")
click(hwnd, *NAV_RESEARCH, wait=2.5)
grab(hwnd, OUT / "01_research.png")
click(hwnd, *FIRST_SESSION, wait=2.5)
grab(hwnd, OUT / "02_selected.png")
click(hwnd, *TAB_CONVERSATION, wait=2.0)
grab(hwnd, OUT / "03_conversation.png")
click(hwnd, *TAB_PROPOSALS, wait=2.0)
grab(hwnd, OUT / "04_proposals.png")
click(hwnd, *TAB_TRAJECTORY, wait=2.5)
grab(hwnd, OUT / "05_trajectory.png")
