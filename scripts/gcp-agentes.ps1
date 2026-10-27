# Fase 3/4: crear o actualizar el runtime ADK y conectarlo a Cloud Run.
#   powershell -ExecutionPolicy Bypass -File scripts\gcp-agentes.ps1              # atencion publica
#   powershell -ExecutionPolicy Bypass -File scripts\gcp-agentes.ps1 -Audience owner   # direccion interna
# Si Cloud Run ya tiene el ID del runtime, lo actualiza (--update) en vez de crear otro.
param([ValidateSet("customer", "owner")][string]$Audience = "customer")
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot)
$P = "manabit-sistema"; $R = "us-central1"; $S = "manabit-sistema"
$py = "agents\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "Falta el entorno virtual: python -m venv agents\.venv; agents\.venv\Scripts\python.exe -m pip install -r agents\requirements.txt" }

if ($Audience -eq "owner") {
  $sa = "manabit-agent-owner"; $secret = "manabit-tools-owner"; $envName = "GOOGLE_OWNER_AGENT_ENGINE_ID"
} else {
  $sa = "manabit-agent-public"; $secret = "manabit-tools-public"; $envName = "GOOGLE_AGENT_ENGINE_ID"
}

$service = & gcloud run services describe $S --project $P --region $R --format=json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $service) { throw "No existe el servicio Cloud Run $S. Ejecuta scripts\gcp-desplegar.ps1" }
$url = $service.status.url
$current = ($service.spec.template.spec.containers[0].env | Where-Object { $_.name -eq $envName }).value

$version = (& gcloud secrets versions list $secret --project $P --filter="state=enabled" --sort-by="~createTime" --limit=1 --format="value(name)")
if ($LASTEXITCODE -ne 0 -or -not $version) { throw "No hay una version habilitada de $secret" }
if ($version -notmatch "^projects/") { $version = "projects/$P/secrets/$secret/versions/$version" }

$deployArgs = @("agents\deploy.py", "--audience", $Audience, "--project", $P, "--location", $R,
  "--bucket", "gs://$P-agent-staging", "--service-account", "$sa@$P.iam.gserviceaccount.com",
  "--api-url", $url, "--secret-version", $version, "--execute")
if ($current) { $deployArgs += @("--update", $current); Write-Host "Actualizando $current" }
else { Write-Host "Creando runtime $Audience (tarda varios minutos)..." }

$resource = $null
& $py @deployArgs 2>&1 | ForEach-Object {
  $line = $_.ToString(); Write-Host $line
  if ($line -match "Recurso (creado|actualizado):\s*(projects/\S+)") { $resource = $Matches[2] }
}
if ($LASTEXITCODE -ne 0 -or -not $resource) { throw "El despliegue del runtime fallo; revisa el log de arriba." }

if ($resource -ne $current) {
  & gcloud run services update $S --project $P --region $R --update-env-vars "$envName=$resource" --quiet
  if ($LASTEXITCODE -ne 0) { throw "No se pudo configurar $envName en Cloud Run." }
}
Write-Host ""
Write-Host "OK  $envName = $resource"
Write-Host "Prueba en $url/reservar : planes, horario, propuesta con CONFIRMAR CODIGO y 'hablar con David'."
