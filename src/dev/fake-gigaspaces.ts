/**
 * npm run simulador
 *
 * SIMULADOR da API REST do GigaSpaces, em memória, para TESTES e ENSAIO.
 * Ele imita os endpoints do REST Service (introduce type, write, read,
 * readMultiple com consulta SQL simples, count, take, takeMultiple) e
 * responde no MESMO formato do GigaSpaces 16.1 real:
 *   - cada entrada vem embrulhada em { typeName, version, transient, properties };
 *   - ler/remover um id que não existe devolve 200 com data = {} (não 404);
 *   - DELETE sem ?query= não remove nada.
 *
 * ATENÇÃO: isto NÃO é o GigaSpaces. Na apresentação, use o GigaSpaces de verdade
 * (veja o README). O simulador existe para rodar os testes automatizados e para
 * vocês treinarem a demo num computador sem Docker.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

type Doc = Record<string, unknown>;

interface TypeInfo {
  idProperty: string;
  entries: Map<string, Doc>;
}

export function createFakeGigaSpaces(): http.Server {
  const types = new Map<string, TypeInfo>();

  const wrap = (typeName: string, d: Doc) => ({ typeName, version: 1, transient: false, properties: d });

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      return send(res, 400, { status: "error", message: "JSON inválido" });
    }

    const [typeName, sub] = parts;
    if (!typeName) return send(res, 200, { status: "success", data: "Fake GigaSpaces REST" });

    // PUT /{Type}/_introduce_type
    if (sub === "_introduce_type" && req.method === "PUT") {
      if (types.has(typeName)) return send(res, 500, { status: "error", message: `Type ${typeName} is already registered` });
      const idProp = (body as { idProperty?: { propertyName?: string } })?.idProperty?.propertyName;
      if (!idProp) return send(res, 400, { status: "error", message: "idProperty é obrigatório" });
      types.set(typeName, { idProperty: idProp, entries: new Map() });
      return send(res, 200, { status: "success" });
    }

    const t = types.get(typeName);
    if (!t) return send(res, 404, { status: "error", message: `Type ${typeName} not found` });

    try {
      // GET /{Type}/count
      if (sub === "count" && req.method === "GET") return send(res, 200, { status: "success", data: t.entries.size });

      // POST /{Type}  -> write / writeMultiple (UPDATE_OR_WRITE)
      if (!sub && req.method === "POST") {
        const docs = Array.isArray(body) ? body : [body];
        for (const d of docs as Doc[]) {
          const id = d?.[t.idProperty];
          if (id === undefined || id === null) throw new Error(`Entrada sem ${t.idProperty}`);
          t.entries.set(String(id), structuredClone(d));
        }
        return send(res, 200, { status: "success" });
      }

      // GET /{Type}/{id}  -> readById
      if (sub && req.method === "GET") {
        const d = t.entries.get(sub);
        return send(res, 200, { status: "success", data: d ? wrap(typeName, d) : {} });
      }

      // DELETE /{Type}/{id}  -> takeById
      if (sub && req.method === "DELETE") {
        const d = t.entries.get(sub);
        if (!d) return send(res, 200, { status: "success", data: {} });
        t.entries.delete(sub);
        return send(res, 200, { status: "success", data: wrap(typeName, d) });
      }

      // GET|DELETE /{Type}?query=..&max=..  -> readMultiple / takeMultiple
      if (!sub && (req.method === "GET" || req.method === "DELETE")) {
        const q = url.searchParams.get("query");
        if (req.method === "DELETE" && !q) { res.writeHead(200); return res.end(); } // igual ao real: não faz nada
        const max = Number(url.searchParams.get("max") ?? Number.MAX_SAFE_INTEGER);
        const pred = q ? compile(q) : () => true;
        const found = [...t.entries.entries()].filter(([, d]) => pred(d)).slice(0, max);
        if (req.method === "DELETE") for (const [id] of found) t.entries.delete(id);
        return send(res, 200, { status: "success", data: found.map(([, d]) => wrap(typeName, d)) });
      }

      send(res, 405, { status: "error", message: "método não suportado" });
    } catch (e) {
      send(res, 500, { status: "error", message: (e as Error).message });
    }
  });
}

// ------------------------------------------------------------------ mini parser SQL
// Suporta: campo op valor, com AND / OR / parênteses. op: = <> != > >= < <= like
// e também: campo IS NULL / campo IS NOT NULL
type Pred = (d: Doc) => boolean;

function compile(query: string): Pred {
  const tokens = query.match(/'(?:[^']|'')*'|<>|!=|>=|<=|[=<>()]|[^\s=<>!()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  const value = (tok: string): unknown => {
    if (tok.startsWith("'")) return tok.slice(1, -1).replace(/''/g, "'");
    if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
    if (/^(true|false)$/i.test(tok)) return tok.toLowerCase() === "true";
    throw new Error(`Valor inválido na consulta: ${tok}`);
  };

  const cmp = (): Pred => {
    if (peek() === "(") {
      next();
      const p = or();
      if (next() !== ")") throw new Error("Parêntese não fechado");
      return p;
    }
    const field = next();
    if (peek()?.toLowerCase() === "is") {
      next();
      const not = peek()?.toLowerCase() === "not";
      if (not) next();
      if (next()?.toLowerCase() !== "null") throw new Error(`Consulta inválida: ${query}`);
      return (d) => (d[field!] === undefined || d[field!] === null) !== not;
    }
    const op = next()?.toLowerCase();
    const raw = next();
    if (!field || !op || raw === undefined) throw new Error(`Consulta inválida: ${query}`);
    const v = value(raw);
    return (d) => {
      let a = d[field];
      if (typeof v === "number" && typeof a === "string") a = Number(a);
      if (typeof v === "string" && typeof a === "number") a = String(a);
      switch (op) {
        case "=": return a === v;
        case "<>": case "!=": return a !== v;
        case ">": return (a as number) > (v as number);
        case ">=": return (a as number) >= (v as number);
        case "<": return (a as number) < (v as number);
        case "<=": return (a as number) <= (v as number);
        case "like": {
          const re = new RegExp("^" + String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$");
          return re.test(String(a));
        }
        default: throw new Error(`Operador não suportado: ${op}`);
      }
    };
  };
  const and = (): Pred => {
    let p = cmp();
    while (peek()?.toLowerCase() === "and") { next(); const l = p, r = cmp(); p = (d) => l(d) && r(d); }
    return p;
  };
  const or = (): Pred => {
    let p = and();
    while (peek()?.toLowerCase() === "or") { next(); const l = p, r = and(); p = (d) => l(d) || r(d); }
    return p;
  };

  const p = or();
  if (i < tokens.length) throw new Error(`Sobrou texto na consulta: ${tokens.slice(i).join(" ")}`);
  return p;
}

// Executado diretamente: sobe o simulador.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FAKE_PORT ?? 8081);
  createFakeGigaSpaces().listen(port, () => {
    console.log(`SIMULADOR da API REST do GigaSpaces em http://localhost:${port}`);
    console.log("(apenas para testes/ensaio — na apresentação use o GigaSpaces real)");
  });
}
