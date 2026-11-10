#!/bin/bash

# Define the source and destination directories
HOME_DIR="/opt/netreveal/standaloneHome"
WLM_PVC_ROOT="$HOME_DIR/pvc-mounts/wlm"
MINIO_LISTIMPORT_DIR="minio/private-bucket/landing/listImport"
PVC_LISTIMPORT_DIR="$WLM_PVC_ROOT/listImport"
MINIO_BATCHWATCH_DIR="minio/private-bucket/landing/batchwatch"
PVC_BATCHWATCH_DIR="$WLM_PVC_ROOT/batchwatch"
MINIO_FPFA_DIR="minio/private-bucket/landing/fpfa"
PVC_FPFA_DIR="$WLM_PVC_ROOT/fpfa"
MINIO_WORLDCHECK_DIR="minio/private-bucket/landing/worldcheck"
PVC_WORLDCHECK_DIR="$WLM_PVC_ROOT/worldcheck"

ACTIVE_LISTS="LISTIMPORT BATCHWATCH FPFA WORLDCHECK"

# Define the logger
function logger() {
    local ts
    ts=$(date +%D\ %R:%S)
    echo "${ts} - WLM-MOVER: ${1}: ${2}"
}

maybe_chown() {
    local path="$1"
    if [ "$(id -u)" -eq 0 ]; then
        chown -R 200:200 "$path"
    fi
}

sync_prefix_to_dir() {
    local src_prefix="$1"
    local dst_root="$2"
    local list_type="$3"

    if [ ! -d "$dst_root" ]; then
        mkdir -p "$dst_root"
        maybe_chown "$dst_root"
    fi

    OBJECTS=()
    mapfile -t OBJECTS < <(mc find "$src_prefix" 2>/dev/null | grep -v '/$' || true)

    if [ "${#OBJECTS[@]}" -eq 0 ]; then
        logger "$list_type" "No files found in $src_prefix"
        return 0
    fi

    for object in "${OBJECTS[@]}"; do
        if [ -z "$object" ] || [ "$object" = "$src_prefix" ] || [ "$object" = "${src_prefix}/" ]; then
            continue
        fi

        relative_path="${object#"${src_prefix}"/}"
        if [ -z "$relative_path" ]; then
            continue
        fi

        dest_path="$dst_root/$relative_path"
        dest_dir="$(dirname "$dest_path")"

        if [ ! -d "$dest_dir" ]; then
            mkdir -p "$dest_dir"
            maybe_chown "$dest_dir"
        fi

        logger "$list_type" "Moving $relative_path"
        if mc cp "$object" "$dest_path"; then
            if mc rm "$object"; then
                logger "$list_type" "$relative_path moved successfully"
            else
                logger "$list_type" "$relative_path copied but source removal failed (will retry on next run)"
            fi
        else
            logger "$list_type" "$relative_path move failed"
        fi
    done
}

for list in $ACTIVE_LISTS; do
    case "$list" in
        LISTIMPORT) sync_prefix_to_dir "$MINIO_LISTIMPORT_DIR" "$PVC_LISTIMPORT_DIR" "$list" ;;
        BATCHWATCH) sync_prefix_to_dir "$MINIO_BATCHWATCH_DIR" "$PVC_BATCHWATCH_DIR" "$list" ;;
        FPFA) sync_prefix_to_dir "$MINIO_FPFA_DIR" "$PVC_FPFA_DIR" "$list" ;;
        WORLDCHECK) sync_prefix_to_dir "$MINIO_WORLDCHECK_DIR" "$PVC_WORLDCHECK_DIR" "$list" ;;
        *) logger "$list" "Unknown list type, skipping" ;;
    esac
done
