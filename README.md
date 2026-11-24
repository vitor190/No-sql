# SpaceChat: chat em tempo real sobre GigaSpaces (Tuple Store)

**Projeto 3 de NoSQL, tema 6: Armazenamento de tuplas (tuple store).**
SGBD escolhido: **GigaSpaces (XAP)**. Sistema escolhido: **(c) chat em tempo real**.
Aplicação prática escrita em **TypeScript** (Node.js + Express + interface web).

O CRUD é feito num Space do GigaSpaces através do **REST Service** oficial dele:

| CRUD   | Operação de tuple space | Requisição ao GigaSpaces           | No chat                         |
|--------|-------------------------|------------------------------------|---------------------------------|
| Create | `write`                 | `POST /Mensagem`                   | enviar mensagem                 |
| Read   | `read` / `readMultiple` | `GET /Mensagem/{id}` · `GET /Mensagem?query=salaId='geral'` | abrir uma mensagem / histórico da sala |
| Update | `write` com o mesmo id (UPDATE_OR_WRITE) | `GET` + `POST /Mensagem` | editar mensagem                 |
| Delete | `take`                  | `DELETE /Mensagem/{id}`            | apagar mensagem                 |

---

## 1. Arquitetura

```
 Navegador (Ana)  ─┐                                   ┌─────────── GigaSpaces (Docker) ───────────┐
 Navegador (Bruno) ─┼─ HTTP ─▶  Servidor TypeScript  ── HTTP ─▶ REST Service ─▶ Space "chatSpace"      │
 Terminal (npm run crud) ─────▶  (src/server, src/model)       (PU chat-rest)    ├─ partição 1          │
                                    SpaceClient.ts             porta 8081        └─ partição 2          │
                                                                └──────────────────────────────────────────┘
```

* `src/gigaspaces/SpaceClient.ts`: cliente da API REST do Space (write, read, readMultiple, count, take, takeMultiple, introduceType).
* `src/model/schema.ts`: modelo de dados (tipos de SpaceDocument).
* `src/model/ChatRepository.ts`: regras do chat (CRUD de mensagens, salas e usuários).
* `src/server/index.ts`: API do chat + interface web (`public/`, `src/web/app.ts`); registra cada ação e as operações que ela fez no Space para o painel "O que aconteceu no banco".
* `src/scripts/crud-demo.ts`: **roteiro da demonstração ao vivo**, passo a passo.
* `src/scripts/setup.ts` + `src/model/seed.ts`: registram os tipos, limpam o Space e gravam os dados iniciais.
* `gigaspaces/`: script para subir o GigaSpaces e a PU do REST Service.
* `src/dev/fake-gigaspaces.ts`: *simulador* da API REST, usado só para testes/ensaio (veja a seção 6).

## 2. Modelo de dados (o que vai no Space)

Cada registro é um **SpaceDocument** (uma "tupla" com campos nomeados).

| Tipo       | Campos | Observações |
|------------|--------|-------------|
| `Usuario`  | `id`, `nome`, `status` (online/offline), `ultimoAcesso` | `status` indexado (EQUAL) |
| `Sala`     | `id`, `nome`, `descricao`, `criadaPor`, `criadaEm` | |
| `Mensagem` | `id`, `salaId`, `autorId`, `texto`, `enviadaEm`, `editada`, `editadaEm` | **`salaId` é a routing property**, `enviadaEm` indexado (ORDERED), FIFO habilitado |

**Por que `salaId` é a routing property:** com o Space particionado (2 partições neste projeto), o GigaSpaces usa o hash da routing property para escolher a partição. Assim todas as mensagens de uma sala ficam na mesma partição, e ler o histórico de uma sala consulta uma partição só, em memória. Esse é um ótimo ponto para a parte "como o BD se adequa ao sistema".

Exemplo de tupla `Mensagem`:
```json
{ "id": "msg-1731770000000-a1b2c3d4", "salaId": "geral", "autorId": "ana",
  "texto": "Olá turma!", "enviadaEm": 1731770000000, "editada": false, "editadaEm": 0 }
```

## 3. Versões testadas

| Componente | Versão | Observação |
|---|---|---|
| GigaSpaces | **XAP Enterprise 16.1.0** (`gigaspaces/xap-enterprise:16.1.0`) | licença de avaliação `tryme` (24 h) |
| Java | **OpenJDK 1.8.0_312** | já vem **dentro** do container; não precisa instalar Java no computador |
| Docker | 29.x (Docker Desktop no Windows) | |
| Node.js | **22.x** (funciona a partir do 18) | |
| Sistema | Windows 10 (PowerShell) | também roda em Linux/macOS com o script `.sh` |

## 4. Subindo o GigaSpaces

Requisitos: **Docker** e **Node.js 18+**.

Windows (PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File gigaspaces\subir-gigaspaces.ps1
```
Linux/macOS/WSL/Git Bash:
```bash
bash gigaspaces/subir-gigaspaces.sh
```

O script, num comando só:
1. usa a imagem `gigaspaces/xap-enterprise:16.1.0` (se ela não estiver no computador, tenta baixar; se não conseguir, usa a `latest`);
2. sobe o container `gs-chat` com a licença `tryme`, o Manager e 3 GSCs;
3. implanta o Space `chatSpace` com 2 partições (`gs.sh space deploy --partitions=2 chatSpace`);
4. implanta a PU `chat-rest` (`gigaspaces/chat-rest.jar`, que contém só o `pu.xml` com `<os-core:rest space-name="chatSpace" port="8081"/>`).

> ⚠️ **O Space não sobrevive a um reinício.** Se o PC ou o Docker reiniciar, ou se a licença de 24 h expirar, o container volta **vazio** e o chat mostra "Não foi possível conectar ao GigaSpaces". Nesses casos, rode o script de novo e depois `npm run setup`.

Para conferir: `curl http://localhost:8081/Mensagem/count` deve responder com HTTP (antes do setup é normal vir um erro de tipo não encontrado).

## 5. Rodando a aplicação

```bash
npm install
npm run setup      # registra os tipos, LIMPA o Space e grava os dados de exemplo
npm start          # chat em http://localhost:3000
```

O `npm run setup` pode ser rodado quantas vezes quiser: ele apaga (take) todas as tuplas `Usuario`, `Sala` e `Mensagem` e grava de novo os dados de exemplo (3 usuários, 2 salas, 5 mensagens). Use-o para desfazer ensaios e testes.

Se o REST Service estiver em outro endereço:
```bash
GS_REST_URL=http://192.168.0.10:8081 npm start          # Linux/macOS
$env:GS_REST_URL="http://192.168.0.10:8081"; npm start  # PowerShell
```

## 6. Roteiro da demonstração ao vivo

### Antes de começar (uns 10 minutos antes)
```powershell
powershell -ExecutionPolicy Bypass -File gigaspaces\subir-gigaspaces.ps1
npm run setup
npm start
```
Deixe abertos: o terminal (fonte grande), o chat em `http://localhost:3000` e a console em `http://localhost:8099`.

### Parte 1: CRUD comentado no terminal (`npm run crud`)
O script para a cada passo (aperte ENTER). Em cada um ele mostra **o que vai acontecer**, as **requisições enviadas ao GigaSpaces**, o **antes → depois** e uma frase **"o que isso mostra"** para vocês lerem em voz alta. A ordem é a do checklist:

| Passo | CRUD | Operação no Space | O que a turma vê |
|---|---|---|---|
| 1 | R | `readMultiple` com `salaId='geral'` | as 3 mensagens iniciais da sala |
| 2 | C | `write` | a tupla nova, campo a campo; contagem 5 → 6 |
| 3 | R | `read` por id + **consulta por template** `salaId='geral' AND autorId='ana'` | a tupla lida e a lista filtrada |
| 4 | U | `read` + `write` com o mesmo id | tabela **antes × depois**; contagem 6 → 6 (substituiu) |
| 5 | R | `read` por id | o texto novo vindo do Space |
| 6 | D | `take` | a tupla que o take devolveu; contagem 6 → 5 |
| 7 | R | `read` + `readMultiple` | "nenhuma tupla encontrada"; sala igual ao passo 1 |
| extra | – | – | tratamento de erro: editar a mensagem apagada |

A demo cria uma mensagem e a apaga no fim, então o Space volta ao estado inicial. Para rodar sem pausas: `npm run crud -- --auto`. Para usar outra sala: `npm run crud -- --sala=projeto-nosql`.

> Dica: deixe o chat aberto na sala **#geral** enquanto roda o `npm run crud`. A mensagem do passo 2 aparece no navegador em cerca de 1 s, a edição do passo 4 também, e ela some no passo 6.

### Parte 2: o chat no navegador (`npm start`)
1. Abra `http://localhost:3000` em **duas janelas** (uma anônima) e entre como "Ana" e como "Bruno".
2. Bruno envia uma mensagem, que aparece para a Ana em cerca de 1 s (**C**).
3. Trocar de sala faz uma consulta por template no Space (**R**). O botão **Ver tupla** mostra a tupla campo a campo (**R** por id).
4. Ana clica em **Editar** numa mensagem dela (**U**) e depois em **Apagar** (**D**).
5. O painel **"O que aconteceu no banco"**, à direita, mostra cada ação com a letra do CRUD, uma explicação, as operações (`read`, `write`, `take`) com a requisição HTTP e o tempo em ms, e um link "ver a tupla". **Apontem para ele durante a demo.**
6. Os contadores **"Tuplas no Space agora"** (coluna da esquerda) sobem e descem a cada C e D.
7. O botão **❓ Como funciona** abre um resumo da arquitetura e do mapeamento CRUD → tuple space, útil para responder perguntas.
8. Extra: abra `http://localhost:8099` (Web Management Console) e mostre as entradas e as 2 partições do `chatSpace`.

A tela começa no tema claro, que lê melhor no projetor. O botão 🌙 troca para o escuro.

## 7. Plano B: simulador (só para ensaio)

Para ensaiar num computador sem Docker:
```bash
npm run simulador    # terminal 1: imita a API REST do GigaSpaces em :8081
npm run setup        # terminal 2
npm start
```
⚠️ **O simulador NÃO é o GigaSpaces.** Ele guarda tudo num `Map` em memória. Responde no mesmo formato do GigaSpaces 16.1 real (entradas dentro de `properties`, `200` com `data: {}` para id inexistente) e serve para os testes automatizados e para treinar o roteiro. Na apresentação, o CRUD tem de rodar no GigaSpaces de verdade (é isso que o enunciado pede).

## 8. Testes

```bash
npm test           # 10 testes: CRUD completo, permissões, consultas, setup repetível, erros
npm run typecheck
```

## 9. Limitações (bom assunto para "desvantagens")

* **Tempo real por polling:** a API REST não expõe `notify` nem `take` bloqueante (eles existem nas APIs Java/.NET do GigaSpaces). Por isso a interface consulta o Space a cada 1 s. Num sistema real, o serviço de chat seria escrito em Java/.NET, usaria *notify containers* / *polling containers* do GigaSpaces e empurraria as mensagens por WebSocket.
* **Update = substituição:** pelo REST, a atualização é um `write` com a entrada inteira (por isso fazemos read → merge → write). Na API Java existe a operação `change`, que altera só alguns campos.
* **Sem leases pelo REST:** na API nativa cada `write` pode ter um *lease* (tempo de vida), útil, por exemplo, para status "digitando…" que some sozinho.
* **Licença:** o XAP Enterprise é comercial; a licença `tryme` dura só 24 h.

## 10. Solução de problemas

| Sintoma | O que fazer |
|---|---|
| `Não foi possível conectar ao GigaSpaces em http://localhost:8081 (fetch failed)` | Quase sempre o container reiniciou e voltou vazio (PC/Docker reiniciado ou licença expirada). Rode o script da seção 4 e depois `npm run setup`. O chat mostra uma faixa amarela com esses comandos. |
| Sumiram salas ou mensagens | Alguém apagou pela interface. `npm run setup` recria os dados de exemplo. |
| Container some depois de um tempo | A licença `tryme` expirou (24 h). Rode o script de novo. |
| `404` em tudo, até em `/Mensagem/count` depois do setup | Abra `http://localhost:8081/` no navegador e veja em qual caminho está a API; se for, por exemplo, `/rest/data`, use `GS_REST_URL=http://localhost:8081/rest/data`. |
| Porta 8081 ocupada | Troque o `port` em `gigaspaces/chat-rest-pu/META-INF/spring/pu.xml`, gere o jar de novo (`cd gigaspaces/chat-rest-pu && jar cf ../chat-rest.jar META-INF`) e ajuste `GS_REST_URL`. |
| A imagem `16.1.0` não baixa em outro computador | O script cai automaticamente para `latest`. Para forçar outra: `$env:GS_IMAGE="gigaspaces/xap-enterprise:latest"` antes de rodar. |
#
