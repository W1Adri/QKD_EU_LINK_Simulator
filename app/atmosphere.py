"""Atmospheric model providers and utilities for link budget calculations.

This module centralises the logic required to fetch meteorological drivers
from Open-Meteo, convert them into turbulence/attenuation profiles and expose
them as a normalised structure that the FastAPI endpoint can return directly
to the frontend.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from functools import lru_cache
import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import copy

import numpy as np
import requests


# ---------------------------------------------------------------------------
# Exceptions and data containers
# ---------------------------------------------------------------------------


class AtmosphereModelError(RuntimeError):
	"""Base exception for atmosphere-related failures."""


class AtmosphereProviderError(AtmosphereModelError):
	"""Raised when an upstream data source cannot satisfy the request."""


class AtmosphereModelNotFoundError(AtmosphereModelError):
	"""Raised when the requested model name is not registered."""


@dataclass(frozen=True)
class AtmosphereQuery:
	"""Input parameters used by the providers."""

	lat: float
	lon: float
	timestamp: datetime
	model: str
	ground_cn2_day: float
	ground_cn2_night: float
	wavelength_nm: float

	@property
	def is_day(self) -> bool:
		return 6 <= self.timestamp.hour < 18

	@property
	def ground_cn2(self) -> float:
		return self.ground_cn2_day if self.is_day else self.ground_cn2_night

	@property
	def hour_key(self) -> str:
		return self.timestamp.strftime("%Y-%m-%dT%H:00")

	@property
	def date_key(self) -> str:
		return self.timestamp.strftime("%Y-%m-%d")


@dataclass
class AtmosphericLayer:
	alt_km: float
	cn2: Optional[float] = None
	wind_mps: Optional[float] = None
	temperature_k: Optional[float] = None
	humidity: Optional[float] = None


@dataclass
class AtmosphericSummary:
	r0_zenith: Optional[float] = None
	fG_zenith: Optional[float] = None
	theta0_zenith: Optional[float] = None
	wind_rms: Optional[float] = None
	loss_aod_db: Optional[float] = None
	loss_abs_db: Optional[float] = None
	coherence_time_ms: Optional[float] = None
	scintillation_index: Optional[float] = None


@dataclass
class AtmosphericProfile:
	model: str
	status: str
	timestamp: str
	summary: AtmosphericSummary
	layers: List[AtmosphericLayer]
	sources: Dict[str, Any]
	metadata: Dict[str, Any]

	def to_dict(self) -> Dict[str, Any]:
		return {
			"model": self.model,
			"status": self.status,
			"timestamp": self.timestamp,
			"summary": _clean_dict(asdict(self.summary)),
			"layers": [_clean_dict(asdict(layer)) for layer in self.layers],
			"sources": self.sources,
			"metadata": self.metadata,
		}


def _clean_dict(payload: Dict[str, Any]) -> Dict[str, Any]:
	"""Drop keys with ``None`` values to keep the JSON compact."""

	return {key: value for key, value in payload.items() if value is not None}


# ---------------------------------------------------------------------------
# Open-Meteo client with basic caching
# ---------------------------------------------------------------------------


class OpenMeteoClient:
	BASE_URL = "https://api.open-meteo.com/v1/forecast"

	def fetch_hourly(self, query: AtmosphereQuery, variables: Sequence[str]) -> Dict[str, Any]:
		"""Fetch hourly data for the given variables (cached by location/date)."""

		if not variables:
			raise AtmosphereProviderError("No variables requested for Open-Meteo fetch")

		variable_tuple = tuple(sorted(set(variables)))
		lat_key = round(query.lat, 3)
		lon_key = round(query.lon, 3)
		raw = _fetch_open_meteo_cached(lat_key, lon_key, query.date_key, variable_tuple)
		# ``requests`` returns mutable dicts; copy to avoid accidental mutation
		return copy.deepcopy(raw)


@lru_cache(maxsize=128)
def _fetch_open_meteo_cached(
	lat_key: float,
	lon_key: float,
	date_key: str,
	variable_tuple: Tuple[str, ...],
) -> Dict[str, Any]:
	params = {
		"latitude": lat_key,
		"longitude": lon_key,
		"start_date": date_key,
		"end_date": date_key,
		"timezone": "UTC",
		"hourly": ",".join(variable_tuple),
	}
	try:
		response = requests.get(OpenMeteoClient.BASE_URL, params=params, timeout=10)
		response.raise_for_status()
	except requests.RequestException as exc:
		raise AtmosphereProviderError(f"Open-Meteo request failed: {exc}") from exc
	data = response.json()
	if "hourly" not in data:
		raise AtmosphereProviderError("Open-Meteo response missing 'hourly' block")
	return data


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def _resolve_hour_index(hourly_block: Dict[str, Any], hour_key: str) -> int:
	timeline = hourly_block.get("time")
	if not isinstance(timeline, list):
		raise AtmosphereProviderError("Open-Meteo hourly timeline unavailable")
	try:
		return timeline.index(hour_key)
	except ValueError as exc:
		raise AtmosphereProviderError(
			f"No Open-Meteo sample available for {hour_key}"
		) from exc


def _calculate_summary_from_layers(
	layers: Iterable[AtmosphericLayer],
	wavelength_nm: float,
	fallback_wind: Optional[float] = None,
	base_loss_aod: float = 0.2,
	base_loss_abs: float = 0.1,
) -> AtmosphericSummary:
	# Prepare arrays for integration, skipping layers without Cn² information
	heights_m = []
	cn2_values = []
	wind_values = []
	for layer in layers:
		if layer.cn2 is None:
			continue
		heights_m.append(layer.alt_km * 1000.0)
		cn2_values.append(layer.cn2)
		wind_values.append(layer.wind_mps if layer.wind_mps is not None else fallback_wind)

	if len(cn2_values) < 2:
		# Not enough information for meaningful integration; return defaults
		return AtmosphericSummary(
			r0_zenith=0.1,
			fG_zenith=30.0,
			theta0_zenith=1.5,
			wind_rms=fallback_wind or 15.0,
			loss_aod_db=base_loss_aod,
			loss_abs_db=base_loss_abs,
		)

	heights = np.array(heights_m, dtype=float)
	cn2 = np.array(cn2_values, dtype=float)
	order = np.argsort(heights)
	heights = heights[order]
	cn2 = cn2[order]
	winds = np.array([wind_values[idx] if wind_values[idx] is not None else 0.0 for idx in order])

	k = 2.0 * math.pi / (wavelength_nm * 1e-9)
	integral_r0 = float(np.trapz(cn2, heights))
	integral_theta = float(np.trapz(cn2 * (heights ** (5.0 / 3.0)), heights))
	integral_wind = float(np.trapz(cn2 * (np.abs(winds) ** (5.0 / 3.0)), heights))

	r0_zenith = (0.423 * (k ** 2) * max(integral_r0, 1e-20)) ** (-3.0 / 5.0)
	theta0_rad = (2.91 * (k ** 2) * max(integral_theta, 1e-20)) ** (-3.0 / 5.0)
	fG_zenith = (0.102 * (k ** 2) * max(integral_wind, 1e-30)) ** (3.0 / 5.0)

	# RMS wind from available data or fallback
	if np.count_nonzero(winds) > 0:
		wind_rms = float(np.sqrt(np.mean(winds ** 2)))
	else:
		wind_rms = fallback_wind or 15.0

	tau0 = 0.314 * r0_zenith / max(wind_rms, 1e-3)

	cn2_scale = max(integral_r0, 1e-12)
	loss_aod = base_loss_aod + min(1.8, 0.18 * (cn2_scale ** 0.3))
	loss_abs = base_loss_abs + min(1.2, 0.12 * (cn2_scale ** 0.25))

	return AtmosphericSummary(
		r0_zenith=float(r0_zenith),
		fG_zenith=float(fG_zenith),
		theta0_zenith=float(math.degrees(theta0_rad) * 3600.0),
		wind_rms=float(wind_rms),
		loss_aod_db=float(loss_aod),
		loss_abs_db=float(loss_abs),
		coherence_time_ms=float(tau0 * 1e3),
	)


def _create_layers_from_samples(
	altitudes_km: Sequence[float],
	cn2_func,
	wind_model,
	temperature_profile=None,
	humidity_profile=None,
) -> List[AtmosphericLayer]:
	layers: List[AtmosphericLayer] = []
	for alt_km in altitudes_km:
		temperature = temperature_profile(alt_km) if temperature_profile else None
		humidity = humidity_profile(alt_km) if humidity_profile else None
		layers.append(
			AtmosphericLayer(
				alt_km=alt_km,
				cn2=float(cn2_func(alt_km * 1000.0)),
				wind_mps=float(wind_model(alt_km)),
				temperature_k=temperature,
				humidity=humidity,
			)
		)
	return layers


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------


def _hv57_provider(query: AtmosphereQuery, client: OpenMeteoClient) -> AtmosphericProfile:
	variables = ["wind_u_component_300hPa", "wind_v_component_300hPa"]
	dataset = client.fetch_hourly(query, variables)
	hourly = dataset["hourly"]
	idx = _resolve_hour_index(hourly, query.hour_key)

	wind_u = hourly.get("wind_u_component_300hPa", [None])[idx]
	wind_v = hourly.get("wind_v_component_300hPa", [None])[idx]
	if wind_u is None or wind_v is None:
		raise AtmosphereProviderError("Missing 300 hPa wind components for Hufnagel-Valley model")

	W = float(math.sqrt(wind_u ** 2 + wind_v ** 2))
	W = max(W, 5.0)
	A = max(query.ground_cn2, 1e-17)

	def cn2_hv(h_metres: float) -> float:
		term1 = 0.00594 * ((W / 27.0) ** 2) * (h_metres * 1e-5) ** 10 * math.exp(-h_metres / 1000.0)
		term2 = 2.7e-16 * math.exp(-h_metres / 1500.0)
		term3 = A * math.exp(-h_metres / 100.0)
		return term1 + term2 + term3

	def wind_profile(alt_km: float) -> float:
		# Empirical decay close to surface with asymptotic high altitude wind
		return float(max(0.0, W * (1.0 - math.exp(-alt_km / 5.0)) + 3.0))

	altitudes = (0.0, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 20.0)
	layers = _create_layers_from_samples(altitudes, cn2_hv, wind_profile)
	summary = _calculate_summary_from_layers(layers, query.wavelength_nm, fallback_wind=W)

	return AtmosphericProfile(
		model="hufnagel-valley",
		status="ok",
		timestamp=query.timestamp.replace(microsecond=0).isoformat() + "Z",
		summary=summary,
		layers=layers,
		sources={
			"provider": "Open-Meteo forecast",
			"variables": variables,
		},
		metadata={
			"daytime": query.is_day,
			"wavelength_nm": query.wavelength_nm,
			"ground_cn2": query.ground_cn2,
			"wind_speed_300hPa": W,
		},
	)


def _bufton_provider(query: AtmosphereQuery, client: OpenMeteoClient) -> AtmosphericProfile:
	variables = [
		"wind_u_component_300hPa",
		"wind_v_component_300hPa",
		"wind_u_component_500hPa",
		"wind_v_component_500hPa",
		"wind_u_component_850hPa",
		"wind_v_component_850hPa",
		"temperature_850hPa",
	]
	dataset = client.fetch_hourly(query, variables)
	hourly = dataset["hourly"]
	idx = _resolve_hour_index(hourly, query.hour_key)

	def _wind_speed(key: str) -> float:
		u = hourly.get(f"wind_u_component_{key}", [None])[idx]
		v = hourly.get(f"wind_v_component_{key}", [None])[idx]
		if u is None or v is None:
			raise AtmosphereProviderError(f"Missing wind component for {key}")
		return float(math.sqrt(u ** 2 + v ** 2))

	wind_300 = _wind_speed("300hPa")
	wind_500 = _wind_speed("500hPa")
	wind_850 = _wind_speed("850hPa")

	temp_850 = hourly.get("temperature_850hPa", [None])[idx]
	lapse_correction = 0.8 if temp_850 is None else max(0.5, min(1.5, (temp_850 + 273.15) / 290.0))

	A = max(query.ground_cn2, 1e-17)
	shear_factor = max(0.5, min(2.5, abs(wind_500 - wind_850) / 10.0))

	def cn2_bufton(h_metres: float) -> float:
		h_km = h_metres / 1000.0
		if h_km < 0.5:
			return A * math.exp(-h_metres / 60.0)
		if h_km < 1.5:
			return 0.3 * A * math.exp(-h_metres / 120.0) * shear_factor
		if h_km < 5.0:
			return 0.08 * A * math.exp(-h_metres / 600.0) * lapse_correction
		return 0.02 * A * math.exp(-(h_metres - 5000.0) / 1500.0)

	def wind_profile(alt_km: float) -> float:
		if alt_km < 0.5:
			return float(max(2.0, wind_850 * 0.6))
		if alt_km < 1.5:
			return float((wind_850 + wind_500) / 2.0)
		if alt_km < 6.0:
			return float(wind_500)
		return float(wind_300)

	def temperature_profile(alt_km: float) -> Optional[float]:
		if temp_850 is None:
			return None
		lapse_rate = -6.5  # K/km
		delta = alt_km - 1.5
		return float((temp_850 + 273.15) + lapse_rate * delta)

	altitudes = (0.0, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 12.0)
	layers = _create_layers_from_samples(altitudes, cn2_bufton, wind_profile, temperature_profile)
	summary = _calculate_summary_from_layers(
		layers,
		query.wavelength_nm,
		fallback_wind=float(np.sqrt((wind_300 ** 2 + wind_500 ** 2 + wind_850 ** 2) / 3.0)),
		base_loss_aod=0.25,
		base_loss_abs=0.12,
	)
	summary.scintillation_index = float(min(1.5, 0.3 + shear_factor * 0.2))

	return AtmosphericProfile(
		model="bufton",
		status="ok",
		timestamp=query.timestamp.replace(microsecond=0).isoformat() + "Z",
		summary=summary,
		layers=layers,
		sources={
			"provider": "Open-Meteo forecast",
			"variables": variables,
		},
		metadata={
			"daytime": query.is_day,
			"wavelength_nm": query.wavelength_nm,
			"ground_cn2": query.ground_cn2,
			"wind_speed": {
				"300hPa": wind_300,
				"500hPa": wind_500,
				"850hPa": wind_850,
			},
			"temperature_850hPa_K": None if temp_850 is None else temp_850 + 273.15,
		},
	)


def _greenwood_provider(query: AtmosphereQuery, client: OpenMeteoClient) -> AtmosphericProfile:
	variables = [
		"wind_u_component_200hPa",
		"wind_v_component_200hPa",
		"wind_u_component_300hPa",
		"wind_v_component_300hPa",
		"temperature_200hPa",
		"relative_humidity_700hPa",
	]
	dataset = client.fetch_hourly(query, variables)
	hourly = dataset["hourly"]
	idx = _resolve_hour_index(hourly, query.hour_key)

	def _wind(key: str) -> float:
		u = hourly.get(f"wind_u_component_{key}", [None])[idx]
		v = hourly.get(f"wind_v_component_{key}", [None])[idx]
		if u is None or v is None:
			raise AtmosphereProviderError(f"Missing wind component for {key}")
		return float(math.sqrt(u ** 2 + v ** 2))

	wind_200 = _wind("200hPa")
	wind_300 = _wind("300hPa")
	temp_200 = hourly.get("temperature_200hPa", [None])[idx]
	humidity_700 = hourly.get("relative_humidity_700hPa", [None])[idx]

	A = max(query.ground_cn2, 5e-18)
	high_wind = max(wind_200, wind_300)
	humidity_factor = 1.0 if humidity_700 is None else 1.0 + max(0.0, (humidity_700 - 40.0) / 200.0)

	def cn2_greenwood(h_metres: float) -> float:
		h_km = h_metres / 1000.0
		core = 0.04 * A * humidity_factor * math.exp(-h_metres / 800.0)
		if h_km > 8.0:
			return core + 1.5e-17 * math.exp(-(h_metres - 8000.0) / 2000.0)
		if h_km > 2.0:
			return core + 4.5e-17 * math.exp(-(h_metres - 2000.0) / 1500.0)
		return core

	def wind_profile(alt_km: float) -> float:
		if alt_km < 2.0:
			return float(max(3.0, wind_300 * 0.5))
		if alt_km < 6.0:
			return float((wind_300 + wind_200) / 2.0)
		return float(high_wind)

	def temperature_profile(alt_km: float) -> Optional[float]:
		if temp_200 is None:
			return None
		lapse_rate = -3.0  # K/km in upper atmosphere
		delta = alt_km - 12.0
		return float((temp_200 + 273.15) + lapse_rate * delta)

	def humidity_profile(alt_km: float) -> Optional[float]:
		if humidity_700 is None:
			return None
		if alt_km < 3.0:
			return float(humidity_700)
		return float(max(5.0, humidity_700 * math.exp(-(alt_km - 3.0) / 2.5)))

	altitudes = (0.0, 0.5, 1.5, 3.0, 6.0, 9.0, 12.0, 16.0)
	layers = _create_layers_from_samples(
		altitudes,
		cn2_greenwood,
		wind_profile,
		temperature_profile,
		humidity_profile,
	)
	summary = _calculate_summary_from_layers(
		layers,
		query.wavelength_nm,
		fallback_wind=high_wind,
		base_loss_aod=0.22,
		base_loss_abs=0.11,
	)
	summary.scintillation_index = float(min(1.8, 0.35 + humidity_factor * 0.25))

	return AtmosphericProfile(
		model="greenwood",
		status="ok",
		timestamp=query.timestamp.replace(microsecond=0).isoformat() + "Z",
		summary=summary,
		layers=layers,
		sources={
			"provider": "Open-Meteo forecast",
			"variables": variables,
		},
		metadata={
			"daytime": query.is_day,
			"wavelength_nm": query.wavelength_nm,
			"ground_cn2": query.ground_cn2,
			"wind_speed": {
				"200hPa": wind_200,
				"300hPa": wind_300,
			},
			"humidity_700hPa_percent": humidity_700,
		},
	)


PROVIDERS = {
	"hufnagel-valley": _hv57_provider,
	"hv57": _hv57_provider,
	"bufton": _bufton_provider,
	"greenwood": _greenwood_provider,
}


def resolve_model_name(model: str) -> str:
	normalized = (model or "").strip().lower()
	if not normalized or normalized == "auto":
		return "hufnagel-valley"
	if normalized not in PROVIDERS:
		raise AtmosphereModelNotFoundError(f"Atmospheric model '{model}' is not available")
	return normalized


def build_profile(query: AtmosphereQuery) -> Dict[str, Any]:
	provider_name = resolve_model_name(query.model)
	provider = PROVIDERS[provider_name]
	client = OpenMeteoClient()
	profile = provider(query, client)
	return profile.to_dict()


__all__ = [
	"AtmosphereModelError",
	"AtmosphereProviderError",
	"AtmosphereModelNotFoundError",
	"AtmosphereQuery",
	"build_profile",
]

