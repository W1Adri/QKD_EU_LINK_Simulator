# QKD Planner FastAPI app. Serves static files, the 2D map, and the 3D orbit designer.
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path
import json, os

# Absolute paths (robust across working directories)
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INDEX_HTML = STATIC_DIR / "index.html"
ORBIT3D_HTML = STATIC_DIR / "orbit3d.html"
DATA_PATH = STATIC_DIR / "ogs_locations.json"

app = FastAPI(title="QKD Europe Planner", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

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

