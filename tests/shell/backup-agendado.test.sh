#!/usr/bin/env bash
# Prova do backup automático (WhatsMeta): o cron chama backup-agendado.sh TODO
# DIA e ele só roda o backup quando o último dump do banco tem a idade do
# intervalo (BACKUP_INTERVALO_DIAS, padrão 25) ou mais. E prova que o
# agendamento no crontab é idempotente.
#
#   bash tests/shell/backup-agendado.test.sh
#
# O kit é copiado para uma pasta temporária com um backup.sh DUBLÊ, que só conta
# quantas vezes foi chamado e cria o dump. Nada aqui toca o docker nem o crontab
# de verdade (o `crontab` é um dublê que guarda o conteúdo num arquivo).
set -uo pipefail
unset COMPOSE_PROJECT_NAME

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILS=0
check() {  # check <descrição> <comando...>
  if "${@:2}"; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); fi
}

KIT="$WORK/kit"
mkdir -p "$KIT"
cp "$ROOT/hostgator-setup-kit/_common.sh" "$ROOT/hostgator-setup-kit/_i18n.sh" \
   "$ROOT/hostgator-setup-kit/_manifestos.sh" "$ROOT/hostgator-setup-kit/backup-agendado.sh" "$KIT/"
cat > "$KIT/backup.sh" <<'STUB'
#!/usr/bin/env bash
echo chamado >> "$CHAMADAS"
mkdir -p "$BACKUP_DIR"
: > "$BACKUP_DIR/db-$(date +%s%N).sql.gz"
STUB

PROJ="$WORK/projeto"
mkdir -p "$PROJ/backups"
: > "$PROJ/docker-compose.prod.yml"
printf '%s\n' 'SINGLE_SERVER="1"' > "$PROJ/.env"
export CHAMADAS="$WORK/chamadas" BACKUP_DIR="$PROJ/backups"
chamadas() { [ -f "$CHAMADAS" ] && wc -l < "$CHAMADAS" | tr -d ' ' || echo 0; }
rodar() { ( cd "$PROJ" && env "$@" bash "$KIT/backup-agendado.sh" ) >/dev/null 2>&1; }
dump_com_idade() {  # dump_com_idade <dias>
  rm -f "$PROJ/backups"/db-*.sql.gz
  : > "$PROJ/backups/db-antigo.sql.gz"
  touch -d "@$(( $(date +%s) - $1 * 86400 - 60 ))" "$PROJ/backups/db-antigo.sql.gz"
}

echo "sem backup nenhum:"
rm -f "$CHAMADAS"; rm -f "$PROJ/backups"/db-*.sql.gz
rodar X=1
check "o primeiro backup sai na hora" [ "$(chamadas)" = 1 ]

echo "último backup há 3 dias (intervalo padrão 25):"
rm -f "$CHAMADAS"; dump_com_idade 3
rodar X=1
check "não faz backup antes do prazo" [ "$(chamadas)" = 0 ]

echo "último backup há 24 dias:"
rm -f "$CHAMADAS"; dump_com_idade 24
rodar X=1
check "24 dias ainda não é o prazo" [ "$(chamadas)" = 0 ]

echo "último backup há 25 dias:"
rm -f "$CHAMADAS"; dump_com_idade 25
rodar X=1
check "25 dias: faz o backup" [ "$(chamadas)" = 1 ]
rodar X=1
check "no dia seguinte (dump novo), não repete" [ "$(chamadas)" = 1 ]

echo "intervalo configurado em 7 dias:"
rm -f "$CHAMADAS"; dump_com_idade 8
rodar BACKUP_INTERVALO_DIAS=7
check "respeita BACKUP_INTERVALO_DIAS" [ "$(chamadas)" = 1 ]

echo "intervalo inválido cai no padrão de 25:"
rm -f "$CHAMADAS"; dump_com_idade 10
rodar BACKUP_INTERVALO_DIAS=abc
check "valor inválido não vira backup diário" [ "$(chamadas)" = 0 ]

echo "BACKUP_FORCAR=1:"
rm -f "$CHAMADAS"; dump_com_idade 1
rodar BACKUP_FORCAR=1
check "força o backup mesmo dentro do prazo" [ "$(chamadas)" = 1 ]
check "deixa registro no log" grep -q "backup automático concluído" "$PROJ/backups/backup-agendado.log"

echo "agendamento no crontab:"
mkdir -p "$WORK/bin"
cat > "$WORK/bin/crontab" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "-l" ]; then cat "$CRONTAB_FILE" 2>/dev/null; exit 0; fi
# Como o crontab de verdade: lê a entrada INTEIRA antes de gravar (senão o
# `crontab -l | ... | crontab -` truncaria o arquivo no meio da leitura).
conteudo="$(cat)"; printf '%s\n' "$conteudo" > "$CRONTAB_FILE"
STUB
chmod +x "$WORK/bin/crontab"
export CRONTAB_FILE="$WORK/crontab.txt"
printf '%s\n' '0 1 * * * linha-de-outra-coisa' > "$CRONTAB_FILE"
agendar() { ( cd "$PROJ" && PATH="$WORK/bin:$PATH" bash -c "source '$KIT/_common.sh'; enter_project; setup_backup_cron" ) >/dev/null 2>&1; }
agendar; agendar
check "uma linha só, mesmo agendando duas vezes" [ "$(grep -c 'backup-agendado.sh' "$CRONTAB_FILE")" = 1 ]
check "roda todo dia às 03:17" grep -q '^17 3 \* \* \* cd .* && bash hostgator-setup-kit/backup-agendado.sh' "$CRONTAB_FILE"
check "não apaga as outras linhas do crontab" grep -q 'linha-de-outra-coisa' "$CRONTAB_FILE"

if [ "$FAILS" -gt 0 ]; then echo "$FAILS falha(s)"; exit 1; fi
echo "Todos os testes do backup automático passaram."
