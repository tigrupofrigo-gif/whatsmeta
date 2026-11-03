/**
 * WhatsMeta: a interface é servida SÓ em português (pt-BR).
 *
 * O setup da suíte (`tests/setup/vitest.setup.ts`) mostra todos os idiomas ao
 * resto dos testes, para o mecanismo seguir provado. Este arquivo desliga esse
 * mock e lê o registro REAL — é aqui que a regra do produto é vigiada.
 */
import { describe, expect, it, vi } from "vitest";

vi.unmock("@/lib/i18n/registro");

const { IDIOMAS_DO_PRODUTO, IDIOMAS_VISIVEIS, REGISTRO_DE_IDIOMAS } = await import("@/lib/i18n/registro");
const { IDIOMA_PADRAO, IDIOMAS, normalizarIdioma, parseAcceptLanguage } = await import("@/lib/i18n/idiomas");

describe("o produto fala só português", () => {
  it("o único idioma oferecido é pt-BR", () => {
    expect(IDIOMAS_DO_PRODUTO).toEqual(["pt-BR"]);
    expect(IDIOMAS_VISIVEIS.map((idioma) => idioma.codigo)).toEqual(["pt-BR"]);
    expect(IDIOMAS).toEqual(["pt-BR"]);
    expect(IDIOMA_PADRAO).toBe("pt-BR");
  });

  it("os outros catálogos continuam registrados (dá para reativar)", () => {
    expect(REGISTRO_DE_IDIOMAS.map((idioma) => idioma.codigo)).toContain("es");
  });

  it("quem tinha espanhol salvo no perfil ou na empresa vê português", () => {
    expect(normalizarIdioma("es")).toBe("pt-BR");
    expect(normalizarIdioma("tr")).toBe("pt-BR");
    expect(normalizarIdioma(null)).toBe("pt-BR");
  });

  it("navegador em espanhol não leva ao espanhol", () => {
    expect(normalizarIdioma(parseAcceptLanguage("es-ES,es;q=0.9,en;q=0.8"))).toBe("pt-BR");
  });
});
