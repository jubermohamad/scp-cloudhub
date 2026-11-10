#!/bin/bash

set -euo pipefail

# To allow scheduling in a read-only root filesystem environment and non-root user,
# this script implements a minimal cron matcher loop and runs the sidecar jobs without needing cron.
# `crontab` management require writable spool/state paths (e.g. `/var/spool/cron`, `/var/run`) and/or runtime crontab mutation,
# which conflicts with a read-only root filesystem and can cause duplicate entries on restart.


log() {
  local ts
  ts=$(date +%D\ %R:%S)
  echo "${ts} - SIDECAR-SCHEDULER: ${1}"
}

field_matches() {
  local field="$1"
  local value="$2"
  local min="$3"
  local max="$4"

  field="${field// /}"
  if [ -z "$field" ] || [ "$field" = "*" ]; then
    return 0
  fi

  local IFS=,
  read -r -a parts <<<"$field"

  for part in "${parts[@]}"; do
    if [[ "$part" == */* ]]; then
      local base="${part%/*}"
      local step_raw="${part#*/}"
      local step=$((10#$step_raw))

      local start end
      if [ "$base" = "*" ]; then
        start="$min"
        end="$max"
      elif [[ "$base" == *-* ]]; then
        start="${base%-*}"
        end="${base#*-}"
      else
        start="$base"
        end="$max"
      fi

      start=$((10#$start))
      end=$((10#$end))

      if (( value < start || value > end )); then
        continue
      fi

      if (( (value - start) % step == 0 )); then
        return 0
      fi
    elif [[ "$part" == *-* ]]; then
      local start_raw="${part%-*}"
      local end_raw="${part#*-}"
      local start=$((10#$start_raw))
      local end=$((10#$end_raw))
      if (( value >= start && value <= end )); then
        return 0
      fi
    else
      local num=$((10#$part))
      if (( value == num )); then
        return 0
      fi
    fi
  done

  return 1
}

cron_matches() {
  local cron_expr="$1"
  local minute="$2"
  local hour="$3"
  local dom="$4"
  local month="$5"
  local dow="$6"

  local f_min f_hour f_dom f_month f_dow
  read -r f_min f_hour f_dom f_month f_dow <<<"$cron_expr"

  if [ -z "${f_dow:-}" ]; then
    return 1
  fi

  field_matches "$f_min" "$minute" 0 59 || return 1
  field_matches "$f_hour" "$hour" 0 23 || return 1
  field_matches "$f_dom" "$dom" 1 31 || return 1
  field_matches "$f_month" "$month" 1 12 || return 1
  field_matches "$f_dow" "$dow" 0 6 || return 1

  return 0
}

run_job_if_due() {
  local name="$1"
  local cron_expr="$2"
  local cmd="$3"
  local minute="$4"
  local hour="$5"
  local dom="$6"
  local month="$7"
  local dow="$8"

  if [ -z "$cron_expr" ]; then
    return 0
  fi

  if cron_matches "$cron_expr" "$minute" "$hour" "$dom" "$month" "$dow"; then
    log "running job=${name} schedule='${cron_expr}'"
    bash "$cmd" &
  fi
}

trap 'log "received shutdown signal"; exit 0' SIGTERM SIGINT

SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/netreveal/standaloneHome/sidecar-scripts}"

ACQ_FEEDBACK_FILES_MOVE_CRON="${ACQ_FEEDBACK_FILES_MOVE_CRON:-}"
ACQ_ENVELOPE_EXTRACTOR_CRON="${ACQ_ENVELOPE_EXTRACTOR_CRON:-}"
AMLOPT_ENVELOPE_EXTRACTOR_CRON="${AMLOPT_ENVELOPE_EXTRACTOR_CRON:-}"
WLM_MOVER_CRON="${WLM_MOVER_CRON:-}"
WLM_ARCHIVE_CLEANER_CRON="${WLM_ARCHIVE_CLEANER_CRON:-}"

while true; do
  sleep "$((60 - 10#$(date +%S)))"

  minute=$((10#$(date +%M)))
  hour=$((10#$(date +%H)))
  dom=$((10#$(date +%d)))
  month=$((10#$(date +%m)))
  dow=$((10#$(date +%w)))

  run_job_if_due "acq-feedback-mover" "$ACQ_FEEDBACK_FILES_MOVE_CRON" "${SCRIPTS_DIR}/acq-feedback-mover.sh" "$minute" "$hour" "$dom" "$month" "$dow"
  run_job_if_due "envelope-extractor-acq" "$ACQ_ENVELOPE_EXTRACTOR_CRON" "${SCRIPTS_DIR}/envelope-extractor-acq.sh" "$minute" "$hour" "$dom" "$month" "$dow"
  {{- if $.Values.global.nrSolutionsSwitches.aml.amlOpt.enabled }}
  run_job_if_due "envelope-extractor-amlopt" "$AMLOPT_ENVELOPE_EXTRACTOR_CRON" "${SCRIPTS_DIR}/envelope-extractor-amlopt.sh" "$minute" "$hour" "$dom" "$month" "$dow"
  {{- end }}
  {{- if $.Values.global.nrSolutionsSwitches.wlm.enabled }}
  run_job_if_due "wlm-mover" "$WLM_MOVER_CRON" "${SCRIPTS_DIR}/wlm-mover.sh" "$minute" "$hour" "$dom" "$month" "$dow"
  run_job_if_due "wlm-archive-cleaner" "$WLM_ARCHIVE_CLEANER_CRON" "${SCRIPTS_DIR}/wlm-archive-cleaner.sh" "$minute" "$hour" "$dom" "$month" "$dow"
  {{- end }}
done
