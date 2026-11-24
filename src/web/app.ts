// Interface do SpaceChat (compilada para public/js/app.js com `npm run build:web`).

interface Usuario { id: string; nome: string; status: "online" | "offline"; ultimoAcesso: number }
interface Sala { id: string; nome: string; descricao: string; criadaPor: string; criadaEm: number }
interface Mensagem { id: string; salaId: string; autorId: string; texto: string; enviadaEm: number; editada: boolean; editadaEm: number }
type Crud = "C" | "R" | "U" | "D";
interface OpResumo { op: string; http: string; ok: boolean; ms: number; total?: number; amostra?: unknown; erro?: string }
interface Acao { seq: number; at: number; ms: number; crud: Crud; titulo: string; explicacao: string; polling: boolean; ok: boolean; erro?: string; ops: OpResumo[] }
interface Status { gigaspaces: string; conectado: boolean; contagens: Record<string, number> | null }

const NOME_CRUD: Record<Crud, string> = { C: "CREATE", R: "READ", U: "UPDATE", D: "DELETE" };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

let eu: Usuario | null = null;
let salaAtual = "geral";
let salas: Sala[] = [];
let usuarios: Usuario[] = [];
let ultimaAssinatura = "";
let idsVistos = new Set<string>();
let editando: string | null = null;
let ultimaAcao = 0;
const acoes: Acao[] = [];
const acoesNovas = new Set<number>();
const detalhesAbertos = new Set<number>();
let contagensAntes: Record<string, number> | null = null;

// ------------------------------------------------------------------ utilidades
async function api<T>(method: string, url: string, body?: unknown, polling = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (polling) headers["X-Polling"] = "1";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { erro?: string }).erro ?? res.statusText);
  return json as T;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function hora(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function nomeDe(id: string): string {
  return usuarios.find((u) => u.id === id)?.nome ?? id;
}

function aviso(titulo: string, texto = "", tipo: "info" | "erro" = "erro"): void {
  const el = document.createElement("div");
  el.className = `toast ${tipo}`;
  el.innerHTML = `<b>${esc(titulo)}</b>${esc(texto)}`;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 6000);
}

function falhou(acao: string, err: unknown): void {
  aviso(`Não foi possível ${acao}`, (err as Error).message);
}

function confirmar(titulo: string, texto: string, rotuloSim: string): Promise<boolean> {
  const dlg = $<HTMLDialogElement>("#dlg-confirmar");
  $("#confirmar-titulo").textContent = titulo;
  $("#confirmar-texto").innerHTML = texto;
  $("#confirmar-sim").textContent = rotuloSim;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((ok) => dlg.addEventListener("close", () => ok(dlg.returnValue === "sim"), { once: true }));
}

// ------------------------------------------------------------------ tema e ajuda
function aplicarTema(t: string): void {
  document.documentElement.dataset.theme = t;
  $("#btn-tema").textContent = t === "dark" ? "☀️" : "🌙";
}
aplicarTema(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
$("#btn-tema").addEventListener("click", () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  aplicarTema(t);
  try { localStorage.setItem("spacechat-tema", t); } catch { /* sem armazenamento: tudo bem */ }
});
$("#btn-ajuda").addEventListener("click", () => $<HTMLDialogElement>("#dlg-ajuda").showModal());

// ------------------------------------------------------------------ entrada / saída
async function entrar(nome: string): Promise<void> {
  eu = await api<Usuario>("POST", "/api/usuarios", { nome });
  try { sessionStorage.setItem("spacechat-nome", eu.nome); } catch { /* ok */ }
  iniciar();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await entrar($<HTMLInputElement>("#login-nome").value);
  } catch (err) {
    $("#login-erro").textContent = (err as Error).message;
  }
});

$("#sair").addEventListener("click", async () => {
  if (eu) await api("POST", `/api/usuarios/${encodeURIComponent(eu.id)}/sair`).catch(() => undefined);
  try { sessionStorage.removeItem("spacechat-nome"); } catch { /* ok */ }
  location.reload();
});

window.addEventListener("beforeunload", () => {
  if (eu) navigator.sendBeacon(`/api/usuarios/${encodeURIComponent(eu.id)}/sair`);
});

// ------------------------------------------------------------------ salas
async function carregarSalas(polling = true): Promise<void> {
  salas = await api<Sala[]>("GET", "/api/salas", undefined, polling);
  if (!salas.some((s) => s.id === salaAtual) && salas.length) {
    salaAtual = salas[0].id;
    ultimaAssinatura = "";
  }
  $("#salas").innerHTML = salas.length
    ? salas.map((s) => `<li data-id="${esc(s.id)}" class="${s.id === salaAtual ? "ativa" : ""}" title="Abrir a sala (consulta salaId='${esc(s.id)}')"># ${esc(s.nome)}</li>`).join("")
    : `<li class="muted">Nenhuma sala. Crie uma abaixo.</li>`;
  const sala = salas.find((s) => s.id === salaAtual);
  $("#sala-titulo").textContent = sala ? `# ${sala.nome}` : "Nenhuma sala";
  $("#sala-desc").textContent = sala ? sala.descricao || `Criada por ${nomeDe(sala.criadaPor)}` : "Crie uma sala na coluna da esquerda.";
  $<HTMLButtonElement>("#apagar-sala").disabled = !sala;
}

function abrirSala(id: string): void {
  salaAtual = id;
  ultimaAssinatura = "";
  idsVistos = new Set();
  editando = null;
  void carregarSalas().then(() => carregarMensagens(false));
}

$("#salas").addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest("li");
  if (li?.dataset.id) abrirSala(li.dataset.id);
});

$("#nova-sala").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("#nova-sala-nome");
  try {
    const sala = await api<Sala>("POST", "/api/salas", { nome: input.value, descricao: `Criada por ${eu?.nome}`, criadaPor: eu?.id });
    input.value = "";
    abrirSala(sala.id);
  } catch (err) {
    falhou("criar a sala", err);
  }
});

$("#apagar-sala").addEventListener("click", async () => {
  const ok = await confirmar(
    `Apagar a sala #${salaAtual}?`,
    `A tupla <b>Sala</b> sai do Space (<b>take</b>) e <b>todas as mensagens</b> dela também (<b>takeMultiple</b> com <code>salaId='${esc(salaAtual)}'</code>).<br><br>Para recuperar os dados de exemplo depois, rode <code>npm run setup</code>.`,
    "Apagar sala (take)",
  );
  if (!ok) return;
  try {
    await api("DELETE", `/api/salas/${encodeURIComponent(salaAtual)}`);
    ultimaAssinatura = "";
    await carregarSalas();
    await carregarMensagens(false);
  } catch (err) {
    falhou("apagar a sala", err);
  }
});

// ------------------------------------------------------------------ usuários
async function carregarUsuarios(): Promise<void> {
  usuarios = await api<Usuario[]>("GET", "/api/usuarios", undefined, true);
  $("#usuarios").innerHTML = usuarios
    .map((u) => {
      const on = u.status === "online";
      return `<li><span class="dot ${on ? "online" : ""}"></span>${esc(u.nome)}${u.id === eu?.id ? " <span class='muted'>(você)</span>" : ""}<span class="estado">${on ? "online" : "offline"}</span></li>`;
    })
    .join("");
}

// ------------------------------------------------------------------ mensagens
async function carregarMensagens(polling = true): Promise<void> {
  const lista = $("#mensagens");
  if (!salas.length) {
    lista.innerHTML = `<li class="vazio">Nenhuma sala ainda. Crie uma na coluna da esquerda,<br>ou rode <code>npm run setup</code> para carregar os dados de exemplo.</li>`;
    ultimaAssinatura = "";
    return;
  }
  const msgs = await api<Mensagem[]>("GET", `/api/salas/${encodeURIComponent(salaAtual)}/mensagens`, undefined, polling);
  const assinatura = `${salaAtual}|` + msgs.map((m) => `${m.id}:${m.editadaEm}`).join("|");
  if (assinatura === ultimaAssinatura || editando) return; // nada mudou (ou está editando)
  ultimaAssinatura = assinatura;

  const noFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;
  if (!msgs.length) {
    lista.innerHTML = `<li class="vazio">Nenhuma mensagem nesta sala.<br>Escreva a primeira lá embaixo: ela vira uma tupla <b>Mensagem</b> no Space.</li>`;
  } else {
    lista.innerHTML = msgs
      .map((m) => {
        const minha = m.autorId === eu?.id;
        const nova = idsVistos.size > 0 && !idsVistos.has(m.id);
        return `<li class="msg ${minha ? "minha" : ""} ${nova ? "nova" : ""}" data-id="${esc(m.id)}">
          <div class="msg-topo"><b>${esc(nomeDe(m.autorId))}</b><time>${hora(m.enviadaEm)}</time>${m.editada ? `<span class="editada">editada às ${hora(m.editadaEm)}</span>` : ""}</div>
          <div class="texto">${esc(m.texto)}</div>
          <div class="msg-acoes">
            <button data-acao="ver" title="Lê esta tupla no Space pelo id (read)"><span class="crud R">R</span> Ver tupla</button>
            ${minha ? `<button data-acao="editar" title="Grava de novo com o mesmo id (write)"><span class="crud U">U</span> Editar</button>
            <button data-acao="apagar" title="Retira a tupla do Space (take)"><span class="crud D">D</span> Apagar</button>` : ""}
          </div>
        </li>`;
      })
      .join("");
  }
  idsVistos = new Set(msgs.map((m) => m.id));
  if (noFim || !polling) lista.scrollTop = lista.scrollHeight;
}

$("#enviar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("#texto");
  const texto = input.value.trim();
  if (!texto || !eu) return;
  input.value = "";
  try {
    await api("POST", `/api/salas/${encodeURIComponent(salaAtual)}/mensagens`, { autorId: eu.id, texto });
    await carregarMensagens();
    const lista = $("#mensagens");
    lista.scrollTop = lista.scrollHeight;
  } catch (err) {
    input.value = texto;
    falhou("enviar a mensagem", err);
  }
});

const NOTAS_CAMPOS: Record<string, string> = {
  id: "chave da tupla (identifica a entrada no Space)",
  salaId: "routing property: decide em qual partição a tupla fica",
  autorId: "id da tupla Usuario de quem escreveu",
  texto: "conteúdo da mensagem",
  enviadaEm: "momento do envio (milissegundos desde 1970)",
  editada: "vira true quando a mensagem é editada (update)",
  editadaEm: "momento da última edição (0 = nunca)",
};

async function verTupla(id: string): Promise<void> {
  try {
    const m = await api<Mensagem>("GET", `/api/mensagens/${encodeURIComponent(id)}`);
    const linhas = Object.keys(NOTAS_CAMPOS)
      .map((campo) => {
        const v = (m as unknown as Record<string, unknown>)[campo];
        let valor = typeof v === "string" ? `"${esc(v)}"` : esc(v);
        if ((campo === "enviadaEm" || campo === "editadaEm") && typeof v === "number" && v > 0) valor += ` <span class="muted">(${hora(v)})</span>`;
        return `<tr><td>${campo}</td><td>${valor}<small>${NOTAS_CAMPOS[campo]}</small></td></tr>`;
      })
      .join("");
    $("#tupla-corpo").innerHTML = `
      <p>Esta é a tupla <b>Mensagem</b> exatamente como está no Space agora. Ela foi lida com <b>read</b> (<code>GET /Mensagem/${esc(m.id)}</code>), que devolve uma cópia: a tupla continua lá.</p>
      <table class="campos">${linhas}</table>`;
    $<HTMLDialogElement>("#dlg-tupla").showModal();
  } catch (err) {
    falhou("ler a tupla", err);
  }
}

$("#mensagens").addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  const li = (e.target as HTMLElement).closest("li.msg") as HTMLElement | null;
  if (!btn || !li || !eu) return;
  const id = li.dataset.id!;
  const acao = btn.dataset.acao;

  if (acao === "ver") return verTupla(id);

  if (acao === "apagar") {
    const ok = await confirmar(
      "Apagar esta mensagem?",
      "Isto faz um <b>take</b> no Space: a tupla é lida <i>e</i> removida numa operação só. Depois disso ela não aparece mais para ninguém.",
      "Apagar (take)",
    );
    if (!ok) return;
    try {
      await api("DELETE", `/api/mensagens/${encodeURIComponent(id)}?autorId=${encodeURIComponent(eu.id)}`);
    } catch (err) {
      falhou("apagar a mensagem", err);
    }
    ultimaAssinatura = "";
    return carregarMensagens();
  }

  if (acao === "editar") {
    editando = id;
    const div = li.querySelector(".texto") as HTMLElement;
    const atual = div.textContent ?? "";
    div.outerHTML = `<form class="edicao"><input value="${esc(atual)}" maxlength="2000" aria-label="Novo texto" />
      <button class="primario"><span class="crud U">U</span> Salvar</button><button type="button" class="sec" data-cancelar>Cancelar</button></form>`;
    li.querySelector(".msg-acoes")?.setAttribute("hidden", "");
    const form = li.querySelector("form.edicao") as HTMLFormElement;
    const input = form.querySelector("input")!;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    const cancelar = () => { editando = null; ultimaAssinatura = ""; void carregarMensagens(); };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Escape") cancelar(); });
    form.querySelector("[data-cancelar]")!.addEventListener("click", cancelar);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await api("PATCH", `/api/mensagens/${encodeURIComponent(id)}`, { autorId: eu!.id, texto: input.value });
      } catch (err) {
        falhou("editar a mensagem", err);
      }
      cancelar();
    });
  }
});

// ------------------------------------------------------------------ painel "o que aconteceu no banco"
async function carregarAcoes(): Promise<void> {
  const novas = await api<Acao[]>("GET", `/api/acoes?desde=${ultimaAcao}`);
  if (!novas.length) return;
  ultimaAcao = novas[novas.length - 1].seq;
  for (const a of novas) acoesNovas.add(a.seq);
  acoes.push(...novas);
  if (acoes.length > 200) acoes.splice(0, acoes.length - 200);
  renderAcoes();
}

function dadosDaAcao(a: Acao): { titulo: string; json: string } | null {
  const preferidas: Record<Crud, string[]> = {
    C: ["write"], U: ["write"], D: ["take", "takeMultiple"], R: ["read", "readMultiple"],
  };
  const op = [...a.ops].reverse().find((o) => preferidas[a.crud].includes(o.op) && o.amostra !== undefined);
  if (!op) return null;
  const v = op.amostra;
  if (v === null || (typeof v === "object" && Object.keys(v as object).length === 0)) return null;
  const titulos: Record<Crud, string> = {
    C: "ver a tupla gravada", U: "ver a tupla gravada (versão nova)", D: "ver o que o take removeu", R: "ver o que o Space devolveu",
  };
  let titulo = titulos[a.crud];
  if (Array.isArray(v) && op.total !== undefined && op.total > v.length) titulo += ` (${v.length} de ${op.total})`;
  return { titulo, json: JSON.stringify(v, null, 2) };
}

function renderAcoes(): void {
  const mostrarPolling = $<HTMLInputElement>("#mostrar-polling").checked;
  const visiveis = acoes.filter((a) => mostrarPolling || !a.polling).slice(-60).reverse();
  const ol = $("#acoes");
  if (!visiveis.length) {
    ol.innerHTML = `<li class="vazio">Faça alguma coisa no chat (abrir uma sala, enviar uma mensagem…) e as operações aparecem aqui.</li>`;
    return;
  }
  ol.innerHTML = visiveis
    .map((a) => {
      const dados = a.polling ? null : dadosDaAcao(a);
      const ops = a.ops
        .map((o) => {
          const total = o.total !== undefined && o.op !== "write" ? ` → ${o.total}` : "";
          return `<li><span class="op ${o.ok ? o.op : "falhou"}">${esc(o.op)}</span><code>${esc(o.http)}${total}</code><span class="ms">${o.ms} ms</span></li>`;
        })
        .join("");
      const nova = acoesNovas.has(a.seq) && !a.polling ? "nova" : "";
      return `<li class="acao ${a.crud} ${a.ok ? "" : "falha"} ${a.polling ? "polling" : ""} ${nova}" data-seq="${a.seq}">
        <div class="acao-topo"><span class="crud ${a.crud}">${a.crud}</span><span class="titulo">${esc(a.titulo)}${a.polling ? " <span class='muted'>(automática)</span>" : ""}</span><span class="nome-crud">${NOME_CRUD[a.crud]}</span><time>${hora(a.at)}</time></div>
        ${a.polling ? "" : `<p class="acao-exp">${esc(a.explicacao)}</p>`}
        ${ops ? `<ol class="acao-ops">${ops}</ol>` : ""}
        ${a.ok ? "" : `<p class="acao-erro">✗ ${esc(a.erro ?? "falhou")}</p>`}
        ${dados ? `<details ${detalhesAbertos.has(a.seq) ? "open" : ""}><summary>${esc(dados.titulo)}</summary><pre>${esc(dados.json)}</pre></details>` : ""}
      </li>`;
    })
    .join("");
  acoesNovas.clear();
}

$("#mostrar-polling").addEventListener("change", renderAcoes);
$("#acoes").addEventListener("toggle", (e) => {
  const d = e.target as HTMLDetailsElement;
  const seq = Number(d.closest<HTMLElement>("li.acao")?.dataset.seq);
  if (d.open) detalhesAbertos.add(seq); else detalhesAbertos.delete(seq);
}, true);

// ------------------------------------------------------------------ conexão e contadores
async function carregarStatus(): Promise<void> {
  const pill = $("#conexao");
  const caixa = $("#aviso");
  try {
    const s = await api<Status>("GET", "/api/status", undefined, true);
    pill.textContent = s.conectado ? "Conectado ao GigaSpaces" : "Sem conexão com o GigaSpaces";
    pill.className = `status ${s.conectado ? "ok" : "off"}`;
    caixa.hidden = s.conectado;
    if (!s.conectado) {
      caixa.innerHTML = `<b>Sem conexão com o GigaSpaces</b> em <code>${esc(s.gigaspaces)}</code>. Para resolver, rode no terminal:
        <code>powershell -ExecutionPolicy Bypass -File gigaspaces\\subir-gigaspaces.ps1</code> e depois <code>npm run setup</code>.`;
    }
    if (s.contagens) {
      for (const el of document.querySelectorAll<HTMLElement>("#contagens [data-tipo]")) {
        const tipo = el.dataset.tipo!;
        const v = s.contagens[tipo];
        const antes = contagensAntes?.[tipo];
        el.textContent = String(v);
        const stat = el.parentElement!;
        if (antes !== undefined && v !== antes) {
          stat.classList.remove("subiu", "desceu");
          stat.classList.add(v > antes ? "subiu" : "desceu");
          setTimeout(() => stat.classList.remove("subiu", "desceu"), 1500);
        }
      }
      contagensAntes = s.contagens;
    }
  } catch {
    pill.textContent = "Servidor do chat fora do ar";
    pill.className = "status off";
    caixa.hidden = false;
    caixa.innerHTML = `<b>O servidor do chat não está respondendo.</b> Confira se o <code>npm start</code> está rodando no terminal.`;
  }
}

// ------------------------------------------------------------------ ciclo
function repetir(fn: () => Promise<void>, ms: number): void {
  const tick = async () => {
    try { await fn(); } catch { /* tenta de novo no próximo ciclo */ }
    setTimeout(tick, ms);
  };
  void tick();
}

function iniciar(): void {
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#eu").textContent = eu!.nome;
  void carregarUsuarios()
    .then(() => carregarSalas())
    .then(() => carregarMensagens(false))
    .catch(() => undefined)
    .finally(() => {
      repetir(carregarUsuarios, 3000);
      repetir(() => carregarSalas(), 3000);
      repetir(() => carregarMensagens(), 1000); // "tempo real" por polling no Space
    });
  repetir(carregarAcoes, 1000);
  repetir(carregarStatus, 3000);
  $<HTMLInputElement>("#texto").focus();
}

// Reentra automaticamente se esta aba já tinha um nome.
let salvo: string | null = null;
try { salvo = sessionStorage.getItem("spacechat-nome"); } catch { /* ok */ }
if (salvo) entrar(salvo).catch(() => undefined);
