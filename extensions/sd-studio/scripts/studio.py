"""
sd-studio: clean single-page UI for reForge, served at /studio.

Registers on app start:
  /studio                               -> static SPA (index.html, studio.css, studio.js)
  GET  /studio/api/previews             -> {"checkpoint": [...], "lora": [...]} names that HAVE a cover
  GET  /studio/api/preview/{kind}       -> cover image for a checkpoint or LoRA (?name=...)
  POST /studio/api/preview/{kind}       -> save a base64 image as that model's cover
  GET  /studio/api/presets              -> list saved configs
  POST /studio/api/presets              -> create/update a saved config (by id)
  DELETE /studio/api/presets/{id}       -> delete a saved config
  GET  /studio/api/lora-names           -> {lora name: display name} chosen in the UI
  POST /studio/api/lora-names           -> set/clear a LoRA's display name (file is NOT renamed)
  POST /studio/api/switch-checkpoint    -> save checkpoint to config and restart the server with it
                                           (hot-swapping SDXL models leaks RAM and segfaults; see relaunch.py)

Generation itself goes through the official /sdapi/v1/* API (requires --api).
"""

import base64
import io
import json
import os
import subprocess
import sys
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from modules import script_callbacks, sd_models, shared

EXT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(EXT_DIR, "static")
PRESETS_FILE = os.path.join(EXT_DIR, "presets.json")
LORA_NAMES_FILE = os.path.join(EXT_DIR, "lora_names.json")  # display names only; files stay untouched
RELAUNCH_SCRIPT = os.path.join(EXT_DIR, "relaunch.py")
RELAUNCH_JOB = os.path.join(EXT_DIR, "relaunch_job.json")
SERVER_LOG = os.path.join(EXT_DIR, "server.log")  # output of servers started by a checkpoint switch
PREVIEW_EXTS = [".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp", ".png", ".jpg", ".jpeg", ".webp"]

_presets_lock = threading.Lock()
_lora_names_lock = threading.Lock()


# ---------------------------------------------------------------- model paths

def _checkpoint_files():
    """Filenames of all known checkpoints, keyed by title and by model_name."""
    out = {}
    for info in sd_models.checkpoints_list.values():
        out[info.title] = info.filename
        out[info.model_name] = info.filename
    return out


def _lora_files():
    """Filenames of all known LoRAs, keyed by name and alias. Empty if Lora ext missing."""
    try:
        import networks  # provided by extensions-builtin/Lora
    except Exception:
        return {}
    out = {}
    for net in networks.available_networks.values():
        out[net.name] = net.filename
        if net.alias:
            out[net.alias] = net.filename
    return out


def _resolve_model(kind: str, name: str) -> str:
    """Map (kind, name) to a model file path. Only known models resolve, so arbitrary paths are impossible."""
    files = _checkpoint_files() if kind == "checkpoint" else _lora_files() if kind == "lora" else None
    if files is None:
        raise HTTPException(400, "kind must be 'checkpoint' or 'lora'")
    path = files.get(name)
    if not path:
        raise HTTPException(404, "model not found")
    return path


def _find_preview(model_path: str):
    base = os.path.splitext(model_path)[0]
    for ext in PREVIEW_EXTS:
        if os.path.isfile(base + ext):
            return base + ext
    return None


# ---------------------------------------------------------------- presets

def _load_presets():
    if not os.path.isfile(PRESETS_FILE):
        return []
    try:
        with open(PRESETS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_presets(items):
    tmp = PRESETS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PRESETS_FILE)


# ---------------------------------------------------------------- checkpoint switch (restart)

def _restart_with_checkpoint(title: str, host: str, port: int):
    """
    Persist `title` as sd_model_checkpoint and restart reForge so it loads in a clean process.

    - Writes opts.data directly (not opts.set) so the onchange hook does NOT hot-load the model here.
    - Spawns relaunch.py detached; it waits for this process to die, then runs launch.py with the
      same arguments (minus --autolaunch, so no extra browser tab). Output goes to SERVER_LOG.
    - Exits this process shortly after, giving the HTTP response time to be sent.
    """
    shared.opts.data["sd_model_checkpoint"] = title
    shared.opts.save(shared.config_filename)

    root = os.path.dirname(os.path.dirname(EXT_DIR))  # extensions/sd-studio -> reForge root
    job = {
        "pid": os.getpid(), "host": host, "port": port, "cwd": root, "python": sys.executable,
        "argv": [a for a in sys.argv[1:] if a != "--autolaunch"], "log": SERVER_LOG,
    }
    with open(RELAUNCH_JOB, "w", encoding="utf-8") as f:
        json.dump(job, f, indent=2)

    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    subprocess.Popen([sys.executable, RELAUNCH_SCRIPT, RELAUNCH_JOB], cwd=root, creationflags=flags,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)

    print(f"[sd-studio] Restarting server to load checkpoint: {title} (log: {SERVER_LOG})", flush=True)
    threading.Timer(1.0, lambda: os._exit(0)).start()


# ---------------------------------------------------------------- LoRA display names

def _load_lora_names() -> dict:
    """Read {lora name: display name}. Missing or corrupt file -> {}."""
    try:
        with open(LORA_NAMES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_lora_names(names: dict):
    """Atomic write (tmp + replace) so a crash never leaves a half-written file."""
    tmp = LORA_NAMES_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, indent=2)
    os.replace(tmp, LORA_NAMES_FILE)


class LoraNameBody(BaseModel):
    name: str          # LoRA name as used in <lora:name:w> (key; never changes)
    display: str = ""  # new visible name; empty -> back to the original


class SwitchBody(BaseModel):
    title: str  # checkpoint title as listed by /sdapi/v1/sd-models


class PreviewBody(BaseModel):
    name: str
    image: str  # base64, with or without data: prefix


class PresetBody(BaseModel):
    id: str | None = None
    name: str
    settings: dict
    thumb: str | None = None  # small base64 jpeg


# ---------------------------------------------------------------- routes

def on_app_started(_demo, app: FastAPI):
    @app.get("/studio", include_in_schema=False)
    async def studio_root():
        return RedirectResponse("/studio/")

    @app.get("/studio/api/previews")
    async def list_previews():
        """
        Names (every key the UI may use: title/model_name for checkpoints, name/alias for LoRAs)
        whose model has a cover image. Lets the UI skip requests that would 404 and spam the console.
        """
        def with_cover(files: dict) -> list:
            cache = {}
            return sorted(n for n, path in files.items() if cache.setdefault(path, _find_preview(path) is not None))
        return {"checkpoint": with_cover(_checkpoint_files()), "lora": with_cover(_lora_files())}

    @app.get("/studio/api/preview/{kind}")
    async def get_preview(kind: str, name: str):
        preview = _find_preview(_resolve_model(kind, name))
        if not preview:
            raise HTTPException(404, "no preview")
        return FileResponse(preview, headers={"Cache-Control": "no-cache"})

    @app.post("/studio/api/preview/{kind}")
    async def set_preview(kind: str, body: PreviewBody):
        from PIL import Image

        model_path = _resolve_model(kind, body.name)
        raw = body.image.split(",", 1)[1] if body.image.startswith("data:") else body.image
        img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        img.thumbnail((768, 768))
        base = os.path.splitext(model_path)[0]
        # drop older previews so the new one wins the lookup order
        for ext in PREVIEW_EXTS:
            if ext.startswith(".preview") and os.path.isfile(base + ext):
                os.remove(base + ext)
        img.save(base + ".preview.png")
        return {"ok": True}

    @app.get("/studio/api/presets")
    async def list_presets():
        with _presets_lock:
            return _load_presets()

    @app.post("/studio/api/presets")
    async def save_preset(body: PresetBody):
        with _presets_lock:
            items = _load_presets()
            entry = {
                "id": body.id or uuid.uuid4().hex,
                "name": body.name.strip() or "Sin nombre",
                "settings": body.settings,
                "thumb": body.thumb,
                "updated": int(time.time()),
            }
            items = [p for p in items if p.get("id") != entry["id"]]
            items.insert(0, entry)
            _save_presets(items)
            return entry

    @app.delete("/studio/api/presets/{preset_id}")
    async def delete_preset(preset_id: str):
        with _presets_lock:
            items = _load_presets()
            _save_presets([p for p in items if p.get("id") != preset_id])
            return {"ok": True}

    @app.get("/studio/api/lora-names")
    async def get_lora_names():
        with _lora_names_lock:
            return _load_lora_names()

    @app.post("/studio/api/lora-names")
    async def set_lora_name(body: LoraNameBody):
        """
        Give a LoRA a friendlier visible name. Only the UI label changes: the file, its
        preview and every <lora:name:w> in prompts/presets keep working as before.
        Returns the full updated mapping.
        """
        _resolve_model("lora", body.name)  # 404 if unknown, so junk keys can't accumulate
        display = body.display.strip()[:80]
        with _lora_names_lock:
            names = _load_lora_names()
            if display and display != body.name:
                names[body.name] = display
            else:
                names.pop(body.name, None)
            _save_lora_names(names)
            return names

    @app.post("/studio/api/switch-checkpoint")
    async def switch_checkpoint(body: SwitchBody, request: Request):
        """
        Change checkpoint by restarting the server (safe path) instead of hot-swapping.
        Returns {"restart": false} if `title` is already loaded, else {"restart": true}
        and the server goes down ~1 s later; the client polls until it is back.
        """
        info = sd_models.get_closet_checkpoint_match(body.title)
        if info is None:
            raise HTTPException(404, "checkpoint not found")
        if shared.opts.sd_model_checkpoint == info.title:
            return {"restart": False, "title": info.title}
        port = request.url.port or getattr(shared.cmd_opts, "port", None) or 7860
        _restart_with_checkpoint(info.title, "127.0.0.1", int(port))
        return {"restart": True, "title": info.title}

    # static last, so the /studio/api/* routes above take priority
    app.mount("/studio", StaticFiles(directory=STATIC_DIR, html=True), name="sd-studio")


script_callbacks.on_app_started(on_app_started)
