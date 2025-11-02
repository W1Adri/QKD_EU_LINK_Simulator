# QKD Planner FastAPI app. Serves static files, the 2D map, and the 3D orbit designer.
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path
import json, os

from . import database
from .database import UserAlreadyExistsError

# Absolute paths (robust across working directories)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"
ORBIT3D_HTML = STATIC_DIR / "orbit3d.html"
DATA_PATH = STATIC_DIR / "ogs_locations.json"

app = FastAPI(title="QKD Europe Planner", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
async def startup_event():
    await run_in_threadpool(database.init_db)

# Healthcheck (optional)
@app.get("/health")
async def health():
    return {"status": "ok"}

# Root -> 2D map
@app.get("/", response_class=HTMLResponse)
async def root():
    if not INDEX_HTML.exists():
        return HTMLResponse("index.html not found", status_code=404)
    return FileResponse(str(INDEX_HTML))

# /orbit3d -> 3D orbit designer
@app.get("/orbit3d", response_class=HTMLResponse)
async def orbit3d():
    if not ORBIT3D_HTML.exists():
        return HTMLResponse("orbit3d.html not found", status_code=404)
    return FileResponse(str(ORBIT3D_HTML))  # <- usa ORBIT3D_HTML


# Simple model for OGS locations
class OGSLocation(BaseModel):
    name: str = Field(min_length=1)
    lat: float
    lon: float
    aperture_m: float = Field(default=1.0, ge=0.1, le=15.0)
    notes: Optional[str] = None


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=4, max_length=128)


class UserRead(BaseModel):
    id: int
    username: str
    created_at: str


class AuthResponse(UserRead):
    message: str


class ChatCreate(BaseModel):
    user_id: int
    message: str = Field(min_length=1, max_length=2000)


class ChatRead(BaseModel):
    id: int
    user_id: int
    username: str
    message: str
    created_at: str


class UserCount(BaseModel):
    count: int


def is_in_europe_bbox(lat: float, lon: float) -> bool:
    return (25.0 <= lat <= 72.0) and (-31.0 <= lon <= 45.0)

@app.get("/api/ogs", response_model=List[OGSLocation])
async def get_ogs():
    if not DATA_PATH.exists():
        return []
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Garantiza que las entradas antiguas incluyan la apertura con un valor por defecto
    for item in data:
        if "aperture_m" not in item or not isinstance(item["aperture_m"], (int, float)):
            item["aperture_m"] = 1.0
    return data

@app.post("/api/ogs", response_model=OGSLocation)
async def add_ogs(loc: OGSLocation):
    if not is_in_europe_bbox(loc.lat, loc.lon):
        raise HTTPException(status_code=400, detail="La ubicacion esta fuera del area de Europa definida.")
    data = []
    if DATA_PATH.exists():
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    data.append(loc.dict())
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return loc

@app.delete("/api/ogs")
async def clear_ogs():
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump([], f)
    return JSONResponse({"status": "ok", "message": "Todas las OGS han sido eliminadas."})


def _normalize_username(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="El nombre de usuario no puede estar vacío.")
    return cleaned


@app.post("/api/users", response_model=AuthResponse, status_code=201)
async def register_user(payload: UserCreate):
    username = _normalize_username(payload.username)
    try:
        record = await run_in_threadpool(database.create_user, username, payload.password)
    except UserAlreadyExistsError:
        raise HTTPException(status_code=409, detail="El nombre de usuario ya está registrado.")
    return AuthResponse(**record.__dict__, message="Usuario creado correctamente.")


@app.get("/api/users/{user_id}", response_model=UserRead)
async def fetch_user(user_id: int):
    record = await run_in_threadpool(database.get_user_by_id, user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return record


@app.post("/api/login", response_model=AuthResponse)
async def login_user(payload: UserCreate):
    username = _normalize_username(payload.username)
    record = await run_in_threadpool(database.verify_credentials, username, payload.password)
    if record is None:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas.")
    return AuthResponse(**record.__dict__, message="Inicio de sesión correcto.")


@app.post("/api/logout")
async def logout_user():
    return {"status": "ok", "message": "Sesión cerrada."}


@app.get("/api/users/count", response_model=UserCount)
async def user_count():
    count = await run_in_threadpool(database.count_users)
    return UserCount(count=count)


@app.get("/api/chats", response_model=List[ChatRead])
async def list_chats(limit: int = 50):
    records = await run_in_threadpool(database.list_chat_messages, limit)
    return [ChatRead(**record.__dict__) for record in records]


@app.post("/api/chats", response_model=ChatRead, status_code=201)
async def post_chat_message(payload: ChatCreate):
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío.")
    user = await run_in_threadpool(database.get_user_by_id, payload.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    record = await run_in_threadpool(database.store_chat_message, payload.user_id, payload.message.strip())
    return ChatRead(**record.__dict__)

