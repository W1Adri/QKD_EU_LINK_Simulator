"""Global meteorological field sampling utilities.

This module provides a lightweight wrapper around the Open-Meteo forecast API
so the frontend can retrieve coarse global grids (lat/lon) for specific
pressure-level variables. The returned payload is intentionally compact and
suited for quick rendering as a colour-mapped overlay on the Leaflet map.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import ceil, inf, isfinite, sqrt
from typing import Any, Dict, List, Sequence

from .atmosphere import AtmosphereProviderError, OpenMeteoClient


class WeatherFieldError(RuntimeError):
    """Base exception for weather field sampling issues."""


class WeatherFieldParameterError(WeatherFieldError):
    """Raised when an unsupported variable or level is requested."""


@dataclass(frozen=True)
class WeatherFieldQuery:
    """Parameters describing the requested global field."""

    timestamp: datetime
    variable: str
    level_hpa: int
    samples: int


@dataclass(frozen=True)
class _HourlyPointQuery:
    """Minimal query object compatible with ``OpenMeteoClient``."""

    lat: float
    lon: float
    timestamp: datetime

    @property
    def date_key(self) -> str:
        return self.timestamp.strftime("%Y-%m-%d")

    @property
    def hour_key(self) -> str:
        return self.timestamp.strftime("%Y-%m-%dT%H:00")


VARIABLE_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "wind_speed": {
        "label": "Wind speed",
        "units": "m/s",
        "levels": {
            200: "wind_speed_200hPa",
            250: "wind_speed_250hPa",
            300: "wind_speed_300hPa",
            500: "wind_speed_500hPa",
            700: "wind_speed_700hPa",
            850: "wind_speed_850hPa",
        },
    },
    "temperature": {
        "label": "Temperature",
        "units": "degC",
        "levels": {
            200: "temperature_200hPa",
            300: "temperature_300hPa",
            500: "temperature_500hPa",
            700: "temperature_700hPa",
            850: "temperature_850hPa",
        },
    },
    "relative_humidity": {
        "label": "Relative humidity",
        "units": "%",
        "levels": {
            700: "relative_humidity_700hPa",
            850: "relative_humidity_850hPa",
            925: "relative_humidity_925hPa",
        },
    },
    "geopotential_height": {
        "label": "Geopotential height",
        "units": "m",
        "levels": {
            500: "geopotential_height_500hPa",
            700: "geopotential_height_700hPa",
            850: "geopotential_height_850hPa",
        },
    },
}


def _resolve_variable(variable: str, level_hpa: int) -> Dict[str, Any]:
    key = (variable or "").strip().lower()
    if key not in VARIABLE_DEFINITIONS:
        raise WeatherFieldParameterError(f"Unsupported variable '{variable}'")
    definition = VARIABLE_DEFINITIONS[key]
    if level_hpa not in definition["levels"]:
        raise WeatherFieldParameterError(
            f"Variable '{variable}' is not available at {level_hpa} hPa",
        )
    return definition


@dataclass
class _GridDefinition:
    rows: int
    cols: int
    latitudes: List[float]
    longitudes: List[float]


def _lerp(start: float, end: float, fraction: float) -> float:
    return start + (end - start) * fraction


def _generate_grid(sample_hint: int) -> _GridDefinition:
    """Create an approximately uniform latitude/longitude grid."""

    clamped_samples = max(16, min(900, int(sample_hint)))
    cols = max(12, int(round(sqrt(clamped_samples * 2))))
    rows = max(6, int(ceil(clamped_samples / cols)))

    latitudes = [
        _lerp(-80.0, 80.0, idx / (rows - 1)) if rows > 1 else 0.0
        for idx in range(rows)
    ]
    longitudes = [
        _lerp(-180.0, 180.0, idx / (cols - 1)) if cols > 1 else 0.0
        for idx in range(cols)
    ]

    return _GridDefinition(rows=rows, cols=cols, latitudes=latitudes, longitudes=longitudes)


def _resolve_hour_index(hourly_block: Dict[str, Any], hour_key: str) -> int:
    timeline = hourly_block.get("time")
    if not isinstance(timeline, list):
        raise AtmosphereProviderError("Open-Meteo hourly timeline unavailable")
    try:
        return timeline.index(hour_key)
    except ValueError as exc:
        raise AtmosphereProviderError(f"No Open-Meteo sample available for {hour_key}") from exc


def build_weather_field(query: WeatherFieldQuery) -> Dict[str, Any]:
    definition = _resolve_variable(query.variable, query.level_hpa)
    variable_key = definition["levels"][query.level_hpa]
    grid = _generate_grid(query.samples)

    client = OpenMeteoClient()
    rows: List[List[Any]] = []
    current_min = inf
    current_max = -inf
    accumulator = 0.0
    valid_count = 0

    for lat in grid.latitudes:
        row_values: List[Any] = []
        for lon in grid.longitudes:
            point_query = _HourlyPointQuery(lat=lat, lon=lon, timestamp=query.timestamp)
            dataset = client.fetch_hourly(point_query, (variable_key,))
            hourly = dataset.get("hourly", {})
            idx = _resolve_hour_index(hourly, point_query.hour_key)
            series: Sequence[Any] = hourly.get(variable_key, [])
            value = None
            if idx < len(series):
                value = series[idx]
            if value is None:
                row_values.append(None)
                continue
            numeric = float(value)
            row_values.append(numeric)
            if numeric < current_min:
                current_min = numeric
            if numeric > current_max:
                current_max = numeric
            accumulator += numeric
            valid_count += 1
        rows.append(row_values)

    if valid_count == 0 or not isfinite(current_min) or not isfinite(current_max):
        raise AtmosphereProviderError("No valid samples returned by Open-Meteo")

    mean_value = accumulator / valid_count if valid_count else None

    return {
        "status": "ok",
        "timestamp": query.timestamp.replace(microsecond=0).isoformat() + "Z",
        "variable": {
            "key": query.variable,
            "label": definition["label"],
            "units": definition["units"],
            "pressure_hpa": query.level_hpa,
            "open_meteo_key": variable_key,
        },
        "grid": {
            "rows": grid.rows,
            "cols": grid.cols,
            "latitudes": grid.latitudes,
            "longitudes": grid.longitudes,
            "values": rows,
            "min": current_min,
            "max": current_max,
            "mean": mean_value,
            "valid_samples": valid_count,
        },
        "metadata": {
            "requested_samples": query.samples,
            "actual_samples": grid.rows * grid.cols,
        },
    }


__all__ = [
    "WeatherFieldError",
    "WeatherFieldParameterError",
    "WeatherFieldQuery",
    "build_weather_field",
]
