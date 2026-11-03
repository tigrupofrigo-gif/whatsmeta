/**
 * GET /api/v1/reports/atendimento — o que é DA ROTA: quem pode filtrar por
 * pessoa, a janela, e a org da sessão indo para a RPC. A régua dos números é
 * provada contra o banco em tests/invariants/relatorio-de-atendimento.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: () => false }));
vi.mock("@/lib/propostas/data-no-fuso", () => ({ fusoDaOrganizacao: async () => "America/Sao_Paulo" }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const EU = "11111111-1111-4111-8111-111111111111";
const OUTRA = "33333333-3333-4333-8333-333333333333";
const JANELA = "from=2026-10-01T03:00:00.000Z&to=2026-10-08T03:00:00.000Z";

function sessao(papel: "agent" | "manager") {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: EU, email: "eu@example.com", is_platform_admin: false, idioma: "pt-BR" } as AuthUser,
    org: { orgId: ORG_ID, name: "Org", role: papel },
  } as never);
}

function banco() {
  const rpcs: Array<Record<string, unknown>> = [];
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    order: () => Promise.resolve({ data: [], error: null }),
    then: (pronto: (v: unknown) => unknown) => pronto({ data: [], error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({
    rpc: (_nome: string, args: Record<string, unknown>) => {
      rpcs.push(args);
      return Promise.resolve({ data: { totais: {}, por_responsavel: [] }, error: null });
    },
    from: () => consulta,
  } as never);
  return rpcs;
}

async function chamar(qs: string): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new NextRequest(`http://localhost/api/v1/reports/atendimento?${qs}`));
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/reports/atendimento", () => {
  it("⭐ o atendente mede só as próprias conversas, mesmo pedindo outra pessoa", async () => {
    sessao("agent");
    const rpcs = banco();
    const res = await chamar(`${JANELA}&responsavel=${OUTRA}`);
    expect(res.status).toBe(200);
    expect(rpcs[0]).toMatchObject({ p_org: ORG_ID, p_responsavel: EU });
    expect((await res.json()).data.filtros.pode_ver_equipe).toBe(false);
  });

  it("quem gerencia filtra por qualquer pessoa, ou vê a equipe toda", async () => {
    sessao("manager");
    const rpcs = banco();
    await chamar(`${JANELA}&responsavel=${OUTRA}`);
    await chamar(JANELA);
    expect(rpcs[0]).toMatchObject({ p_responsavel: OUTRA });
    expect(rpcs[1]).toMatchObject({ p_responsavel: null });
  });

  it("a janela vai inteira para a RPC, com o fuso da empresa", async () => {
    sessao("manager");
    const rpcs = banco();
    await chamar(JANELA);
    expect(rpcs[0]).toMatchObject({
      p_from: "2026-10-01T03:00:00.000Z",
      p_to: "2026-10-08T03:00:00.000Z",
      p_fuso: "America/Sao_Paulo",
    });
  });

  it("início depois do fim, ou janela de mais de 400 dias, é 422", async () => {
    sessao("manager");
    banco();
    expect((await chamar("from=2026-10-08T00:00:00Z&to=2026-10-01T00:00:00Z")).status).toBe(422);
    expect((await chamar("from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z")).status).toBe(422);
  });

  it("sem papel, a recusa do requireRole volta como está", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    expect((await chamar(JANELA)).status).toBe(403);
  });
});
