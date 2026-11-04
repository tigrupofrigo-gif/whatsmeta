import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { fatiarCsv, registrosDoCsv, textoDoArquivo } from "./fatiar-csv";

/**
 * A propriedade que sustenta a importação sem limite: o que a rota lê de cada
 * lote, somado, é exatamente o que ela leria do arquivo inteiro — mesmas linhas,
 * mesmos campos, mesma ordem. Medida contra o `parseCsv` da PRÓPRIA rota.
 */
function linhasPelosLotes(csv: string, porLote: number): string[][] {
  const r = fatiarCsv(csv, porLote);
  if (!r) return [];
  return r.lotes.flatMap((lote) => {
    const linhas = parseCsv(lote);
    expect(linhas[0]).toEqual(parseCsv(csv)[0]); // todo lote começa pelo cabeçalho
    return linhas.slice(1);
  });
}

const CASOS: Array<[string, string]> = [
  ["vírgula simples", "nome,telefone\nAna,11999990001\nBia,11999990002\nCaio,11999990003\n"],
  ["ponto e vírgula do Excel pt-BR e CRLF", "nome;telefone;email\r\nAna;11999990001;a@x.com\r\nBia;11999990002;b@x.com\r\n"],
  ["campo com vírgula e quebra de linha entre aspas", 'nome,obs\n"Silva, Maria","linha 1\nlinha 2"\nJoão,"diz ""oi"""\nZé,\n'],
  ["linhas em branco no meio e no fim", "nome,telefone\n\nAna,1\n\n\nBia,2\n\n"],
  ["sem quebra no final", "nome,telefone\nAna,1\nBia,2"],
  ["BOM e tabulação", "﻿nome\ttelefone\nAna\t1\nBia\t2\n"],
  ["aspas no meio do campo não abrem aspas", 'nome,obs\nAna,ab"c\nBia,ok\n'],
];

describe("fatiarCsv — os lotes somados são o arquivo inteiro", () => {
  for (const [nome, csv] of CASOS) {
    for (const porLote of [1, 2, 500]) {
      it(`${nome} (lotes de ${porLote})`, () => {
        expect(linhasPelosLotes(csv, porLote)).toEqual(parseCsv(csv).slice(1));
      });
    }
  }

  it("⭐ 1.234 linhas viram 3 lotes de até 500, e a contagem bate", () => {
    const linhas = Array.from({ length: 1234 }, (_, i) => `Pessoa ${i},1199${String(i).padStart(7, "0")}`);
    const csv = ["nome,telefone", ...linhas].join("\n");
    const r = fatiarCsv(csv, 500)!;
    expect(r.totalDeLinhas).toBe(1234);
    expect(r.lotes).toHaveLength(3);
    expect(r.lotes.map((l) => parseCsv(l).length - 1)).toEqual([500, 500, 234]);
    expect(linhasPelosLotes(csv, 500)).toEqual(parseCsv(csv).slice(1));
  });

  it("a linha do erro no lote N é (linha no lote) + N × tamanho do lote", () => {
    // A rota numera como posição + 2. O 3º registro do 2º lote (lotes de 2) é o 5º do arquivo → linha 6.
    const csv = "nome\nA\nB\nC\nD\nE\n";
    const r = fatiarCsv(csv, 2)!;
    const posicaoNoLote = 0; // primeiro registro do 3º lote
    expect(parseCsv(r.lotes[2]!)[1 + posicaoNoLote]).toEqual(parseCsv(csv)[1 + 2 * 2 + posicaoNoLote]);
  });

  it("só cabeçalho, ou vazio, não vira lote", () => {
    expect(fatiarCsv("nome,telefone\n", 500)).toBeNull();
    expect(fatiarCsv("", 500)).toBeNull();
    expect(registrosDoCsv("\n\n")).toEqual([]);
  });
});

describe("textoDoArquivo", () => {
  it("UTF-8 válido passa direto; Windows-1252 do Excel vira texto certo", () => {
    expect(textoDoArquivo(new TextEncoder().encode("João").buffer as ArrayBuffer)).toBe("João");
    expect(textoDoArquivo(new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f]).buffer)).toBe("João");
  });
});
