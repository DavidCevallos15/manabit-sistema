# Fase 2a: permiso de Firestore para la web y secretos en Secret Manager.
# Ejecutar en PowerShell normal desde la carpeta del proyecto:
#   powershell -ExecutionPolicy Bypass -File scripts\gcp-preparar.ps1
# Los valores se generan aqui y se suben sin mostrarse. Solo ADMIN_PASSWORD la escribes tu.
# PowerShell 5.1 convierte el stderr de gcloud en error fatal con "Stop"; se valida $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$P = "manabit-sistema"
$web = "serviceAccount:manabit-web@$P.iam.gserviceaccount.com"
$agentPublic = "serviceAccount:manabit-agent-public@$P.iam.gserviceaccount.com"
$agentOwner = "serviceAccount:manabit-agent-owner@$P.iam.gserviceaccount.com"

function Invoke-Gcloud([string[]]$ArgList) {
  & gcloud @ArgList
  if ($LASTEXITCODE -ne 0) { throw "gcloud fallo: $($ArgList -join ' ')" }
}

# 1. Firestore para la web (reintenta si IAM tiene cambios concurrentes)
for ($i = 1; $i -le 5; $i++) {
  & gcloud projects add-iam-policy-binding $P --member $web --role roles/datastore.user --condition=None --format=none
  if ($LASTEXITCODE -eq 0) { Write-Host "OK  roles/datastore.user -> manabit-web"; break }
  if ($i -eq 5) { throw "No se pudo asignar roles/datastore.user" }
  Start-Sleep -Seconds (2 * $i)
}

function Test-Secret([string]$Name) {
  & gcloud secrets describe $Name --project $P --format="value(name)" 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function New-RandomHex {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Set-Secret([string]$Name, [string]$Value) {
  if (Test-Secret $Name) { Write-Host "--  $Name ya existe; se conserva"; return }
  # Archivo temporal sin salto de linea final (un pipe de PowerShell lo anadiria).
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $Value, (New-Object Text.UTF8Encoding($false)))
    Invoke-Gcloud @("secrets", "create", $Name, "--project", $P, "--replication-policy", "automatic", "--data-file", $tmp, "--format=none")
    Write-Host "OK  $Name creado"
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# 2. Contrasena del panel (no se muestra; guardala en tu gestor de contrasenas)
if (-not (Test-Secret "manabit-admin-password")) {
  do {
    $s1 = Read-Host "Contrasena del panel (16+ caracteres)" -AsSecureString
    $s2 = Read-Host "Repitela" -AsSecureString
    $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
    $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
    $ok = ($p1 -eq $p2) -and ($p1.Length -ge 16)
    if (-not $ok) { Write-Host "No coinciden o tiene menos de 16 caracteres. Intenta de nuevo." }
  } until ($ok)
  Set-Secret "manabit-admin-password" $p1
  $p1 = $null; $p2 = $null
} else { Write-Host "--  manabit-admin-password ya existe; se conserva" }

# 3. Secretos aleatorios
Set-Secret "manabit-session-secret" (New-RandomHex)
Set-Secret "manabit-tools-public" (New-RandomHex)
Set-Secret "manabit-tools-owner" (New-RandomHex)
Set-Secret "manabit-worker-token" (New-RandomHex)

# 4. Acceso minimo: la web lee los cinco; cada agente solo su token de herramientas
foreach ($name in "manabit-admin-password", "manabit-session-secret", "manabit-tools-public", "manabit-tools-owner", "manabit-worker-token") {
  Invoke-Gcloud @("secrets", "add-iam-policy-binding", $name, "--project", $P, "--member", $web, "--role", "roles/secretmanager.secretAccessor", "--format=none")
}
Invoke-Gcloud @("secrets", "add-iam-policy-binding", "manabit-tools-public", "--project", $P, "--member", $agentPublic, "--role", "roles/secretmanager.secretAccessor", "--format=none")
Invoke-Gcloud @("secrets", "add-iam-policy-binding", "manabit-tools-owner", "--project", $P, "--member", $agentOwner, "--role", "roles/secretmanager.secretAccessor", "--format=none")
Write-Host "OK  accesos a secretos asignados"

Write-Host ""
Write-Host "Verificacion (sin valores):"
& gcloud secrets list --project $P --format="table(name,createTime.date('%Y-%m-%d'))"
