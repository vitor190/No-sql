/**
 * Dados iniciais do chat. Usado pelo `npm run setup` e pelos testes.
 *
 * recriarDados() deixa o Space sempre no MESMO estado, não importa o que
 * aconteceu antes (ensaios, testes pela interface, salas apagadas...):
 *   1. take de todas as tuplas Usuario, Sala e Mensagem (limpa);
 *   2. write dos dados de exemplo (recria).
 */
import type { SpaceClient } from "../gigaspaces/SpaceClient.js";
import { TYPES, type Mensagem, type Sala, type Usuario } from "./schema.js";

export function dadosIniciais(agora = Date.now()): { usuarios: Usuario[]; salas: Sala[]; mensagens: Mensagem[] } {
  const usuarios: Usuario[] = [
    { id: "ana", nome: "Ana", status: "offline", ultimoAcesso: agora },
    { id: "bruno", nome: "Bruno", status: "offline", ultimoAcesso: agora },
    { id: "carla", nome: "Carla", status: "offline", ultimoAcesso: agora },
  ];
  const salas: Sala[] = [
    { id: "geral", nome: "geral", descricao: "Conversa geral da turma", criadaPor: "ana", criadaEm: agora - 3000 },
    { id: "projeto-nosql", nome: "projeto-nosql", descricao: "Organização da apresentação de NoSQL", criadaPor: "bruno", criadaEm: agora - 2000 },
  ];
  const msg = (n: number, salaId: string, autorId: string, texto: string): Mensagem => ({
    id: `seed-${salaId}-${n}`, salaId, autorId, texto, enviadaEm: agora - (100 - n) * 1000, editada: false, editadaEm: 0,
  });
  const mensagens: Mensagem[] = [
    msg(1, "geral", "ana", "Bem-vindos ao chat feito sobre o GigaSpaces!"),
    msg(2, "geral", "bruno", "Cada mensagem aqui é uma tupla guardada no Space."),
    msg(3, "geral", "carla", "E apagar uma mensagem é uma operação take 😄"),
    msg(4, "projeto-nosql", "bruno", "Quem fica com os slides de vantagens e desvantagens?"),
    msg(5, "projeto-nosql", "ana", "Eu faço a demo do CRUD ao vivo."),
  ];
  return { usuarios, salas, mensagens };
}

export interface ResultadoSeed {
  removidas: Record<string, number>;
  gravadas: Record<string, number>;
}

/** Limpa o Space (take de tudo) e grava os dados de exemplo (write). */
export async function recriarDados(space: SpaceClient): Promise<ResultadoSeed> {
  const removidas: Record<string, number> = {};
  for (const t of [TYPES.mensagem, TYPES.sala, TYPES.usuario]) removidas[t] = await space.takeAll(t);

  const { usuarios, salas, mensagens } = dadosIniciais();
  await space.write(TYPES.usuario, usuarios);
  await space.write(TYPES.sala, salas);
  await space.write(TYPES.mensagem, mensagens);
  return {
    removidas,
    gravadas: { [TYPES.usuario]: usuarios.length, [TYPES.sala]: salas.length, [TYPES.mensagem]: mensagens.length },
  };
}
