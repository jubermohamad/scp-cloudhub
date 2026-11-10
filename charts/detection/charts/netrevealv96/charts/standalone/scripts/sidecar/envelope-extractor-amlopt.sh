
#!/bin/bash

# Define the logger
function logger() {
    local ts=$(date +%D\ %R:%S)
    echo "${ts} - AMLOPT: ${1}"
}

# Define the ORGUNITS array dynamically from helm list
# and include empty string for acqusition folder without orgUnit
{{- if .Values.global.nrOrgUnits }}
    {{- if ne (len .Values.global.nrOrgUnits) 0 }}
ORGUNITS=(""{{- range $key, $value := .Values.global.nrOrgUnits }} "{{ $value.orgUnitCode }}"{{- end }})
    {{- else }}
ORGUNITS=("")
    {{- end }}
{{- else }}
ORGUNITS=("")
{{- end }}

# Define base directories
HOME_DIR="/opt/netreveal/standaloneHome"
TMP_DATA_DIR_BASE="$HOME_DIR/pvc-mounts/tmp/"

PID_FILE="$TMP_DATA_DIR_BASE/amlopt_pid"

if [ -f "$PID_FILE" ]; then
    logger "Script is already running."
    exit 1
else
    logger "Creating pid file."
    echo $$ > "$PID_FILE"
    trap  "echo \"$(date +%D\ %R:%S) - AMLOPT: Remove pid file.\"; rm -f $PID_FILE" EXIT
fi

remove_directory() {
    local dir=$1
    if rm -rf "$dir"; then
        logger "$dir was successfully removed"
    else
        logger "Removing $dir was failed"
        exit 1
    fi
}

create_directory_if_not_exists() {
    local dir=$1
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo "Directory $dir created."
        if [ "$(id -u)" -eq 0 ]; then
            chown -R 200:200 "$dir"
            logger "Owner for $dir is set"
        fi
    fi
}

for orgunit in "${ORGUNITS[@]}"; do
    MINIO_AMLOPT_DATA_BUCKET_PATH="minio/private-bucket/landing/amlopt$orgunit/data"
    PVC_DATA_DIR="$HOME_DIR/pvc-mounts/amlopt$orgunit/data"
    TMP_DATA_DIR="$TMP_DATA_DIR_BASE/amlopt$orgunit/data"
    MINIO_FEEDBACK_BUCKET_PATH="minio/private-bucket/landing/acquisition$orgunit/feedback/amlopt"

    FLAG_OBJECTS=()
    mapfile -t FLAG_OBJECTS < <(mc find --name "*.zip.flag" "$MINIO_AMLOPT_DATA_BUCKET_PATH" 2>/dev/null || true)

    create_directory_if_not_exists "$TMP_DATA_DIR"
    create_directory_if_not_exists "$PVC_DATA_DIR"

    if [ "${#FLAG_OBJECTS[@]}" -gt 0 ]; then
        for flag_file in "${FLAG_OBJECTS[@]}"; do
            logger "Flag file found: $flag_file"
            DATE_PART=$(echo "$flag_file" | grep -oPi '(?<=([eE][nN][vV][eE][lL][oO][pP][eE]_))\d{8}(?=\.zip.flag)')
            ZIP_FILE_OBJECT="${flag_file%.flag}"

            if mc stat "$ZIP_FILE_OBJECT" > /dev/null 2>&1; then
                logger "Corresponding zip file found: $ZIP_FILE_OBJECT"
                mc cp "$ZIP_FILE_OBJECT" "$TMP_DATA_DIR/" && \
                unzip "$TMP_DATA_DIR/$(basename "$ZIP_FILE_OBJECT")" -d "$TMP_DATA_DIR"
                if [ $? -eq 0 ]; then
                    logger "Zip file successfully extracted to $TMP_DATA_DIR"
                    logger "Moving AMLOPT files to $PVC_DATA_DIR"
                    find "$TMP_DATA_DIR" -maxdepth 1 -type f ! -name '*.sha' -exec mv -f {} "$PVC_DATA_DIR" \;
                    if [ $? -eq 0 ]; then
                        logger "ENVLP-101: Files successfully moved to $PVC_DATA_DIR" | tee "$TMP_DATA_DIR/envelope_success_$DATE_PART.zip.flag"
                        mc cp "$TMP_DATA_DIR/envelope_success_$DATE_PART.zip.flag" "$MINIO_FEEDBACK_BUCKET_PATH/envelope_success_$DATE_PART.zip.flag"
                        if ! mc rm "$ZIP_FILE_OBJECT"; then
                            logger "WARNING: Failed to remove source zip $ZIP_FILE_OBJECT (will be skipped on next run due to missing flag)"
                        fi
                        if ! mc rm "$flag_file"; then
                            logger "WARNING: Failed to remove flag file $flag_file (may cause duplicate processing)"
                        fi
                    else
                        logger "ENVLP-501: Failed to move files to $PVC_DATA_DIR" | tee "$TMP_DATA_DIR/envelope_error_$DATE_PART.zip.flag"
                        mc cp "$TMP_DATA_DIR/envelope_error_$DATE_PART.zip.flag" "$MINIO_FEEDBACK_BUCKET_PATH/envelope_error_$DATE_PART.zip.flag" || true
                    fi
                    remove_directory "$TMP_DATA_DIR"
                else
                    logger "ENVLP-502: Failed to extract zip file." | tee "$TMP_DATA_DIR/envelope_error_$DATE_PART.zip.flag"
                    mc cp "$TMP_DATA_DIR/envelope_error_$DATE_PART.zip.flag" "$MINIO_FEEDBACK_BUCKET_PATH/envelope_error_$DATE_PART.zip.flag" || true
                    remove_directory "$TMP_DATA_DIR"
                    exit 1
                fi
            else
                logger "ENVLP-503: Corresponding zip file does not exist" | tee "$TMP_DATA_DIR/envelope_error_$DATE_PART.zip.flag"
                mc cp "$TMP_DATA_DIR/envelope_error_$DATE_PART.zip.flag" "$MINIO_FEEDBACK_BUCKET_PATH/envelope_error_$DATE_PART.zip.flag" || true
                exit 1
            fi
        done
    else
        logger "No flag file found in $MINIO_AMLOPT_DATA_BUCKET_PATH"
    fi
done
