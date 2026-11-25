"""
services/phase_access.py

Phases decide WHICH PAGES participants may open while the competition is in a
given stage.  The organizer defines the phases in CreateCompetition; each phase
is stored inside Competition.dataset_config (task_config) as:

    {
      "id": 1, "order": 1,
      "name": "Data Collection",            # free text chosen by the organizer
      "description": "Record and label ...", # shown to members on locked pages
      "durationDays": 14,
      "allowedPages": ["data-collection", "data-annotation", "documentation"]
    }

The current phase is derived from the dates: phase 1 starts on start_date,
each next phase starts when the previous one ends (durationDays).  After the
last phase has ended the last phase's rules stay in force until the
competition ends.

Organizers are never locked out.  Competitions without phases, and phases saved
before `allowedPages` existed (key missing), keep every page open.
"""

import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import Competition

# keys == the `path` of the items in CompetitionSidebar.jsx
PAGE_KEYS = [
    "data-collection",
    "data-annotation",
    "team-dataset",
    "dataset-hub",
    "experiments",
    "experiment-registry",
    "leaderboard",
    "documentation",
    "support",
]
PAGE_LABELS = {
    "data-collection": "Data Collection",
    "data-annotation": "Annotation",
    "team-dataset": "Dataset",
    "dataset-hub": "Validation",
    "experiments": "Workspace",
    "experiment-registry": "Experiments",
    "leaderboard": "Leaderboard",
    "documentation": "Documentation",
    "support": "Support",
}
ALWAYS_OPEN = {"support"}   # a locked member must still be able to ask for help


def _parse_date(value) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _task_config(competition: Competition) -> dict:
    try:
        cfg = json.loads(competition.dataset_config or "{}")
        return cfg if isinstance(cfg, dict) else {}
    except (TypeError, ValueError):
        return {}


def _allowed(phase: dict):
    """None = every page (legacy phase), otherwise the list of page keys."""
    raw = phase.get("allowedPages", phase.get("allowed_pages"))
    if raw is None:
        return None
    return [k for k in raw if k in PAGE_KEYS]


def phase_state(competition: Competition, today: Optional[date] = None) -> dict:
    today = today or date.today()
    cfg = _task_config(competition)
    phases = cfg.get("phases") or []

    if not cfg.get("phases_enabled") or not phases:
        return {"enabled": False, "state": "disabled", "current": None,
                "allowed_pages": None, "phases": [], "starts_on": competition.start_date}

    start = _parse_date(competition.start_date)
    cursor = start
    out = []
    for i, p in enumerate(sorted(phases, key=lambda x: x.get("order", 0) or 0)):
        days = max(int(p.get("durationDays") or 1), 1)
        begins = cursor
        ends = (cursor + timedelta(days=days - 1)) if cursor else None
        cursor = (ends + timedelta(days=1)) if ends else None
        out.append({
            "id": p.get("id"),
            "order": i + 1,
            "name": p.get("name") or f"Phase {i + 1}",
            "description": p.get("description") or "",
            "duration_days": days,
            "starts_on": begins.isoformat() if begins else None,
            "ends_on": ends.isoformat() if ends else None,
            "allowed_pages": _allowed(p),
            "status": "upcoming",
        })

    state, current_idx = "active", 0
    if start and today < start:
        state, current_idx = "not_started", None
    elif start:
        current_idx = len(out) - 1                 # after the last phase: keep its rules
        for i, ph in enumerate(out):
            if ph["ends_on"] and today <= _parse_date(ph["ends_on"]):
                current_idx = i
                break

    for i, ph in enumerate(out):
        if current_idx is None:
            ph["status"] = "upcoming"
        elif i < current_idx:
            ph["status"] = "done"
        elif i == current_idx:
            ph["status"] = "current"

    current = out[current_idx] if current_idx is not None else None
    return {
        "enabled": True,
        "state": state,                            # "not_started" | "active"
        "starts_on": competition.start_date,
        "current": current,
        "allowed_pages": ([] if current is None else current["allowed_pages"]),
        "phases": out,
    }


def page_is_open(state: dict, page_key: str) -> bool:
    if not state.get("enabled") or page_key in ALWAYS_OPEN:
        return True
    allowed = state.get("allowed_pages")
    return allowed is None or page_key in allowed


def assert_page_open(db: Session, competition_id: str, page_key: str):
    """403 when a PARTICIPANT calls an endpoint of a page that's locked in the current phase."""
    comp = db.query(Competition).filter(Competition.id == competition_id).first()
    if not comp:
        return
    st = phase_state(comp)
    if page_is_open(st, page_key):
        return
    cur = st.get("current")
    if cur:
        msg = f'"{PAGE_LABELS.get(page_key, page_key)}" is locked during the phase "{cur["name"]}".'
    else:
        msg = "This competition has not started yet."
    raise HTTPException(status_code=403, detail=msg)


def enforce_page(db: Session, competition_id: str, user_id, page_key: str):
    """
    Same 403 as assert_page_open, but organizers always pass. Use it in endpoints that don't go
    through resolve_scope (legacy sample endpoints, leaderboard) so they honour phase locks too.
    """
    from models import CompetitionOrganizer
    is_org = db.query(CompetitionOrganizer.id).filter(
        CompetitionOrganizer.competition_id == competition_id,
        CompetitionOrganizer.user_id == str(user_id)).first() is not None
    if not is_org:
        assert_page_open(db, competition_id, page_key)