"""
services/export_service.py

One export implementation shared by every dataset export (the global Dataset Hub and the
team / solo dataset page).

    records   the items produced by routes/dataset_hub.collect_records():
              {id, number, submitted_at, assets: [{key, type, text, duration, audio_path}],
               final: {task_key: {value, basis, votes, of}}, annotator_answers?: {...}}

    fmt       "csv" | "jsonl"
    include_audio
              False -> a plain .csv / .jsonl file (audio is referenced by storage path, as before)
              True  -> a .zip that contains the data file AND the audio files.
                       The audio columns of the data file then point at the files inside the zip
                       (audio/000012_recording.wav), so the archive is self-contained.
                       If the dataset has no audio, a plain file is returned instead.

Audio is optional on purpose: it can be hundreds of MB, so it is only bundled when asked for.
The archive is assembled in a spooled temp file (RAM up to ZIP_SPOOL_BYTES, then disk) so a large
export never has to live fully in memory, and the audio is fetched from storage in small parallel
batches. Files that cannot be fetched are skipped and listed in missing_audio.txt inside the zip.
"""

import csv
import io
import json
import re
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fastapi.responses import StreamingResponse

from supabase_client import supabase
from .task_registry import ASSET_TYPES

AUDIO_BUCKET = "audio-samples"
ZIP_SPOOL_BYTES = 64 * 1024 * 1024
DOWNLOAD_WORKERS = 8
DOWNLOAD_BATCH = 16
CHUNK = 1024 * 1024


def _kind(asset_type: str) -> str:
    return ASSET_TYPES.get(asset_type, {}).get("kind", (asset_type or "").lower())


def safe_name(title: str, limit: int = 40) -> str:
    return (title or "dataset").replace(" ", "_").replace("/", "-")[:limit] or "dataset"


def _ext(path: str) -> str:
    m = re.search(r"\.([A-Za-z0-9]{1,5})$", path or "")
    return m.group(1).lower() if m else "wav"


def has_audio(records: list) -> bool:
    return any(a.get("audio_path") for r in records for a in r["assets"])


def plan_audio(records: list) -> dict:
    """{storage_path: name inside the zip}. Readable and unique: sample number + asset key."""
    plan = {}
    for r in records:
        for a in r["assets"]:
            p = a.get("audio_path")
            if p and p not in plan:
                key = re.sub(r"[^A-Za-z0-9_.-]", "_", a["key"])
                plan[p] = f"audio/{r['number']:06d}_{key}.{_ext(p)}"
    return plan


# ─────────────────────────────────────────────────────────────────────────────
# Data file (shared by the plain download and the zip)
# ─────────────────────────────────────────────────────────────────────────────

def _asset_view(a: dict, names: dict) -> dict:
    out = {}
    for k in ("type", "text", "audio_path", "duration"):
        v = a.get(k)
        if v is None:
            continue
        out[k] = names.get(v, v) if k == "audio_path" else v
    return out


def _jsonl_chunks(records, competition_id, details, names):
    for r in records:
        yield json.dumps({
            "id": r["id"],
            "competition_id": competition_id,
            "submitted_at": r["submitted_at"],
            "assets": {a["key"]: _asset_view(a, names) for a in r["assets"]},
            "annotations": {k: f["value"] for k, f in r["final"].items()},          # the final decision
            "agreement": {k: {"basis": f["basis"], "votes": f["votes"], "of": f["of"]}
                          for k, f in r["final"].items()},
            **({"annotator_answers": r["annotator_answers"]} if details and "annotator_answers" in r else {}),
        }, ensure_ascii=False) + "\n"


def _csv_chunks(records, structure, names):
    asset_cols = []
    for a in structure["assets"]:
        asset_cols.append(a["key"])
        if _kind(a["type"]) == "audio":
            asset_cols.append(f"{a['key']}_duration_seconds")
    task_keys = [t["key"] for t in structure["tasks"]]

    buf = io.StringIO()
    w = csv.writer(buf)

    def flush():
        data = buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        return data

    w.writerow(["sample_id", "submitted_at", *asset_cols, *task_keys])
    yield flush()
    for r in records:
        by_key = {a["key"]: a for a in r["assets"]}
        row = [r["id"], r["submitted_at"] or ""]
        for a in structure["assets"]:
            x = by_key.get(a["key"]) or {}
            ref = x.get("audio_path")
            row.append(x.get("text") or (names.get(ref, ref) if ref else "") or "")
            if _kind(a["type"]) == "audio":
                row.append(x.get("duration") if x.get("duration") is not None else "")
        for k in task_keys:
            f = r["final"].get(k)
            row.append(json.dumps(f["value"], ensure_ascii=False) if f else "")
        w.writerow(row)
        yield flush()


def _data_chunks(fmt, records, structure, competition_id, details, names):
    if fmt == "jsonl":
        return _jsonl_chunks(records, competition_id, details, names)
    return _csv_chunks(records, structure, names)


# ─────────────────────────────────────────────────────────────────────────────
# Audio
# ─────────────────────────────────────────────────────────────────────────────

def _fetch(path: str):
    try:
        data = supabase.storage.from_(AUDIO_BUCKET).download(path)
        return path, (bytes(data) if data else None)
    except Exception:
        return path, None


def _build_zip(records, structure, fmt, competition_id, details, base, plan):
    tmp = tempfile.SpooledTemporaryFile(max_size=ZIP_SPOOL_BYTES)
    saved, missing = {}, []
    with zipfile.ZipFile(tmp, "w") as zf:
        paths = list(plan)
        with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
            for i in range(0, len(paths), DOWNLOAD_BATCH):
                for path, data in pool.map(_fetch, paths[i:i + DOWNLOAD_BATCH]):
                    if data is None:
                        missing.append(path)
                        continue
                    # audio is already compressed: store it, don't waste CPU deflating it
                    zf.writestr(zipfile.ZipInfo(plan[path], date_time=datetime.utcnow().timetuple()[:6]),
                                data, compress_type=zipfile.ZIP_STORED)
                    saved[path] = plan[path]

        with zf.open(f"{base}.{fmt}", "w") as out:
            for chunk in _data_chunks(fmt, records, structure, competition_id, details, saved):
                out.write(chunk.encode("utf-8"))
        if missing:
            zf.writestr("missing_audio.txt",
                        "These audio files could not be downloaded and are not in the archive:\n"
                        + "\n".join(missing) + "\n")
    size = tmp.seek(0, 2)
    tmp.seek(0)
    return tmp, size


def _stream_file(tmp):
    try:
        while True:
            chunk = tmp.read(CHUNK)
            if not chunk:
                break
            yield chunk
    finally:
        tmp.close()


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def export_response(records: list, structure: dict, fmt: str, competition_id: str, title: str,
                    details: bool = False, include_audio: bool = False) -> StreamingResponse:
    base = f"{safe_name(title)}_{datetime.utcnow().strftime('%Y%m%d')}"
    media = "application/x-ndjson" if fmt == "jsonl" else "text/csv"

    if include_audio and has_audio(records):
        tmp, size = _build_zip(records, structure, fmt, competition_id, details, base, plan_audio(records))
        return StreamingResponse(
            _stream_file(tmp), media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{base}.zip"',
                     "Content-Length": str(size)},
        )

    return StreamingResponse(
        _data_chunks(fmt, records, structure, competition_id, details, {}), media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{base}.{fmt}"'},
    )