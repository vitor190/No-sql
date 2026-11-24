#!/usr/bin/env bash
# Sobe o GigaSpaces num container Docker, implanta o Space "chatSpace"
# e o REST Service (PU chat-rest) na porta 8081.
#
#   bash gigaspaces/subir-gigaspaces.sh
#
# Licença "tryme": o GigaSpaces Enterprise funciona por 24 h e depois o
# container encerra. Rode este script de novo pouco antes da apresentação.
set -euo pipefail
# Git Bash (Windows): impede que caminhos como /opt/... virem C:/Program Files/Git/opt/...
export MSYS_NO_PATHCONV=1

VERSAO="16.1.0"
IMAGE="${GS_IMAGE:-gigaspaces/xap-enterprise:$VERSAO}"
NAME="${GS_CONTAINER:-gs-chat}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> A imagem $IMAGE não está neste computador. Baixando (precisa de internet)…"
  if ! docker pull "$IMAGE"; then
    echo "    Não consegui baixar $IMAGE. Vou usar gigaspaces/xap-enterprise:latest."
    IMAGE="gigaspaces/xap-enterprise:latest"
  fi
fi

echo "==> Removendo container antigo (se existir)"
docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "==> Iniciando $IMAGE (Manager + 3 containers GSC: 2 para as partições, 1 livre para o REST Service)"
docker run --name "$NAME" -d \
  -e GS_LICENSE=tryme \
  -p 8090:8090 -p 8099:8099 -p 8081:8081 -p 8082:8082 \
  "$IMAGE" host run-agent --auto --gsc=3

echo "==> Aguardando o GigaSpaces Manager (porta 8090)…"
for i in $(seq 1 90); do
  if curl -fs "http://localhost:8090/v2/info" >/dev/null 2>&1; then break; fi
  sleep 2
  if [ "$i" = 90 ]; then echo "Manager não respondeu. Veja: docker logs $NAME"; exit 1; fi
done
sleep 5

GS_HOME="$(docker exec "$NAME" sh -c 'echo ${GS_HOME:-/opt/gigaspaces}')"
GS="$GS_HOME/bin/gs.sh"
# O Manager escuta no hostname do container, não em localhost (IPv6 ::1)
GS_HOST="$(docker exec "$NAME" hostname)"
echo "    GS_HOME=$GS_HOME"

echo "==> Implantando o Space chatSpace (2 partições)"
docker exec "$NAME" "$GS" --server="$GS_HOST" space deploy --partitions=2 chatSpace

echo "==> Implantando o REST Service (PU chat-rest, porta 8081)"
docker cp "$DIR/chat-rest.jar" "$NAME:/tmp/chat-rest.jar"
docker exec "$NAME" "$GS" --server="$GS_HOST" pu deploy chat-rest /tmp/chat-rest.jar

echo "==> Aguardando o REST Service (porta 8081)…"
for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8081/ || true)"
  if [ "$code" != "000" ]; then break; fi
  sleep 2
done

echo
echo "GigaSpaces pronto ($IMAGE):"
echo "  REST Service do Space : http://localhost:8081"
echo "  Web Management Console: http://localhost:8099"
echo "  Manager REST API      : http://localhost:8090"
echo
echo "Próximo passo:  npm run setup"
