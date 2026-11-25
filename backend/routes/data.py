"""
routes/data.py  — fixed

Key fix: result.reasons (validation failure messages) are now saved into the
`flags` column on every insert. This powers the "Why?" popover in the UI
with the actual rule that failed, instead of a generic fallback message.
"""

import csv
import io
import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from models import (
    Competition, CompetitionOrganizer, CompetitionPrompt, DataComponent, DataSample, Sample, SampleAsset,
    UserProfile,
)
from schemas import DataSampleIn
from supabase_client import supabase
from services.validation_service import validate_sample
from services.participant_scope import apply_scope, describe_scope, member_names, resolve_scope
from services.phase_access import enforce_page
from services.rules_service import license_of
from services.sample_service import (
    MAX_ASSET_BYTES, MIME_BY_EXT, check_assets, file_ext, wav_duration,
)
from .utils import get_db, get_current_user

router = APIRouter(tags=["data"])


# (prompt rotation: GET /competitions/{id}/prompts/next lives in routes/datasets.py)


# ─────────────────────────────────────────────────────────────────────────────
# Text sample
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/data-samples")
async def create_text_sample(
    body: DataSampleIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    enforce_page(db, body.competition_id, current_user.id, "data-collection")
    result = await validate_sample(
        text_content=body.text_content,
        annotation=body.annotation,
        task_type="TEXT_PROCESSING",
        run_ai=True,
    )

    if result.status == "rejected":
        raise HTTPException(
            status_code=422,
            detail={
                "status": "rejected",
                "reasons": result.reasons,
                "message": "Sample did not pass validation and was not saved.",
            },
        )

    sample = DataSample(
        competition_id=body.competition_id,
        contributor_id=str(current_user.id),
        text_content=body.text_content,
        annotation=body.annotation or {},        # jsonb — store as dict
        status=result.status,
        quality_score=float(result.quality_score) if result.quality_score is not None else None,
        flags=result.reasons,                    # jsonb — store as list directly
        # score_breakdown is Column(JSON) — assign the list directly, no json.dumps().
        # (json.dumps()-ing it here double-encodes it; validation.py's _parse_json_list()
        # was only added to paper over that. Fix it at the source instead.)
        score_breakdown=result.score_breakdown or [],
        submitted_at=datetime.utcnow().isoformat(),
    )
    db.add(sample)
    db.commit()
    db.refresh(sample)

    return {
        "id": str(sample.id),
        "status": sample.status,
        "quality_score": result.quality_score,
        "validation_notes": result.reasons,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Audio sample
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/data-samples/audio")
async def create_audio_sample(
    audio: UploadFile = File(...),
    competition_id: str = Form(...),
    annotation: str = Form(...),
    audio_duration: float = Form(0),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    enforce_page(db, competition_id, current_user.id, "data-collection")
    try:
        ann_dict = json.loads(annotation)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="annotation must be valid JSON")

    result = await validate_sample(
        text_content=ann_dict.get("transcript", "placeholder"),
        annotation=ann_dict,
        task_type="AUDIO_SYNTHESIS",
        run_ai=False,
    )

    if result.status == "rejected":
        raise HTTPException(
            status_code=422,
            detail={"status": "rejected", "reasons": result.reasons},
        )

    derived_status = result.status
    derived_reasons = list(result.reasons)

    if audio_duration <= 0:
        derived_status = "flagged"
        derived_reasons.append("Audio duration is zero — recording may be empty.")

    sample_id    = str(uuid.uuid4())
    storage_path = f"{competition_id}/{sample_id}.wav"
    audio_bytes  = await audio.read()

    supabase.storage.from_("audio-samples").upload(
        storage_path, audio_bytes, {"content-type": "audio/wav"}
    )

    sample = DataSample(
        id=sample_id,
        competition_id=competition_id,
        contributor_id=str(current_user.id),
        audio_url=storage_path,
        audio_duration=audio_duration,
        text_content=ann_dict.get("transcript") or None,
        annotation=ann_dict,                     # jsonb — store as dict
        status=derived_status,
        quality_score=float(result.quality_score) if result.quality_score is not None else None,
        flags=derived_reasons,                   # jsonb — store as list
        score_breakdown=result.score_breakdown or [],
        submitted_at=datetime.utcnow().isoformat(),
    )
    db.add(sample)
    db.commit()
    return {"id": sample_id, "status": derived_status}


# ─────────────────────────────────────────────────────────────────────────────
# Bulk import
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/{competition_id}/samples/bulk")
async def bulk_import(
    competition_id: str,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    enforce_page(db, competition_id, current_user.id, "data-collection")
    inserted = 0
    rejected = 0

    for f in files:
        content = (await f.read()).decode("utf-8")
        rows_to_insert = []
        raw_rows = []

        if f.filename.endswith(".jsonl"):
            for line in content.strip().splitlines():
                try:
                    obj = json.loads(line)
                    raw_rows.append({
                        "text_content": obj.get("text_content"),
                        "annotation": obj.get("annotation", {}),
                    })
                except json.JSONDecodeError:
                    rejected += 1

        elif f.filename.endswith(".csv"):
            reader = csv.DictReader(io.StringIO(content))
            for row in reader:
                raw_rows.append({
                    "text_content": row.get("text_content", ""),
                    "annotation": {"label": row.get("label", "")},
                })

        for row in raw_rows:
            result = await validate_sample(
                text_content=row["text_content"],
                annotation=row["annotation"],
                task_type="TEXT_PROCESSING",
                run_ai=False,
            )
            if result.status == "rejected":
                rejected += 1
                continue

            rows_to_insert.append(DataSample(
                competition_id=competition_id,
                contributor_id=str(current_user.id),
                text_content=row["text_content"],
                annotation=row["annotation"],            # jsonb — store as dict
                status=result.status,
                quality_score=float(result.quality_score) if result.quality_score is not None else None,
                flags=result.reasons,                    # jsonb — store as list
                score_breakdown=result.score_breakdown or [],
                submitted_at=datetime.utcnow().isoformat(),
            ))

        db.add_all(rows_to_insert)
        inserted += len(rows_to_insert)

    db.commit()
    return {"inserted": inserted, "rejected": rejected}


# ─────────────────────────────────────────────────────────────────────────────
# Stats helpers
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/data-samples/count")
def sample_count(competition_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    scope = resolve_scope(db, competition_id, str(current_user.id))
    q = db.query(DataSample).filter(DataSample.competition_id == competition_id)
    if scope.key is not None:
        q = q.filter(DataSample.contributor_id.in_(list(scope.member_ids) or [""]))
    return {"count": q.count()}


@router.get("/competitions/{competition_id}/my-stats")
def my_stats(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    base = db.query(DataSample).filter(
        DataSample.competition_id == competition_id,
        DataSample.contributor_id == str(current_user.id),
    )
    return {
        "validated": base.filter(DataSample.status == "validated").count(),
        "flagged":   base.filter(DataSample.status == "flagged").count(),
        "pending":   base.filter(DataSample.status == "pending").count(),
    }


@router.get("/competitions/{competition_id}/team-stats")
def team_stats(competition_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Legacy endpoint: now restricted to the caller's team (legacy DataSample rows carry no scope,
    # so use contributor ids of the caller's own team members).
    scope = resolve_scope(db, competition_id, str(current_user.id))
    allowed = list(scope.member_ids)
    total_q = db.query(DataSample).filter(DataSample.competition_id == competition_id)
    if scope.key is not None:
        total_q = total_q.filter(DataSample.contributor_id.in_(allowed or [""]))
    total = total_q.count()

    rows = (
        db.query(DataSample.contributor_id, func.count(DataSample.id).label("cnt"))
        .filter(DataSample.competition_id == competition_id,
                *( [DataSample.contributor_id.in_(allowed or [""])] if scope.key is not None else [] ))
        .group_by(DataSample.contributor_id)
        .order_by(func.count(DataSample.id).desc())
        .limit(5)
        .all()
    )

    members = []
    for contributor_id, cnt in rows:
        profile  = db.query(UserProfile).filter(UserProfile.user_id == contributor_id).first()
        name     = (profile.full_name if profile else None) or "Unknown"
        initials = "".join(w[0].upper() for w in name.split()[:2]) or "?"
        members.append({
            "id": contributor_id,
            "name": name,
            "initials": initials,
            "role": "Contributor",
            "count": cnt,
            "today": 0,
        })

    return {"total": total, "members": members}


# ─────────────────────────────────────────────────────────────────────────────
# Generic sample creation
#
#   DataComponent = what asset the competition expects (type + constraints)
#   SampleAsset   = the actual asset collected in this sample
#
# One endpoint for every competition: the form is generated from the
# competition's DataComponent[] and checked against the same constraints here.
# Creating a sample collects assets only — there is no annotation in this flow.
# ─────────────────────────────────────────────────────────────────────────────

# The contributor's track and accepted license version are NOT taken from the request: they were
# chosen/accepted when joining and are read from their participation record below.
_META_KEYS = ("source_url", "prompt_id")


def _participation(db: Session, competition_id: str, user_id: str):
    """The contributor's participant row (track, rules acceptance), or None if they never joined.
    Tolerates databases where the optional columns haven't been migrated yet."""
    for cols in ("track_id, rules_accepted_at", "track_id", "id"):
        try:
            row = db.execute(
                text(f"SELECT {cols} FROM competition_participants "
                     "WHERE competition_id = :c AND user_id = :u LIMIT 1"),
                {"c": competition_id, "u": user_id},
            ).mappings().first()
            return dict(row) if row else None
        except Exception:
            db.rollback()
    return None


def _json_field(form, name: str) -> dict:
    raw = form.get(name)
    if not raw:
        return {}
    try:
        val = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail=f"'{name}' must be valid JSON")
    if not isinstance(val, dict):
        raise HTTPException(status_code=422, detail=f"'{name}' must be a JSON object")
    return val


@router.post("/competitions/{competition_id}/samples")
async def create_sample(
    competition_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    multipart/form-data:
      texts     JSON  {component_key: "text"}
      durations JSON  {component_key: seconds}   (client-measured; WAV is re-measured here)
      meta      JSON  optional: track_id, source_url, license_version, prompt_id
      asset__<component_key>   file parts, one per file-backed asset
    """
    comp = db.query(Competition).filter(Competition.id == competition_id).first()
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    if comp.is_draft:
        raise HTTPException(status_code=400, detail="This competition is not open for submissions yet")

    uid = str(current_user.id)
    joined = _participation(db, competition_id, uid)
    is_organizer = db.query(CompetitionOrganizer.id).filter(
        CompetitionOrganizer.competition_id == competition_id, CompetitionOrganizer.user_id == uid
    ).first() is not None
    if not joined and not is_organizer:
        raise HTTPException(status_code=403, detail="Join this competition to contribute samples")
    scope = resolve_scope(db, competition_id, uid, page="data-collection")   # the team / solo scope this sample belongs to

    components = (
        db.query(DataComponent)
        .filter(DataComponent.competition_id == competition_id)
        .order_by(DataComponent.position)
        .all()
    )
    if not components:
        raise HTTPException(status_code=400, detail="This competition has no sample structure defined yet")

    form = await request.form()
    texts = {k: v for k, v in _json_field(form, "texts").items() if isinstance(v, str)}
    durations = _json_field(form, "durations")
    meta_in = _json_field(form, "meta")

    uploads = {}
    for name, value in form.multi_items():
        if name.startswith("asset__") and hasattr(value, "read"):
            uploads[name[len("asset__"):]] = value

    # Read files + measure duration (WAV is measured server-side, never trusted)
    blobs: dict[str, bytes] = {}
    files: dict[str, dict] = {}
    for key, up in uploads.items():
        data = await up.read()
        if len(data) > MAX_ASSET_BYTES:
            raise HTTPException(status_code=413, detail=f"'{key}' is larger than {MAX_ASSET_BYTES // (1024 * 1024)} MB")
        if not data:
            continue
        ext = file_ext(up.filename)
        dur = wav_duration(data) if ext == "wav" else None
        if dur is None:
            try:
                dur = float(durations.get(key)) if durations.get(key) is not None else None
            except (TypeError, ValueError):
                dur = None
        blobs[key] = data
        files[key] = {"filename": up.filename, "duration": dur}

    errors = check_assets(components, texts, files)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "Sample did not pass validation and was not saved.", "errors": errors},
        )

    sample_id = str(uuid.uuid4())
    by_key = {c.key: c for c in components}
    uploaded_paths: list[str] = []

    try:
        asset_rows = []
        for c in components:
            if c.key in blobs:
                ext = file_ext(files[c.key]["filename"])
                path = f"{competition_id}/{sample_id}/{c.key}.{ext}"
                supabase.storage.from_("audio-samples").upload(
                    path, blobs[c.key], {"content-type": MIME_BY_EXT.get(ext, "application/octet-stream")}
                )
                uploaded_paths.append(path)
                asset_rows.append(SampleAsset(
                    sample_id=sample_id, component_id=c.id, storage_path=path,
                    duration_seconds=files[c.key]["duration"],
                    meta_data={"format": ext, "original_filename": files[c.key]["filename"]},
                ))
            elif (texts.get(c.key) or "").strip():
                asset_rows.append(SampleAsset(
                    sample_id=sample_id, component_id=c.id, text_content=texts[c.key].strip(),
                ))

        meta = {k: str(meta_in[k])[:500] for k in _META_KEYS if meta_in.get(k)}
        if joined and joined.get("track_id"):
            meta["track_id"] = str(joined["track_id"])
        try:
            cfg = json.loads(comp.dataset_config or "{}")
        except (TypeError, ValueError):
            cfg = {}
        lic = license_of(cfg)
        if lic and joined and joined.get("rules_accepted_at"):
            meta["license_version"] = lic.get("version") or "accepted"
            meta["license_accepted_at"] = joined["rules_accepted_at"]
        db.add(Sample(
            id=sample_id, competition_id=competition_id, contributor_id=str(current_user.id),
            scope_key=scope.write_key,
            status="pending", meta_data=meta, submitted_at=datetime.utcnow().isoformat(),
        ))
        db.flush()
        db.add_all(asset_rows)
        db.commit()
    except Exception:
        db.rollback()
        if uploaded_paths:
            try:
                supabase.storage.from_("audio-samples").remove(uploaded_paths)
            except Exception:
                pass
        raise HTTPException(status_code=502, detail="Could not save the sample. Please try again.")

    return {"id": sample_id, "status": "pending", "assets": len(asset_rows)}


@router.get("/competitions/{competition_id}/samples/stats")
def sample_stats(
    competition_id: str,
    view: Optional[str] = None,          # organizers only: a scope key such as "team:12"
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Statistics of the caller's own team / solo scope. Other teams' numbers are never returned."""
    uid = str(current_user.id)
    scope = resolve_scope(db, competition_id, uid, requested=view)
    base = apply_scope(db.query(Sample).filter(Sample.competition_id == competition_id), Sample, scope)

    total = base.count()
    mine = base.filter(Sample.contributor_id == uid).count()
    today = datetime.utcnow().date().isoformat()
    by_status = {s or "pending": n for s, n in
                 base.with_entities(Sample.status, func.count(Sample.id)).group_by(Sample.status).all()}

    counts = dict(base.with_entities(Sample.contributor_id, func.count(Sample.id))
                  .group_by(Sample.contributor_id).all())
    today_counts = dict(base.filter(Sample.submitted_at.like(f"{today}%"))
                        .with_entities(Sample.contributor_id, func.count(Sample.id))
                        .group_by(Sample.contributor_id).all())

    # a team lists every member (even with 0 samples); an unrestricted organizer view lists top contributors
    ids = list(scope.member_ids) or sorted(counts, key=lambda k: -counts[k])[:5]
    names = member_names(db, ids)
    members = []
    for mid in ids:
        name = names.get(mid) or "Unknown"
        members.append({
            "id": mid, "name": name,
            "initials": "".join(w[0].upper() for w in name.split()[:2]) or "?",
            "count": counts.get(mid, 0), "today": today_counts.get(mid, 0),
        })
    members.sort(key=lambda m: -m["count"])

    return {"total": total, "mine": mine, "by_status": by_status, "members": members,
            "scope": describe_scope(db, scope)}


# ─────────────────────────────────────────────────────────────────────────────
# Data Annotation workflow lives in routes/annotation.py; it is mounted on this
# router so no change to routes/__init__.py is needed.
# ─────────────────────────────────────────────────────────────────────────────
from .annotation import router as _annotation_router  # noqa: E402

router.include_router(_annotation_router)

# Team dataset overview (routes/dataset_overview.py), mounted the same way.
from .dataset_overview import router as _dataset_overview_router  # noqa: E402

router.include_router(_dataset_overview_router)