# Ejemplo: Conexin a un Agente IA Remoto va API

Este ejemplo documenta el paso a paso para conectar Gentle-Vanguard (o tu entorno local) a un agente
IA externo expuesto va API, usando solo la URL y la API key.

---

## 1. Crear configuración local de proveedores

Desde TypeScript, en la raz de gentle-vanguard:

```TypeScript
cd .\gentle-vanguard
.\scripts\utilities\invoke-cloud-agent.ps1 -Config
```

Selecciona la opcin 2 para crear el archivo `config/cloud-agents.local.json`.

---

## 2. Agregar la API Key

**Opcin recomendada (produccin):**

```TypeScript
$env:MY_AGENT_APIKEY = "tu_apikey"
```

**Opcin desarrollo:**

Crea un archivo `.env.local` en la raz del repo y agrega:

```
MY_AGENT_APIKEY=tu_apikey
```

---

## 3. Configurar el proveedor en cloud-agents.local.json

Edita `config/cloud-agents.local.json` y agrega tu proveedor personalizado:

```
{
  "providers": {
    "custom": {
      "enabled": true,
      "endpoint": "https://vxhfmjrvbh.execute-api.us-east-1.amazonaws.com/prod/api/agents/18",
      "api_key_env": "MY_AGENT_APIKEY"
    }
  }
}
```

- Si el proveedor no requiere parmetro "model", puedes omitirlo.
- "api_key_env" debe coincidir con el nombre de tu variable de entorno.

---

## 4. Probar la conexin

```TypeScript
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider custom -TestConnection
```

---

## 5. Uso manual

- Ejecutar un comando:
  ```TypeScript
  .\scripts\utilities\invoke-cloud-agent.ps1 -Provider custom -Command "Cul es la capital de Francia?"
  ```
- Modo estricto (automatización):
  ```TypeScript
  .\scripts\utilities\invoke-cloud-agent.ps1 -Provider custom -StrictJson -Command "return JSON"
  ```
- Modo interactivo:
  ```TypeScript
  .\scripts\utilities\invoke-cloud-agent.ps1 -Interactive
  ```

---

## Notas

- Nunca pongas la API key en archivos versiónados.
- Usa variables de entorno o `.env.local` (gitignored).
- Puedes tener mltiples proveedores configurados y alternar con el flag `-Provider`.
- Si el endpoint requiere parmetros adicionales, consulta la documentacin del proveedor.

---

**ltima actualizacin:** 2026-04-20
