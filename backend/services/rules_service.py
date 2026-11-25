"""
services/rules_service.py

The rules a participant must agree to when joining, built from the competition's
configuration (never hard-coded per competition). Shown in the join dialog and
recorded as accepted on the participant, so contributions can be tied to the
license version that was accepted.

Pure functions: no DB, no HTTP.
"""

from typing import Any, Optional


def active_tracks(task_config: Optional[dict]) -> list[dict]:
    cfg = task_config or {}
    if not cfg.get("tracks_enabled"):
        return []
    return [t for t in (cfg.get("tracks") or []) if t.get("active") is not False]


def license_of(task_config: Optional[dict]) -> Optional[dict]:
    """{'version', 'text'} when the competition collects participant data under a license."""
    cfg = task_config or {}
    lic = cfg.get("license") or {}
    return lic if cfg.get("data_collection_enabled") and (lic.get("text") or "").strip() else None


def _yn(v: Any, yes: str, no: str) -> str:
    return yes if v else no


def rules_to_accept(competition, task_config: Optional[dict]) -> list[dict]:
    """[{key, title, text}] — everything the participant is agreeing to."""
    cfg = task_config or {}
    rules: list[dict] = []

    if competition.max_submissions_per_day:
        rules.append({"key": "submissions", "title": "Submission limit",
                      "text": f"At most {competition.max_submissions_per_day} submissions per day."})
    rules.append({"key": "external_data", "title": "External data",
                  "text": _yn(competition.allow_external_data, "External data may be used.",
                              "External data may not be used.")})
    rules.append({"key": "pretrained", "title": "Pre-trained models",
                  "text": _yn(competition.allow_pretrained_models, "Pre-trained models may be used.",
                              "Pre-trained models may not be used.")})
    if competition.require_code_sharing:
        rules.append({"key": "code", "title": "Code sharing",
                      "text": "You must share the code behind your submissions."})

    extra = (competition.additional_rules or "").strip()
    if extra:
        rules.append({"key": "additional", "title": "Additional rules", "text": extra})

    if cfg.get("data_collection_enabled"):
        dc = cfg.get("data_collection") or {}
        sources = dc.get("allowed_source_types") or []
        if sources:
            # a source link is asked for when the organizer turned provenance on AND some allowed
            # source is not self-recorded (same rule as the contribution form)
            needs_link = bool(dc.get("require_public_source_provenance")) and any(s != "self_recorded" for s in sources)
            rules.append({"key": "sources", "title": "Data you contribute",
                          "text": "Allowed sources: " + ", ".join(str(s).replace("_", " ") for s in sources) + "."
                                  + (" Anything you did not record or write yourself needs a source link." if needs_link else "")})
        lic = license_of(cfg)
        if lic:
            ver = f" (version {lic['version']})" if lic.get("version") else ""
            rules.append({"key": "license", "title": f"Data usage license{ver}", "text": lic["text"].strip()})

    return rules