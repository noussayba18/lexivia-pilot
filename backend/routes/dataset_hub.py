"""
routes/dataset_hub.py — the global Dataset Hub, built on the generic sample structure

    Competition ─ DataComponent[] (asset slots)   ─┐
                ─ CompetitionTask[] (annotation)   ├─ Sample ─ SampleAsset[] + Annotation[]
                                                  ─┘

A dataset is published here only once its competition has CLOSED (end date passed).
Open / upcoming / draft competitions never appear, and asking for one directly is refused.

  GET /datasets/hub                              closed competitions that collected samples (cards)
  GET /datasets/hub/{id}                         one dataset: structure + statistics
  GET /datasets/hub/{id}/samples                 paginated samples with assets (audio URLs) + annotations
  GET /datasets/hub/{id}/export?format=jsonl|csv[&include_audio=true]
                                                 full export in the sample structure; with include_audio the
                                                 audio files are bundled with the data file in a .zip

Only COMPLETE annotation rows are shown/counted. Annotators are anonymous ("Annotator A…").

Each sample shows its FINAL decision per task (majority vote / strict-majority set / first answer for
free text, see services/consensus_service.py), never the individual answers. What each annotator wrote
is only returned by  GET /datasets/hub/{id}/samples/{sample_id}/annotations  (the "Details" button).
Samples that never reached a final decision (e.g. an unresolved tie) have none and are not part of
the exported dataset.
This file replaces the old /datasets/hub, /datasets/hub/{id}/export and
/datasets/hub/{id}/stats routes that used to live in routes/datasets.py.
"""

import csv
import io
import json
from collections import Counter, defaultdict
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import exists, func, literal_column
from sqlalchemy.orm import Session

from models import Annotation, Competition, Sample, SampleAsset, UserProfile
from supabase_client import supabase
from services.annotation_service import COMPLETE_ROW, S_COMPLETED, agreement, evaluate_sample, read_settings
from services.consensus_service import final_decision
from services.export_service import export_response
from services.participant_scope import ORGANIZER_KEY, scope_sizes
from services.sample_service import count_words
from services.structure_service import load_structure
from services.task_registry import ASSET_TYPES, TASK_TYPES
from .utils import get_current_user, get_db

router = APIRouter(tags=["dataset-hub"])

AUDIO_BUCKET = "audio-samples"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _is_closed(comp: Competition) -> bool:
    """Same rule as compute_competition_status() in competitions.py: CLOSED = end date passed."""
    end = _parse_date(comp.end_date)
    return (not comp.is_draft) and end is not None and date.today() > end


def _closed_competition_or_error(db: Session, competition_id: str) -> Competition:
    comp = db.query(Competition).filter(Competition.id == competition_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not _is_closed(comp):
        raise HTTPException(status_code=403, detail="This dataset is published when its competition closes.")
    return comp


def _audio_url(path: str):
    try:
        res = supabase.storage.from_(AUDIO_BUCKET).create_signed_url(path, 3600)
    except Exception:
        return None
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl") or res.get("signed_url")
    return getattr(res, "signed_url", None) or getattr(res, "signedURL", None)


def _kind(asset_type: str) -> str:
    return ASSET_TYPES.get(asset_type, {}).get("kind", (asset_type or "").lower())


def _summary_of(shape: str, value: dict) -> str:
    if shape == "labels":
        return ", ".join(value.get("labels", []))
    if shape == "spans":
        n = len(value.get("spans", []))
        return "No spans" if value.get("none") else f"{n} span{'s' if n != 1 else ''}"
    if shape == "qa":
        return f"Q: {value.get('question', '')} — A: {value.get('answer', '')}"
    return value.get("text", "")


class _Closed:
    """
    Every sample of the closed competition (ALL teams) with its evaluated state and final decisions.
    The global hub is the one place that is deliberately not scoped to a team.
    """

    def __init__(self, db: Session, comp: Competition, structure: dict):
        self.tasks = sorted(structure["tasks"], key=lambda t: t["position"])
        task_key = {t["id"]: t["key"] for t in self.tasks}
        required = read_settings(comp.dataset_config)["required_annotators"]
        self.configured = bool(required and self.tasks)
        self.samples, self.rows, self.evals, self.number = [], defaultdict(list), {}, {}
        if not self.configured:
            return

        sizes = scope_sizes(db, comp.id)
        self.samples = (db.query(Sample).filter(Sample.competition_id == comp.id)
                        .order_by(Sample.submitted_at, Sample.id).all())
        q = (db.query(Annotation.sample_id, Annotation.task_id, Annotation.annotator_id,
                      Annotation.value, Annotation.status, Annotation.created_at)
             .join(Sample, Sample.id == Annotation.sample_id)
             .filter(Sample.competition_id == comp.id))
        for sid, tid, aid, value, status, created in q.yield_per(1000):
            self.rows[sid].append({"task_key": task_key.get(tid), "annotator_id": aid, "value": value,
                                   "status": status, "created_at": created})
        now = datetime.utcnow()
        for i, s in enumerate(self.samples, 1):
            # same cap as the annotation workflow: a team is never asked for more annotators than it has
            r = required
            if s.scope_key and s.scope_key != ORGANIZER_KEY and sizes.get(s.scope_key):
                r = min(required, sizes[s.scope_key])
            self.evals[s.id] = evaluate_sample(self.tasks, self.rows[s.id], [], max(r, 1), now)
            self.number[s.id] = i

    def is_final(self, sample_id: str) -> bool:
        return self.evals.get(sample_id, {}).get("status") == S_COMPLETED

    def entries(self, sample_id: str, task_key: str) -> list:
        rows = [r for r in self.rows[sample_id] if r["task_key"] == task_key and r["status"] == COMPLETE_ROW]
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


def _structure_payload(structure: dict):
    assets = [{
        "key": a["key"], "name": a["name"], "type": a["type"], "kind": _kind(a["type"]),
        "required": a["required"], "constraints": a["constraints"], "position": a["position"],
    } for a in structure["assets"]]
    tasks = []
    for t in structure["tasks"]:
        spec = TASK_TYPES.get(t["type"], {})
        tasks.append({
            "key": t["key"], "name": t["name"], "type": t["type"],
            "label": spec.get("label", t["type"]), "answer": spec.get("answer", "text"),
            "config": t["config"], "target": t["target"],
            "instructions": t["instructions"], "position": t["position"],
        })
    return assets, tasks


def _short(text: str, n: int = 200) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[:n].rstrip() + "…"


# ─────────────────────────────────────────────────────────────────────────────
# GET /datasets/hub — cards for closed competitions
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/datasets/hub")
def list_hub_datasets(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    closed = [c for c in db.query(Competition).filter(Competition.end_date.isnot(None)).all() if _is_closed(c)]
    ids = [c.id for c in closed]
    if not ids:
        return []

    sample_rows = {
        cid: (total, contributors, last)
        for cid, total, contributors, last in db.query(
            Sample.competition_id,
            func.count(Sample.id),
            func.count(func.distinct(Sample.contributor_id)),
            func.max(Sample.submitted_at),
        ).filter(Sample.competition_id.in_(ids)).group_by(Sample.competition_id)
    }

    ann_rows = {
        cid: (annotated, total, annotators)
        for cid, annotated, total, annotators in db.query(
            Sample.competition_id,
            func.count(func.distinct(Annotation.sample_id)),
            func.count(Annotation.id),
            func.count(func.distinct(Annotation.annotator_id)),
        ).join(Annotation, Annotation.sample_id == Sample.id)
        .filter(Sample.competition_id.in_(ids), Annotation.status == COMPLETE_ROW)
        .group_by(Sample.competition_id)
    }

    audio_rows = {
        cid: float(seconds or 0)
        for cid, seconds in db.query(
            Sample.competition_id, func.coalesce(func.sum(SampleAsset.duration_seconds), 0),
        ).join(SampleAsset, SampleAsset.sample_id == Sample.id)
        .filter(Sample.competition_id.in_(ids))
        .group_by(Sample.competition_id)
    }

    result = []
    for comp in closed:
        total, contributors, last = sample_rows.get(comp.id, (0, 0, None))
        if not total:
            continue                                    # nothing was collected → no dataset
        annotated, annotations, annotators = ann_rows.get(comp.id, (0, 0, 0))
        assets, tasks = _structure_payload(load_structure(db, comp.id))
        result.append({
            "id": comp.id,
            "title": f"{comp.title} Dataset",
            "description": _short(comp.description),
            "source_competition_id": comp.id,
            "source_competition_title": comp.title,
            "ended_at": comp.end_date,
            "total_samples": total,
            "contributors": contributors,
            "annotated_samples": annotated,
            "annotations": annotations,
            "annotators": annotators,
            "audio_seconds": audio_rows.get(comp.id, 0.0),
            "last_updated": last,
            "assets": [{k: a[k] for k in ("key", "name", "type", "kind")} for a in assets],
            "tasks": [{k: t[k] for k in ("key", "name", "type", "label")} for t in tasks],
        })

    result.sort(key=lambda d: d["ended_at"] or "", reverse=True)     # most recently closed first
    return result


# ─────────────────────────────────────────────────────────────────────────────
# GET /datasets/hub/{id} — one dataset: structure + statistics
# ─────────────────────────────────────────────────────────────────────────────

def _stats(db: Session, competition_id: str, structure: dict, final_samples: int = 0) -> dict:
    asset_by_id = {a["id"]: a for a in structure["assets"]}
    task_by_id = {t["id"]: t for t in structure["tasks"]}
    answer_by_key = {t["key"]: TASK_TYPES.get(t["type"], {}).get("answer", "text") for t in structure["tasks"]}

    total, contributors, first, last = db.query(
        func.count(Sample.id), func.count(func.distinct(Sample.contributor_id)),
        func.min(Sample.submitted_at), func.max(Sample.submitted_at),
    ).filter(Sample.competition_id == competition_id).one()

    # ── assets ──────────────────────────────────────────────────────────────
    acc = {a["key"]: {"count": 0, "words": 0, "max_words": 0, "seconds": 0.0, "max_seconds": 0.0}
           for a in structure["assets"]}
    q = (db.query(SampleAsset.component_id, SampleAsset.text_content, SampleAsset.duration_seconds)
         .join(Sample, Sample.id == SampleAsset.sample_id)
         .filter(Sample.competition_id == competition_id))
    for component_id, text, duration in q.yield_per(1000):
        comp = asset_by_id.get(component_id)
        if not comp:
            continue
        s = acc[comp["key"]]
        s["count"] += 1
        if text:
            w = count_words(text)
            s["words"] += w
            s["max_words"] = max(s["max_words"], w)
        if duration:
            s["seconds"] += float(duration)
            s["max_seconds"] = max(s["max_seconds"], float(duration))

    assets = []
    for a in structure["assets"]:
        s, kind = acc[a["key"]], _kind(a["type"])
        row = {"key": a["key"], "name": a["name"], "type": a["type"], "kind": kind, "count": s["count"]}
        if kind == "text":
            row.update(avg_words=round(s["words"] / s["count"], 1) if s["count"] else None,
                       max_words=s["max_words"], total_words=s["words"])
        elif kind == "audio":
            row.update(total_seconds=round(s["seconds"], 1),
                       avg_seconds=round(s["seconds"] / s["count"], 2) if s["count"] else None,
                       max_seconds=round(s["max_seconds"], 2))
        assets.append(row)

    # ── annotations (COMPLETE rows only) ────────────────────────────────────
    tacc = {t["key"]: {"annotations": 0, "samples": set(), "annotators": set(),
                       "dist": Counter(), "spans": 0, "words": 0} for t in structure["tasks"]}
    annotated, annotators = set(), set()
    q = (db.query(Annotation.task_id, Annotation.sample_id, Annotation.annotator_id, Annotation.value)
         .join(Sample, Sample.id == Annotation.sample_id)
         .filter(Sample.competition_id == competition_id, Annotation.status == COMPLETE_ROW))
    for task_id, sample_id, annotator_id, value in q.yield_per(1000):
        task = task_by_id.get(task_id)
        if not task:
            continue
        s, shape, v = tacc[task["key"]], answer_by_key[task["key"]], (value or {})
        s["annotations"] += 1
        s["samples"].add(sample_id)
        s["annotators"].add(annotator_id)
        annotated.add(sample_id)
        annotators.add(annotator_id)
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

    tasks = []
    for t in structure["tasks"]:
        s, shape = tacc[t["key"]], answer_by_key[t["key"]]
        spec = TASK_TYPES.get(t["type"], {})
        tasks.append({
            "key": t["key"], "name": t["name"], "type": t["type"], "label": spec.get("label", t["type"]),
            "answer": shape, "annotations": s["annotations"], "samples": len(s["samples"]),
            "annotators": len(s["annotators"]),
            "distribution": [{"label": k, "count": n} for k, n in s["dist"].most_common(12)],
            "total_spans": s["spans"] if shape == "spans" else None,
            "avg_words": round(s["words"] / s["annotations"], 1) if shape in ("text", "qa") and s["annotations"] else None,
        })

    # ── contributions per day + top contributors ────────────────────────────
    day = func.substr(Sample.submitted_at, 1, 10)
    per_day = [{"date": d, "count": n} for d, n in
               db.query(day, func.count(Sample.id)).filter(Sample.competition_id == competition_id,
                                                           Sample.submitted_at.isnot(None))
               .group_by(literal_column("1")).order_by(literal_column("1")).all()]   # positional: avoids re-binding substr() params

    top = (db.query(Sample.contributor_id, func.count(Sample.id))
           .filter(Sample.competition_id == competition_id)
           .group_by(Sample.contributor_id).order_by(func.count(Sample.id).desc()).limit(5).all())
    names = {p.user_id: p.full_name for p in
             db.query(UserProfile).filter(UserProfile.user_id.in_([u for u, _ in top if u] or [""]))}
    top_contributors = [{"name": names.get(u) or "Anonymous", "count": n} for u, n in top]

    return {
        "total_samples": total, "contributors": contributors,
        "annotated_samples": len(annotated), "annotators": len(annotators),
        "final_samples": final_samples,
        "annotations": sum(t["annotations"] for t in tasks),
        "audio_seconds": round(sum(a.get("total_seconds", 0) or 0 for a in assets), 1),
        "first_submitted": first, "last_submitted": last,
        "assets": assets, "tasks": tasks,
        "samples_per_day": per_day, "top_contributors": top_contributors,
    }


@router.get("/datasets/hub/{competition_id}")
def dataset_detail(competition_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    comp = _closed_competition_or_error(db, competition_id)
    structure = load_structure(db, comp.id)
    assets, tasks = _structure_payload(structure)
    ctx = _Closed(db, comp, structure)
    final_samples = sum(1 for s in ctx.samples if ctx.is_final(s.id))
    return {
        "id": comp.id,
        "title": f"{comp.title} Dataset",
        "description": comp.description or "",
        "source_competition_id": comp.id,
        "source_competition_title": comp.title,
        "start_date": comp.start_date,
        "ended_at": comp.end_date,
        "assets": assets,
        "tasks": tasks,
        "stats": _stats(db, comp.id, structure, final_samples=final_samples),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Samples (shared by the browser and the export)
# ─────────────────────────────────────────────────────────────────────────────

def _build_items(db: Session, structure: dict, samples: list, ctx: "_Closed", for_api: bool = True) -> list:
    """
    One dict per sample:
      assets       [{key, name, type, kind, text, duration, audio_url | audio_path}]  (slot order)
      annotations  {task_key: [{annotator: "Final decision", value, basis, votes, of}]}
                   the FINAL decision only (one entry per task); {} when the sample has none.
                   Individual answers: see dataset_sample_annotations().
    """
    if not samples:
        return []
    ids = [s.id for s in samples]
    comp_by_id = {a["id"]: a for a in structure["assets"]}
    task_by_id = {t["id"]: t for t in structure["tasks"]}

    assets_by_sample = defaultdict(list)
    for sa in db.query(SampleAsset).filter(SampleAsset.sample_id.in_(ids)):
        c = comp_by_id.get(sa.component_id)
        if not c:
            continue
        item = {
            "key": c["key"], "name": c["name"], "type": c["type"], "kind": _kind(c["type"]),
            "language": (c["constraints"] or {}).get("language"), "position": c["position"],
            "text": sa.text_content, "duration": sa.duration_seconds,
        }
        if sa.storage_path:
            if for_api:
                item["audio_url"] = _audio_url(sa.storage_path)
            else:
                item["audio_path"] = sa.storage_path
        assets_by_sample[sa.sample_id].append(item)

    out = []
    for s in samples:
        final = ctx.final(s.id)
        out.append({
            "id": s.id, "number": ctx.number[s.id], "submitted_at": s.submitted_at,
            "assets": sorted(assets_by_sample[s.id], key=lambda a: a["position"]),
            "has_final": bool(final),
            "annotations": {k: [{"annotator": "Final decision", "value": f["value"], "basis": f["basis"],
                                 "votes": f["votes"], "of": f["of"]}] for k, f in final.items()},
        })
    return out


@router.get("/datasets/hub/{competition_id}/samples")
def dataset_samples(
    competition_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    annotated: str = Query("yes", pattern="^(all|yes|no)$"),   # default: the dataset itself (final decisions)
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    comp = _closed_competition_or_error(db, competition_id)
    structure = load_structure(db, comp.id)
    ctx = _Closed(db, comp, structure)

    # yes = has a final decision (the dataset) · no = never reached one · all = everything
    matching = [s for s in ctx.samples
                if annotated == "all" or (annotated == "yes") == ctx.is_final(s.id)]
    total = len(matching)
    offset = (page - 1) * page_size
    rows = matching[offset: offset + page_size]

    return {
        "page": page, "page_size": page_size, "total": total,
        "pages": max(1, -(-total // page_size)),
        "items": _build_items(db, structure, rows, ctx),
    }


@router.get("/datasets/hub/{competition_id}/samples/{sample_id}/annotations")
def dataset_sample_annotations(
    competition_id: str,
    sample_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """The "Details" button: what each annotator wrote for one sample (anonymous: Annotator A, B…)."""
    comp = _closed_competition_or_error(db, competition_id)
    structure = load_structure(db, comp.id)
    ctx = _Closed(db, comp, structure)
    if sample_id not in ctx.evals:
        raise HTTPException(status_code=404, detail="Sample not found")

    final = ctx.final(sample_id)
    letters: dict = {}
    tasks = []
    for t in ctx.tasks:
        method, extract = agreement(t["type"], t.get("config") or {})
        entries = []
        for r in ctx.entries(sample_id, t["key"]):
            if r["annotator_id"] not in letters:
                letters[r["annotator_id"]] = chr(ord("A") + len(letters) % 26)
            agrees = None
            if method != "none" and t["key"] in final:
                try:
                    agrees = extract(r["value"]) == extract(final[t["key"]]["value"])
                except Exception:
                    agrees = None
            entries.append({"annotator": f"Annotator {letters[r['annotator_id']]}", "value": r["value"],
                            "agrees_with_final": agrees})
        tasks.append({"task_key": t["key"], "entries": entries,
                      "final": final.get(t["key"])})
    return {"sample_id": sample_id, "number": ctx.number[sample_id],
            "has_final": bool(final), "tasks": tasks}


# ─────────────────────────────────────────────────────────────────────────────
# Export — sample structure (assets + annotations), JSONL or CSV, optionally with the audio (ZIP)
# ─────────────────────────────────────────────────────────────────────────────

def collect_records(db: Session, structure: dict, samples: list, ctx, details: bool = False) -> list:
    """
    Export records for `samples`: assets (+ audio storage path) and the final decision per task.
    `ctx` only needs  .number  .final(sample_id)  .entries(sample_id, task_key)  .tasks
    so the team dataset page reuses this with its own scoped context.
    Everything is read here, before streaming starts, so the DB session is never used mid-response.
    """
    records, batch = [], 200
    for i in range(0, len(samples), batch):
        chunk = samples[i:i + batch]
        for item, s in zip(_build_items(db, structure, chunk, ctx, for_api=False), chunk):
            item["final"] = ctx.final(s.id)
            if details:
                item["annotator_answers"] = {
                    t["key"]: [r["value"] for r in ctx.entries(s.id, t["key"])] for t in ctx.tasks}
            records.append(item)
    return records


@router.get("/datasets/hub/{competition_id}/export")
def export_dataset(
    competition_id: str,
    format: str = Query("jsonl", pattern="^(jsonl|csv)$"),
    details: bool = Query(False, description="also include every annotator's answer (jsonl only)"),
    include_audio: bool = Query(False, description="bundle the audio files with the data file in a .zip"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    comp = _closed_competition_or_error(db, competition_id)
    structure = load_structure(db, comp.id)

    # Only samples with a FINAL decision are part of the exported dataset.
    ctx = _Closed(db, comp, structure)
    final_samples = [s for s in ctx.samples if ctx.is_final(s.id)]
    records = collect_records(db, structure, final_samples, ctx, details)
    return export_response(records, structure, format, comp.id, comp.title,
                           details=details, include_audio=include_audio)