/**
 * Regras do chat em cima do Space. Cada método indica qual operação de
 * tuple space ele usa (write / read / take).
 */
import { randomUUID } from "node:crypto";
import { SpaceClient, SpaceError, sqlText } from "../gigaspaces/SpaceClient.js";
import { DESCRIPTORS, TYPES, type Mensagem, type Sala, type Usuario } from "./schema.js";

export class ChatError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export class ChatRepository {
  constructor(public readonly space: SpaceClient) {}

  /** Registra os tipos Usuario, Sala e Mensagem no Space. */
  async registrarTipos(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [type, desc] of Object.entries(DESCRIPTORS)) {
      out[type] = await this.space.introduceType(type, desc);
    }
    return out;
  }

  // =============================================================== Usuários

  /** write (upsert): entra no chat e fica online. */
  async entrar(nome: string): Promise<Usuario> {
    const limpo = nome.trim();
    if (!limpo) throw new ChatError("Informe um nome");
    if (limpo.length > 40) throw new ChatError("Nome muito longo (máx. 40)");
    const usuario: Usuario = { id: slug(limpo), nome: limpo, status: "online", ultimoAcesso: Date.now() };
    await this.space.write(TYPES.usuario, usuario);
    return usuario;
  }

  /** update (read + write): marca o usuário como offline. */
  async sair(usuarioId: string): Promise<Usuario | null> {
    return this.space.update<Usuario>(TYPES.usuario, usuarioId, { status: "offline", ultimoAcesso: Date.now() });
  }

  /** readMultiple */
  async listarUsuarios(): Promise<Usuario[]> {
    const lista = await this.space.readMultiple<Usuario>(TYPES.usuario);
    return lista.sort((a, b) => a.nome.localeCompare(b.nome));
  }

  // =============================================================== Salas

  /** write */
  async criarSala(nome: string, descricao: string, criadaPor: string): Promise<Sala> {
    const limpo = nome.trim();
    if (!limpo) throw new ChatError("Informe o nome da sala");
    const sala: Sala = { id: slug(limpo), nome: limpo, descricao: descricao.trim(), criadaPor, criadaEm: Date.now() };
    if (await this.space.readById<Sala>(TYPES.sala, sala.id)) throw new ChatError(`A sala "${sala.id}" já existe`, 409);
    await this.space.write(TYPES.sala, sala);
    return sala;
  }

  /** readMultiple */
  async listarSalas(): Promise<Sala[]> {
    const salas = await this.space.readMultiple<Sala>(TYPES.sala);
    return salas.sort((a, b) => a.criadaEm - b.criadaEm);
  }

  /** take da sala + takeMultiple das mensagens dela. */
  async apagarSala(salaId: string): Promise<{ sala: Sala | null; mensagensRemovidas: number }> {
    const sala = await this.space.takeById<Sala>(TYPES.sala, salaId);
    const msgs = await this.space.takeMultiple<Mensagem>(TYPES.mensagem, `salaId=${sqlText(salaId)}`);
    return { sala, mensagensRemovidas: msgs.length };
  }

  // =============================================================== Mensagens (CRUD principal)

  /** CREATE -> write */
  async enviarMensagem(salaId: string, autorId: string, texto: string): Promise<Mensagem> {
    const t = texto.trim();
    if (!t) throw new ChatError("Mensagem vazia");
    if (t.length > 2000) throw new ChatError("Mensagem muito longa (máx. 2000)");
    if (!(await this.space.readById<Sala>(TYPES.sala, salaId))) throw new ChatError(`Sala "${salaId}" não existe`, 404);
    const msg: Mensagem = {
      id: `msg-${Date.now()}-${randomUUID().slice(0, 8)}`,
      salaId,
      autorId,
      texto: t,
      enviadaEm: Date.now(),
      editada: false,
      editadaEm: 0,
    };
    await this.space.write(TYPES.mensagem, msg);
    return msg;
  }

  /** READ -> read por id */
  async lerMensagem(id: string): Promise<Mensagem | null> {
    return this.space.readById<Mensagem>(TYPES.mensagem, id);
  }

  /** READ -> readMultiple por consulta (histórico da sala) */
  async historico(salaId: string, max = 500): Promise<Mensagem[]> {
    const msgs = await this.space.readMultiple<Mensagem>(TYPES.mensagem, `salaId=${sqlText(salaId)}`, max);
    return msgs.sort((a, b) => a.enviadaEm - b.enviadaEm);
  }

  /** UPDATE -> read + write com o mesmo id. Só o autor pode editar. */
  async editarMensagem(id: string, autorId: string, novoTexto: string): Promise<Mensagem> {
    const t = novoTexto.trim();
    if (!t) throw new ChatError("Mensagem vazia");
    const atual = await this.lerMensagem(id);
    if (!atual) throw new ChatError("Mensagem não encontrada", 404);
    if (atual.autorId !== autorId) throw new ChatError("Só o autor pode editar a mensagem", 403);
    const nova: Mensagem = { ...atual, texto: t, editada: true, editadaEm: Date.now() };
    await this.space.write(TYPES.mensagem, nova);
    return nova;
  }

  /** DELETE -> take (lê e remove do Space). Só o autor pode apagar. */
  async apagarMensagem(id: string, autorId: string): Promise<Mensagem> {
    const atual = await this.lerMensagem(id);
    if (!atual) throw new ChatError("Mensagem não encontrada", 404);
    if (atual.autorId !== autorId) throw new ChatError("Só o autor pode apagar a mensagem", 403);
    const removida = await this.space.takeById<Mensagem>(TYPES.mensagem, id);
    if (!removida) throw new ChatError("Mensagem já tinha sido removida", 404);
    return removida;
  }

  async contagens(): Promise<Record<string, number>> {
    const [usuarios, salas, mensagens] = await Promise.all([
      this.space.count(TYPES.usuario),
      this.space.count(TYPES.sala),
      this.space.count(TYPES.mensagem),
    ]);
    return { usuarios, salas, mensagens };
  }
}

/** "Sala Geral!" -> "sala-geral" (usado como id: sem aspas, seguro para consultas). */
export function slug(s: string): string {
  const out = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!out) throw new ChatError("Nome inválido");
  return out;
}

export { SpaceError };
