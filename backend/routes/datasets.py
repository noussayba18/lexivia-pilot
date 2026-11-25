"""
routes/datasets.py

Organizer-supplied source prompts, and the hidden / reference dataset upload.
A competition has no task type any more, so upload rules are the same for every
competition (DATASET_UPLOAD_CONFIG below). They are served to the frontend by
GET /competitions/{id}/dataset-config in routes/competitions.py.
"""
import json
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from supabase_client import supabase

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
import csv
import io

from models import Competition, DataSample, UserProfile, CompetitionParticipant, CompetitionDataset, CompetitionPrompt, CompetitionOrganizer
from .utils import get_db, get_current_user

router = APIRouter(tags=["datasets"])
STORAGE_BUCKET = "competition-datasets"


def _is_organizer(db: Session, competition_id: str, user_id) -> bool:
    return db.query(CompetitionOrganizer.id).filter(
        CompetitionOrganizer.competition_id == competition_id,
        CompetitionOrganizer.user_id == str(user_id),
    ).first() is not None


def _is_hidden(dataset_type: str | None) -> bool:
    """hidden_test / hidden_labels: the held-out data submissions are scored against. Organizer eyes only."""
    return str(dataset_type or "").lower().startswith("hidden")

# ─────────────────────────────────────────────────────────────────────────────
# Upload rules for the hidden / reference dataset (same for every competition)
# ─────────────────────────────────────────────────────────────────────────────

DATASET_UPLOAD_CONFIG: dict = {
    "hidden_dataset_instructions": (
        "Upload your reference data with the expected answer for each task. "
        "Text: JSONL or CSV, one row per sample. "
        "Audio: a ZIP with the audio files plus a JSONL manifest."
    ),
    "allowed_extensions": [".jsonl", ".csv", ".txt", ".tmx", ".zip", ".wav", ".mp3", ".flac", ".ogg", ".m4a"],
    "max_file_size_mb": 2048,
}


# ─────────────────────────────────────────────────────────────────────────────
# Prompts  (source texts / utterances for any competition)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/prompts/next")
def get_next_prompt(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns the least-used prompt for a competition, regardless of task type.

    Audio tasks  → utterance / TTS prompt the contributor reads aloud.
    Text tasks   → organizer-supplied source text the contributor annotates
                   (classification sentence, NER passage, translation source,
                    QA context, document to summarise, etc.)

    Returns null (HTTP 200 with body `null`) when the competition has no
    prompts configured — widgets handle this gracefully by falling back to
    free-form entry.
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    prompt = (
        db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .order_by(
            CompetitionPrompt.used_count.asc(),
            CompetitionPrompt.created_at.asc(),
        )
        .first()
    )

    if not prompt:
        return None  # No prompts configured — widget falls back to free entry

    # Increment usage counter so prompts rotate fairly
    prompt.used_count = (prompt.used_count or 0) + 1
    db.commit()

    return {
        "id": str(prompt.id),
        "content": prompt.content,
        "difficulty": getattr(prompt, "difficulty", None),
        "domain": getattr(prompt, "domain", None),
        "target_emotion": getattr(prompt, "target_emotion", None),
    }


@router.post("/competitions/{competition_id}/prompts/batch")
def create_prompts_batch(
    competition_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Bulk-creates prompts / source texts for a competition: utterances to read
    aloud, or source texts shown to contributors as a starting point.

    Body:
        {
          "prompts":    ["Sentence one.", "Sentence two."],  // required
          "difficulty": "medium",   // optional, applied to all
          "domain":     "general",  // optional, applied to all
          "replace":    false       // true = wipe existing prompts first
        }

    Only the organizer may call this.
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(
            CompetitionOrganizer.competition_id == competition_id,
            CompetitionOrganizer.user_id == current_user.id,
        )
        .first()
    )
    if not is_organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can add prompts")

    prompts_text: list[str] = body.get("prompts", [])
    difficulty: str | None = body.get("difficulty")
    domain: str | None = body.get("domain")
    replace: bool = body.get("replace", False)

    if not prompts_text:
        raise HTTPException(status_code=400, detail="prompts list is required and must not be empty")

    if replace:
        db.query(CompetitionPrompt).filter(
            CompetitionPrompt.competition_id == competition_id
        ).delete()

    new_prompts = [
        CompetitionPrompt(
            competition_id=competition_id,
            content=text.strip(),
            difficulty=difficulty,
            domain=domain,
            used_count=0,
            created_at=datetime.utcnow(),
        )
        for text in prompts_text
        if text.strip()
    ]

    db.add_all(new_prompts)
    db.commit()

    return {
        "created": len(new_prompts),
        "total_prompts": db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .count(),
    }


@router.get("/competitions/{competition_id}/prompts")
def list_prompts(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Returns all prompts for a competition (organizer view)."""
    prompts = (
        db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .order_by(CompetitionPrompt.created_at.asc())
        .all()
    )
    return [
        {
            "id": str(p.id),
            "content": p.content,
            "difficulty": p.difficulty,
            "domain": p.domain,
            "used_count": p.used_count,
        }
        for p in prompts
    ]


@router.delete("/competitions/{competition_id}/prompts/{prompt_id}")
def delete_prompt(
    competition_id: str,
    prompt_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Deletes a single prompt (organizer only)."""
    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(
            CompetitionOrganizer.competition_id == competition_id,
            CompetitionOrganizer.user_id == current_user.id,
        )
        .first()
    )
    if not is_organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can delete prompts")

    prompt = (
        db.query(CompetitionPrompt)
        .filter(
            CompetitionPrompt.id == prompt_id,
            CompetitionPrompt.competition_id == competition_id,
        )
        .first()
    )
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    db.delete(prompt)
    db.commit()
    return {"deleted": prompt_id}


# ─────────────────────────────────────────────────────────────────────────────
# Hidden dataset upload / list / delete (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/{competition_id}/datasets")
async def upload_hidden_dataset(
    competition_id: str,
    file: UploadFile = File(...),
    dataset_type: str = Form("hidden_test"),
    description: str = Form(""),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")
    if not _is_organizer(db, competition_id, current_user.id):
        raise HTTPException(status_code=403, detail="Only the organizer can upload datasets")

    file_bytes = await file.read()
    file_size_mb = len(file_bytes) / (1024 * 1024)
    max_mb = DATASET_UPLOAD_CONFIG["max_file_size_mb"]
    if file_size_mb > max_mb:
        raise HTTPException(
            status_code=413,
            detail=f"File is {file_size_mb:.1f} MB. The limit is {max_mb} MB.",
        )

    dataset_id = str(uuid.uuid4())
    ext = file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "bin"
    storage_path = f"{competition_id}/{dataset_type}/{dataset_id}.{ext}"

    try:
        supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_path, file_bytes,
            {"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {exc}")

    record = CompetitionDataset(
        id=dataset_id,
        competition_id=competition_id,
        uploaded_by=current_user.id,
        dataset_type=dataset_type,
        original_filename=file.filename,
        storage_path=storage_path,
        file_size_bytes=len(file_bytes),
        description=description,
        uploaded_at=datetime.utcnow().isoformat(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "id": record.id,
        "competition_id": competition_id,
        "dataset_type": dataset_type,
        "original_filename": file.filename,
        "storage_path": storage_path,
        "file_size_bytes": len(file_bytes),
        "uploaded_at": record.uploaded_at,
    }


@router.get("/competitions/{competition_id}/datasets")
def list_datasets(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    records = (
        db.query(CompetitionDataset)
        .filter(CompetitionDataset.competition_id == competition_id)
        .order_by(CompetitionDataset.uploaded_at.desc())
        .all()
    )
    # Preserve public dataset listing, but never expose hidden evaluation files
    # or internal storage locations to participants.
    is_organizer = _is_organizer(db, competition_id, current_user.id)
    if not is_organizer:
        records = [r for r in records if not _is_hidden(r.dataset_type)]

    return [
        {
            "id": r.id,
            "dataset_type": r.dataset_type,
            "original_filename": r.original_filename,
            **({"storage_path": r.storage_path} if is_organizer else {}),
            "file_size_bytes": r.file_size_bytes,
            "description": r.description,
            "uploaded_at": r.uploaded_at,
        }
        for r in records
    ]


@router.delete("/competitions/{competition_id}/datasets/{dataset_id}")
def delete_dataset(
    competition_id: str,
    dataset_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not _is_organizer(db, competition_id, current_user.id):
        raise HTTPException(status_code=403, detail="Only the organizer can delete datasets")
    record = db.query(CompetitionDataset).filter(
        CompetitionDataset.id == dataset_id,
        CompetitionDataset.competition_id == competition_id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Dataset not found")
    try:
        supabase.storage.from_(STORAGE_BUCKET).remove([record.storage_path])
    except Exception:
        pass
    db.delete(record)
    db.commit()
    return {"deleted": dataset_id}


# ─────────────────────────────────────────────────────────────────────────────
# Dataset Hub (closed competitions only, built on the sample structure) lives in
# routes/dataset_hub.py; it is mounted on this router so routes/__init__.py is unchanged.
# It replaces the old /datasets/hub, /datasets/hub/{id}/export and /datasets/hub/{id}/stats.
# ─────────────────────────────────────────────────────────────────────────────
from .dataset_hub import router as _hub_router  # noqa: E402

router.include_router(_hub_router)