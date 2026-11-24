/**
 * npm start
 * Servidor web do chat: API REST própria (Express) que usa o GigaSpaces como banco,
 * e serve a interface em /public.
 *
 * Painel "O que aconteceu no banco": cada requisição da interface vira uma AÇÃO
 * (ex.: "Enviar mensagem", CREATE) com a lista das operações que ela fez no Space
 * (read, write, take...). A interface busca essas ações em GET /api/acoes.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";
import { SpaceClient, SpaceError, type SpaceOperation } from "../gigaspaces/SpaceClient.js";
import { ChatError, ChatRepository } from "../model/ChatRepository.js";
import { TYPES } from "../model/schema.js";

const space = new SpaceClient(config.gsRestUrl);
const repo = new ChatRepository(space);

// ------------------------------------------------------------------ ações (painel da interface)
type Crud = "C" | "R" | "U" | "D";

interface Descricao { crud: Crud; titulo: string; explicacao: string }

interface OpResumo {
  op: SpaceOperation["op"];
  http: string;
  ok: boolean;
  ms: number;
  total?: number;
  amostra?: unknown;
  erro?: string;
}

interface Acao extends Descricao {
  seq: number;
  at: number;
  ms: number;
  polling: boolean;
  ok: boolean;
  erro?: string;
  ops: OpResumo[];
}

interface Contexto extends Descricao { polling: boolean; inicio: number; ops: OpResumo[] }

const contexto = new AsyncLocalStorage<Contexto>();
const acoesUsuario: Acao[] = [];
const acoesPolling: Acao[] = [];
let seq = 0;

space.onOperation((op) => {
  const ctx = contexto.getStore();
  if (!ctx) return;
  const resumo: OpResumo = { op: op.op, http: op.http, ok: op.ok, ms: op.ms, total: op.total, erro: op.erro };
  if (!ctx.polling) resumo.amostra = Array.isArray(op.dados) ? op.dados.slice(0, 3) : op.dados;
  ctx.ops.push(resumo);
});

/** Diz qual ação do chat é cada rota da API, com a explicação mostrada no painel. */
function descrever(method: string, p: string): Descricao | null {
  const r = (re: RegExp) => re.exec(p);
  let m: RegExpExecArray | null;
  if (method === "POST" && p === "/usuarios")
    return { crud: "C", titulo: "Entrar no chat", explicacao: "Grava a tupla Usuario com status online (write). Se o usuário já existia, o write com o mesmo id substitui." };
  if (method === "POST" && r(/^\/usuarios\/[^/]+\/sair$/))
    return { crud: "U", titulo: "Sair do chat", explicacao: "Lê a tupla Usuario e grava de novo com status offline (mesmo id)." };
  if (method === "GET" && p === "/usuarios")
    return { crud: "R", titulo: "Listar usuários", explicacao: "Consulta todas as tuplas Usuario." };
  if (method === "GET" && p === "/salas")
    return { crud: "R", titulo: "Listar salas", explicacao: "Consulta todas as tuplas Sala." };
  if (method === "POST" && p === "/salas")
    return { crud: "C", titulo: "Criar sala", explicacao: "Confere se já existe uma Sala com esse id (read) e grava a tupla nova (write)." };
  if (method === "DELETE" && (m = r(/^\/salas\/([^/]+)$/)))
    return { crud: "D", titulo: `Apagar a sala #${decodeURIComponent(m[1])}`, explicacao: "Retira a tupla Sala (take) e todas as mensagens dela de uma vez (takeMultiple com salaId)." };
  if (method === "GET" && (m = r(/^\/salas\/([^/]+)\/mensagens$/)))
    return { crud: "R", titulo: `Abrir a sala #${decodeURIComponent(m[1])}`, explicacao: `Consulta por template: só salaId='${decodeURIComponent(m[1])}' preenchido, os outros campos são coringa. O Space devolve todas as mensagens da sala.` };
  if (method === "POST" && r(/^\/salas\/[^/]+\/mensagens$/))
    return { crud: "C", titulo: "Enviar mensagem", explicacao: "Confere se a sala existe (read) e grava uma tupla Mensagem nova no Space (write)." };
  if (method === "GET" && r(/^\/mensagens\/[^/]+$/))
    return { crud: "R", titulo: "Ver a tupla da mensagem", explicacao: "Lê a tupla pelo id (read). O read devolve uma cópia: a tupla continua no Space." };
  if (method === "PATCH" && r(/^\/mensagens\/[^/]+$/))
    return { crud: "U", titulo: "Editar mensagem", explicacao: "Lê a tupla atual (read) e grava de novo com o MESMO id (write): o Space substitui a versão antiga." };
  if (method === "DELETE" && r(/^\/mensagens\/[^/]+$/))
    return { crud: "D", titulo: "Apagar mensagem", explicacao: "Confere o autor (read) e retira a tupla do Space (take = lê e remove numa operação só)." };
  if (method === "GET" && p === "/status")
    return { crud: "R", titulo: "Contar tuplas", explicacao: "count de cada tipo, para os contadores da tela." };
  return null;
}

function registrar(ctx: Contexto, status: number, erro?: string): void {
  const acao: Acao = {
    seq: ++seq, at: ctx.inicio, ms: Date.now() - ctx.inicio,
    crud: ctx.crud, titulo: ctx.titulo, explicacao: ctx.explicacao,
    polling: ctx.polling, ok: status < 400, erro, ops: ctx.ops,
  };
  const lista = ctx.polling ? acoesPolling : acoesUsuario;
  lista.push(acao);
  if (lista.length > (ctx.polling ? 40 : 120)) lista.shift();
}

// ------------------------------------------------------------------ app
const app = express();
app.use(express.json());

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
app.use(express.static(path.join(root, "public")));

app.use("/api", (req, res, next) => {
  const d = descrever(req.method, req.path);
  if (!d) return next();
  const polling = req.get("x-polling") === "1" || req.path === "/status";
  const ctx: Contexto = { ...d, polling, inicio: Date.now(), ops: [] };
  res.on("finish", () => registrar(ctx, res.statusCode, res.locals.erro as string | undefined));
  contexto.run(ctx, next);
});

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ------------------------------------------------------------------ status e painel
app.get("/api/status", h(async (_req, res) => {
  const ok = await space.ping(TYPES.mensagem);
  res.json({ gigaspaces: config.gsRestUrl, conectado: ok, contagens: ok ? await repo.contagens() : null });
}));

app.get("/api/acoes", (req, res) => {
  const desde = Number(req.query.desde ?? 0);
  const todas = [...acoesUsuario, ...acoesPolling].filter((a) => a.seq > desde).sort((a, b) => a.seq - b.seq);
  res.json(todas);
});

// ------------------------------------------------------------------ usuários
app.post("/api/usuarios", h(async (req, res) => res.status(201).json(await repo.entrar(str(req.body?.nome)))));
app.get("/api/usuarios", h(async (_req, res) => res.json(await repo.listarUsuarios())));
app.post("/api/usuarios/:id/sair", h(async (req, res) => res.json(await repo.sair(String(req.params.id)))));

// ------------------------------------------------------------------ salas
app.get("/api/salas", h(async (_req, res) => res.json(await repo.listarSalas())));
app.post("/api/salas", h(async (req, res) =>
  res.status(201).json(await repo.criarSala(str(req.body?.nome), str(req.body?.descricao), str(req.body?.criadaPor))),
));
app.delete("/api/salas/:id", h(async (req, res) => res.json(await repo.apagarSala(String(req.params.id)))));

// ------------------------------------------------------------------ mensagens (CRUD)
app.get("/api/salas/:id/mensagens", h(async (req, res) => res.json(await repo.historico(String(req.params.id)))));
app.post("/api/salas/:id/mensagens", h(async (req, res) =>
  res.status(201).json(await repo.enviarMensagem(String(req.params.id), str(req.body?.autorId), str(req.body?.texto))),
));
app.get("/api/mensagens/:id", h(async (req, res) => {
  const m = await repo.lerMensagem(String(req.params.id));
  if (!m) throw new ChatError("Mensagem não encontrada", 404);
  res.json(m);
}));
app.patch("/api/mensagens/:id", h(async (req, res) =>
  res.json(await repo.editarMensagem(String(req.params.id), str(req.body?.autorId), str(req.body?.texto))),
));
app.delete("/api/mensagens/:id", h(async (req, res) =>
  res.json(await repo.apagarMensagem(String(req.params.id), str(req.query.autorId))),
));

// ------------------------------------------------------------------ erros
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.locals.erro = (err as Error)?.message;
  if (err instanceof ChatError) return res.status(err.status).json({ erro: err.message });
  if (err instanceof SpaceError) return res.status(502).json({ erro: err.message });
  console.error(err);
  res.status(500).json({ erro: "Erro interno" });
});

// ------------------------------------------------------------------ start
const server = app.listen(config.port, async () => {
  console.log(`\nChat em http://localhost:${config.port}`);
  console.log(`GigaSpaces REST: ${config.gsRestUrl}`);
  try {
    await repo.registrarTipos();
    const c = await repo.contagens();
    console.log(`Conectado ao GigaSpaces ✓  (Usuario ${c.usuarios} · Sala ${c.salas} · Mensagem ${c.mensagens})`);
  } catch (e) {
    console.warn(`\nAVISO: não consegui falar com o GigaSpaces: ${(e as Error).message}`);
    console.warn("Rode:  powershell -ExecutionPolicy Bypass -File gigaspaces\\subir-gigaspaces.ps1   e depois   npm run setup\n");
  }
});

export { app, server };
