"""Small suite of connectivity checks for external HTTP APIs."""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from typing import Any, Dict, Iterable

import requests


def pretty(obj: Any) -> str:
    """Return a safe string representation for logging."""
    try:
        return json.dumps(obj, indent=2)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(obj)


def run_test(name: str, url: str, params: Dict[str, Any] | None = None) -> bool:
    """Run a single HTTP GET test and report success."""
    print(f"\n=== Test: {name} ===")
    print(f"URL: {url}")
    if params:
        print(f"Parámetros: {params}")

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        print("Resultado: ÉXITO")
        payload = response.json()
        print("Extracto de la respuesta:")
        print(pretty(payload if isinstance(payload, dict) else payload[:1]))
        return True

    except requests.exceptions.Timeout:
        print("Resultado: ERROR - Timeout")
        return False

    except requests.exceptions.HTTPError as exc:
        print(f"Resultado: ERROR HTTP - {exc}")
        try:
            print("Cuerpo devuelto:")
            print(pretty(response.json()))
        except Exception:  # pragma: no cover - logging only
            print(response.text)
        return False

    except requests.exceptions.RequestException as exc:
        print(f"Resultado: ERROR DE CONEXIÓN - {exc}")
        return False


def build_tests() -> Iterable[tuple[str, str, Dict[str, Any] | None]]:
    """Define the list of tests to execute."""
    today = date.today()
    yesterday = today - timedelta(days=1)
    reference = date(2023, 1, 1)

    return (
        (
            "GitHub API",
            "https://api.github.com/repos/octocat/Hello-World",
            None,
        ),
        (
            "Open-Meteo Forecast (simple)",
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": 28.3,
                "longitude": -16.5,
                "hourly": "temperature_2m",
            },
        ),
        (
            "Open-Meteo ERA5 (surface)",
            "https://archive-api.open-meteo.com/v1/era5",
            {
                "latitude": 28.3,
                "longitude": -16.5,
                "start_date": str(yesterday),
                "end_date": str(yesterday),
                "hourly": "temperature_2m",
            },
        ),
        (
            "Open-Meteo ERA5 Pressure Levels",
            "https://archive-api.open-meteo.com/v1/era5",
            {
                "latitude": 28.3,
                "longitude": -16.5,
                "start_date": str(reference),
                "end_date": str(reference),
                "hourly": "temperature",
                "pressure_level": "300",
                "models": "best_match",
            },
        ),
    )


def main() -> int:
    success = False
    for name, url, params in build_tests():
        success = run_test(name, url, params) or success
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
