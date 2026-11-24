/**
 * Configuração lida de variáveis de ambiente.
 *
 *  GS_REST_URL  -> endereço do REST Service do GigaSpaces (PU "chat-rest").
 *                  Padrão: http://localhost:8081
 *  PORT         -> porta do servidor web do chat. Padrão: 3000
 */
export const config = {
  gsRestUrl: (process.env.GS_REST_URL ?? "http://localhost:8081").replace(/\/+$/, ""),
  port: Number(process.env.PORT ?? 3000),
};
