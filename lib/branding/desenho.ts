/**
 * O DESENHO da marca do produto — símbolo e logotipo — como geometria pura.
 *
 * Mora aqui, e não num `.svg` em `public/`, por duas razões que a doutrina de
 * marca própria já paga:
 *
 *  1. `public/` é servido a todo mundo, sempre. Um arquivo fixo ali seria a
 *     marca do PRODUTO na instalação de um revendedor que configurou a dele —
 *     é exatamente o vazamento que `tests/unit/branding.test.ts` vigia. Como
 *     geometria, o desenho só aparece onde um componente decide que a marca em
 *     vigor é a padrão (`marcaEhADoProduto`, em `lib/branding.ts`).
 *  2. O favicon (`app/icon.tsx`) é gerado em runtime pelo `ImageResponse`, que
 *     aceita SVG inline mas não lê arquivo do disco. Um único desenho alimenta
 *     a tela e o ícone — dois arquivos divergiriam na primeira revisão da marca.
 *
 * As cores NÃO estão aqui de propósito: quem desenha escolhe (a tela lê os
 * tokens do tema; o favicon lê a régua do produto). A fonte deste arquivo são
 * os SVGs em `docs/brand/`; ao trocar a arte, regenere os dois lados a partir
 * deles.
 */

/** Glifo com a transformação que o posiciona no `viewBox` do logotipo. */
export type Glifo = { readonly transform: string; readonly d: string };

const D_ABERTO =
  "M49.5 154.5H86.2L102.1 91.5C104.7 81.1 106.3 69.9 107.9 58.6C109.6 70.1 111.4 81.4 114 91.5L129.9 154.5H166.5L203 18H167.2L153.7 78.4C151 91 148.8 106.4 146.7 120.9C144.3 106.4 141.9 91 138.9 78.4L124.5 18H91.6L77.1 78.4C74.1 91.2 71.7 106.7 69.3 121.2C67.1 106.7 64.9 91.2 62.3 78.4L48.8 18H13Z";

/** O símbolo: um W com um módulo quadrado destacado embaixo. Quadrado de 216. */
export const SIMBOLO = {
  viewBox: "0 0 216 216",
  transform: "translate(0.5 2)",
  d: D_ABERTO,
  modulo: { x: 91, y: 161, width: 34, height: 34, rx: 4 },
} as const;

/**
 * O logotipo: símbolo + "WhatsMeta" + "CRM", com o texto já convertido em
 * caminhos — não depende de fonte instalada nem de `@font-face`.
 */
export const LOGOTIPO = {
  viewBox: "51 25 807 211",
  /** Proporção largura/altura do `viewBox`, para dimensionar por altura. */
  proporcao: 807 / 211,
  simbolo: { transform: "translate(44 19) scale(1.05)", d: D_ABERTO, modulo: SIMBOLO.modulo },
  nome: [
    {
      transform: "translate(268.0 151) scale(0.05 -0.05)",
      d: "M449 0H798L995 762C1024 875 1042 994 1061 1118C1082 990 1102 869 1129 762L1327 0H1675L2076 1490H1742L1569 757C1539 621 1513 461 1489 309C1462 461 1435 621 1402 757L1221 1490H904L722 757C688 620 662 458 635 305C611 458 585 620 555 757L382 1490H49Z",
    },
    {
      transform: "translate(374.25 151) scale(0.05 -0.05)",
      d: "M428 647C428 795 517 881 645 881C771 881 847 798 847 659V0H1148V711C1148 973 995 1132 763 1132C597 1132 487 1050 422 904V1490H128V0H428Z",
    },
    {
      transform: "translate(438.0 151) scale(0.05 -0.05)",
      d: "M440 -22C605 -22 713 51 767 155H777V0H1061V753C1061 1024 827 1132 587 1132C337 1132 157 1021 100 827L375 781C399 853 470 910 586 910C698 910 761 856 761 761V756C761 683 682 675 490 656C270 635 68 563 68 313C68 92 227 -22 440 -22ZM525 189C426 189 356 234 356 321C356 411 430 454 541 470C607 479 726 495 763 521V400C763 282 665 189 525 189Z",
    },
    {
      transform: "translate(497.45 151) scale(0.05 -0.05)",
      d: "M683 1118H474V1384H174V1118H20V889H174V301C174 96 296 -16 520 -16C580 -16 647 -9 714 11L671 236C649 230 599 223 576 223C503 223 474 256 474 327V889H683Z",
    },
    {
      transform: "translate(534.95 151) scale(0.05 -0.05)",
      d: "M572 -22C865 -22 1072 125 1072 345C1072 504 968 603 752 647L551 687C445 709 407 748 407 804C407 871 483 917 581 917C690 917 753 863 777 787L1043 834C1001 1016 842 1132 577 1132C294 1132 107 1000 107 785C107 618 213 512 429 468L622 428C720 408 766 372 766 313C766 246 695 198 581 198C458 198 386 249 357 354L78 306C117 98 302 -22 572 -22Z",
    },
    {
      transform: "translate(592.3 151) scale(0.05 -0.05)",
      d: "M135 0H438V703C438 815 430 1034 427 1215C480 1015 540 806 575 703L826 0H1083L1330 703C1365 809 1428 1026 1478 1227C1475 1039 1467 815 1467 703V0H1774V1490H1304L1066 806C1036 711 990 512 956 351C921 513 875 712 845 806L603 1490H135Z",
    },
    {
      transform: "translate(687.7 151) scale(0.05 -0.05)",
      d: "M633 -22C893 -22 1071 99 1126 285L854 336C822 250 743 204 638 204C487 204 385 298 378 481H1143V565C1143 947 910 1132 618 1132C291 1132 81 898 81 553C81 200 291 -22 633 -22ZM380 669C392 807 478 906 621 906C760 906 839 815 854 669Z",
    },
    {
      transform: "translate(748.7 151) scale(0.05 -0.05)",
      d: "M683 1118H474V1384H174V1118H20V889H174V301C174 96 296 -16 520 -16C580 -16 647 -9 714 11L671 236C649 230 599 223 576 223C503 223 474 256 474 327V889H683Z",
    },
    {
      transform: "translate(786.2 151) scale(0.05 -0.05)",
      d: "M440 -22C605 -22 713 51 767 155H777V0H1061V753C1061 1024 827 1132 587 1132C337 1132 157 1021 100 827L375 781C399 853 470 910 586 910C698 910 761 856 761 761V756C761 683 682 675 490 656C270 635 68 563 68 313C68 92 227 -22 440 -22ZM525 189C426 189 356 234 356 321C356 411 430 454 541 470C607 479 726 495 763 521V400C763 282 665 189 525 189Z",
    },
  ] as readonly Glifo[],
  sufixo: [
    {
      transform: "translate(273 191) scale(0.01171875 -0.01171875)",
      d: "M1073 53Q996 12 915.0 -8.5Q834 -29 743 -29Q456 -29 297.5 174.0Q139 377 139 745Q139 1111 298.5 1315.5Q458 1520 743 1520Q834 1520 915.0 1499.5Q996 1479 1073 1438V1231Q999 1292 914.0 1324.0Q829 1356 743 1356Q546 1356 448.0 1204.0Q350 1052 350 745Q350 439 448.0 287.0Q546 135 743 135Q831 135 915.5 167.0Q1000 199 1073 260Z",
    },
    {
      transform: "translate(292.4492 191) scale(0.01171875 -0.01171875)",
      d: "M760 705Q838 685 893.0 629.5Q948 574 1030 408L1233 0H1016L838 377Q761 538 699.5 584.5Q638 631 539 631H346V0H143V1493H559Q805 1493 936.0 1382.0Q1067 1271 1067 1061Q1067 913 986.5 819.5Q906 726 760 705ZM346 1327V797H567Q712 797 783.0 862.0Q854 927 854 1061Q854 1190 778.5 1258.5Q703 1327 559 1327Z",
    },
    {
      transform: "translate(311.8984 191) scale(0.01171875 -0.01171875)",
      d: "M86 1493H356L614 733L874 1493H1145V0H958V1319L692 532H539L272 1319V0H86Z",
    },
  ] as readonly Glifo[],
} as const;

/**
 * As cores da marca do produto, por tema — os mesmos graus da régua
 * (`regua-do-produto.ts`): sálvia 600/400 para o símbolo, neutro 900/0 para
 * o nome e neutro 600/300 para o "CRM". Copiadas dos SVGs de `docs/brand/`.
 */
export const CORES_DA_MARCA = {
  claro: { simbolo: "#506d48", nome: "#1c1a16", sufixo: "#5d594f" },
  escuro: { simbolo: "#82a077", nome: "#f5f4ef", sufixo: "#8e8b7f" },
} as const;
