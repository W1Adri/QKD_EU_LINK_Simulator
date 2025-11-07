# QKD Planner FastAPI app. Serves static files, the 2D map, and the 3D orbit designer.
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path
from datetime import datetime
from uuid import uuid4
import json, os

from . import database
from .database import UserAlreadyExistsError
from .atmosphere import (
    AtmosphereModelNotFoundError,
    AtmosphereProviderError,
    AtmosphereQuery,
    build_profile,
)
from .meteo_field import (
    WeatherFieldParameterError,
    WeatherFieldQuery,
    build_weather_field,
)

# Absolute paths (robust across working directories)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"
ORBIT3D_HTML = STATIC_DIR / "orbit3d.html"
DATA_PATH = STATIC_DIR / "ogs_locations.json"
FAVICON_PATH = STATIC_DIR / "favicon.ico"

app = FastAPI(title="QKD Europe Planner", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    if FAVICON_PATH.exists():
        return FileResponse(str(FAVICON_PATH))
    return Response(status_code=204)


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
    id: Optional[str] = None
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


class AtmosRequest(BaseModel):
    lat: float
    lon: float
    time: str
    ground_cn2_day: float
    ground_cn2_night: float
    model: str = Field(default="hufnagel-valley")
    wavelength_nm: Optional[float] = Field(default=810.0, ge=400.0, le=2000.0)


class WeatherFieldRequest(BaseModel):
    time: str
    variable: str = Field(default="wind_speed")
    level_hpa: int = Field(default=200, ge=50, le=1000)
    samples: int = Field(default=120, ge=16, le=900)


def is_in_europe_bbox(lat: float, lon: float) -> bool:
    return (25.0 <= lat <= 72.0) and (-31.0 <= lon <= 45.0)


def _normalize_username(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Nombre de usuario inválido")
    return value.strip().lower()

@app.get("/api/ogs", response_model=List[OGSLocation])
async def get_ogs():
    if not DATA_PATH.exists():
        return []
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    needs_write = False
    data = []
    for idx, item in enumerate(raw_data):
        record = dict(item)
        if "aperture_m" not in record or not isinstance(record["aperture_m"], (int, float)):
            record["aperture_m"] = 1.0
            needs_write = True
        if not record.get("id"):
            record["id"] = f"station-{uuid4().hex[:8]}-{idx}"
            needs_write = True
        data.append(record)

    if needs_write:
        with open(DATA_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    return data

@app.post("/api/ogs", response_model=OGSLocation)
async def add_ogs(loc: OGSLocation):
    if not is_in_europe_bbox(loc.lat, loc.lon):
        raise HTTPException(status_code=400, detail="La ubicacion esta fuera del area de Europa definida.")
    data = []
    if DATA_PATH.exists():
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

    record = loc.dict()
    if not record.get("id"):
        record["id"] = f"station-{uuid4().hex[:8]}"

    # Actualiza la entrada si ya existe con el mismo id
    updated = False
    for idx, item in enumerate(data):
        if item.get("id") == record["id"]:
            data[idx] = record
            updated = True
            break

    if not updated:
        data.append(record)

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return OGSLocation(**record)

@app.delete("/api/ogs")
async def clear_ogs():
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump([], f)
    return JSONResponse({"status": "ok", "message": "Todas las OGS han sido eliminadas."})


@app.delete("/api/ogs/{station_id}")
async def delete_ogs(station_id: str):
    if not DATA_PATH.exists():
        raise HTTPException(status_code=404, detail="Estación no encontrada.")

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    filtered = [item for item in data if item.get("id") != station_id]
    if len(filtered) == len(data):
        raise HTTPException(status_code=404, detail="Estación no encontrada.")

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(filtered, f, ensure_ascii=False, indent=2)

    return JSONResponse({"status": "ok", "deleted": station_id})

@app.post("/api/get_atmosphere_profile")
async def get_atmosphere_profile(req: AtmosRequest):
    try:
        target_dt = datetime.fromisoformat(req.time.rstrip('Z'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Timestamp ISO inválido")
    wavelength = req.wavelength_nm or 810.0
    query = AtmosphereQuery(
        lat=req.lat,
        lon=req.lon,
        timestamp=target_dt,
        model=req.model,
        ground_cn2_day=req.ground_cn2_day,
        ground_cn2_night=req.ground_cn2_night,
        wavelength_nm=wavelength,
    )

    try:
        profile = await run_in_threadpool(build_profile, query)
        return profile
    except AtmosphereModelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AtmosphereProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=500, detail=f"Error al procesar atmósfera: {exc}") from exc


@app.post("/api/get_weather_field")
async def get_weather_field(req: WeatherFieldRequest):
    try:
        target_dt = datetime.fromisoformat(req.time.rstrip('Z'))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Timestamp ISO inválido") from exc

    query = WeatherFieldQuery(
        timestamp=target_dt,
        variable=req.variable,
        level_hpa=req.level_hpa,
        samples=req.samples,
    )

    try:
        payload = await run_in_threadpool(build_weather_field, query)
        return payload
    except WeatherFieldParameterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AtmosphereProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=500, detail=f"Error al obtener campo meteorológico: {exc}") from exc


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

