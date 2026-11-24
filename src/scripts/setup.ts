/**
 * npm run setup
 *
 * Prepara o Space para a demo:
 *   1. registra os tipos Usuario, Sala e Mensagem (introduce type);
 *   2. LIMPA o Space (take de todas as tuplas desses tipos);
 *   3. grava os dados de exemplo (write).
 * Pode ser executado quantas vezes quiser: o resultado é sempre o mesmo.
 */
import { config } from "../config.js";
import { SpaceClient } from "../gigaspaces/SpaceClient.js";
import { ChatRepository } from "../model/ChatRepository.js";
import { dadosIniciais, recriarDados } from "../model/seed.js";

const tty = Boolean(process.stdout.isTTY);
const pinta = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const cor = { b: pinta("1"), ok: pinta("32"), dim: pinta("2"), err: pinta("31") };

const space = new SpaceClient(config.gsRestUrl);
const repo = new ChatRepository(space);

console.log(cor.b("\nPreparando o Space para a demo"));
console.log(cor.dim(`GigaSpaces REST Service: ${config.gsRestUrl}\n`));

try {
  console.log(cor.b("1) Registrando os tipos no Space") + cor.dim("   (PUT /{Tipo}/_introduce_type)"));
  const tipos = await repo.registrarTipos();
  for (const [t, r] of Object.entries(tipos)) {
    console.log(`   ${cor.ok("✓")} ${t.padEnd(9)} ${r === "created" ? "registrado agora" : "já estava registrado"}`);
  }

  console.log("\n" + cor.b("2) Limpando o Space") + cor.dim("   (DELETE /{Tipo}?query=id IS NOT NULL  =  take de todas as tuplas)"));
  console.log(cor.b("3) Gravando os dados de exemplo") + cor.dim("   (POST /{Tipo}  =  write)"));
  const r = await recriarDados(space);
  for (const t of Object.keys(r.gravadas)) {
    console.log(`   ${cor.ok("✓")} ${t.padEnd(9)} removidas: ${String(r.removidas[t] ?? 0).padStart(3)}   gravadas: ${r.gravadas[t]}`);
  }

  const { salas, mensagens, usuarios } = dadosIniciais();
  console.log("\n" + cor.b("Estado do Space agora:"));
  console.log(`   Usuários: ${usuarios.map((u) => u.nome).join(", ")}`);
  for (const s of salas) {
    const n = mensagens.filter((m) => m.salaId === s.id).length;
    console.log(`   Sala #${s.nome.padEnd(14)} ${n} mensagem(ns)`);
  }
  const c = await repo.contagens();
  console.log(cor.dim(`   Conferido no Space (count): Usuario ${c.usuarios} · Sala ${c.salas} · Mensagem ${c.mensagens}`));

  console.log("\n" + cor.ok(cor.b("Pronto!")) + " Próximo passo:");
  console.log("   npm start      → chat em http://localhost:" + config.port);
  console.log("   npm run crud   → demo do CRUD no terminal\n");
} catch (e) {
  console.log("\n" + cor.err(cor.b("Não deu certo: ")) + (e as Error).message);
  console.log("\nO GigaSpaces está de pé? Rode primeiro:");
  console.log("   powershell -ExecutionPolicy Bypass -File gigaspaces\\subir-gigaspaces.ps1\n");
  process.exit(1);
}
