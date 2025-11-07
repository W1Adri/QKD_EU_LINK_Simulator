import requests
import json
from datetime import datetime, timedelta

# --- 1. CONFIGURACIÓN ---
# API de pronóstico (esta es la que usaremos)
api_url = "https://api.open-meteo.com/v1/forecast" 

# Calcula la fecha de mañana
tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')

params = {
    "latitude": 28.3,
    "longitude": -16.5,
    "start_date": tomorrow, # ¡Pedimos un pronóstico para mañana!
    "end_date": tomorrow,
    
    # ¡LA CLAVE! Pedimos las variables con el sufijo de altura
        "hourly": "temperature_300hPa,wind_u_component_300hPa,wind_v_component_300hPa",
    
    # NO incluimos 'pressure_level' NI 'models'
    # La API infiere el modelo (ERA5) por la fecha histórica y el nombre de la variable.
}

print(f"Intentando conectar a: {api_url}")
print(f"Parámetros: {params}")

# --- 2. EJECUCIÓN ---
try:
    response = requests.get(api_url, params=params, timeout=10)
    response.raise_for_status() # Lanza un error si la API devuelve 4xx o 5xx
    
    # Si llegamos aquí, ¡funcionó!
    print("\n--- ¡ÉXITO! ---")
    print(f"Respuesta del servidor: {response.status_code}")
    print("Datos recibidos (extracto):")
    print(json.dumps(response.json(), indent=2))
    
except requests.exceptions.HTTPError as e:
    print(f"\n--- ERROR HTTP: {e} ---")
    print("La API respondió con un error.")
    try:
        print("Respuesta del servidor:", response.json())
    except:
        print("Respuesta del servidor:", response.text)
    
except requests.exceptions.Timeout:
    print("\n--- ERROR: Timeout ---")
    print("La conexión ha tardado demasiado.")
    
except requests.exceptions.RequestException as e:
    print(f"\n--- ERROR DE CONEXIÓN: {e} ---")
    print("Python no ha podido conectarse. Revisa tu conexión a internet.")