#!/usr/bin/env bash
# Backup AUTOMÁTICO (WhatsMeta): o banco inteiro — conversas, contatos, negócios —,
# as sessões do WhatsApp e os anexos, a cada BACKUP_INTERVALO_DIAS (padrão: 25).
#
# O cron não sabe contar "a cada 25 dias": uma linha `*/25` no campo de dia reinicia
# todo mês (dia 1 e 26). Por isso o install.sh/update.sh agendam ESTE script todo
# dia, e é ele que decide: só chama o backup.sh quando o último dump do banco
# CONFERIDO (o backup.sh só dá o nome definitivo depois do `gzip -t`) tem a idade
# do intervalo ou mais. Servidor desligado no dia "certo" não perde o backup: ele
# sai na primeira manhã em que o servidor estiver de pé.
#
# A saída vai para backups/backup-agendado.log, que guarda as últimas 500 linhas.
#
# Uso manual (o mesmo que o cron faz):  bash hostgator-setup-kit/backup-agendado.sh
# Forçar agora, ignorando a idade:      BACKUP_FORCAR=1 bash hostgator-setup-kit/backup-agendado.sh
KIT="$(cd "$(dirname "$0")" && pwd)"
source "$KIT/_common.sh"
enter_project

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
intervalo="${BACKUP_INTERVALO_DIAS:-25}"
case "$intervalo" in
  ''|*[!0-9]*) intervalo=25 ;;
esac
if [ "$intervalo" -lt 1 ] || [ "$intervalo" -gt 365 ]; then intervalo=25; fi

umask 077
mkdir -p "$BACKUP_DIR"
log="$BACKUP_DIR/backup-agendado.log"

# Idade, em segundos, do dump do banco mais novo — vazio quando não há nenhum.
idade_do_ultimo_backup() {
  local ultimo
  ultimo="$( (ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null || true) | head -1)"
  [ -n "$ultimo" ] || return 0
  printf '%s' "$(( $(date +%s) - $(stat -c %Y "$ultimo") ))"
}

idade="$(idade_do_ultimo_backup)"
limite=$(( intervalo * 86400 ))
if [ "${BACKUP_FORCAR:-0}" != "1" ] && [ -n "$idade" ] && [ "$idade" -lt "$limite" ]; then
  exit 0
fi

{
  printf '\n==> %s — backup automático (intervalo: %s dias; último: %s)\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$intervalo" \
    "$([ -n "$idade" ] && printf 'há %s dias' "$(( idade / 86400 ))" || printf 'nenhum')"
  if bash "$KIT/backup.sh"; then
    printf '==> backup automático concluído\n'
  else
    printf '==> backup automático FALHOU (exit %s) — o próximo dia tenta de novo\n' "$?"
  fi
} >> "$log" 2>&1

# O log não cresce para sempre.
if [ -f "$log" ]; then
  tail -n 500 "$log" > "$log.tmp" 2>/dev/null && mv -f "$log.tmp" "$log"
fi
exit 0
