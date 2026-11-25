"""
routes/dataset_overview.py — the team's live view of its dataset

    GET /competitions/{id}/dataset/overview   statistics: collection, annotation, conflicts,
                                              per-contributor and per-annotator breakdowns
    GET /competitions/{id}/dataset/samples    paginated samples: collected assets + every
                                              annotator's answer per task (names visible)
    GET /competitions/{id}/dataset/export     download the dataset (csv | jsonl); include_audio=true
                                              bundles the audio files with the data file in a .zip

Unlike the global Dataset Hub (closed competitions, anonymous annotators), this is for
participants/organizers of the competition itself, while it is running. Several annotators
can answer the same sample and the same task, so answers are returned as a LIST per task,
each entry tagged with who wrote it.

All statuses are derived through the same _Ctx / evaluate_sample used by the annotation
workflow, so the numbers here always match what annotators see.
"""

from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from models import Annotation, Sample, SampleAsset, UserProfile
from services.annotation_service import (
    COMPLETE_ROW, CONFLICT, CONFLICT_RESOLUTION, NOT_STARTED, RESOLUTION,
    S_COMPLETED, S_PARTIAL, SUBMITTED,
)
from services.consensus_service import final_decision
from services.export_service import export_response
from services.participant_scope import apply_scope, describe_scope
from services.sample_service import count_words
from services.task_registry import ASSET_TYPES, TASK_TYPES
from .annotation import _Ctx, _audio_url, _summary
from .dataset_hub import collect_records
from .utils import get_current_user, get_db

router = APIRouter(tags=["dataset-overview"])

STATUS_FILTERS = {
    "all": None,
    "completed": (S_COMPLETED,),
    "partial": (S_PARTIAL,),
    "not_started": (NOT_STARTED,),
    "conflict": (CONFLICT, CONFLICT_RESOLUTION),
}


def _initials(name: str) -> str:
    return "".join(w[0].upper() for w in (name or "").split()[:2]) or "?"


def _names(db: Session, ids) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return {p.user_id: p.full_name for p in db.query(UserProfile).filter(UserProfile.user_id.in_(ids))}


def _kind(asset_type: str) -> str:
    return ASSET_TYPES.get(asset_type, {}).get("kind", (asset_type or "").lower())


# ─────────────────────────────────────────────────────────────────────────────
# Overview
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/dataset/overview")
def dataset_overview(competition_id: str, view: Optional[str] = None, db: Session = Depends(get_db),
                     current_user=Depends(get_current_user)):
    # ctx is scoped to the caller's team / solo scope (organizers: all, or ?view=team:12)
    ctx = _Ctx(db, competition_id, str(current_user.id), view, page="team-dataset")
    ctx.load_samples(db, competition_id)
    structure = ctx.structure
    sample_ids = [s.id for s in ctx.samples]

    # ── collected data ──────────────────────────────────────────────────────
    asset_by_id = {a["id"]: a for a in structure["assets"]}
    acc = {a["key"]: {"count": 0, "words": 0, "seconds": 0.0} for a in structure["assets"]}
    if sample_ids:
        q = (db.query(SampleAsset.component_id, SampleAsset.text_content, SampleAsset.duration_seconds)
             .join(Sample, Sample.id == SampleAsset.sample_id)
             .filter(Sample.competition_id == competition_id))
        q = apply_scope(q, Sample, ctx.scope)
        for component_id, text, duration in q.yield_per(1000):
            comp = asset_by_id.get(component_id)
            if not comp:
                continue
            s = acc[comp["key"]]
            s["count"] += 1
            s["words"] += count_words(text) if text else 0
            s["seconds"] += float(duration or 0)

    assets = []
    for a in structure["assets"]:
        s, kind = acc[a["key"]], _kind(a["type"])
        row = {"key": a["key"], "name": a["name"], "type": a["type"], "kind": kind, "count": s["count"]}
        if kind == "text":
            row["total_words"] = s["words"]
            row["avg_words"] = round(s["words"] / s["count"], 1) if s["count"] else None
        elif kind == "audio":
            row["total_seconds"] = round(s["seconds"], 1)
            row["avg_seconds"] = round(s["seconds"] / s["count"], 2) if s["count"] else None
        assets.append(row)

    # contributors (who collected what)
    per_day = defaultdict(int)
    contrib = Counter()
    for s in ctx.samples:
        contrib[s.contributor_id] += 1
        if s.submitted_at:
            per_day[s.submitted_at[:10]] += 1

    # ── sample statuses ─────────────────────────────────────────────────────
    totals = {"total": len(ctx.samples), "completed": 0, "partial": 0, "not_started": 0,
              "conflicts_to_resolve": 0, "resolved_conflicts": 0}
    for s in ctx.samples:
        ev = ctx.evals[s.id]
        st = ev["status"]
        totals["completed"] += st == S_COMPLETED
        totals["partial"] += st == S_PARTIAL
        totals["not_started"] += st == NOT_STARTED
        in_conflict = st in (CONFLICT, CONFLICT_RESOLUTION)
        totals["conflicts_to_resolve"] += in_conflict
        totals["resolved_conflicts"] += ev["ever_conflict"] and not in_conflict

    # ── per-task coverage + distribution (every annotator's COMPLETE answers) ─
    task_by_id = {t["id"]: t for t in structure["tasks"]}
    tacc = {t["key"]: {"answers": 0, "samples": set(), "annotators": set(), "dist": Counter(),
                       "spans": 0, "words": 0, "per_annotator": Counter()} for t in structure["tasks"]}
    if sample_ids:
        q = (db.query(Annotation.task_id, Annotation.sample_id, Annotation.annotator_id, Annotation.value)
             .join(Sample, Sample.id == Annotation.sample_id)
             .filter(Sample.competition_id == competition_id, Annotation.status == COMPLETE_ROW))
        q = apply_scope(q, Sample, ctx.scope)
        for task_id, sample_id, annotator_id, value in q.yield_per(1000):
            task = task_by_id.get(task_id)
            if not task:
                continue
            shape = TASK_TYPES.get(task["type"], {}).get("answer", "text")
            s, v = tacc[task["key"]], (value or {})
            s["answers"] += 1
            s["samples"].add(sample_id)
            s["annotators"].add(annotator_id)
            s["per_annotator"][annotator_id] += 1
            if shape == "labels":
                s["dist"].update(v.get("labels", []))
            elif shape == "spans":
                spans = v.get("spans", [])
                s["spans"] += len(spans)
                s["dist"].update(sp.get("label") for sp in spans if sp.get("label"))
            elif shape == "text":
                s["words"] += count_words(v.get("text", ""))
            elif shape == "qa":
                s["words"] += count_words(v.get("answer", ""))

    required = ctx.settings["required_annotators"]
    tasks = []
    for t in structure["tasks"]:
        s = tacc[t["key"]]
        shape = TASK_TYPES.get(t["type"], {}).get("answer", "text")
        satisfied = sum(1 for smp in ctx.samples if ctx.evals[smp.id]["tasks"][t["key"]]["status"] == "SATISFIED")
        tasks.append({
            "key": t["key"], "name": t["name"], "type": t["type"],
            "label": TASK_TYPES.get(t["type"], {}).get("label", t["type"]), "answer": shape,
            "answers": s["answers"], "samples_with_answers": len(s["samples"]),
            "samples_satisfied": satisfied, "annotators": len(s["annotators"]),
            "distribution": [{"label": k, "count": n} for k, n in s["dist"].most_common(12)],
            "total_spans": s["spans"] if shape == "spans" else None,
            "avg_words": round(s["words"] / s["answers"], 1) if shape in ("text", "qa") and s["answers"] else None,
        })

    # ── who annotated what ──────────────────────────────────────────────────
    per = defaultdict(lambda: {"annotated": 0, "completed": 0, "partial": 0,
                               "conflicts_handled": 0, "conflicts_resolved": 0})
    for s in ctx.samples:
        still = ctx.evals[s.id]["status"] in (CONFLICT, CONFLICT_RESOLUTION)
        for asg in ctx.assignments[s.id]:
            if asg["status"] not in SUBMITTED:
                continue
            p = per[asg["annotator_id"]]
            p["annotated"] += 1
            p["completed"] += asg["status"] == "COMPLETED"
            p["partial"] += asg["status"] == "PARTIAL"
            if asg["role"] == RESOLUTION:
                p["conflicts_handled"] += 1
                p["conflicts_resolved"] += not still

    names = _names(db, list(per) + list(contrib))
    annotators = []
    for aid, p in sorted(per.items(), key=lambda kv: -kv[1]["annotated"]):
        name = names.get(aid) or "Unknown"
        annotators.append({
            "id": aid, "name": name, "initials": _initials(name), **p,
            "by_task": [{"key": t["key"], "name": t["name"], "answers": tacc[t["key"]]["per_annotator"].get(aid, 0)}
                        for t in structure["tasks"]],
        })

    contributors = []
    for cid, n in contrib.most_common():
        name = names.get(cid) or "Unknown"
        contributors.append({"id": cid, "name": name, "initials": _initials(name), "samples": n})

    return {
        "configured": ctx.configured,
        "required_annotators": required,
        "adjudication": ctx.settings["adjudication"],
        "totals": totals,
        "assets": assets, "tasks": tasks,
        "contributors": contributors, "annotators": annotators,
        "samples_per_day": [{"date": d, "count": n} for d, n in sorted(per_day.items())],
        "me": str(current_user.id),
        "scope": describe_scope(db, ctx.scope),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Samples with every annotator's answers
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/dataset/samples")
def dataset_samples(
    competition_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    status: str = Query("all", pattern="^(all|completed|partial|not_started|conflict)$"),
    view: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ctx = _Ctx(db, competition_id, str(current_user.id), view, page="team-dataset")
    ctx.load_samples(db, competition_id)

    wanted = STATUS_FILTERS[status]
    matching = [s for s in ctx.samples if wanted is None or ctx.evals[s.id]["status"] in wanted]
    total = len(matching)
    offset = (page - 1) * page_size
    chunk = matching[offset: offset + page_size]
    ids = [s.id for s in chunk]

    comp_by_id = {a["id"]: a for a in ctx.structure["assets"]}
    assets_by_sample = defaultdict(list)
    if ids:
        for sa in db.query(SampleAsset).filter(SampleAsset.sample_id.in_(ids)):
            c = comp_by_id.get(sa.component_id)
            if not c:
                continue
            assets_by_sample[sa.sample_id].append({
                "key": c["key"], "name": c["name"], "type": c["type"], "kind": _kind(c["type"]),
                "position": c["position"], "text": sa.text_content, "duration": sa.duration_seconds,
                "audio_url": _audio_url(sa.storage_path) if sa.storage_path else None,
            })

    rows_by_sample = defaultdict(list)
    for sid in ids:
        rows_by_sample[sid] = sorted(ctx.rows[sid], key=lambda r: (r["created_at"] or "", r["annotator_id"] or ""))

    people = [s.contributor_id for s in chunk]
    for sid in ids:
        people += [r["annotator_id"] for r in rows_by_sample[sid]]
        people += [a["annotator_id"] for a in ctx.assignments[sid]]
    names = _names(db, people)

    def person(uid):
        n = names.get(uid) or "Unknown"
        return {"id": uid, "name": n, "initials": _initials(n)}

    tasks = sorted(ctx.tasks, key=lambda t: t["position"])
    items = []
    for i, s in enumerate(chunk):
        ev = ctx.evals[s.id]
        answers = {}
        for t in tasks:
            shape = TASK_TYPES[t["type"]]["answer"]
            st = ev["tasks"][t["key"]]
            answers[t["key"]] = {
                "status": st["status"], "count": st["count"], "needed_more": st["needed_more"],
                "entries": [{
                    "annotator": person(r["annotator_id"]), "value": r["value"],
                    "summary": _summary(shape, r["value"] or {}), "complete": r["status"] == COMPLETE_ROW,
                    "created_at": r["created_at"],
                } for r in rows_by_sample[s.id] if r["task_key"] == t["key"]],
            }
        items.append({
            "id": s.id, "number": ctx.number[s.id], "submitted_at": s.submitted_at,
            "contributor": person(s.contributor_id),
            "status": ev["status"], "ever_conflict": ev["ever_conflict"],
            "annotators": [{**person(a["annotator_id"]), "status": a["status"], "role": a["role"]}
                           for a in ctx.assignments[s.id] if a["status"] in SUBMITTED],
            "assets": sorted(assets_by_sample[s.id], key=lambda a: a["position"]),
            "answers": answers,
        })

    return {
        "page": page, "page_size": page_size, "total": total,
        "pages": max(1, -(-total // page_size)),
        "tasks": [{"key": t["key"], "name": t["name"], "type": t["type"],
                   "answer": TASK_TYPES[t["type"]]["answer"]} for t in tasks],
        "items": items,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Export (the caller's own team / solo dataset; organizers: everything, or ?view=team:12)
# ─────────────────────────────────────────────────────────────────────────────

class _ScopedFinal:
    """Adapter so the shared export code can read final decisions out of the scoped _Ctx."""

    def __init__(self, ctx):
        self._ctx = ctx
        self.tasks = sorted(ctx.tasks, key=lambda t: t["position"])
        self.number = ctx.number

    def is_final(self, sample_id: str) -> bool:
        return self._ctx.evals[sample_id]["status"] == S_COMPLETED

    def entries(self, sample_id: str, task_key: str) -> list:
        rows = [r for r in self._ctx.rows[sample_id]
                if r["task_key"] == task_key and r["status"] == COMPLETE_ROW]
        return sorted(rows, key=lambda r: (r["created_at"] or "", r["annotator_id"] or ""))

    def final(self, sample_id: str) -> dict:
        """{task_key: {value, basis, votes, of}} — empty unless the sample is completed."""
        if not self.is_final(sample_id):
            return {}
        out = {}
        for t in self.tasks:
            fd = final_decision(t, self.entries(sample_id, t["key"]))
            if fd:
                out[t["key"]] = fd
        return out


@router.get("/competitions/{competition_id}/dataset/export")
def export_team_dataset(
    competition_id: str,
    format: str = Query("jsonl", pattern="^(jsonl|csv)$"),
    include_audio: bool = Query(False, description="bundle the audio files with the data file in a .zip"),
    details: bool = Query(False, description="also include every annotator's answer (jsonl only)"),
    samples: str = Query("final", pattern="^(final|all)$",
                         description="final = completed samples only · all = every collected sample"),
    view: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ctx = _Ctx(db, competition_id, str(current_user.id), view, page="team-dataset")
    ctx.load_samples(db, competition_id)
    scoped = _ScopedFinal(ctx)

    chosen = [s for s in ctx.samples if samples == "all" or scoped.is_final(s.id)]
    records = collect_records(db, ctx.structure, chosen, scoped, details)
    return export_response(records, ctx.structure, format, competition_id, ctx.comp.title,
                           details=details, include_audio=include_audio)