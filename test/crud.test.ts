import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createFakeGigaSpaces } from "../src/dev/fake-gigaspaces.js";
import { SpaceClient, SpaceError, sqlText } from "../src/gigaspaces/SpaceClient.js";
import { ChatError, ChatRepository, slug } from "../src/model/ChatRepository.js";
import { TYPES } from "../src/model/schema.js";
import { recriarDados } from "../src/model/seed.js";

const server = createFakeGigaSpaces();
let space: SpaceClient;
let repo: ChatRepository;

before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  space = new SpaceClient(`http://127.0.0.1:${port}`);
  repo = new ChatRepository(space);
});
after(() => server.close());

test("registra os tipos e é idempotente", async () => {
  assert.deepEqual(await repo.registrarTipos(), { Usuario: "created", Sala: "created", Mensagem: "created" });
  assert.deepEqual(await repo.registrarTipos(), { Usuario: "exists", Sala: "exists", Mensagem: "exists" });
});

test("CRUD completo de mensagem: write → read → write(update) → take", async () => {
  await repo.entrar("Ana");
  await repo.criarSala("Geral", "sala geral", "ana");

  // CREATE
  const m = await repo.enviarMensagem("geral", "ana", "olá");
  assert.equal(await space.count(TYPES.mensagem), 1);

  // READ
  assert.equal((await repo.lerMensagem(m.id))?.texto, "olá");
  await repo.enviarMensagem("geral", "ana", "segunda");
  const hist = await repo.historico("geral");
  assert.deepEqual(hist.map((x) => x.texto), ["olá", "segunda"]);

  // UPDATE
  const ed = await repo.editarMensagem(m.id, "ana", "olá editado");
  assert.equal(ed.editada, true);
  assert.equal((await repo.lerMensagem(m.id))?.texto, "olá editado");
  assert.equal(await space.count(TYPES.mensagem), 2, "update não pode duplicar a tupla");

  // DELETE
  const rem = await repo.apagarMensagem(m.id, "ana");
  assert.equal(rem.id, m.id);
  assert.equal(await repo.lerMensagem(m.id), null);
  assert.equal(await space.count(TYPES.mensagem), 1);
});

test("só o autor edita/apaga", async () => {
  await repo.entrar("Bruno");
  const m = await repo.enviarMensagem("geral", "ana", "minha");
  await assert.rejects(repo.editarMensagem(m.id, "bruno", "hack"), (e: ChatError) => e.status === 403);
  await assert.rejects(repo.apagarMensagem(m.id, "bruno"), (e: ChatError) => e.status === 403);
});

test("histórico só traz a sala pedida (consulta por routing property)", async () => {
  await repo.criarSala("Outra", "", "bruno");
  await repo.enviarMensagem("outra", "bruno", "na outra sala");
  const geral = await repo.historico("geral");
  assert.ok(geral.every((x) => x.salaId === "geral"));
  assert.equal((await repo.historico("outra")).length, 1);
});

test("apagar sala faz take da sala e takeMultiple das mensagens", async () => {
  const r = await repo.apagarSala("outra");
  assert.equal(r.sala?.id, "outra");
  assert.equal(r.mensagensRemovidas, 1);
  assert.equal((await repo.historico("outra")).length, 0);
});

test("sair = update do status", async () => {
  const u = await repo.sair("ana");
  assert.equal(u?.status, "offline");
  const lista = await repo.listarUsuarios();
  assert.equal(lista.find((x) => x.id === "ana")?.status, "offline");
});

test("validações", async () => {
  await assert.rejects(repo.enviarMensagem("nao-existe", "ana", "x"), (e: ChatError) => e.status === 404);
  await assert.rejects(repo.enviarMensagem("geral", "ana", "   "), ChatError);
  await assert.rejects(repo.criarSala("Geral", "", "ana"), (e: ChatError) => e.status === 409);
  assert.equal(slug("Projeto NoSQL — Ação!"), "projeto-nosql-acao");
  assert.equal(sqlText("geral"), "'geral'");
  assert.throws(() => sqlText("x' OR 1=1 --"), SpaceError);
});

test("erro claro quando o GigaSpaces está fora do ar", async () => {
  const off = new SpaceClient("http://127.0.0.1:1");
  await assert.rejects(off.count("Mensagem"), (e: SpaceError) => /Não foi possível conectar/.test(e.message));
  assert.equal(await off.ping("Mensagem"), false);
});

test("ler/remover id inexistente devolve null (o GigaSpaces real responde 200 com data = {})", async () => {
  assert.equal(await space.readById(TYPES.mensagem, "nao-existe"), null);
  assert.equal(await space.takeById(TYPES.mensagem, "nao-existe"), null);
  await assert.rejects(repo.editarMensagem("nao-existe", "ana", "x"), (e: ChatError) => e.status === 404);
});

test("setup limpa e recria: o resultado é sempre o mesmo", async () => {
  await repo.criarSala("Lixo de ensaio", "", "ana");
  await repo.enviarMensagem("lixo-de-ensaio", "ana", "sobra de um ensaio");
  const r1 = await recriarDados(space);
  assert.ok(r1.removidas.Mensagem > 0, "deveria ter removido as tuplas antigas");
  assert.deepEqual(await repo.contagens(), { usuarios: 3, salas: 2, mensagens: 5 });
  assert.equal(await space.readById(TYPES.sala, "lixo-de-ensaio"), null);
  await recriarDados(space);
  assert.deepEqual(await repo.contagens(), { usuarios: 3, salas: 2, mensagens: 5 });
});
