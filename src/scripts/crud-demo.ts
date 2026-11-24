/**
 * npm run crud
 *
 * Roteiro da demonstração AO VIVO do CRUD, na ordem do checklist:
 *   Read (estado inicial) → Create → Read → Update → Read → Delete → Read
 *
 * Cada passo:
 *   1. explica o que vai acontecer e espera ENTER;
 *   2. executa no GigaSpaces e lista as requisições HTTP enviadas ao Space;
 *   3. mostra o resultado (antes → depois) e a frase "o que isso mostra".
 *
 * Opções:
 *   npm run crud -- --auto         roda direto, sem esperar ENTER
 *   npm run crud -- --sala=outra   usa outra sala (padrão: geral)
 *
 * A demo cria UMA mensagem e a apaga no final: o Space volta ao estado inicial.
 */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "../config.js";
import { SpaceClient, type SpaceOperation } from "../gigaspaces/SpaceClient.js";
import { ChatError, ChatRepository } from "../model/ChatRepository.js";
import { TYPES, type Mensagem } from "../model/schema.js";

// ------------------------------------------------------------------ opções
const auto = process.argv.includes("--auto");
const salaId = process.argv.find((a) => a.startsWith("--sala="))?.slice(7) || "geral";
const rl = auto ? null : readline.createInterface({ input: stdin, output: stdout });

// ------------------------------------------------------------------ cores
// Cores só quando a saída é um terminal (sem lixo ao redirecionar para arquivo).
const tty = Boolean(process.stdout.isTTY);
const esc = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const cor = {
  b: esc("1"), dim: esc("2"), it: esc("3"),
  azul: esc("94"), verde: esc("92"), amarelo: esc("93"), vermelho: esc("91"), ciano: esc("96"),
};
const CRUD = {
  C: { nome: "CREATE", cor: cor.azul, fundo: esc("30;104") },
  R: { nome: "READ", cor: cor.verde, fundo: esc("30;102") },
  U: { nome: "UPDATE", cor: cor.amarelo, fundo: esc("30;103") },
  D: { nome: "DELETE", cor: cor.vermelho, fundo: esc("30;101") },
} as const;
type Letra = keyof typeof CRUD;
const selo = (l: Letra) => CRUD[l].fundo(` ${l} `);

const W = 76;
const linha = (ch = "─") => console.log(cor.dim(ch.repeat(W)));
const corta = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const hora = (ts: number) => new Date(ts).toLocaleTimeString("pt-BR");

// ------------------------------------------------------------------ Space + registro das requisições
const space = new SpaceClient(config.gsRestUrl);
const repo = new ChatRepository(space);
let gravando = false;
let requisicoes: SpaceOperation[] = [];
space.onOperation((op) => {
  if (gravando && op.op !== "count" && op.op !== "introduceType") requisicoes.push(op);
});

const NOME_OP: Record<string, string> = {
  write: "write", read: "read", readMultiple: "readMultiple", take: "take", takeMultiple: "takeMultiple",
};

function mostrarRequisicoes(): void {
  console.log(cor.b("\n  Requisições enviadas ao GigaSpaces:"));
  for (const op of requisicoes) {
    const [metodo, ...resto] = op.http.split(" ");
    const caminho = corta(resto.join(" "), 44);
    const status = op.ok ? cor.verde("✓") : cor.vermelho("✗");
    const extra = op.detail?.includes("→") ? cor.dim(` (${op.detail.split("→")[1].trim()})`) : "";
    console.log(`    ${status} ${cor.b((NOME_OP[op.op] ?? op.op).padEnd(13))}${metodo.padEnd(7)}${caminho.padEnd(45)}${cor.dim(`${op.ms} ms`)}${extra}`);
  }
  requisicoes = [];
}

// ------------------------------------------------------------------ peças visuais
async function passo(n: number, letra: Letra, titulo: string, opSpace: string, explicacao: string[]): Promise<void> {
  console.log("\n");
  linha("━");
  console.log(`${cor.b(` PASSO ${n} de 7 `)} ${selo(letra)} ${CRUD[letra].cor(cor.b(`${CRUD[letra].nome}`))} ${cor.b("— " + titulo)}`);
  console.log(cor.dim(`  operação de tuple space: `) + cor.b(opSpace));
  linha("━");
  console.log(cor.b("  O que vai acontecer:"));
  for (const l of explicacao) console.log("    " + l);
  if (rl) await rl.question(cor.ciano("\n  ▶ Aperte ENTER para executar "));
  requisicoes = [];
  gravando = true;
}

function fimDoPasso(licao: string[]): void {
  gravando = false;
  console.log(cor.b("\n  O que isso mostra:"));
  for (const l of licao) console.log("    " + cor.amarelo(l));
}

const NOTAS: Record<string, string> = {
  id: "chave da tupla",
  salaId: "routing property: decide a partição",
};

function mostrarTupla(titulo: string, m: Mensagem | null): void {
  if (!m) {
    console.log(cor.vermelho(`\n  ${titulo}: nenhuma tupla encontrada no Space.`));
    return;
  }
  const largura = 64;
  console.log(`\n  ┌─ ${cor.b(titulo)} ${"─".repeat(Math.max(0, largura - titulo.length - 3))}`);
  for (const campo of ["id", "salaId", "autorId", "texto", "enviadaEm", "editada", "editadaEm"]) {
    const v = m[campo];
    let txt = typeof v === "string" ? (campo === "texto" ? `"${v}"` : v) : String(v);
    if ((campo === "enviadaEm" || campo === "editadaEm") && typeof v === "number" && v > 0) txt = `${v}  (${hora(v)})`;
    txt = corta(txt, 42);
    const nota = NOTAS[campo] ? cor.dim(`  ← ${NOTAS[campo]}`) : "";
    console.log(`  │ ${cor.ciano(campo.padEnd(10))} ${txt}${nota}`);
  }
  console.log(`  └${"─".repeat(largura + 1)}`);
}

function mostrarLista(titulo: string, msgs: Mensagem[], destaque?: { id: string; rotulo: string }): void {
  console.log(cor.b(`\n  ${titulo}`) + cor.dim(` — ${msgs.length} mensagem(ns)`));
  if (!msgs.length) return console.log(cor.dim("    (nenhuma)"));
  console.log(cor.dim(`    ${"hora".padEnd(10)}${"autor".padEnd(8)}texto`));
  for (const m of msgs) {
    const marca = destaque?.id === m.id ? cor.verde(`  ← ${destaque.rotulo}`) : "";
    const ed = m.editada ? cor.dim(" (editada)") : "";
    console.log(`    ${hora(m.enviadaEm).padEnd(10)}${corta(m.autorId, 7).padEnd(8)}${corta(m.texto, 48)}${ed}${marca}`);
  }
}

function antesDepois(rotulo: string, antes: number, depois: number, comentario = ""): void {
  const seta = depois > antes ? cor.verde("▲") : depois < antes ? cor.vermelho("▼") : cor.dim("=");
  console.log(`  ${rotulo.padEnd(30)} ${cor.b(String(antes))} → ${cor.b(String(depois))}  ${seta} ${cor.dim(comentario)}`);
}

function comparar(antes: Mensagem, depois: Mensagem): void {
  console.log(cor.b("\n  Antes × depois (mesma tupla, mesmo id):"));
  console.log(cor.dim(`    ${"campo".padEnd(11)}${"antes".padEnd(30)}depois`));
  for (const campo of ["id", "texto", "editada", "editadaEm"]) {
    const fmt = (v: unknown) => {
      if (campo === "editadaEm" && typeof v === "number") return v > 0 ? hora(v) : "0 (nunca)";
      return typeof v === "string" && campo === "texto" ? `"${v}"` : String(v);
    };
    const a = corta(fmt(antes[campo]), 28);
    const d = corta(fmt(depois[campo]), 28);
    const mudou = antes[campo] !== depois[campo];
    console.log(`    ${cor.ciano(campo.padEnd(11))}${a.padEnd(30)}${mudou ? cor.amarelo(cor.b(d)) : d}${mudou ? cor.amarelo("  ← mudou") : cor.dim("  (igual)")}`);
  }
}

// ================================================================== DEMO
try {
  console.log("");
  linha("═");
  console.log(cor.b("  DEMO AO VIVO — CRUD no GigaSpaces (armazenamento de tuplas)"));
  console.log(cor.dim(`  Sistema: chat em tempo real · Space: chatSpace · sala usada: #${salaId}`));
  linha("═");
  console.log(cor.b("\n  Como cada letra do CRUD vira uma operação de tuple space:\n"));
  console.log(`    ${selo("C")} Create  →  ${cor.b("write")}   grava uma tupla nova no Space`);
  console.log(`    ${selo("R")} Read    →  ${cor.b("read")}    lê uma CÓPIA da tupla (ela continua no Space)`);
  console.log(`    ${selo("U")} Update  →  ${cor.b("write")}   com o mesmo id: a tupla nova substitui a antiga`);
  console.log(`    ${selo("D")} Delete  →  ${cor.b("take")}    lê E remove a tupla, numa operação só`);

  // ---- conexão e preparação (não aparece nos passos)
  process.stdout.write(cor.dim(`\n  Conectando em ${config.gsRestUrl} ... `));
  await repo.registrarTipos();
  if (!(await space.readById(TYPES.sala, salaId))) {
    await repo.criarSala(salaId, "Sala criada para a demo", "ana");
  }
  await repo.entrar("Ana");
  const inicio = await repo.contagens();
  console.log(cor.verde("conectado ✓"));
  console.log(cor.dim(`  Tuplas no Space agora: Usuario ${inicio.usuarios} · Sala ${inicio.salas} · Mensagem ${inicio.mensagens}`));

  // ---------------------------------------------------------------- 1. READ (estado inicial)
  await passo(1, "R", "Estado inicial da sala", "readMultiple (consulta)", [
    `Vamos consultar o Space e listar as mensagens da sala #${salaId}.`,
    `A consulta é ${cor.b(`salaId='${salaId}'`)}: o Space devolve toda tupla Mensagem com esse valor.`,
  ]);
  const histInicial = await repo.historico(salaId);
  mostrarRequisicoes();
  mostrarLista(`Mensagens na sala #${salaId}`, histInicial);
  fimDoPasso([
    "É o ponto de partida. Os dados vieram do Space, não de um arquivo do programa.",
    "read/readMultiple devolvem CÓPIAS: as tuplas continuam lá dentro.",
  ]);

  // ---------------------------------------------------------------- 2. CREATE
  const texto = "Olá, professora! Esta mensagem está sendo gravada agora no GigaSpaces.";
  await passo(2, "C", "Ana envia uma mensagem", "write", [
    `Ana escreve: ${cor.it(`"${texto}"`)}`,
    "O servidor monta uma tupla Mensagem e faz um write no Space.",
    cor.dim("(antes, um read confere se a sala existe)"),
  ]);
  const totalAntesC = await space.count(TYPES.mensagem);
  const criada = await repo.enviarMensagem(salaId, "ana", texto);
  mostrarRequisicoes();
  mostrarTupla("Tupla gravada no Space", criada);
  console.log("");
  antesDepois(`Mensagens na sala #${salaId}`, histInicial.length, (await repo.historico(salaId)).length);
  antesDepois("Tuplas Mensagem no Space", totalAntesC, await space.count(TYPES.mensagem));
  fimDoPasso([
    "Uma tupla nova entrou no Space.",
    "salaId é a routing property: todas as mensagens desta sala ficam na mesma partição.",
  ]);

  // ---------------------------------------------------------------- 3. READ (por id e por template)
  await passo(3, "R", "Ler a mensagem criada", "read (por id) + readMultiple (template)", [
    `a) read pelo id: ${cor.b(criada.id)}`,
    `b) consulta por template: só ${cor.b("salaId")} e ${cor.b("autorId")} preenchidos; o resto fica como coringa (*):`,
    cor.ciano(`     Mensagem( id=*, salaId='${salaId}', autorId='ana', texto=*, enviadaEm=*, ... )`),
  ]);
  const lida = await repo.lerMensagem(criada.id);
  const daAna = (await space.readMultiple<Mensagem>(TYPES.mensagem, `salaId='${salaId}' AND autorId='ana'`)).sort((a, b) => a.enviadaEm - b.enviadaEm);
  mostrarRequisicoes();
  mostrarTupla("a) read por id", lida);
  mostrarLista(`b) Template: mensagens da Ana na sala #${salaId}`, daAna, { id: criada.id, rotulo: "a que acabamos de criar" });
  fimDoPasso([
    "Busca associativa: o Space procura pelo CONTEÚDO dos campos, não só pela chave.",
    "Os campos preenchidos precisam casar; os vazios aceitam qualquer valor.",
  ]);

  // ---------------------------------------------------------------- 4. UPDATE
  const novoTexto = "Olá, professora! (mensagem EDITADA ao vivo)";
  await passo(4, "U", "Ana edita a mensagem", "read + write com o mesmo id", [
    `Novo texto: ${cor.it(`"${novoTexto}"`)}`,
    "O servidor lê a tupla atual, troca o texto e faz write com o MESMO id.",
    "No GigaSpaces o write padrão é UPDATE_OR_WRITE: se o id já existe, substitui.",
  ]);
  const antesU = (await repo.lerMensagem(criada.id))!;
  requisicoes = [];
  const totalAntesU = await space.count(TYPES.mensagem);
  const editada = await repo.editarMensagem(criada.id, "ana", novoTexto);
  mostrarRequisicoes();
  comparar(antesU, editada);
  console.log("");
  antesDepois("Tuplas Mensagem no Space", totalAntesU, await space.count(TYPES.mensagem), "não criou outra: substituiu");
  fimDoPasso([
    "Mesmo id = mesma tupla. O Space trocou a versão antiga pela nova.",
    "Pelo REST o update é a tupla inteira; na API Java existe o change (só alguns campos).",
  ]);

  // ---------------------------------------------------------------- 5. READ (confirma o update)
  await passo(5, "R", "Conferir a edição", "read (por id)", [
    "Vamos ler a tupla de novo, direto do Space, para provar que a edição foi gravada.",
  ]);
  const conferida = await repo.lerMensagem(criada.id);
  mostrarRequisicoes();
  mostrarTupla("Tupla lida do Space", conferida);
  fimDoPasso([
    `texto e editada=${conferida?.editada} vieram do Space: a alteração está gravada no banco.`,
  ]);

  // ---------------------------------------------------------------- 6. DELETE
  await passo(6, "D", "Ana apaga a mensagem", "take", [
    "take é a operação típica de tuple space: lê a tupla E a remove, de forma atômica.",
    cor.dim("(antes, um read confere se a Ana é a autora)"),
  ]);
  const naSalaAntesD = (await repo.historico(salaId)).length;
  requisicoes = [];
  const totalAntesD = await space.count(TYPES.mensagem);
  const removida = await repo.apagarMensagem(criada.id, "ana");
  mostrarRequisicoes();
  mostrarTupla("Tupla retirada do Space (o take devolve o que removeu)", removida);
  console.log("");
  antesDepois(`Mensagens na sala #${salaId}`, naSalaAntesD, (await repo.historico(salaId)).length);
  antesDepois("Tuplas Mensagem no Space", totalAntesD, await space.count(TYPES.mensagem));
  fimDoPasso([
    "A leitura CONSUMIU a tupla. Ela não está mais no Space.",
    "Se dois clientes fizerem take da mesma tupla ao mesmo tempo, só um a recebe.",
  ]);

  // ---------------------------------------------------------------- 7. READ (confirma o delete)
  await passo(7, "R", "Conferir que a mensagem sumiu", "read (por id) + readMultiple", [
    `a) read pelo id ${cor.b(criada.id)}`,
    `b) lista da sala #${salaId} de novo`,
  ]);
  const depoisD = await repo.lerMensagem(criada.id);
  const histFinal = await repo.historico(salaId);
  mostrarRequisicoes();
  mostrarTupla("a) read por id", depoisD);
  mostrarLista(`b) Mensagens na sala #${salaId}`, histFinal);
  fimDoPasso([
    "A sala voltou ao estado do passo 1: a demo não deixou lixo no Space.",
  ]);

  // ---------------------------------------------------------------- extra: erro
  console.log("\n");
  linha("━");
  console.log(cor.b("  EXTRA — tratamento de erro"));
  linha("━");
  console.log("    E se alguém tentar editar a mensagem que acabou de ser apagada?");
  if (rl) await rl.question(cor.ciano("\n  ▶ Aperte ENTER para tentar "));
  try {
    await repo.editarMensagem(criada.id, "ana", "isto não deveria funcionar");
    console.log(cor.vermelho("    (inesperado: a edição funcionou)"));
  } catch (e) {
    const msg = e instanceof ChatError ? e.message : (e as Error).message;
    console.log(`\n    ${cor.vermelho("✗")} O sistema respondeu: ${cor.b(msg)}`);
    console.log(cor.dim("      O read não encontrou a tupla, então nada foi gravado."));
  }

  // ---------------------------------------------------------------- resumo
  const fim = await repo.contagens();
  console.log("\n");
  linha("═");
  console.log(cor.b("  RESUMO DO CRUD NO GIGASPACES"));
  linha("═");
  console.log(`    ${selo("C")} Create  ${cor.b("write".padEnd(13))}POST   /Mensagem              ${cor.verde("✓")}`);
  console.log(`    ${selo("R")} Read    ${cor.b("read".padEnd(13))}GET    /Mensagem/{id}         ${cor.verde("✓")}`);
  console.log(`${" ".repeat(16)}${cor.b("readMultiple".padEnd(13))}GET    /Mensagem?query=...    ${cor.verde("✓")}`);
  console.log(`    ${selo("U")} Update  ${cor.b("write".padEnd(13))}POST   /Mensagem (mesmo id)   ${cor.verde("✓")}`);
  console.log(`    ${selo("D")} Delete  ${cor.b("take".padEnd(13))}DELETE /Mensagem/{id}         ${cor.verde("✓")}`);
  console.log(cor.dim(`\n    Tuplas no Space: Usuario ${fim.usuarios} · Sala ${fim.salas} · Mensagem ${fim.mensagens} (igual ao início)`));
  console.log(cor.dim("    Para ver as tuplas na console do GigaSpaces: http://localhost:8099 → chatSpace"));
  console.log("");
} catch (e) {
  gravando = false;
  console.log("\n\n" + cor.vermelho(cor.b("  A demo parou por um erro:")));
  console.log("  " + (e as Error).message);
  console.log(cor.b("\n  O que fazer:"));
  console.log("    1. Suba o GigaSpaces:  powershell -ExecutionPolicy Bypass -File gigaspaces\\subir-gigaspaces.ps1");
  console.log("    2. Carregue os dados:  npm run setup");
  console.log("    3. Rode a demo de novo: npm run crud\n");
  process.exitCode = 1;
} finally {
  rl?.close();
}
