# Fase 2b: construir con Cloud Build y desplegar en Cloud Run (Firestore, sin redes activas).
#   powershell -ExecutionPolicy Bypass -File scripts\gcp-desplegar.ps1
# Repetirlo despliega una nueva revision del mismo servicio.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot)
$P = "manabit-sistema"; $R = "us-central1"; $S = "manabit-sistema"
$number = (& gcloud projects describe $P --format="value(projectNumber)").Trim()
$url = "https://$S-$number.$R.run.app"

$secrets = @(
  "SESSION_SECRET=manabit-session-secret:latest",
  "ADMIN_PASSWORD=manabit-admin-password:latest",
  "MANABIT_TOOLS_TOKEN=manabit-tools-public:latest",
  "MANABIT_OWNER_TOOLS_TOKEN=manabit-tools-owner:latest",
  "WORKER_TOKEN=manabit-worker-token:latest"
) -join ","
$envVars = @(
  "DATABASE_BACKEND=firestore",
  "FIRESTORE_PROJECT_ID=$P",
  "APP_URL=$url",
  "SOCIAL_AUTOMATION_ENABLED=false"
) -join ","

& gcloud run deploy $S --source . --project $P --region $R `
  --service-account "manabit-web@$P.iam.gserviceaccount.com" `
  --allow-unauthenticated --min-instances 0 --max-instances 1 `
  --cpu 1 --memory 512Mi --timeout 120 --concurrency 40 `
  --set-env-vars $envVars --set-secrets $secrets --quiet
if ($LASTEXITCODE -ne 0) { throw "El despliegue fallo. Revisa el log de Cloud Build indicado arriba." }

$urls = & gcloud run services describe $S --project $P --region $R --format="value(metadata.annotations.'run.googleapis.com/urls')"
if ($urls -notmatch [regex]::Escape($url)) { Write-Warning "APP_URL ($url) no aparece en las URLs del servicio: $urls" }

Write-Host ""
Write-Host "Servicio: $url"
try {
  Invoke-WebRequest "$url/api/admin/state" -UseBasicParsing | Out-Null
  Write-Warning "/api/admin/state respondio sin sesion: NO compartas la URL y revisa la configuracion."
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 401) { Write-Host "OK  /api/admin/state devuelve 401 sin sesion" } else { Write-Warning "/api/admin/state devolvio $code" }
}
try {
  $slots = Invoke-RestMethod "$url/api/public/slots?date=$((Get-Date).AddDays(7).ToString('yyyy-MM-dd'))"
  Write-Host "OK  horarios publicos desde Firestore: $(@($slots.slots).Count) espacios en una fecha de prueba"
} catch { Write-Warning "No respondieron los horarios publicos: $($_.Exception.Message)" }
