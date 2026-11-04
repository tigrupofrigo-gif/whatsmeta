import { describe, expect, it } from "vitest";

import { duracao, janelaDoPeriodo, linhasParaCsv } from "./relatorio-util";

// 15/10/2026, 14:30 no relógio local de quem roda o teste.
const AGORA = new Date(2026, 9, 15, 14, 30);
const local = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${d.getHours()}h`;
};

describe("janelaDoPeriodo", () => {
  it.each([
    ["hoje", "2026-10-15 0h", "2026-10-16 0h"],
    ["ontem", "2026-10-14 0h", "2026-10-15 0h"],
    ["7d", "2026-10-09 0h", "2026-10-16 0h"],
    ["30d", "2026-09-16 0h", "2026-10-16 0h"],
    ["mes", "2026-10-01 0h", "2026-10-16 0h"],
    ["mes-passado", "2026-09-01 0h", "2026-10-01 0h"],
  ] as const)("%s", (chave, de, ate) => {
    const j = janelaDoPeriodo(chave, AGORA)!;
    expect([local(j.from), local(j.to)]).toEqual([de, ate]);
  });

  it("personalizado: o dia final entra inteiro", () => {
    const j = janelaDoPeriodo("personalizado", AGORA, "2026-09-01", "2026-09-30")!;
    expect([local(j.from), local(j.to)]).toEqual(["2026-09-01 0h", "2026-10-01 0h"]);
  });

  it("personalizado sem datas ou com o fim antes do início não consulta", () => {
    expect(janelaDoPeriodo("personalizado", AGORA, "", "2026-09-30")).toBeNull();
    expect(janelaDoPeriodo("personalizado", AGORA, "2026-09-30", "2026-09-01")).toBeNull();
  });
});

describe("duracao", () => {
  it.each([
    [null, "—"],
    [45, "45 s"],
    [260, "4 min 20 s"],
    [3900, "1 h 05 min"],
    [183600, "2 d 3 h"],
  ] as const)("%s → %s", (s, texto) => {
    expect(duracao(s)).toBe(texto);
  });
});

describe("linhasParaCsv", () => {
  it("separa por ponto e vírgula, escapa aspas e neutraliza fórmula", () => {
    expect(linhasParaCsv(["Nome", "Valor"], [['Ana "A"', 3], ["=1+1", -5]])).toBe(
      'Nome;Valor\r\n"Ana ""A""";3\r\n\'=1+1;-5\r\n',
    );
  });
});
