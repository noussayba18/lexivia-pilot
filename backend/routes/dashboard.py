"""Personal dashboard. Counts describe the authenticated user's work only."""
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from models import (Competition, CompetitionOrganizer, CompetitionParticipant,
                    CompetitionTask, CompetitionJoinRequest, Sample, SampleAssignment)
from models_teams import TeamInvitation, Team
from .utils import get_db, get_current_user

router = APIRouter(tags=["dashboard"])
BLOCKED = {"pending", "rejected", "removed", "left", "banned"}


def parse_date(value):
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except (ValueError, TypeError):
        return None


def status_of(comp):
    today = datetime.now(timezone.utc).date()
    start, end = parse_date(comp.start_date), parse_date(comp.end_date)
    if comp.is_draft:
        return "DRAFT"
    if end and today > end:
        return "CLOSED"
    if start and today < start:
        return "UPCOMING"
    return "OPEN"


def overview(db, uid):
    organized = {r.competition_id for r in db.query(CompetitionOrganizer).filter_by(user_id=uid).all()}
    joined = {r.competition_id for r in db.query(CompetitionParticipant).filter_by(user_id=uid).all()
              if (r.status or "joined").lower() not in BLOCKED}
    ids = organized | joined
    comps = db.query(Competition).filter(Competition.id.in_(ids)).all() if ids else []
    comps = [c for c in comps if not c.is_draft or c.id in organized]
    tasks = {}
    if ids:
        for t in db.query(CompetitionTask).filter(CompetitionTask.competition_id.in_(ids)).order_by(CompetitionTask.position).all():
            tasks.setdefault(t.competition_id, []).append(t.name or t.type)
    rows = []
    for c in comps:
        organizer = c.id in organized
        rows.append({"id": c.id, "title": c.title, "status": status_of(c),
                     "role": "Organizer" if organizer else "Participant",
                     "tasks": tasks.get(c.id, []), "end_date": c.end_date,
                     "start_date": c.start_date,
                     "href": f"/edit-competition/{c.id}" if c.is_draft else
                     f"/competitions/{c.id}/organizer" if organizer else f"/competitions/{c.id}"})
    order = {"OPEN": 0, "UPCOMING": 1, "DRAFT": 2, "CLOSED": 3}
    rows.sort(key=lambda r: (order[r["status"]], parse_date(r["end_date"]) or date.max, r["title"].lower()))
    now = datetime.now(timezone.utc)
    actions = []
    # Pending requests are grouped by competition, with no private requester data.
    if organized:
        pending = db.query(CompetitionJoinRequest.competition_id, func.count(CompetitionJoinRequest.id)).filter(
            CompetitionJoinRequest.competition_id.in_(organized), CompetitionJoinRequest.status == "pending").group_by(CompetitionJoinRequest.competition_id).all()
        by_id = {r["id"]: r for r in rows}
        for cid, count in pending:
            if cid in by_id:
                actions.append({"id": f"requests-{cid}", "title": f"{count} join request{'s' if count != 1 else ''} to review",
                                "detail": by_id[cid]["title"], "href": by_id[cid]["href"]})
    for inv, team in db.query(TeamInvitation, Team).join(Team, Team.id == TeamInvitation.team_id).filter(
            TeamInvitation.receiver_id == uid, TeamInvitation.status == "pending").all():
        actions.append({"id": f"invitation-{inv.id}", "title": "Team invitation", "detail": team.name,
                        "href": f"/teams/{team.id}"})
    for a in db.query(SampleAssignment).filter(SampleAssignment.annotator_id == uid,
                                              SampleAssignment.status == "ASSIGNED",
                                              SampleAssignment.competition_id.in_(ids)).all() if ids else []:
        try:
            expiry = datetime.fromisoformat(a.expires_at.replace("Z", "+00:00")) if a.expires_at else None
            if expiry and expiry.replace(tzinfo=expiry.tzinfo or timezone.utc) <= now:
                continue
        except ValueError:
            continue
        row = next((r for r in rows if r["id"] == a.competition_id), None)
        if row and row["status"] == "OPEN":
            actions.append({"id": f"assignment-{a.id}", "title": "Continue annotation", "detail": row["title"],
                            "href": f"/competitions/{a.competition_id}/data-annotation"})
    deadlines = [dict(r, days_left=(parse_date(r["end_date"]) - now.date()).days)
                 for r in rows if r["status"] in {"OPEN", "UPCOMING"} and parse_date(r["end_date"])
                 and 0 <= (parse_date(r["end_date"]) - now.date()).days <= 14]
    deadlines.sort(key=lambda r: r["days_left"])
    return {"stats": {"active": sum(r["status"] == "OPEN" for r in rows),
                      "drafts": sum(r["status"] == "DRAFT" for r in rows),
                      "samples": db.query(Sample).join(Competition, Competition.id == Sample.competition_id).filter(Sample.contributor_id == uid).count(),
                      "annotations": db.query(SampleAssignment).join(Competition, Competition.id == SampleAssignment.competition_id).filter(
                          SampleAssignment.annotator_id == uid, SampleAssignment.status == "COMPLETED").count()},
            "competitions": rows, "actions": actions, "deadlines": deadlines,
            "generated_at": now.isoformat()}


@router.get("/dashboard/overview")
def get_overview(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return overview(db, str(current_user.id))


# Compatibility for older clients; access is restricted to the logged-in user.
@router.get("/dashboard/stats/{user_id}")
def get_dashboard_stats(user_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if user_id != str(current_user.id):
        raise HTTPException(403, "You can only view your own dashboard")
    rows = overview(db, user_id)["competitions"]
    from models_teams import TeamMember
    return {"user_id": user_id, "organized_competitions": sum(r["role"] == "Organizer" and r["status"] != "DRAFT" for r in rows),
            "joined_competitions": db.query(CompetitionParticipant.competition_id).join(Competition, Competition.id == CompetitionParticipant.competition_id).filter(
                CompetitionParticipant.user_id == user_id, Competition.is_draft.is_(False),
                func.lower(func.coalesce(CompetitionParticipant.status, "joined")).notin_(BLOCKED)).distinct().count(),
            "teams_joined": db.query(TeamMember.team_id).filter_by(user_id=user_id).distinct().count()}


@router.get("/dashboard/recent/{user_id}")
def get_recent_competitions(user_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if user_id != str(current_user.id):
        raise HTTPException(403, "You can only view your own dashboard")
    return [{"id": r["id"], "competition_id": r["id"], "title": r["title"], "type": "GENERAL",
             "status": r["status"], "role": r["role"].upper(), "score": "--", "sync": ""}
            for r in overview(db, user_id)["competitions"] if r["status"] != "DRAFT"][:10]
