"""
routes/competitions.py

A competition has no "type". It is defined by:
  - DataComponent[]    the assets one sample is made of (Text, Audio, ...)
  - CompetitionTask[]  the tasks done on those assets (task type + target + config)
Both live in their own tables (see services/structure_service.py) and the list of
asset/task types, their option forms and their suggested starting values come from
services/task_registry.py via GET /competition-schema.

Competition.dataset_config (JSON) only carries the independent platform capabilities,
validated server-side when the matching flag is set:
  - Tracks          task_config["tracks"]           -> validate_tracks_config()
  - Phases          task_config["phases"]           -> validate_phases_config()
  - Data collection task_config["data_collection"]  -> validate_data_collection_config()
                    + task_config["license"]
  - Evaluation      task_config["evaluation_scoring"] -> validate_evaluation_scoring()
  - Team rules      task_config["team_requirements"]  -> validate_team_requirements()
Source prompts (task_config["prompts"]) are stored in competition_prompts instead.
"""

import json
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, text, func

from models import (
    Competition,
    CompetitionOrganizer,
    CompetitionParticipant,
    CompetitionJoinRequest,
    CompetitionPrompt,
    CompetitionDataset,
    CompetitionTask,
    Sample,
    Submission,
    DataSample,
)
from schemas import CompetitionCreateIn, CompetitionActionOut
from services.task_registry import registry_payload
from services.structure_service import (
    validate_or_400, sync_structure, load_structure, task_types_by_competition,
)
from services.rules_service import active_tracks, rules_to_accept
from services.phase_access import PAGE_KEYS, phase_state
from services.eligibility_service import (
    check_individual, check_team, describe_rules, read_rules,
)
from .utils import get_db, get_current_user
from .datasets import DATASET_UPLOAD_CONFIG

router = APIRouter(tags=["competitions"])

MAX_ANNOTATORS_PER_INSTANCE = 25   # keep in sync with MAX_ANNOTATORS in CreateCompetition.jsx

def parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None


def compute_competition_status(competition: Competition):
    if competition.is_draft:
        return "DRAFT"

    today = date.today()
    start = parse_date(competition.start_date)
    end = parse_date(competition.end_date)

    if start and today < start:
        return "UPCOMING"
    if start and end and start <= today <= end:
        return "OPEN"
    if end and today > end:
        return "CLOSED"

    return "OPEN"


def task_category(competition: Competition, task_types: list | None = None):
    """
    Kept for older clients. A competition no longer has ONE type: it has
    CompetitionTask[]; use `task_types` (the distinct generic task types).
    """
    if task_types:
        return task_types[0] if len(task_types) == 1 else "MULTI_TASK"
    return "GENERAL"


def competition_display_dict(competition: Competition, task_types: list | None = None) -> dict:
    real_status = compute_competition_status(competition)

    if real_status == "UPCOMING":
        footer = "UPCOMING"
    elif real_status == "OPEN":
        footer = "ACTIVE"
    elif real_status == "CLOSED":
        footer = "ENDED"
    else:
        footer = real_status

    base = {c.name: getattr(competition, c.name) for c in competition.__table__.columns}

    # `dataset_config` is the column name, but since the CreateCompetition
    # wizard was extended it actually stores the full organizer-defined task
    # config: tracks, phases, data_collection rules, license, and evaluation
    # scoring. Parse it once here so every consumer (details page, teams
    # panel, etc.) gets a real dict under `task_config` instead of having to
    # re-parse (or silently ignore, as the details page used to) a raw JSON
    # string.
    try:
        task_config = json.loads(competition.dataset_config or "{}")
        if not isinstance(task_config, dict):
            task_config = {}
    except (TypeError, ValueError):
        task_config = {}

    base.update(
        {
            "task_types": list(task_types or []),
            "category": task_category(competition, task_types),
            "status": real_status,
            "stat1_label": "REWARD",
            "stat1_value": f"${competition.prize_pool:,}" if competition.prize_pool is not None else "TBD",
            "stat2_label": "DEADLINE",
            "stat2_value": competition.end_date or "TBD",
            "footer": footer,
            "muted": False,
            "datasets_json": "[]",
            "join_method": competition.join_method or "auto",
            "task_config": task_config,
            "tracks_enabled": bool(task_config.get("tracks_enabled")),
            "phases_enabled": bool(task_config.get("phases_enabled")),
            # the wizard stores the flag explicitly; fall back to the block for older records
            "data_collection_enabled": bool(task_config.get("data_collection_enabled", bool(task_config.get("data_collection")))),
        }
    )

    return base


def delete_competition_related_rows(db: Session, competition_id: str):
    # Generic structure, children first (annotations/sample_assets -> samples/tasks/components)
    db.execute(text("DELETE FROM notifications WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_join_requests WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM experiment_runs WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM experiment_workspaces WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM submissions WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM data_samples WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM sample_assignments WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM annotations WHERE sample_id IN (SELECT id FROM samples WHERE competition_id = :cid)"), {"cid": competition_id})
    db.execute(text("DELETE FROM sample_assets WHERE sample_id IN (SELECT id FROM samples WHERE competition_id = :cid)"), {"cid": competition_id})
    db.execute(text("DELETE FROM samples WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("UPDATE competition_tasks SET target_task_id = NULL WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_tasks WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM data_components WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_datasets WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_participants WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_organizers WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM recent_competitions WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM competition_prompts WHERE competition_id = :cid"), {"cid": competition_id})
    db.execute(text("DELETE FROM dataset_versions WHERE competition_id = :cid"), {"cid": competition_id})


def _derive_collection_inputs(clean_assets: list[dict]) -> list[dict]:
    """A contributed instance IS a sample, so its inputs are exactly the sample's
    assets. Derived from the structure so the two can never drift apart."""
    inputs = []
    for a in clean_assets:
        c = a["constraints"]
        audio = a["type"] == "AUDIO"
        inputs.append({
            "name": a["name"],
            "asset_key": a["key"],
            "modality": "audio" if audio else "text",
            "max_length": c.get("max_duration_seconds") if audio else c.get("max_words"),
        })
    return inputs


def validate_team_requirements(data: CompetitionCreateIn, task_config: dict):
    """task_config.team_requirements.skill_members = {skill: N | "all"} — how many team
    members must have each required skill. Must refer to a required skill and be satisfiable."""
    rules = ((task_config or {}).get("team_requirements") or {}).get("skill_members") or {}
    if not isinstance(rules, dict):
        raise HTTPException(status_code=400, detail="Invalid team skill requirements")
    for skill, members in rules.items():
        if skill not in (data.required_skills or []):
            raise HTTPException(status_code=400, detail=f"Team skill rule for '{skill}', which is not a required skill")
        if members == "all":
            continue
        if isinstance(members, bool) or not isinstance(members, int) or members < 1:
            raise HTTPException(status_code=400, detail=f"Members needing '{skill}' must be 1 or more, or all members")
        if data.max_members and members > data.max_members:
            raise HTTPException(
                status_code=400,
                detail=f"{members} members must have '{skill}', but teams can have at most {data.max_members}",
            )


def validate_competition_payload(data: CompetitionCreateIn):
    """Validates the payload and returns (clean_assets, clean_tasks)."""
    if not data.competition_name or not data.competition_name.strip():
        raise HTTPException(status_code=400, detail="Competition name is required")
    if not data.description or not data.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")

    start = parse_date(data.start_date)
    end = parse_date(data.end_date)

    if data.start_date and not start:
        raise HTTPException(status_code=400, detail="Invalid start date format")
    if data.end_date and not end:
        raise HTTPException(status_code=400, detail="Invalid end date format")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    if not data.primary_metric:
        raise HTTPException(status_code=400, detail="Primary metric is required")
    if data.secondary_metric and data.secondary_metric == data.primary_metric:
        raise HTTPException(status_code=400, detail="The secondary metric must differ from the primary metric")

    if data.prize_pool is not None and data.prize_pool < 0:
        raise HTTPException(status_code=400, detail="Prize pool cannot be negative")
    if data.max_teams is not None and data.max_teams < 0:
        raise HTTPException(status_code=400, detail="Max teams cannot be negative")
    if data.min_members is not None and data.min_members <= 0:
        raise HTTPException(status_code=400, detail="Min team members must be greater than 0")
    if data.max_members is not None and data.max_members <= 0:
        raise HTTPException(status_code=400, detail="Max team members must be greater than 0")
    if data.min_members is not None and data.max_members is not None and data.min_members > data.max_members:
        raise HTTPException(status_code=400, detail="Min team members cannot exceed max team members")
    if data.max_submissions_per_day is not None and data.max_submissions_per_day <= 0:
        raise HTTPException(status_code=400, detail="Max submissions per day must be greater than 0")

    merge_deadline = parse_date(data.merge_deadline)
    validation_date = parse_date(data.validation_date)
    freeze_date = parse_date(data.freeze_date)

    if data.merge_deadline and not merge_deadline:
        raise HTTPException(status_code=400, detail="Invalid merge deadline format")
    if data.validation_date and not validation_date:
        raise HTTPException(status_code=400, detail="Invalid validation date format")
    if data.freeze_date and not freeze_date:
        raise HTTPException(status_code=400, detail="Invalid freeze date format")

    for label, value in [
        ("Merge deadline", merge_deadline),
        ("Validation date", validation_date),
        ("Freeze date", freeze_date),
    ]:
        if value and start and value < start:
            raise HTTPException(status_code=400, detail=f"{label} cannot be before start date")
        if value and end and value > end:
            raise HTTPException(status_code=400, detail=f"{label} cannot be after end date")

    if validation_date and freeze_date and freeze_date < validation_date:
        raise HTTPException(status_code=400, detail="Freeze date cannot be before validation date")

    clean_assets, clean_tasks = validate_or_400(
        [a.model_dump() for a in data.assets], [t.model_dump() for t in data.tasks]
    )

    task_config = getattr(data, "task_config", None) or {}
    validate_team_requirements(data, task_config)
    if getattr(data, "data_collection_enabled", False):
        task_config.setdefault("data_collection", {})["inputs"] = _derive_collection_inputs(clean_assets)
        data.task_config = task_config

    if getattr(data, "tracks_enabled", False):
        validate_tracks_config(task_config.get("tracks") or [], data.max_teams)

    if getattr(data, "phases_enabled", False):
        validate_phases_config(task_config.get("phases") or [], start, end)

    if getattr(data, "data_collection_enabled", False):
        validate_data_collection_config(
            task_config.get("data_collection") or {},
            task_config.get("license") or {},
            data.min_members,
        )

    # Independent of the flags above: whenever combined evaluation scoring is
    # selected, its weights must be valid, whether or not tracks are enabled.
    validate_evaluation_scoring(task_config.get("evaluation_scoring") or {})
    if (task_config.get("evaluation_scoring") or {}).get("mode") == "data_quality_plus_model" \
            and not getattr(data, "data_collection_enabled", False):
        raise HTTPException(status_code=400, detail="Combined data-quality + model scoring needs Data Collection to be enabled")

    return clean_assets, clean_tasks


def validate_tracks_config(tracks: list, max_teams=None):
    """
    Split participants into fair comparison groups, each viable only once it
    reaches its own minimum team count. Runs whenever tracks_enabled=True so a
    direct API call can't skip the checks the CreateCompetition wizard enforces.
    """
    if not tracks:
        raise HTTPException(status_code=400, detail="At least one track is required when Tracks is enabled")
    for t in tracks:
        if not (t.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="Every track needs a name")
        if not t.get("minTeams") or int(t["minTeams"]) < 1:
            raise HTTPException(status_code=400, detail=f"Track '{t.get('name')}' needs a minimum team count of at least 1")
    names = [(t.get("name") or "").strip().lower() for t in tracks]
    if len(set(names)) != len(names):
        raise HTTPException(status_code=400, detail="Track names must be unique")
    # every team belongs to exactly one track, so the minimums have to fit inside the team cap
    needed = sum(int(t["minTeams"]) for t in tracks)
    if max_teams and needed > max_teams:
        raise HTTPException(
            status_code=400,
            detail=f"The tracks need at least {needed} teams in total, but the competition is limited to {max_teams} teams",
        )


def validate_phases_config(phases: list, start=None, end=None):
    """
    An ordered, named timeline replacing the flat start/end date pair.
    Runs whenever phases_enabled=True.
    """
    if not phases:
        raise HTTPException(status_code=400, detail="At least one phase is required when Phases is enabled")
    for p in phases:
        if not (p.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="Every phase needs a name")
        if not p.get("durationDays") or int(p["durationDays"]) <= 0:
            raise HTTPException(status_code=400, detail=f"Phase '{p.get('name')}' needs a duration greater than 0 days")
        # members read this on the locked-page screen
        if not (p.get("description") or "").strip():
            raise HTTPException(status_code=400, detail=f"Phase '{p.get('name')}' needs a description")
        # allowedPages: missing = legacy phase (every page open); otherwise a list of known page keys
        pages = p.get("allowedPages")
        if pages is not None:
            if not isinstance(pages, list):
                raise HTTPException(status_code=400, detail=f"Phase '{p.get('name')}': allowedPages must be a list")
            unknown = [k for k in pages if k not in PAGE_KEYS]
            if unknown:
                raise HTTPException(status_code=400, detail=f"Phase '{p.get('name')}': unknown page(s) {', '.join(map(str, unknown))}")
    if start and end:
        total = sum(int(p["durationDays"]) for p in phases)
        window = (end - start).days + 1
        if total > window:
            raise HTTPException(
                status_code=400,
                detail=f"The phases add up to {total} days, but the competition only runs {window} days",
            )


def annotator_limit_message(annotators: int, smallest_team: int) -> str:
    return (
        f"Annotators per instance is limited by team size: each team's data is annotated only by its own "
        f"members, and the smallest team allowed has {smallest_team} member{'s' if smallest_team != 1 else ''}. "
        f"Choose {smallest_team} or fewer annotators, or raise Min Team Members to at least {annotators}."
    )


def validate_data_collection_config(data_collection: dict, license_cfg: dict, min_members=None):
    """
    Participants source, record, or adapt their own raw data instead of using
    an organizer-provided dataset. Runs whenever data_collection_enabled=True,
    independent of task type or which/how many labels are being annotated.

    An instance can carry more than one input (e.g. Question Answering needs
    a "Question" and a "Context Passage", both text), so this validates a
    list of named inputs rather than a single modality.
    """
    inputs = data_collection.get("inputs") or []
    if not inputs:
        raise HTTPException(status_code=400, detail="Define at least one input for Data Collection")
    for inp in inputs:
        if not (inp.get("name") or "").strip():
            raise HTTPException(status_code=400, detail="Every input needs a name")
        if inp.get("modality") not in ("text", "audio"):
            raise HTTPException(status_code=400, detail=f"Input '{inp.get('name')}' needs a modality of 'text' or 'audio'")
        if not inp.get("max_length") or float(inp["max_length"]) <= 0:
            raise HTTPException(status_code=400, detail=f"Input '{inp.get('name')}' needs a positive maximum length")

    if not data_collection.get("allowed_source_types"):
        raise HTTPException(status_code=400, detail="Select at least one allowed data source")
    try:
        annotators = int(data_collection.get("annotators_per_instance"))
    except (TypeError, ValueError):
        annotators = 0
    if annotators < 1:
        raise HTTPException(status_code=400, detail="At least one annotator per instance is required")
    if annotators > MAX_ANNOTATORS_PER_INSTANCE:
        raise HTTPException(status_code=400, detail=f"At most {MAX_ANNOTATORS_PER_INSTANCE} annotators per instance")
    # Each team's data is annotated only by its own members, so the annotators per instance
    # can never exceed the smallest team the competition accepts (no minimum set = teams of 1).
    smallest_team = min_members if isinstance(min_members, int) and min_members >= 1 else 1
    if annotators > smallest_team:
        raise HTTPException(status_code=400, detail=annotator_limit_message(annotators, smallest_team))

    if not (license_cfg.get("version") or "").strip():
        raise HTTPException(status_code=400, detail="A license version is required before contributors can accept it")
    if not (license_cfg.get("text") or "").strip():
        raise HTTPException(status_code=400, detail="License text is required when Data Collection is enabled")


def validate_evaluation_scoring(evaluation: dict):
    """
    "standard" ranks on the primary metric alone and needs no extra checks;
    "data_quality_plus_model" combines a per-team data-quality score with each
    team's own model score, so its weights must be valid regardless of which
    other capabilities (tracks, phases, data collection) are turned on.
    """
    if evaluation.get("mode") != "data_quality_plus_model":
        return

    dq = evaluation.get("data_quality_weight")
    mw = evaluation.get("model_weight")
    if dq is None or mw is None or abs((float(dq) + float(mw)) - 100) > 0.01:
        raise HTTPException(status_code=400, detail="Data quality weight + model weight must add up to 100")
    fraction = evaluation.get("public_test_fraction")
    if fraction is not None and not (0 <= float(fraction) <= 100):
        raise HTTPException(status_code=400, detail="Held-out test fraction must be between 0 and 100")
    if not evaluation.get("winners_per_track") or int(evaluation["winners_per_track"]) < 1:
        raise HTTPException(status_code=400, detail="At least 1 winner is required")


def _clean_list_values(cfg: dict) -> dict:
    """
    Strip empty/whitespace-only strings from any list values in a task config
    dict. This prevents blank label buttons when the organizer leaves trailing
    newlines in the textarea form fields.
    """
    cleaned = {}
    for k, v in cfg.items():
        if isinstance(v, list):
            # Only blank strings are noise. Lists of objects (tracks, phases) must survive —
            # filtering to strings here used to empty them on every save.
            cleaned[k] = [item for item in v if not (isinstance(item, str) and not item.strip())]
        else:
            cleaned[k] = v
    return cleaned


def build_competition_record(data: CompetitionCreateIn, is_draft: bool) -> Competition:
    task_config = getattr(data, "task_config", None) or {}
    # No competition types: nothing to merge defaults from. Assets/tasks live in
    # their own tables; dataset_config only carries tracks/phases/data-collection/
    # license/evaluation. "prompts" live in competition_prompts.
    config_to_store = _clean_list_values({k: v for k, v in task_config.items() if k != "prompts"})

    return Competition(
        title=data.competition_name,
        description=data.description,
        is_draft=is_draft,
        start_date=data.start_date,
        end_date=data.end_date,
        prize_pool=data.prize_pool,
        primary_metric=data.primary_metric,
        secondary_metric=data.secondary_metric,
        max_teams=data.max_teams,
        min_members=data.min_members,
        max_members=data.max_members,
        merge_deadline=data.merge_deadline,
        required_skills=json.dumps(data.required_skills or []),
        max_submissions_per_day=data.max_submissions_per_day,
        allow_external_data=data.allow_external_data,
        allow_pretrained_models=data.allow_pretrained_models,
        require_code_sharing=data.require_code_sharing,
        additional_rules=data.additional_rules,
        complexity_level=data.complexity_level,
        validation_date=data.validation_date,
        freeze_date=data.freeze_date,
        dataset_config=json.dumps(config_to_store),
        join_method=getattr(data, "join_method", "auto") or "auto",
    )


def _seed_prompts(db: Session, competition_id: str, task_config: dict):
    """
    Source prompts (sentences to read aloud, texts to annotate...).

    * No "prompts" key in the request  -> leave the stored prompts alone.
    * An empty list                    -> remove them all.
    * Unchanged list                   -> do nothing, so prompt ids and used_count survive
                                          (samples reference prompt ids in their metadata).
    * Otherwise                        -> replace them.
    """
    if "prompts" not in task_config:
        return

    wanted = [c.strip() for c in (task_config.get("prompts") or []) if isinstance(c, str) and c.strip()]
    existing = [
        row[0] for row in db.query(CompetitionPrompt.content)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .order_by(CompetitionPrompt.created_at.asc(), CompetitionPrompt.id.asc())
        .all()
    ]
    if existing == wanted:
        return

    db.execute(
        text("DELETE FROM competition_prompts WHERE competition_id = :cid"),
        {"cid": competition_id},
    )
    for content in wanted:
        db.add(CompetitionPrompt(
            competition_id=competition_id,
            content=content,
            used_count=0,
            created_at=datetime.utcnow().isoformat(),
        ))


def _persist_structure(db: Session, competition: Competition, data: CompetitionCreateIn,
                       clean: tuple | None, is_draft: bool):
    """
    Publish: `clean` is the validated (assets, tasks) and goes to the tables.
    Draft: the organizer may be mid-way, so try to validate; if the structure
    isn't valid yet, keep the raw input in dataset_config["structure_draft"] so
    nothing is lost and the wizard can restore it. Tables are never written
    with an invalid structure.
    """
    cfg = json.loads(competition.dataset_config or "{}")
    if clean is None:
        try:
            clean = validate_or_400(
                [a.model_dump() for a in data.assets], [t.model_dump() for t in data.tasks]
            )
        except HTTPException:
            clean = None

    if clean is not None:
        sync_structure(db, competition.id, clean[0], clean[1])
        cfg.pop("structure_draft", None)
    elif is_draft:
        cfg["structure_draft"] = {
            "assets": [a.model_dump() for a in data.assets],
            "tasks": [t.model_dump() for t in data.tasks],
        }
    competition.dataset_config = json.dumps(cfg)


def parse_task_type_filter(task_type: str | None, category: str | None = None) -> list[str]:
    """`task_type` is a comma-separated list of generic task types ("CLASSIFICATION,SPAN_ANNOTATION");
    `category` is the old parameter name, still accepted. "ALL TASKS"/empty = no filter."""
    raw = task_type or category or ""
    out = []
    for part in raw.split(","):
        part = part.strip().upper().replace(" ", "_")
        if part and part != "ALL_TASKS":
            out.append(part)
    return out


def apply_competition_filters(query, db, search, task_types, tab, current_user):
    """
    task_types: generic task types; a competition matches when ANY of its tasks has
    one of them — even if it also contains other kinds of task.
    """
    if search:
        term = f"%{search}%"
        typed = f"%{search.strip().upper().replace(' ', '_')}%"
        with_matching_task = db.query(CompetitionTask.competition_id).filter(CompetitionTask.type.ilike(typed))
        query = query.filter(
            or_(
                Competition.title.ilike(term),
                Competition.description.ilike(term),
                Competition.id.in_(with_matching_task),
            )
        )

    if task_types:
        # Any competition that has at least one task of a selected type, whatever other tasks it has.
        with_task = db.query(CompetitionTask.competition_id).filter(CompetitionTask.type.in_(task_types))
        query = query.filter(Competition.id.in_(with_task))

    if tab == "participating":
        ids = db.query(CompetitionParticipant.competition_id).filter(
            CompetitionParticipant.user_id == current_user.id
        )
        query = query.filter(Competition.id.in_(ids))
    elif tab == "organizing":
        ids = db.query(CompetitionOrganizer.competition_id).filter(
            CompetitionOrganizer.user_id == current_user.id
        )
        query = query.filter(Competition.id.in_(ids))

    return query


def get_user_role(db: Session, competition_id: str, user_id: str):
    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id == competition_id, CompetitionOrganizer.user_id == user_id)
        .first()
        is not None
    )
    if is_organizer:
        return "organizer"

    is_participant = (
        db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id == competition_id, CompetitionParticipant.user_id == user_id)
        .first()
        is not None
    )
    if is_participant:
        return "participant"

    return "none"

def _parse_skills(raw) -> list:
    """Return list of skill strings from JSON text/list."""
    if not raw:
        return []

    if isinstance(raw, list):
        return [str(s).strip() for s in raw if str(s).strip()]

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(s).strip() for s in parsed if str(s).strip()]
        return []
    except Exception:
        return []


def _get_user_skills(db: Session, user_id: str) -> list[str]:
    row = db.execute(
        text("SELECT skills FROM user_profiles WHERE user_id = :uid"),
        {"uid": str(user_id)},
    ).first()

    if not row or not row[0]:
        return []

    value = row[0]

    if isinstance(value, list):
        return [str(s).strip() for s in value if str(s).strip()]

    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(s).strip() for s in parsed if str(s).strip()]
    except Exception:
        pass

    return []


def _format_user_names(db: Session, user_ids: list[str]) -> str:
    from models import UserProfile

    if not user_ids:
        return ""

    profiles = (
        db.query(UserProfile)
        .filter(UserProfile.user_id.in_([str(uid) for uid in user_ids]))
        .all()
    )

    by_id = {str(p.user_id): p for p in profiles}

    labels = []

    for uid in user_ids:
        p = by_id.get(str(uid))
        if p:
            labels.append(p.full_name or p.email or str(uid))
        else:
            labels.append(str(uid))

    return ", ".join(labels)


def _raise_if_team_has_organizer(
    db: Session,
    competition_id: str,
    member_rows,
):
    member_ids = [str(m.user_id) for m in member_rows]

    organizer_rows = (
        db.query(CompetitionOrganizer)
        .filter(
            CompetitionOrganizer.competition_id == competition_id,
            CompetitionOrganizer.user_id.in_(member_ids),
        )
        .all()
    )

    organizer_ids = [str(row.user_id) for row in organizer_rows]

    if organizer_ids:
        names = _format_user_names(db, organizer_ids)

        raise HTTPException(
            status_code=400,
            detail=(
                "This team cannot join because one or more team members are organizers "
                f"of this competition: {names}. Remove them from the team or choose another team."
            ),
        )


def _raise_if_team_members_already_joined(
    db: Session,
    competition_id: str,
    team_id: str,
    member_rows,
):
    member_ids = [str(m.user_id) for m in member_rows]

    existing_rows = (
        db.query(CompetitionParticipant)
        .filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.user_id.in_(member_ids),
        )
        .all()
    )

    if not existing_rows:
        return

    existing_ids = [str(row.user_id) for row in existing_rows]
    names = _format_user_names(db, existing_ids)

    raise HTTPException(
        status_code=400,
        detail=(
            "This team cannot join because one or more team members have already joined "
            f"this competition: {names}."
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Eligibility — rules live in services/eligibility_service.py (pure); this is the DB side.
# The same checks drive the join dialog (/join-options) and are enforced by /join,
# /join-team and join-request approval, so what the dialog offers is what is accepted.
# ─────────────────────────────────────────────────────────────────────────────

def _rules_for(competition: Competition):
    task_config = competition_display_dict(competition).get("task_config") or {}
    return read_rules(competition, task_config), task_config


def _capacity_reason(db: Session, competition: Competition, rules: dict) -> str | None:
    """Each team, and each individual, takes one of the competition's `max_teams` places."""
    if not rules["max_teams"]:
        return None
    taken = db.execute(
        text("SELECT COUNT(DISTINCT COALESCE(team_id, user_id)) FROM competition_participants "
             "WHERE competition_id = :cid"),
        {"cid": competition.id},
    ).scalar() or 0
    if taken >= rules["max_teams"]:
        return f"This competition is full ({rules['max_teams']} places)."
    return None


def _team_member_info(db: Session, member_rows) -> list[dict]:
    from models import UserProfile

    ids = [str(m.user_id) for m in member_rows]
    names = {p.user_id: p.full_name for p in db.query(UserProfile).filter(UserProfile.user_id.in_(ids))}
    return [{
        "user_id": str(m.user_id),
        "name": names.get(str(m.user_id)) or str(m.user_id),
        "role": m.role,
        "skills": _get_user_skills(db, m.user_id),
    } for m in member_rows]


def _blockers(fn, *args) -> list[str]:
    """Run a helper that raises HTTPException, and return its message as a reason instead."""
    try:
        fn(*args)
        return []
    except HTTPException as exc:
        return [str(exc.detail)]


def _team_reasons(db: Session, competition: Competition, rules: dict, team_id: str, member_rows) -> list[str]:
    reasons = check_team(rules, _team_member_info(db, member_rows))
    reasons += _blockers(_raise_if_team_has_organizer, db, competition.id, member_rows)
    reasons += _blockers(_raise_if_team_members_already_joined, db, competition.id, team_id, member_rows)
    cap = _capacity_reason(db, competition, rules)
    if cap:
        reasons.append(cap)
    return reasons


def _require_track_and_rules(competition: Competition, body: dict):
    """
    Joining requires (1) choosing a track when the competition has tracks and (2) agreeing to all
    the rules. Enforced here on the server, not only in the dialog.
    Returns (track_id | None, rules_accepted_at).
    """
    d = competition_display_dict(competition)
    task_config = d.get("task_config") or {}
    track_id = str(body.get("track_id") or "").strip() or None
    if track_id and not task_config.get("tracks_enabled"):
        raise HTTPException(status_code=400, detail="This competition does not use tracks")
    if active_tracks(task_config) and not track_id:
        raise HTTPException(status_code=400, detail="Select a track to join this competition.")
    _validate_track_selection(task_config, track_id)
    if body.get("accept_rules") is not True:
        raise HTTPException(status_code=400, detail="You must agree to the competition rules to join.")
    return track_id, datetime.utcnow().isoformat()


def _do_join_competition(db: Session, competition: Competition, user_id: str, team_id=None, track_id=None,
                         rules_accepted_at=None):
    participant = CompetitionParticipant(
        competition_id=competition.id,
        user_id=user_id,
        team_id=team_id,
        status="joined",
        joined_at=datetime.utcnow().isoformat(),
    )
    db.add(participant)

    if track_id or rules_accepted_at:
        db.flush()
    if track_id:
        _set_participant_track_id(db, participant.id, track_id)
    if rules_accepted_at:
        _set_participant_rules_accepted(db, participant.id, rules_accepted_at)

    return participant


# ─────────────────────────────────────────────────────────────────────────────
# Track assignment helpers
#
# Tracks (e.g. regional dialect tracks) live inside task_config, not as their
# own table — but WHICH track a team registered for has to be recorded
# somewhere so organizers can count teams per track and remove tracks that
# never reach their minimum. That requires a `track_id` column on
# competition_participants (see migrations/2026_add_track_support.sql).
#
# These helpers check for that column once per process and no-op instead of
# raising if the migration hasn't been applied yet, so track selection is
# additive and never breaks a plain join.
# ─────────────────────────────────────────────────────────────────────────────

_column_cache: dict = {}
_track_column_cache = _column_cache   # kept for older tests/imports


def _participants_have_column(db: Session, column: str) -> bool:
    """These columns arrive by migration; check once per process and no-op if it hasn't run yet,
    so recording a track / acceptance never breaks a plain join."""
    key = f"competition_participants.{column}"
    if _column_cache.get(key) is None:
        try:
            row = db.execute(
                text("SELECT column_name FROM information_schema.columns "
                     "WHERE table_name = 'competition_participants' AND column_name = :c"),
                {"c": column},
            ).first()
            _column_cache[key] = row is not None
        except Exception:
            _column_cache[key] = False
    return _column_cache[key]


def _participants_have_track_column(db: Session) -> bool:
    return _participants_have_column(db, "track_id")


def _set_participant_track_id(db: Session, participant_id, track_id):
    if not _participants_have_track_column(db):
        return
    db.execute(
        text("UPDATE competition_participants SET track_id = :tid WHERE id = :pid"),
        {"tid": str(track_id), "pid": participant_id},
    )


def _set_participant_rules_accepted(db: Session, participant_id, accepted_at: str):
    if not _participants_have_column(db, "rules_accepted_at"):
        return
    db.execute(
        text("UPDATE competition_participants SET rules_accepted_at = :t WHERE id = :pid"),
        {"t": accepted_at, "pid": participant_id},
    )


def _get_track_team_counts(db: Session, competition_id: str) -> dict:
    """Returns {track_id: distinct_team_count} for a competition. Counts
    individual (non-team) participants too, keyed the same way, so tracks
    work whether or not the competition requires teams."""
    if not _participants_have_track_column(db):
        return {}
    rows = db.execute(
        text(
            "SELECT track_id, COUNT(DISTINCT COALESCE(team_id, user_id)) AS cnt "
            "FROM competition_participants "
            "WHERE competition_id = :cid AND track_id IS NOT NULL "
            "GROUP BY track_id"
        ),
        {"cid": competition_id},
    ).all()
    return {str(r.track_id): int(r.cnt) for r in rows}


def _validate_track_selection(task_config: dict, track_id):
    """Raises if track_id doesn't refer to a real, still-active track."""
    if not track_id:
        return
    tracks = (task_config or {}).get("tracks") or []
    match = next((t for t in tracks if str(t.get("id")) == str(track_id)), None)
    if not match:
        raise HTTPException(status_code=400, detail="Selected track does not exist for this competition")
    if match.get("active") is False:
        raise HTTPException(
            status_code=400,
            detail=f"Track '{match.get('name')}' did not reach its minimum team count and is no longer accepting teams",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Dataset-config endpoint  ← used by DataCollection.jsx to populate widgets
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/dataset-config")
def get_dataset_config(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns what the data-collection and dataset-upload widgets need: the hidden-dataset
    upload rules, the organizer's stored config (tracks, phases, data collection, license,
    evaluation...), the number of source prompts, and the structure (assets + tasks).
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    try:
        stored = json.loads(competition.dataset_config or "{}")
    except (json.JSONDecodeError, TypeError):
        stored = {}

    merged = _clean_list_values(stored if isinstance(stored, dict) else {})
    # Upload rules for the hidden dataset (same for every competition); stored config wins.
    merged = {**DATASET_UPLOAD_CONFIG, **merged}

    merged.pop("structure_draft", None)
    merged["prompt_count"] = (
        db.query(CompetitionPrompt)
        .filter(CompetitionPrompt.competition_id == competition_id)
        .count()
    )
    # Generic structure: what a sample contains and which tasks run on it.
    merged.update(load_structure(db, competition_id))
    return merged


# ─────────────────────────────────────────────────────────────────────────────
# Asset / task type registry (drives the wizard's forms — nothing hard-coded there)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competition-schema")
def get_competition_schema(current_user=Depends(get_current_user)):
    return registry_payload()


# ─────────────────────────────────────────────────────────────────────────────
# Competition count
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/count")
def get_competitions_count(
    search: str | None = None,
    task_type: str | None = None,
    category: str | None = None,     # deprecated alias of task_type
    status: str | None = None,
    tab: str = "all",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = db.query(Competition)
    query = apply_competition_filters(
        query, db, search, parse_task_type_filter(task_type, category), tab, current_user)
    if tab != "organizing":
        query = query.filter(Competition.is_draft == False)

    competitions = query.all()

    if status:
        wanted = status.upper()
        return {"count": sum(1 for comp in competitions if compute_competition_status(comp) == wanted)}

    return {"count": len(competitions)}


# ─────────────────────────────────────────────────────────────────────────────
# Draft
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/draft", response_model=CompetitionActionOut)
def save_competition_draft(
    data: CompetitionCreateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = build_competition_record(data, is_draft=True)

    db.add(competition)
    db.flush()
    _persist_structure(db, competition, data, None, is_draft=True)

    db.add(
        CompetitionOrganizer(
            competition_id=competition.id,
            user_id=current_user.id,
            role="owner",
            created_at=datetime.utcnow().isoformat(),
        )
    )

    task_config = getattr(data, "task_config", None) or {}
    _seed_prompts(db, competition.id, task_config)

    db.commit()
    db.refresh(competition)

    return {"message": "Competition draft saved successfully", "competition_id": competition.id}


# ─────────────────────────────────────────────────────────────────────────────
# Create
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/competitions/create", response_model=CompetitionActionOut)
def create_competition(
    data: CompetitionCreateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    clean = validate_competition_payload(data)

    competition = build_competition_record(data, is_draft=False)
    db.add(competition)
    db.flush()
    _persist_structure(db, competition, data, clean, is_draft=False)

    db.add(
        CompetitionOrganizer(
            competition_id=competition.id,
            user_id=current_user.id,
            role="owner",
            created_at=datetime.utcnow().isoformat(),
        )
    )

    task_config = getattr(data, "task_config", None) or {}
    _seed_prompts(db, competition.id, task_config)

    db.commit()
    db.refresh(competition)

    return {"message": "Competition created successfully", "competition_id": competition.id}


# ─────────────────────────────────────────────────────────────────────────────
# List / search
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions")
def get_competitions(
    limit: int = 20,
    offset: int = 0,
    search: str | None = None,
    task_type: str | None = None,
    category: str | None = None,     # deprecated alias of task_type
    status: str | None = None,
    tab: str = "all",
    sort: str = "newest",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = db.query(Competition)
    query = apply_competition_filters(
        query, db, search, parse_task_type_filter(task_type, category), tab, current_user)
    # Drafts should only ever be visible to their own organizer, and only in
    # the "My Organizing" view — apply_competition_filters() has already
    # scoped "organizing" down to competitions this user actually organizes.
    if tab != "organizing":
        query = query.filter(Competition.is_draft == False)

    competitions = query.all()

    def valid_date_value(value):
        return parse_date(value) is not None

    if sort == "unknown_dates":
        competitions = [c for c in competitions if not valid_date_value(c.start_date) or not valid_date_value(c.end_date)]
    elif sort == "oldest":
        competitions = [c for c in competitions if valid_date_value(c.start_date)]
        competitions.sort(key=lambda c: parse_date(c.start_date))
    else:
        competitions = [c for c in competitions if valid_date_value(c.start_date)]
        competitions.sort(key=lambda c: parse_date(c.start_date), reverse=True)

    if status:
        wanted = status.upper()
        competitions = [comp for comp in competitions if compute_competition_status(comp) == wanted]

    competitions = competitions[offset: offset + limit]

    if not competitions:
        return []

    comp_ids = [c.id for c in competitions]

    organized_ids = {
        row.competition_id
        for row in db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id.in_(comp_ids), CompetitionOrganizer.user_id == current_user.id)
        .all()
    }

    participated_ids = {
        row.competition_id
        for row in db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id.in_(comp_ids), CompetitionParticipant.user_id == current_user.id)
        .all()
    }

    types_by_comp = task_types_by_competition(db, comp_ids)

    result = []
    for comp in competitions:
        d = competition_display_dict(comp, types_by_comp.get(comp.id))

        if comp.id in organized_ids:
            d["user_role"] = "organizer"
        elif comp.id in participated_ids:
            d["user_role"] = "participant"
        else:
            d["user_role"] = "none"

        result.append(d)

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Is-joined
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/is-joined")
def is_joined_competition(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    role = get_user_role(db, competition_id, current_user.id)
    return {"joined": role == "participant", "user_role": role}


# ─────────────────────────────────────────────────────────────────────────────
# Join
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/join-options")
def join_options(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Everything the join dialog needs, computed from the organizer's rules:
      - whether this user can join individually, and if not why
      - the teams this user LEADS (only a leader can join for a team), each marked
        eligible or not with the reasons — the dialog offers only eligible ones
      - how joining works (instant, or organizer approval) and the tracks to choose from
    """
    from models_teams import Team, TeamMember

    competition = (db.query(Competition)
                   .filter(Competition.id == competition_id, Competition.is_draft == False).first())  # noqa: E712
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    uid = str(current_user.id)
    rules, task_config = _rules_for(competition)
    status = compute_competition_status(competition)
    role = get_user_role(db, competition_id, uid)
    pending = (db.query(CompetitionJoinRequest)
               .filter(CompetitionJoinRequest.competition_id == competition_id,
                       CompetitionJoinRequest.status == "pending",
                       CompetitionJoinRequest.user_id == uid).first() is not None)

    blocked = None
    if status != "OPEN":
        blocked = f"This competition is {status.lower()} and cannot be joined."
    elif role == "organizer":
        blocked = "Organizers cannot join their own competition."
    elif role == "participant":
        blocked = "You have already joined this competition."
    elif pending:
        blocked = "You already have a pending join request."

    capacity = _capacity_reason(db, competition, rules)
    individual_reasons = check_individual(rules, _get_user_skills(db, uid)) + ([capacity] if capacity else [])

    teams, not_leader = [], 0
    for tm in db.query(TeamMember).filter(TeamMember.user_id == uid).all():
        if tm.role != "leader":
            not_leader += 1
            continue
        team = db.query(Team).filter(Team.id == tm.team_id).first()
        rows = db.query(TeamMember).filter(TeamMember.team_id == tm.team_id).all()
        if not team or not rows:
            continue
        reasons = _team_reasons(db, competition, rules, str(team.id), rows)
        if (db.query(CompetitionJoinRequest)
                .filter(CompetitionJoinRequest.competition_id == competition_id,
                        CompetitionJoinRequest.team_id == str(team.id),
                        CompetitionJoinRequest.status == "pending").first()):
            reasons.append("This team already has a pending join request.")
        teams.append({
            "id": team.id, "name": team.name, "member_count": len(rows),
            "eligible": not reasons, "reasons": reasons,
            "members": [{"name": m["name"], "role": m["role"], "skills": m["skills"]}
                        for m in _team_member_info(db, rows)],
        })

    tracks = [{"id": t.get("id"), "name": t.get("name"), "description": t.get("description")}
              for t in active_tracks(task_config)]

    return {
        "can_join": blocked is None,
        "blocked_reason": blocked,
        "join_method": rules["join_method"],
        "rules": describe_rules(rules),
        "individual": {
            "available": rules["allows_individual"],
            "eligible": not individual_reasons,
            "reasons": individual_reasons,
        },
        "team": {
            "available": rules["allows_team"],
            "teams": teams,
            "eligible_count": sum(1 for t in teams if t["eligible"]),
            "not_leader_count": not_leader,
        },
        "tracks": tracks,
        "track_required": bool(tracks),
        "rules_to_accept": rules_to_accept(competition, task_config),
    }


@router.post("/competitions/{competition_id}/join")
def join_competition(
    competition_id: str,
    body: dict = {},
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models import UserProfile

    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id, Competition.is_draft == False)
        .first()
    )
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    real_status = compute_competition_status(competition)
    if real_status != "OPEN":
        raise HTTPException(status_code=400, detail=f"Competition is {real_status.lower()} and cannot be joined")
    
    rules, _ = _rules_for(competition)
    reasons = check_individual(rules, _get_user_skills(db, current_user.id))
    cap = _capacity_reason(db, competition, rules)
    if cap:
        reasons.append(cap)
    if reasons:
        raise HTTPException(status_code=400, detail=" ".join(reasons))

    current_role = get_user_role(db, competition_id, current_user.id)
    if current_role == "organizer":
        raise HTTPException(status_code=400, detail="Organizer cannot join as participant")
    if current_role == "participant":
        raise HTTPException(status_code=400, detail="Already joined this competition")

    existing_req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.user_id == current_user.id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )
    if existing_req:
        raise HTTPException(status_code=400, detail="You already have a pending join request for this competition")

    track_id, rules_accepted_at = _require_track_and_rules(competition, body)

    join_method = competition.join_method or "auto"

    if join_method == "manual":
        message = (body.get("message") or "").strip() or None
        now = datetime.utcnow().isoformat()

        req = CompetitionJoinRequest(
            competition_id=competition_id,
            user_id=str(current_user.id),
            team_id=None,
            track_id=track_id,
            rules_accepted_at=rules_accepted_at,
            message=message,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        db.add(req)

        from .notifications import create_notification

        organizers = db.query(CompetitionOrganizer).filter(
            CompetitionOrganizer.competition_id == competition_id
        ).all()

        profile = db.query(UserProfile).filter(UserProfile.user_id == str(current_user.id)).first()
        actor_name = profile.full_name if profile else "A user"

        for org in organizers:
            create_notification(
                db,
                user_id=org.user_id,
                type="competition_join_request",
                title="New Competition Join Request",
                message=f"{actor_name} requested to join \"{competition.title}\".",
                actor_id=str(current_user.id),
                actor_name=actor_name,
                competition_id=competition.id,
                competition_name=competition.title,
            )

        db.commit()
        return {"message": "Join request submitted. Waiting for organizer approval.", "status": "pending"}

    _do_join_competition(
        db, competition, str(current_user.id), team_id=None, track_id=track_id, rules_accepted_at=rules_accepted_at
    )
    db.commit()
    return {"message": "Joined competition successfully", "status": "joined"}


@router.post("/competitions/{competition_id}/join-team")
def join_competition_as_team(
    competition_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Team join. Only the team LEADER may call this.
    Validates:
      - caller is team leader
      - team size matches competition requirements
      - team collectively covers required skills
      - no team member is an organizer of this competition
      - no team member already joined this competition
    """
    from models import UserProfile
    from models_teams import Team, TeamMember

    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id, Competition.is_draft == False)
        .first()
    )

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    real_status = compute_competition_status(competition)

    if real_status != "OPEN":
        raise HTTPException(
            status_code=400,
            detail=f"Competition is {real_status.lower()} and cannot be joined",
        )

    team_id = str(body.get("team_id") or "").strip()

    if not team_id:
        raise HTTPException(status_code=400, detail="team_id is required")

    try:
        team_id_int = int(team_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid team_id")

    team = db.query(Team).filter(Team.id == team_id_int).first()

    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    leader_row = (
        db.query(TeamMember)
        .filter(
            TeamMember.team_id == team_id_int,
            TeamMember.user_id == str(current_user.id),
            TeamMember.role == "leader",
        )
        .first()
    )

    if not leader_row:
        raise HTTPException(
            status_code=403,
            detail="Only the team leader can submit a join request",
        )

    already_team = (
        db.query(CompetitionParticipant)
        .filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.team_id == team_id,
        )
        .first()
    )

    if already_team:
        raise HTTPException(
            status_code=400,
            detail="This team has already joined the competition",
        )

    existing_req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.team_id == team_id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )

    if existing_req:
        raise HTTPException(
            status_code=400,
            detail="This team already has a pending join request",
        )

    member_rows = (
        db.query(TeamMember)
        .filter(TeamMember.team_id == team_id_int)
        .all()
    )

    if not member_rows:
        raise HTTPException(status_code=400, detail="Team has no members")

    # All checks run BEFORE anything is inserted into competition_participants:
    # team size, required skills (per the organizer's rules), organizers in the team,
    # members who already joined, and the competition's capacity.
    rules, _ = _rules_for(competition)
    reasons = _team_reasons(db, competition, rules, team_id, member_rows)
    if reasons:
        raise HTTPException(status_code=400, detail=" ".join(reasons))

    track_id, rules_accepted_at = _require_track_and_rules(competition, body)

    join_method = competition.join_method or "auto"
    message = (body.get("message") or "").strip() or None

    if join_method == "manual":
        now = datetime.utcnow().isoformat()

        req = CompetitionJoinRequest(
            competition_id=competition_id,
            user_id=str(current_user.id),
            team_id=team_id,
            track_id=track_id,
            rules_accepted_at=rules_accepted_at,
            message=message,
            status="pending",
            created_at=now,
            updated_at=now,
        )

        db.add(req)

        from .notifications import create_notification

        organizers = (
            db.query(CompetitionOrganizer)
            .filter(CompetitionOrganizer.competition_id == competition_id)
            .all()
        )

        for org in organizers:
            create_notification(
                db,
                user_id=org.user_id,
                type="competition_join_request",
                title="New Team Join Request",
                message=f'Team "{team.name}" requested to join "{competition.title}".',
                actor_id=str(current_user.id),
                team_id=team.id,
                team_name=team.name,
                competition_id=competition.id,
                competition_name=competition.title,
            )

        db.commit()

        return {
            "message": "Join request submitted. Waiting for organizer approval.",
            "status": "pending",
        }

    for m in member_rows:
        _do_join_competition(
            db,
            competition,
            str(m.user_id),
            team_id=team_id,
            track_id=track_id,
            rules_accepted_at=rules_accepted_at,
        )

    db.commit()

    return {
        "message": f"Team '{team.name}' joined competition successfully",
        "status": "joined",
    }

# ─────────────────────────────────────────────────────────────────────────────
# Join-request management (organizer only)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/join-requests")
def list_join_requests(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models import UserProfile
    from models_teams import Team, TeamMember

    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can view join requests")

    requests = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.status == "pending",
        )
        .order_by(CompetitionJoinRequest.created_at.asc())
        .all()
    )

    rules, task_config = _rules_for(competition)
    track_names = {str(t.get("id")): t.get("name") for t in (task_config.get("tracks") or [])}

    result = []

    for req in requests:
        profile = db.query(UserProfile).filter(UserProfile.user_id == req.user_id).first()

        team_info = None
        reasons: list[str] = []

        if not req.team_id:
            reasons = check_individual(rules, _get_user_skills(db, req.user_id))

        if req.team_id:
            team = db.query(Team).filter(Team.id == int(req.team_id)).first()
            members = db.query(TeamMember).filter(TeamMember.team_id == int(req.team_id)).all()

            team_members = []

            for m in members:
                p = db.query(UserProfile).filter(UserProfile.user_id == str(m.user_id)).first()

                team_members.append({
                    "user_id": str(m.user_id),
                    "username": p.full_name if p else str(m.user_id),
                    "email": p.email if p else None,
                    "role": m.role,
                    "skills": _get_user_skills(db, m.user_id),
                })

            reasons = check_team(rules, [
                {"user_id": m["user_id"], "name": m["username"], "skills": m["skills"]} for m in team_members
            ]) + _blockers(_raise_if_team_has_organizer, db, competition_id, members)

            team_info = {
                "id": req.team_id,
                "name": team.name if team else f"Team #{req.team_id}",
                "members": team_members,
                "member_count": len(team_members),
            }

        result.append({
            "id": req.id,
            "competition_id": req.competition_id,
            "user_id": req.user_id,
            "username": profile.full_name if profile else req.user_id,
            "email": profile.email if profile else None,
            "skills": _get_user_skills(db, req.user_id),
            "team_id": req.team_id,
            "team": team_info,
            "track_id": req.track_id,
            "track_name": track_names.get(str(req.track_id)) if req.track_id else None,
            "rules_accepted": bool(req.rules_accepted_at),
            "meets_requirements": not reasons,
            "requirement_issues": reasons,
            "message": req.message,
            "status": req.status,
            "created_at": req.created_at,
        })

    return result

@router.post("/competitions/{competition_id}/join-requests/{request_id}/approve")
def approve_join_request(
    competition_id: str,
    request_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Organizer approves a pending join request."""
    from models_teams import TeamMember

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(
            status_code=403,
            detail="Only the organizer can approve join requests",
        )

    req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.id == request_id,
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )

    if not req:
        raise HTTPException(status_code=404, detail="Join request not found")

    competition = (
        db.query(Competition)
        .filter(Competition.id == competition_id)
        .first()
    )

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if req.team_id:
        member_rows = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == int(req.team_id))
            .all()
        )

        if not member_rows:
            raise HTTPException(status_code=400, detail="Team has no members")

        # Teams change between request and approval, so re-check against the rules now
        # (this also prevents the DB trigger crash on organizers / duplicate members).
        rules, _ = _rules_for(competition)
        reasons = _team_reasons(db, competition, rules, str(req.team_id), member_rows)
        if reasons:
            raise HTTPException(status_code=400, detail="Cannot approve: " + " ".join(reasons))

        for m in member_rows:
            _do_join_competition(
                db,
                competition,
                str(m.user_id),
                team_id=req.team_id,
                track_id=req.track_id,
                rules_accepted_at=req.rules_accepted_at,
            )
    else:
        current_role = get_user_role(db, competition_id, req.user_id)

        if current_role == "organizer":
            raise HTTPException(
                status_code=400,
                detail="Organizer cannot also be participant",
            )

        if current_role == "participant":
            raise HTTPException(
                status_code=400,
                detail="User has already joined this competition",
            )

        rules, _ = _rules_for(competition)
        reasons = check_individual(rules, _get_user_skills(db, req.user_id))
        cap = _capacity_reason(db, competition, rules)
        if cap:
            reasons.append(cap)
        if reasons:
            raise HTTPException(status_code=400, detail="Cannot approve: " + " ".join(reasons))

        _do_join_competition(
            db,
            competition,
            req.user_id,
            team_id=None,
            track_id=req.track_id,
            rules_accepted_at=req.rules_accepted_at,
        )

    req.status = "approved"
    req.updated_at = datetime.utcnow().isoformat()

    db.commit()

    return {"message": "Join request approved"}

@router.post("/competitions/{competition_id}/join-requests/{request_id}/reject")
def reject_join_request(
    competition_id: str,
    request_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Organizer rejects a pending join request."""
    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can reject join requests")

    req = db.query(CompetitionJoinRequest).filter(
        CompetitionJoinRequest.id == request_id,
        CompetitionJoinRequest.competition_id == competition_id,
        CompetitionJoinRequest.status == "pending",
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Join request not found")

    req.status = "rejected"
    req.updated_at = datetime.utcnow().isoformat()
    db.commit()
    return {"message": "Join request rejected"}


# ─────────────────────────────────────────────────────────────────────────────
# Joined teams (organizer only) — distinct from list_join_requests, which only
# shows *pending* requests. This shows who has actually joined.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/teams")
def list_joined_teams(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models import UserProfile
    from models_teams import Team, TeamMember

    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can view joined teams")

    participants = (
        db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id == competition_id)
        .order_by(CompetitionParticipant.joined_at.asc())
        .all()
    )

    track_by_participant_id = {}
    if _participants_have_track_column(db):
        rows = db.execute(
            text(
                "SELECT id, track_id FROM competition_participants "
                "WHERE competition_id = :cid"
            ),
            {"cid": competition_id},
        ).all()
        track_by_participant_id = {r.id: r.track_id for r in rows}

    task_config = competition_display_dict(competition).get("task_config") or {}
    track_name_by_id = {str(t.get("id")): t.get("name") for t in (task_config.get("tracks") or [])}

    teams_by_key = {}
    solo_entries = []

    for p in participants:
        profile = db.query(UserProfile).filter(UserProfile.user_id == p.user_id).first()
        member = {
            "user_id": p.user_id,
            "username": profile.full_name if profile else p.user_id,
            "email": profile.email if profile else None,
            "skills": _get_user_skills(db, p.user_id),
        }
        track_id = track_by_participant_id.get(p.id)
        track_name = track_name_by_id.get(str(track_id)) if track_id else None

        if p.team_id:
            key = str(p.team_id)
            if key not in teams_by_key:
                team = db.query(Team).filter(Team.id == int(p.team_id)).first()
                teams_by_key[key] = {
                    "team_id": p.team_id,
                    "team_name": team.name if team else f"Team #{p.team_id}",
                    "members": [],
                    "joined_at": p.joined_at,
                    "status": p.status,
                    "track_id": track_id,
                    "track_name": track_name,
                }
            teams_by_key[key]["members"].append(member)
        else:
            solo_entries.append({
                "team_id": None,
                "team_name": None,
                "members": [member],
                "joined_at": p.joined_at,
                "status": p.status,
                "track_id": track_id,
                "track_name": track_name,
            })

    teams = list(teams_by_key.values()) + solo_entries
    for t in teams:
        t["size"] = len(t["members"])

    return {
        "competition_id": competition_id,
        "total_teams": len(teams_by_key),
        "total_solo_participants": len(solo_entries),
        "teams": teams,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Submissions (organizer-only — recent submissions list)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/organizer-submissions")
def list_recent_submissions(
    competition_id: str,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from models import UserProfile
    from models_teams import Team

    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can view submissions")

    submissions = (
        db.query(Submission)
        .filter(Submission.competition_id == competition_id)
        .order_by(Submission.submitted_at.desc())
        .limit(limit)
        .all()
    )

    result = []
    for s in submissions:
        team_name = None
        if s.team_id:
            team = db.query(Team).filter(Team.id == int(s.team_id)).first()
            team_name = team.name if team else f"Team #{s.team_id}"
        else:
            profile = db.query(UserProfile).filter(UserProfile.user_id == s.user_id).first()
            team_name = (profile.full_name if profile else None) or s.user_id

        result.append({
            "id": s.id,
            "team_name": team_name,
            "is_team": s.team_id is not None,
            "score": float(s.score) if s.score is not None else None,
            "metric_name": s.metric_name or competition.primary_metric,
            "status": s.status,
            "error_message": s.error_message,
            "submitted_at": s.submitted_at,
            "evaluated_at": s.evaluated_at,
        })

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Tracks (organizer + participant visible)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/tracks")
def get_tracks(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    d = competition_display_dict(competition)
    task_config = d.get("task_config") or {}
    tracks = task_config.get("tracks") or []
    counts = _get_track_team_counts(db, competition_id)

    result = []
    for t in tracks:
        tid = str(t.get("id"))
        result.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "min_teams": t.get("minTeams"),
            "team_count": counts.get(tid, 0),
            "active": t.get("active", True),
        })

    return {"tracks_enabled": d.get("tracks_enabled"), "tracks": result}


@router.post("/competitions/{competition_id}/tracks/finalize")
def finalize_tracks(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Organizer action (AMDC Section 5/10): once registration closes, any track
    that hasn't reached its minimum team count is deactivated — it is removed
    from the competition rather than merged with another track. Teams already
    registered to a deactivated track keep their `joined` status but the
    track itself stops accepting new registrations (enforced by
    _validate_track_selection on future join calls).
    """
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    if get_user_role(db, competition_id, current_user.id) != "organizer":
        raise HTTPException(status_code=403, detail="Only the organizer can finalize tracks")

    d = competition_display_dict(competition)
    task_config = d.get("task_config") or {}
    tracks = task_config.get("tracks") or []
    if not tracks:
        raise HTTPException(status_code=400, detail="This competition has no tracks configured")

    counts = _get_track_team_counts(db, competition_id)

    updated_tracks = []
    for t in tracks:
        tid = str(t.get("id"))
        count = counts.get(tid, 0)
        min_teams = int(t.get("minTeams") or 1)
        t = dict(t)
        t["active"] = count >= min_teams
        t["team_count"] = count
        updated_tracks.append(t)

    task_config["tracks"] = updated_tracks
    # `prompts` never lives in this JSON blob (see build_competition_record),
    # so it's safe to write the whole dict straight back.
    competition.dataset_config = json.dumps(task_config)
    db.commit()

    return {"tracks": updated_tracks}


# ─────────────────────────────────────────────────────────────────────────────
# Monitoring
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/monitoring")
def get_competition_monitoring(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    role = get_user_role(db, competition_id, current_user.id)

    # Drafts are only visible to their own organizer — everyone else gets a 404,
    # same as if the competition didn't exist yet. This is what lets an
    # organizer open the Organizer Dashboard / Edit Competition flow for a
    # competition that hasn't been published yet.
    if competition.is_draft and role != "organizer":
        raise HTTPException(status_code=404, detail="Competition not found")

    participants_count = (
        db.query(CompetitionParticipant)
        .filter(CompetitionParticipant.competition_id == competition_id)
        .count()
    )

    team_count = (
        db.query(func.count(func.distinct(CompetitionParticipant.team_id)))
        .filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.team_id.isnot(None),
        )
        .scalar()
        or 0
    )

    datasets_count = (
        db.query(CompetitionDataset)
        .filter(CompetitionDataset.competition_id == competition_id)
        .count()
    )

    # Participant-sourced data ("Data Collection") competitions never expect an
    # organizer-uploaded dataset — their samples come from DataSample instead —
    # so their status is derived from submitted samples, not from datasets_count.
    try:
        task_config = json.loads(competition.dataset_config or "{}")
        if not isinstance(task_config, dict):
            task_config = {}
    except (TypeError, ValueError):
        task_config = {}
    data_collection_enabled = bool(task_config.get("data_collection_enabled"))

    if data_collection_enabled:
        samples_count = (
            db.query(Sample).filter(Sample.competition_id == competition_id).count()
            + db.query(DataSample).filter(DataSample.competition_id == competition_id).count()
        )
        data_collection_status = (
            f"{samples_count} sample{'s' if samples_count != 1 else ''} collected"
            if samples_count
            else "Awaiting participant contributions"
        )
    else:
        samples_count = 0
        data_collection_status = "Configured" if datasets_count else "Not configured"

    submissions_count = (
        db.query(Submission)
        .filter(Submission.competition_id == competition_id)
        .count()
    )

    done_submissions = (
        db.query(Submission)
        .filter(
            Submission.competition_id == competition_id,
            Submission.status == "done",
            Submission.score.isnot(None),
        )
        .all()
    )

    if done_submissions:
        best_submission = max(done_submissions, key=lambda s: float(s.score or 0))
        best_score = round(float(best_submission.score), 4)
        leaderboard_status = "Leaderboard active"
    else:
        best_score = "Pending"
        leaderboard_status = "Waiting for submissions"

    return {
        "is_organizer": role == "organizer",
        "user_role": role,
        "competition_status": compute_competition_status(competition),
        "participants_count": participants_count,
        "teams_count": team_count,
        "solo_participants_count": participants_count - db.query(CompetitionParticipant).filter(
            CompetitionParticipant.competition_id == competition_id,
            CompetitionParticipant.team_id.isnot(None),
        ).count(),
        "max_teams": competition.max_teams,
        "datasets_count": datasets_count,
        "data_collection_enabled": data_collection_enabled,
        "samples_count": samples_count,
        "tasks_count": db.query(CompetitionTask).filter(CompetitionTask.competition_id == competition_id).count(),
        "data_collection_status": data_collection_status,
        "submissions_count": submissions_count,
        "best_score": best_score,
        "primary_metric": competition.primary_metric or "Not selected",
        "leaderboard_status": leaderboard_status,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Get single competition
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/competitions/{competition_id}/phase-access")
def get_phase_access(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Current phase + which sidebar pages are open. Read by the sidebar and by withPhaseGate."""
    competition = db.query(Competition).filter(Competition.id == competition_id).first()
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")
    role = get_user_role(db, competition_id, current_user.id)
    if competition.is_draft and role != "organizer":
        raise HTTPException(status_code=404, detail="Competition not found")
    return {**phase_state(competition), "is_organizer": role == "organizer"}


@router.get("/competitions/{competition_id}")
def get_competition_details(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    role = get_user_role(db, competition_id, current_user.id)

    # A draft is only visible to its own organizer (e.g. so Edit Competition
    # and the Organizer Dashboard keep working for a competition that hasn't
    # been published yet). Everyone else gets the same 404 as if it didn't exist.
    if competition.is_draft and role != "organizer":
        raise HTTPException(status_code=404, detail="Competition not found")

    d = competition_display_dict(
        competition,
        task_types_by_competition(db, [competition_id])[competition_id],
    )
    d["user_role"] = role
    d["is_organizer"] = role == "organizer"
    d["my_track_id"] = None
    if role == "participant" and _participants_have_track_column(db):
        d["my_track_id"] = db.execute(
            text("SELECT track_id FROM competition_participants WHERE competition_id = :c AND user_id = :u LIMIT 1"),
            {"c": competition_id, "u": str(current_user.id)},
        ).scalar()
    d["is_participant"] = role == "participant"
    d["datasets_count"] = db.query(CompetitionDataset).filter(CompetitionDataset.competition_id == competition_id).count()

    # Expose whether this user has a pending manual join request
    pending_req = (
        db.query(CompetitionJoinRequest)
        .filter(
            CompetitionJoinRequest.competition_id == competition_id,
            CompetitionJoinRequest.user_id == current_user.id,
            CompetitionJoinRequest.status == "pending",
        )
        .first()
    )
    d["has_pending_request"] = pending_req is not None

    structure = load_structure(db, competition_id)
    if not structure["assets"] and not structure["tasks"]:
        # unfinished draft: structure the organizer typed but that wasn't valid yet
        draft = (d.get("task_config") or {}).get("structure_draft") or {}
        structure = {"assets": draft.get("assets", []), "tasks": draft.get("tasks", [])}
    d["assets"], d["tasks"] = structure["assets"], structure["tasks"]
    if isinstance(d.get("task_config"), dict):
        d["task_config"].pop("structure_draft", None)

    return d


# ─────────────────────────────────────────────────────────────────────────────
# Update
# ─────────────────────────────────────────────────────────────────────────────

@router.put("/competitions/{competition_id}/update")
def update_competition(
    competition_id: str,
    data: CompetitionCreateIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    clean = validate_competition_payload(data)

    competition = db.query(Competition).filter(Competition.id == competition_id).first()

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id == competition_id, CompetitionOrganizer.user_id == current_user.id)
        .first()
    )

    if not is_organizer:
        raise HTTPException(status_code=403, detail="Not allowed")

    competition.title = data.competition_name
    competition.description = data.description
    competition.start_date = data.start_date
    competition.end_date = data.end_date
    competition.prize_pool = data.prize_pool
    competition.primary_metric = data.primary_metric
    competition.secondary_metric = data.secondary_metric

    competition.max_teams = data.max_teams
    competition.min_members = data.min_members
    competition.max_members = data.max_members
    competition.merge_deadline = data.merge_deadline

    competition.required_skills = json.dumps(data.required_skills or [])
    competition.max_submissions_per_day = data.max_submissions_per_day
    competition.allow_external_data = data.allow_external_data
    competition.allow_pretrained_models = data.allow_pretrained_models
    competition.require_code_sharing = data.require_code_sharing
    competition.additional_rules = data.additional_rules

    competition.complexity_level = data.complexity_level

    competition.validation_date = data.validation_date
    competition.freeze_date = data.freeze_date
    competition.is_draft = False
    competition.join_method = getattr(data, "join_method", "auto") or "auto"

    # Save updated task config
    task_config = getattr(data, "task_config", None) or {}
    config_to_store = _clean_list_values({k: v for k, v in task_config.items() if k != "prompts"})
    competition.dataset_config = json.dumps(config_to_store)
    _persist_structure(db, competition, data, clean, is_draft=False)

    # Re-seed prompts if applicable
    _seed_prompts(db, competition_id, task_config)

    db.commit()

    return {"message": "Competition updated successfully"}


# ─────────────────────────────────────────────────────────────────────────────
# Delete
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/competitions/{competition_id}")
def delete_competition(
    competition_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    competition = db.query(Competition).filter(Competition.id == competition_id).first()

    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    is_organizer = (
        db.query(CompetitionOrganizer)
        .filter(CompetitionOrganizer.competition_id == competition_id, CompetitionOrganizer.user_id == current_user.id)
        .first()
    )

    if not is_organizer:
        raise HTTPException(status_code=403, detail="Not allowed")

    delete_competition_related_rows(db, competition_id)
    db.flush()

    db.delete(competition)
    db.commit()

    return {"message": "Competition deleted successfully"}