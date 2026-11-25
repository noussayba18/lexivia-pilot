"""
routes/annotation.py — the Data Annotation workflow

    Data Collection → Samples → Data Annotation → automatic assignment
        → independent annotations → conflict detection
        → one extra annotator when needed → completed sample

  GET  /competitions/{id}/annotation/next                 hand the annotator a sample (or resume theirs)
  POST /competitions/{id}/annotation/{assignment}/submit  save answers (partial is fine)
  GET  /competitions/{id}/annotation/stats                progress, conflicts, per-annotator numbers
  GET  /competitions/{id}/annotation/mine                 the samples I annotated, with my current answers
  PUT  /competitions/{id}/annotation/revise/{sample_id}   change my own answers (while the competition is open)

Every rule lives in services/annotation_service.py. The number of annotators per
sample is the organizer's value from Competition Creation
(data_collection.annotators_per_instance): read here, never set here.

Sample statuses are derived from the annotations on every request, so they can
never drift out of sync with the data.
"""

from collections import defaultdict
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    Annotation, Competition, CompetitionOrganizer, CompetitionParticipant,
    Sample, SampleAsset, SampleAssignment, UserProfile,
)
from supabase_client import supabase
from services.annotation_service import (
    ASSIGNED, COMPLETE_ROW, COMPLETED, CONFLICT, CONFLICT_RESOLUTION, NOT_STARTED, PARTIAL,
    PARTIAL_ROW, RESOLUTION, S_COMPLETED, S_PARTIAL, SKIPPED, SUBMITTED, ValueError_,
    capacity_left, evaluate_sample, lease_expiry, normalize_value, open_tasks_for, priority,
    read_settings,
)
from services.participant_scope import apply_scope, describe_scope, resolve_scope
from services.structure_service import load_structure
from services.task_registry import ASSET_TYPES, TASK_TYPES
from .utils import get_current_user, get_db

router = APIRouter(tags=["annotation"])

_BLOCKED_PARTICIPANT = {"pending", "rejected", "removed", "left", "banned"}


def _is_closed(comp) -> bool:
    """CLOSED = not a draft and the end date has passed (same rule as the dashboard and the dataset hub)."""
    if comp.is_draft or not comp.end_date:
        return False
    v = comp.end_date
    try:
        if isinstance(v, datetime):
            end = v.date()
        elif isinstance(v, date):
            end = v
        else:
            end = datetime.fromisoformat(str(v).strip().replace("Z", "+00:00")).date()
    except ValueError:
        return False
    return date.today() > end


# ─────────────────────────────────────────────────────────────────────────────
# Loading
# ─────────────────────────────────────────────────────────────────────────────

class _Ctx:
    """Everything needed to evaluate a competition's samples."""

    def __init__(self, db: Session, competition_id: str, user_id: str, view: Optional[str] = None,
                 page: Optional[str] = "data-annotation"):
        self.now = datetime.utcnow()
        self.user_id = user_id
        self.comp = db.query(Competition).filter(Competition.id == competition_id).first()
        if not self.comp:
            raise HTTPException(status_code=404, detail="Competition not found")
        if self.comp.is_draft:
            raise HTTPException(status_code=400, detail="This competition is not open yet")

        # A team (or solo participant) only ever sees its own samples. Organizers see all of
        # them, or one team's when `view` is passed.
        self.scope = resolve_scope(db, competition_id, user_id, requested=view, page=page)
        self.is_organizer = self.scope.is_organizer

        self.settings = read_settings(self.comp.dataset_config)
        # Safety net for competitions created before the team-size rule (or teams that shrank):
        # a team can never be asked for more independent annotators than it has members.
        if (not self.scope.is_organizer and self.settings.get("required_annotators")
                and len(self.scope.member_ids) >= 1):
            self.settings = {**self.settings,
                             "required_annotators": min(self.settings["required_annotators"], len(self.scope.member_ids))}
        self.structure = load_structure(db, competition_id)
        self.tasks = self.structure["tasks"]
        self.task_by_key = {t["key"]: t for t in self.tasks}
        self.task_key_by_id = {t["id"]: t["key"] for t in self.tasks}

    @property
    def configured(self) -> bool:
        return self.settings["required_annotators"] is not None and bool(self.tasks)

    def load_samples(self, db: Session, competition_id: str):
        sq = apply_scope(db.query(Sample).filter(Sample.competition_id == competition_id),
                         Sample, self.scope)
        self.samples = sq.order_by(Sample.submitted_at, Sample.id).all()
        ids = [s.id for s in self.samples] or [""]
        rows = db.query(Annotation).filter(Annotation.sample_id.in_(ids)).all()
        self.rows = defaultdict(list)
        for r in rows:
            self.rows[r.sample_id].append({
                "task_key": self.task_key_by_id.get(r.task_id), "annotator_id": r.annotator_id,
                "value": r.value, "status": r.status, "created_at": r.created_at,
            })
        self.assignments = defaultdict(list)
        for a in db.query(SampleAssignment).filter(SampleAssignment.sample_id.in_(ids)):
            self.assignments[a.sample_id].append({
                "id": a.id, "annotator_id": a.annotator_id, "status": a.status, "role": a.role,
                "expires_at": a.expires_at, "task_keys": a.task_keys or [],
            })
        R = self.settings["required_annotators"]
        self.evals = {s.id: evaluate_sample(self.tasks, self.rows[s.id], self.assignments[s.id], R, self.now)
                      for s in self.samples}
        self.number = {s.id: i + 1 for i, s in enumerate(self.samples)}


def _audio_url(path: str):
    try:
        res = supabase.storage.from_("audio-samples").create_signed_url(path, 3600)
    except Exception:
        return None
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
    return getattr(res, "signed_url", None) or getattr(res, "signedURL", None)


def _summary(shape: str, value: dict) -> str:
    if shape == "labels":
        return ", ".join(value.get("labels", []))
    if shape == "spans":
        n = len(value.get("spans", []))
        return "No spans" if value.get("none") else f"{n} span{'s' if n != 1 else ''}"
    if shape == "qa":
        return f"Q: {value.get('question', '')} — A: {value.get('answer', '')}"
    return value.get("text", "")


def _assets_payload(db: Session, ctx: _Ctx, sample: Sample) -> list:
    comp_by_id = {a["id"]: a for a in ctx.structure["assets"]}
    assets = []
    for sa in db.query(SampleAsset).filter(SampleAsset.sample_id == sample.id):
        c = comp_by_id.get(sa.component_id)
        if not c:
            continue
        assets.append({
            "key": c["key"], "name": c["name"], "type": c["type"],
            "kind": ASSET_TYPES.get(c["type"], {}).get("kind", c["type"].lower()),
            "constraints": c["constraints"], "position": c["position"],
            "text": sa.text_content,
            "audio_url": _audio_url(sa.storage_path) if sa.storage_path else None,
            "duration": sa.duration_seconds,
        })
    assets.sort(key=lambda a: a["position"])
    return assets


def _task_payload(t: dict, ev: dict) -> dict:
    return {
        "key": t["key"], "name": t["name"], "type": t["type"], "config": t["config"],
        "instructions": t["instructions"], "answer": TASK_TYPES[t["type"]]["answer"],
        "target": t["target"], "depends_on": t["depends_on"],
        "conflict": t["key"] in ev["conflicted"],
    }


def _payload(db: Session, ctx: _Ctx, sample: Sample, assignment: SampleAssignment) -> dict:
    ev = ctx.evals[sample.id]
    keys = list(assignment.task_keys or [])

    assets = _assets_payload(db, ctx, sample)
    tasks = [_task_payload(t, ev) for t in sorted(ctx.tasks, key=lambda t: t["position"]) if t["key"] in keys]

    conflicts = []
    if assignment.role == RESOLUTION:
        # Previous results are shown for the conflicted tasks only, and annotators are
        # anonymous ("Annotator A…") — real names are visible to organizers only.
        letters: dict[str, str] = {}
        for r in sorted(ctx.rows[sample.id], key=lambda r: (r["created_at"] or "", r["annotator_id"])):
            if r["annotator_id"] not in letters:
                letters[r["annotator_id"]] = chr(ord("A") + len(letters) % 26)
        names = {}
        if ctx.is_organizer and letters:
            names = {p.user_id: p.full_name for p in
                     db.query(UserProfile).filter(UserProfile.user_id.in_(list(letters)))}
        for key in ev["conflicted"]:
            if key not in keys:
                continue
            t = ctx.task_by_key[key]
            shape = TASK_TYPES[t["type"]]["answer"]
            results = [{
                "annotator": f"Annotator {letters[r['annotator_id']]}",
                "name": names.get(r["annotator_id"]),
                "value": r["value"], "summary": _summary(shape, r["value"]),
            } for r in sorted(ctx.rows[sample.id], key=lambda r: (r["created_at"] or "", r["annotator_id"]))
                if r["task_key"] == key and r["status"] == COMPLETE_ROW]
            conflicts.append({"task_key": key, "task_name": t["name"], "answer": shape, "results": results})

    return {
        "state": "assigned",
        "assignment_id": assignment.id,
        "mode": assignment.role,
        "required_annotators": ctx.settings["required_annotators"],
        "lease_expires_at": assignment.expires_at,
        "sample": {
            "id": sample.id, "number": ctx.number[sample.id], "status": ev["status"],
            "annotators_so_far": len({r["annotator_id"] for r in ctx.rows[sample.id]}),
            "assets": assets,
        },
        "tasks": tasks,
        "tasks_already_covered": len(ctx.tasks) - len(tasks),
        "conflicts": conflicts,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET next — automatic assignment
# ─────────────────────────────────────────────────────────────────────────────

def _not_ready(ctx: _Ctx):
    if ctx.settings["required_annotators"] is None:
        return {"state": "not_configured",
                "message": "The organizer hasn't set the number of annotators per sample for this competition."}
    if not ctx.tasks:
        return {"state": "no_tasks", "message": "This competition has no annotation tasks defined."}
    return None


@router.get("/competitions/{competition_id}/annotation/next")
def next_sample(competition_id: str, view: Optional[str] = None, db: Session = Depends(get_db),
                current_user=Depends(get_current_user)):
    uid = str(current_user.id)
    ctx = _Ctx(db, competition_id, uid, view)
    blocked = _not_ready(ctx)
    if blocked:
        return blocked

    # release expired reservations so those samples go back into the pool
    db.query(SampleAssignment).filter(
        SampleAssignment.competition_id == competition_id,
        SampleAssignment.status == ASSIGNED,
        SampleAssignment.expires_at < ctx.now.isoformat(),
    ).delete(synchronize_session=False)
    db.commit()

    for _ in range(3):                       # retry if two requests race for the same sample
        ctx.load_samples(db, competition_id)
        by_id = {s.id: s for s in ctx.samples}

        mine = (db.query(SampleAssignment).filter(
            SampleAssignment.competition_id == competition_id,
            SampleAssignment.annotator_id == uid, SampleAssignment.status == ASSIGNED).first())
        if mine and mine.sample_id in by_id:                      # resume where they left off
            mine.expires_at = lease_expiry(ctx.now)
            db.commit()
            return _payload(db, ctx, by_id[mine.sample_id], mine)

        candidates = []
        for idx, s in enumerate(ctx.samples):
            if any(a["annotator_id"] == uid for a in ctx.assignments[s.id]):
                continue                                          # one submission per annotator per sample
            ev = ctx.evals[s.id]
            keys, role = open_tasks_for(ctx.tasks, ev, uid, ctx.settings["adjudication"])
            if keys and capacity_left(ctx.tasks, ev, keys, uid, ctx.now):
                candidates.append((priority(ev), idx, s, keys, role))
        if not candidates:
            return {"state": "empty", "message": "No samples are available for you right now."}

        _, _, sample, keys, role = min(candidates, key=lambda c: (c[0], c[1]))
        assignment = SampleAssignment(
            competition_id=competition_id, sample_id=sample.id, annotator_id=uid, status=ASSIGNED,
            role=role, task_keys=keys, expires_at=lease_expiry(ctx.now),
        )
        db.add(assignment)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        ctx.assignments[sample.id].append({
            "id": assignment.id, "annotator_id": uid, "status": ASSIGNED, "role": role,
            "expires_at": assignment.expires_at, "task_keys": keys})
        return _payload(db, ctx, sample, assignment)

    return {"state": "empty", "message": "No samples are available for you right now."}


# ─────────────────────────────────────────────────────────────────────────────
# POST submit — partial answers are fine
# ─────────────────────────────────────────────────────────────────────────────

class SubmitIn(BaseModel):
    values: dict[str, Any] = {}          # {task_key: answer} — omit or leave empty what you didn't do


def _validate_answers(db: Session, ctx: _Ctx, sample_id: str, keys: list, values: dict, known: Optional[dict] = None):
    """
    Normalise + validate one annotator's answers for `keys` on a sample.
    known: {task_key: (value, is_complete)} answers already stored (a revision that touches only
           a dependent task still sees its producer's saved output).
    Returns (normalized, complete, errors).
    """
    known = known or {}
    # context for each task's target (text length / audio duration for span bounds)
    comp_by_id = {c["id"]: c for c in ctx.structure["assets"]}
    asset_by_key = {}
    for sa in db.query(SampleAsset).filter(SampleAsset.sample_id == sample_id):
        c = comp_by_id.get(sa.component_id)
        if c:
            asset_by_key[c["key"]] = (c, sa)

    normalized: dict[str, dict] = {}
    complete: dict[str, bool] = {}
    errors: dict[str, str] = {}

    def producer(ref):
        if ref in normalized:
            return normalized.get(ref), complete.get(ref)
        v, ok = known.get(ref, (None, False))
        return v, ok

    for t in sorted(ctx.tasks, key=lambda t: t["position"]):
        if t["key"] not in keys:
            continue
        tgt = t["target"]
        tctx = {"target_kind": "sample", "target_text": None, "target_duration": None}
        if tgt["type"] == "ASSET" and tgt["ref"] in asset_by_key:
            c, sa = asset_by_key[tgt["ref"]]
            tctx = {"target_kind": ASSET_TYPES.get(c["type"], {}).get("kind"),
                    "target_text": sa.text_content, "target_duration": sa.duration_seconds}
        elif tgt["type"] == "TASK_OUTPUT":
            tctx["target_kind"] = "text"
            prod, prod_ok = producer(tgt["ref"])
            if prod and prod_ok:
                tctx["target_text"] = prod.get("text")
        try:
            value, ok = normalize_value(t["type"], t["config"], values.get(t["key"]), tctx)
        except ValueError_ as e:
            errors[t["key"]] = f"{t['name']}: {e}"
            continue
        if value is None:
            continue
        if tgt["type"] == "TASK_OUTPUT" and not producer(tgt["ref"])[1]:
            errors[t["key"]] = f"{t['name']}: complete '{ctx.task_by_key[tgt['ref']]['name']}' first."
            continue
        normalized[t["key"]], complete[t["key"]] = value, ok
    return normalized, complete, errors


@router.post("/competitions/{competition_id}/annotation/{assignment_id}/submit")
def submit(competition_id: str, assignment_id: str, body: SubmitIn,
           db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    uid = str(current_user.id)
    ctx = _Ctx(db, competition_id, uid)
    blocked = _not_ready(ctx)
    if blocked:
        raise HTTPException(status_code=400, detail=blocked["message"])

    a = (db.query(SampleAssignment).filter(
        SampleAssignment.id == assignment_id, SampleAssignment.competition_id == competition_id,
        SampleAssignment.annotator_id == uid).first())
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if a.status != ASSIGNED:
        raise HTTPException(status_code=409, detail="This sample was already submitted")
    in_scope = apply_scope(db.query(Sample.id).filter(Sample.id == a.sample_id), Sample, ctx.scope).first()
    if not in_scope:
        raise HTTPException(status_code=404, detail="Assignment not found")

    keys = list(a.task_keys or [])
    extra = [k for k in body.values if k not in keys]
    if extra:
        raise HTTPException(status_code=422, detail={"errors": {"_form": "Unexpected task in submission."}})

    normalized, complete, errors = _validate_answers(db, ctx, a.sample_id, keys, body.values)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors, "message": "Some answers are not valid."})

    now_iso = ctx.now.isoformat()
    for key, value in normalized.items():
        db.add(Annotation(
            sample_id=a.sample_id, task_id=ctx.task_by_key[key]["id"], annotator_id=uid,
            value=value, status=COMPLETE_ROW if complete[key] else PARTIAL_ROW, created_at=now_iso,
        ))
    if not normalized:
        a.status = SKIPPED                                   # nothing answered: release the sample
    else:
        a.status = COMPLETED if all(complete.get(k) for k in keys) else PARTIAL
    a.submitted_at = now_iso
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This sample was already submitted")

    ctx.load_samples(db, competition_id)
    return {
        "status": a.status,
        "saved_fields": len(normalized),
        "missing_fields": [k for k in keys if not complete.get(k)],
        "sample_status": ctx.evals[a.sample_id]["status"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Revise my answers
#   A tie (or a change of mind) can be settled by the annotators themselves: you may change
#   your OWN answers on a sample you already annotated, while the competition is open.
#   You can only touch your own rows, only inside your team's samples, and a COMPLETE answer
#   must stay complete.
# ─────────────────────────────────────────────────────────────────────────────

class ReviseIn(BaseModel):
    values: dict[str, Any]


def _my_rows(db: Session, ctx: _Ctx, uid: str, sample_id: str) -> dict:
    rows = db.query(Annotation).filter(Annotation.sample_id == sample_id, Annotation.annotator_id == uid).all()
    return {ctx.task_key_by_id[r.task_id]: r for r in rows if r.task_id in ctx.task_key_by_id}


@router.get("/competitions/{competition_id}/annotation/mine")
def my_annotations(competition_id: str, page: int = 1, page_size: int = 5,
                   db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    uid = str(current_user.id)
    ctx = _Ctx(db, competition_id, uid)
    blocked = _not_ready(ctx)
    if blocked:
        return blocked
    ctx.load_samples(db, competition_id)

    mine = []
    for s in ctx.samples:
        rows = [r for r in ctx.rows[s.id] if r["annotator_id"] == uid]
        if rows:
            mine.append((max(r["created_at"] or "" for r in rows), s, rows))
    mine.sort(key=lambda m: m[0], reverse=True)

    page, page_size = max(1, page), max(1, min(page_size, 20))
    chunk = mine[(page - 1) * page_size: page * page_size]
    editable = not _is_closed(ctx.comp)

    items = []
    for _, s, rows in chunk:
        ev = ctx.evals[s.id]
        values = {r["task_key"]: r["value"] for r in rows if r["task_key"]}
        items.append({
            "sample": {"id": s.id, "number": ctx.number[s.id], "status": ev["status"],
                       "assets": _assets_payload(db, ctx, s)},
            "tasks": [_task_payload(t, ev) for t in sorted(ctx.tasks, key=lambda t: t["position"])
                      if t["key"] in values],
            "values": values,
        })
    total = len(mine)
    return {"state": "ok", "editable": editable, "page": page, "page_size": page_size,
            "total": total, "pages": max(1, -(-total // page_size)), "items": items}


@router.put("/competitions/{competition_id}/annotation/revise/{sample_id}")
def revise(competition_id: str, sample_id: str, body: ReviseIn,
           db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    uid = str(current_user.id)
    ctx = _Ctx(db, competition_id, uid)
    blocked = _not_ready(ctx)
    if blocked:
        raise HTTPException(status_code=400, detail=blocked["message"])
    if _is_closed(ctx.comp):
        raise HTTPException(status_code=409, detail="This competition is closed; annotations can no longer be changed.")

    in_scope = apply_scope(db.query(Sample.id).filter(
        Sample.id == sample_id, Sample.competition_id == competition_id), Sample, ctx.scope).first()
    if not in_scope:
        raise HTTPException(status_code=404, detail="Sample not found")

    mine = _my_rows(db, ctx, uid, sample_id)
    if not mine:
        raise HTTPException(status_code=404, detail="You have not annotated this sample")
    extra = [k for k in body.values if k not in mine]
    if extra:
        raise HTTPException(status_code=422, detail={"errors": {"_form": "You can only change tasks you already answered."}})

    known = {k: (r.value, r.status == COMPLETE_ROW) for k, r in mine.items()}
    normalized, complete, errors = _validate_answers(db, ctx, sample_id, list(body.values), body.values, known)
    for key in normalized:
        if mine[key].status == COMPLETE_ROW and not complete[key]:
            errors[key] = f"{ctx.task_by_key[key]['name']}: keep this answer complete, or leave it unchanged."
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors, "message": "Some answers are not valid."})

    for key, value in normalized.items():
        mine[key].value = value                       # created_at is kept: it only orders the answers
        mine[key].status = COMPLETE_ROW if complete[key] else PARTIAL_ROW

    # keep the annotator's assignment status consistent with the revised rows
    asg = db.query(SampleAssignment).filter(
        SampleAssignment.sample_id == sample_id, SampleAssignment.annotator_id == uid,
        SampleAssignment.status.in_(list(SUBMITTED))).first()
    if asg:
        asg.status = COMPLETED if all(
            k in mine and mine[k].status == COMPLETE_ROW for k in (asg.task_keys or [])) else PARTIAL
    db.commit()

    ctx.load_samples(db, competition_id)
    return {"saved_fields": len(normalized), "sample_status": ctx.evals[sample_id]["status"]}


# ─────────────────────────────────────────────────────────────────────────────
# GET stats
# ─────────────────────────────────────────────────────────────────────────────

def _blank():
    return {"annotated": 0, "completed": 0, "partial": 0, "conflicts_handled": 0, "conflicts_resolved": 0}


@router.get("/competitions/{competition_id}/annotation/stats")
def annotation_stats(competition_id: str, view: Optional[str] = None, db: Session = Depends(get_db),
                     current_user=Depends(get_current_user)):
    uid = str(current_user.id)
    ctx = _Ctx(db, competition_id, uid, view)
    base = {"required_annotators": ctx.settings["required_annotators"], "adjudication": ctx.settings["adjudication"],
            "scope": describe_scope(db, ctx.scope)}
    if not ctx.configured:
        return {**base, "configured": False}
    ctx.load_samples(db, competition_id)

    counts = {"total": len(ctx.samples), "completed": 0, "partial": 0, "not_started": 0,
              "conflicts_to_resolve": 0, "in_resolution": 0, "resolved_conflicts": 0}
    for s in ctx.samples:
        ev = ctx.evals[s.id]
        st = ev["status"]
        counts["completed"] += st == S_COMPLETED
        counts["partial"] += st == S_PARTIAL
        counts["not_started"] += st == NOT_STARTED
        counts["conflicts_to_resolve"] += st in (CONFLICT, CONFLICT_RESOLUTION)
        counts["in_resolution"] += st == CONFLICT_RESOLUTION
        counts["resolved_conflicts"] += ev["ever_conflict"] and st not in (CONFLICT, CONFLICT_RESOLUTION)
    counts["conflicts"] = counts["conflicts_to_resolve"] + counts["resolved_conflicts"]

    per: dict[str, dict] = defaultdict(_blank)
    for s in ctx.samples:
        still_conflicted = ctx.evals[s.id]["status"] in (CONFLICT, CONFLICT_RESOLUTION)
        for asg in ctx.assignments[s.id]:
            if asg["status"] not in SUBMITTED:
                continue
            p = per[asg["annotator_id"]]
            p["annotated"] += 1
            p["completed"] += asg["status"] == COMPLETED
            p["partial"] += asg["status"] == PARTIAL
            if asg["role"] == RESOLUTION:
                p["conflicts_handled"] += 1
                p["conflicts_resolved"] += not still_conflicted

    names = {p.user_id: p.full_name for p in
             db.query(UserProfile).filter(UserProfile.user_id.in_(list(per) or [""]))}
    annotators = []
    for aid, p in sorted(per.items(), key=lambda kv: -kv[1]["annotated"]):
        name = names.get(aid) or "Unknown"
        annotators.append({"id": aid, "name": name,
                           "initials": "".join(w[0].upper() for w in name.split()[:2]) or "?", **p})

    me = dict(per.get(uid) or _blank())
    me["remaining_for_me"] = sum(
        1 for s in ctx.samples
        if not any(x["annotator_id"] == uid for x in ctx.assignments[s.id])
        and open_tasks_for(ctx.tasks, ctx.evals[s.id], uid, ctx.settings["adjudication"])[0])
    return {**base, "configured": True, "totals": counts, "me": me, "annotators": annotators}