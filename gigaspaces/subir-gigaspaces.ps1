# Versão Windows (PowerShell) de subir-gigaspaces.sh
#   powershell -ExecutionPolicy Bypass -File gigaspaces\subir-gigaspaces.ps1
#
# Sobe o GigaSpaces num container Docker, implanta o Space "chatSpace"
# (2 partições) e o REST Service (PU chat-rest) na porta 8081.
#
# IMPORTANTE: quando o container reinicia (PC ou Docker reiniciado) ou a
# licença "tryme" de 24 h expira, o Space some. Rode este script de novo
# e depois "npm run setup".
$ErrorActionPreference = "Stop"

$Versao = "16.1.0"
$Image = if ($env:GS_IMAGE) { $env:GS_IMAGE } else { "gigaspaces/xap-enterprise:$Versao" }
$Name  = if ($env:GS_CONTAINER) { $env:GS_CONTAINER } else { "gs-chat" }
$Dir   = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-Imagem($img) {
  $ErrorActionPreference = "Continue"
  docker image inspect $img 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Imagem $Image)) {
  Write-Host "==> A imagem $Image não está neste computador. Baixando (precisa de internet)..."
  $ErrorActionPreference = "Continue"
  docker pull $Image
  $ErrorActionPreference = "Stop"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    Não consegui baixar $Image. Vou usar gigaspaces/xap-enterprise:latest."
    $Image = "gigaspaces/xap-enterprise:latest"
  }
}

Write-Host "==> Removendo container antigo (se existir)"
$ErrorActionPreference = "Continue"
docker rm -f $Name 2>&1 | Out-Null
$ErrorActionPreference = "Stop"

Write-Host "==> Iniciando $Image (Manager + 3 GSCs: 2 para as partições, 1 para o REST Service)"
docker run --name $Name -d -e GS_LICENSE=tryme `
  -p 8090:8090 -p 8099:8099 -p 8081:8081 -p 8082:8082 `
  $Image host run-agent --auto --gsc=3 | Out-Null

Write-Host "==> Aguardando o GigaSpaces Manager (porta 8090)..."
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest -UseBasicParsing http://localhost:8090/v2/info -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { Start-Sleep 2 }
}
if (-not $ok) { throw "Manager não respondeu. Veja: docker logs $Name" }
Start-Sleep 5

$GsHome = (docker exec $Name sh -c 'echo ${GS_HOME:-/opt/gigaspaces}').Trim()
# O Manager escuta no hostname do container, não em localhost (IPv6 ::1)
$GsHost = (docker exec $Name hostname).Trim()
$Gs = "$GsHome/bin/gs.sh"

Write-Host "==> Implantando o Space chatSpace (2 partições)"
docker exec $Name $Gs --server=$GsHost space deploy --partitions=2 chatSpace

Write-Host "==> Implantando o REST Service (PU chat-rest, porta 8081)"
docker cp "$Dir\chat-rest.jar" "${Name}:/tmp/chat-rest.jar"
docker exec $Name $Gs --server=$GsHost pu deploy chat-rest /tmp/chat-rest.jar

Write-Host "==> Aguardando o REST Service (porta 8081)..."
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -UseBasicParsing http://localhost:8081/ -TimeoutSec 2 | Out-Null; break }
  catch { if ($_.Exception.Response) { break } else { Start-Sleep 2 } }
}

Write-Host ""
Write-Host "GigaSpaces pronto ($Image):"
Write-Host "  REST Service do Space : http://localhost:8081"
Write-Host "  Web Management Console: http://localhost:8099"
Write-Host ""
Write-Host "Próximo passo:  npm run setup"
