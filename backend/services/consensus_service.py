"""
services/consensus_service.py

The FINAL decision of a task on one sample, from the annotators' COMPLETE answers.
Used by the global Dataset Hub (closed competitions): it shows this decision per
sample and only reveals what each annotator wrote on request.

    vote  (single label)      most voted label (clear winner; ties never reach here)
    set   (multi-label/spans) every item chosen by MORE than half of the annotators
    none  (free text / QA)    there is nothing to vote on -> the first submitted answer

Pure functions: no DB, no HTTP.
"""

from collections import Counter
from typing import Any, Optional

from .annotation_service import agreement
from .task_registry import TASK_TYPES


def final_decision(task: dict, entries: list[dict]) -> Optional[dict]:
    """
    task:    {"key", "type", "config"}
    entries: COMPLETE answers, oldest first: [{"value": {...}}]
    returns  {"value", "basis", "votes", "of"} or None when nobody answered
    """
    values = [e["value"] for e in entries if e.get("value") is not None]
    k = len(values)
    if not k:
        return None

    shape = TASK_TYPES[task["type"]]["answer"]
    method, extract = agreement(task["type"], task.get("config") or {})

    if method == "vote":
        label, n = Counter(extract(v) for v in values).most_common(1)[0]
        return {"value": {"labels": [label]}, "basis": "majority_vote", "votes": n, "of": k}

    if method == "set":
        counts = Counter(i for v in values for i in extract(v))
        keep = {i for i, n in counts.items() if 2 * n > k}
        if shape == "labels":
            return {"value": {"labels": sorted(keep)}, "basis": "majority_vote",
                    "votes": None, "of": k}
        # spans: keep the span dicts whose item a strict majority picked (first occurrence wins)
        spans, seen = [], set()
        for v in values:
            for s in v.get("spans", []):
                item = next(iter(extract({"spans": [s]})))
                if item in keep and item not in seen:
                    seen.add(item)
                    spans.append(s)
        spans.sort(key=lambda s: (s.get("start_time", s.get("start", 0)), s.get("label", "")))
        return {"value": {"spans": spans, "none": not spans}, "basis": "majority_vote",
                "votes": None, "of": k}

    return {"value": values[0], "basis": "first_submitted", "votes": None, "of": k}