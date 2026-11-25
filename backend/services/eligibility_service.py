"""
services/eligibility_service.py

Who may join a competition, and with which team — from the rules the organizer
set in Create Competition. One module, used by the join-options endpoint (what
the join dialog shows), by /join and /join-team (what is enforced) and when an
organizer approves a manual join request (re-checked, since teams change).

Rules read from the competition:
  min_members / max_members   required team size (set them equal for an exact size;
                              min > 1 means individuals cannot join)
  required_skills             skills the competition requires
  task_config.team_requirements.skill_members
                              {skill: N | "all"} — how many team members must have
                              each skill: 1 = at least one member (the default),
                              N = at least N members, "all" = every member
  max_teams                   capacity (a team or an individual each take one place)
  join_method                 "auto" accepts on eligibility, "manual" sends a request
                              to the organizer (applied by the caller)

Pure functions: no DB, no HTTP.
"""

import json
from typing import Any, Optional


def _skill_list(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        items = raw
    else:
        try:
            items = json.loads(raw)
        except (TypeError, ValueError):
            return []
    return [str(s).strip() for s in items if str(s).strip()] if isinstance(items, list) else []


def _key(skill: str) -> str:
    return skill.strip().lower()


def _positive(v) -> Optional[int]:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def read_rules(competition, task_config: Optional[dict]) -> dict:
    min_m, max_m = _positive(competition.min_members), _positive(competition.max_members)
    skills = _skill_list(competition.required_skills)
    configured = ((task_config or {}).get("team_requirements") or {}).get("skill_members") or {}

    skill_rules = []
    for s in skills:
        raw = configured.get(s, 1)
        members: Any = "all" if raw == "all" else (_positive(raw) or 1)
        skill_rules.append({"skill": s, "members": members})

    return {
        "min_members": min_m,
        "max_members": max_m,
        "requires_team": bool(min_m and min_m > 1),
        "allows_team": max_m is None or max_m > 1,
        "allows_individual": not (min_m and min_m > 1),
        "required_skills": skills,
        "skill_rules": skill_rules,
        "max_teams": _positive(competition.max_teams),
        "join_method": competition.join_method or "auto",
    }


def team_size_text(rules: dict) -> Optional[str]:
    lo, hi = rules["min_members"], rules["max_members"]
    if lo and hi and lo == hi:
        return f"exactly {lo} members"
    if lo and hi:
        return f"{lo}–{hi} members"
    if lo:
        return f"at least {lo} members"
    if hi:
        return f"at most {hi} members"
    return None


def skill_rule_text(rule: dict) -> str:
    m = rule["members"]
    if m == "all":
        return f"Every member needs {rule['skill']}"
    if m == 1:
        return f"At least one member needs {rule['skill']}"
    return f"At least {m} members need {rule['skill']}"


def describe_rules(rules: dict) -> dict:
    """The rules in a shape the join dialog / details page can show directly."""
    return {
        "team_size": team_size_text(rules),
        "min_members": rules["min_members"],
        "max_members": rules["max_members"],
        "requires_team": rules["requires_team"],
        "allows_individual": rules["allows_individual"],
        "allows_team": rules["allows_team"],
        "skills": [{"skill": r["skill"], "members": r["members"], "text": skill_rule_text(r)}
                   for r in rules["skill_rules"]],
        "max_teams": rules["max_teams"],
        "join_method": rules["join_method"],
    }


def check_individual(rules: dict, user_skills: list[str]) -> list[str]:
    """Reasons this person cannot join on their own (empty list = eligible)."""
    reasons = []
    if not rules["allows_individual"]:
        reasons.append(f"This competition requires teams of {team_size_text(rules)}.")
    have = {_key(s) for s in user_skills}
    missing = [s for s in rules["required_skills"] if _key(s) not in have]
    if missing:
        reasons.append(f"Missing required skill(s): {', '.join(sorted(missing))}.")
    return reasons


def check_team(rules: dict, members: list[dict]) -> list[str]:
    """
    Reasons this team cannot join (empty list = eligible).
    members: [{"user_id", "name", "skills": [str]}]
    """
    reasons = []
    n = len(members)

    if not rules["allows_team"]:
        reasons.append("This competition is for individuals only.")

    lo, hi = rules["min_members"], rules["max_members"]
    if (lo and n < lo) or (hi and n > hi):
        reasons.append(f"Team size must be {team_size_text(rules)} (this team has {n}).")

    for r in rules["skill_rules"]:
        k = _key(r["skill"])
        have = [m for m in members if k in {_key(s) for s in m.get("skills", [])}]
        if r["members"] == "all":
            lacking = [m.get("name") or m["user_id"] for m in members if m not in have]
            if lacking:
                reasons.append(f"Every member needs {r['skill']} (missing: {', '.join(lacking)}).")
        elif len(have) < r["members"]:
            reasons.append(f"{skill_rule_text(r)} (this team has {len(have)}).")

    return reasons