"""
services/participant_scope.py

One participant = one SCOPE: a team (every member shares it) or a solo user.
Everything a participant produces or sees inside a competition -- contributed
samples, annotation pool, statistics, dataset versions, experiment workspaces,
runs, submissions -- is tagged with a `scope_key` and filtered by it, so a team
only ever reaches its own data. Organizers are the only role that can look
across scopes.

    scope_key  "team:<team_id>"  members of that team (competition_participants.team_id)
               "user:<user_id>"  a solo participant
               "organizer"       things the organizers contributed themselves

Pure DB helpers, no HTTP routes. Import and use in every route that reads or
writes participant data:

    scope = resolve_scope(db, competition_id, user_id)          # 403 if not a participant
    q = apply_scope(db.query(Sample).filter(...), Sample, scope)  # read side
    Sample(..., scope_key=scope.write_key)                        # write side
    assert_same_scope(scope, row.scope_key)                       # single-row access (404 on mismatch)
"""

from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import CompetitionOrganizer, CompetitionParticipant, UserProfile

BLOCKED_STATUSES = {"pending", "rejected", "removed", "left", "banned"}
ORGANIZER_KEY = "organizer"


def team_key(team_id) -> str:
    return f"team:{team_id}"


def user_key(user_id) -> str:
    return f"user:{user_id}"


@dataclass(frozen=True)
class Scope:
    kind: str                       # "team" | "solo" | "organizer"
    key: Optional[str]              # filter key; None = organizer looking at everything
    member_ids: tuple = ()
    team_id: Optional[str] = None

    @property
    def is_organizer(self) -> bool:
        return self.kind == "organizer"

    @property
    def write_key(self) -> str:
        """Key to stamp on rows this user creates."""
        return self.key or ORGANIZER_KEY


def _active_participants(db: Session, competition_id: str):
    return [p for p in db.query(CompetitionParticipant)
            .filter(CompetitionParticipant.competition_id == competition_id).all()
            if (p.status or "joined").lower() not in BLOCKED_STATUSES]


def members_of(db: Session, competition_id: str, key: Optional[str]) -> tuple:
    """User ids that belong to a scope key."""
    if not key:
        return ()
    if key.startswith("user:"):
        return (key[len("user:"):],)
    if key.startswith("team:"):
        tid = key[len("team:"):]
        return tuple(str(p.user_id) for p in _active_participants(db, competition_id)
                     if p.team_id and str(p.team_id) == tid)
    return ()


def resolve_scope(db: Session, competition_id: str, user_id: str,
                  requested: Optional[str] = None, page: Optional[str] = None) -> Scope:
    """
    The caller's scope in this competition.
      participant -> their own team/solo scope (`requested` is ignored: nobody can
                     ask for somebody else's view)
      organizer   -> all scopes, or one scope when `requested` is given
      otherwise   -> 403
    `page` (sidebar key, e.g. "data-collection"): when given, a participant gets 403 if
    that page is locked in the competition's current phase (see services/phase_access.py).
    Organizers are never blocked.
    """
    user_id = str(user_id)

    is_org = db.query(CompetitionOrganizer.id).filter(
        CompetitionOrganizer.competition_id == competition_id,
        CompetitionOrganizer.user_id == user_id).first() is not None
    if is_org:
        key = (requested or "").strip() or None
        return Scope("organizer", key, members_of(db, competition_id, key))

    part = db.query(CompetitionParticipant).filter(
        CompetitionParticipant.competition_id == competition_id,
        CompetitionParticipant.user_id == user_id).first()
    if not part or (part.status or "joined").lower() in BLOCKED_STATUSES:
        raise HTTPException(status_code=403, detail="Join this competition to access it")

    if page:
        from services.phase_access import assert_page_open
        assert_page_open(db, competition_id, page)

    if part.team_id:
        key = team_key(part.team_id)
        return Scope("team", key, members_of(db, competition_id, key), str(part.team_id))
    return Scope("solo", user_key(user_id), (user_id,))


def apply_scope(query, model, scope: Scope):
    """Restrict a query on any model that has a `scope_key` column."""
    return query if scope.key is None else query.filter(model.scope_key == scope.key)


def assert_same_scope(scope: Scope, row_scope_key: Optional[str]):
    """Guard for single-row access. 404 (not 403) so other teams can't probe ids."""
    if scope.key is None:                       # organizer, unrestricted
        return
    if row_scope_key != scope.key:
        raise HTTPException(status_code=404, detail="Not found")


def scope_key_for_user(db: Session, competition_id: str, user_id: str) -> str:
    """Key to stamp on a new row for this user (used by background jobs / backfills)."""
    return resolve_scope(db, competition_id, user_id).write_key


def describe_scope(db: Session, scope: Scope) -> dict:
    """Small summary the UI can show: 'Team Alpha · 3 members' or 'Solo'."""
    name = None
    if scope.team_id:
        try:
            from models_teams import Team
            t = db.query(Team).filter(Team.id == int(scope.team_id)).first()
            name = t.name if t else None
        except (ValueError, TypeError):
            pass
    return {"kind": scope.kind, "team_id": scope.team_id, "team_name": name,
            "size": len(scope.member_ids), "key": scope.key}


def member_names(db: Session, user_ids) -> dict:
    ids = [str(i) for i in user_ids]
    if not ids:
        return {}
    return {p.user_id: p.full_name for p in
            db.query(UserProfile).filter(UserProfile.user_id.in_(ids))}


# ── workspaces / modeling ────────────────────────────────────────────────────
# A team shares ONE workspace (files, Jupyter container, runs, model artifacts).
# Solo participants and organizers keep their personal workspace, with the same
# folder name as before, so nothing existing has to move.

def workspace_owner(scope: Scope, user_id) -> str:
    """Folder / container / storage identity of the workspace this user works in."""
    return f"team-{scope.team_id}" if scope.kind == "team" else str(user_id)


def workspace_scope_key(scope: Scope, user_id) -> str:
    """scope_key for ExperimentWorkspace / ExperimentRun / Submission rows."""
    return scope.key if scope.kind != "organizer" else user_key(user_id)


# ── legacy tables without a scope_key (DataSample) ───────────────────────────
# DataSample only records who contributed it, so its scope is "contributed by a member".

def contributor_in_scope(scope: Scope, contributor_id) -> bool:
    return scope.key is None or str(contributor_id) in set(scope.member_ids)


def apply_member_scope(query, contributor_col, scope: Scope):
    """Restrict a query on a model with a contributor column (e.g. DataSample.contributor_id)."""
    if scope.key is None:
        return query
    return query.filter(contributor_col.in_(list(scope.member_ids) or [""]))


def scope_sizes(db: Session, competition_id: str) -> dict:
    """{scope_key: number of active members} for every team / solo participant of a competition."""
    sizes: dict = {}
    for p in _active_participants(db, competition_id):
        k = team_key(p.team_id) if p.team_id else user_key(p.user_id)
        sizes[k] = sizes.get(k, 0) + 1
    return sizes