
#!/bin/bash

# Define the logger
function logger() {
    local ts=$(date +%D\ %R:%S)
    echo "${ts} - ACQ: ${1}"
}

# Define the ORGUNITS array dynamically from helm list
# and include empty string for acqusition folder without orgUnit
{{- if .Values.global.nrOrgUnits }}
    {{- if ne (len .Values.global.nrOrgUnits) 0 }}
ORGUNITS=(""{{- range $key, $value := .Values.global.nrOrgUnits }} "{{ $value.orgUnitCode }}"{{- end }})
_ENDOFDAY=""
        {{- range $key, $value := .Values.global.nrOrgUnits }}
            {{- if $value.endOfDay }}
{{ $value.orgUnitCode | replace "-" "_" }}_ENDOFDAY="{{ $value.endOfDay }}"
            {{- else }}
{{ $value.orgUnitCode | replace "-" "_" }}_ENDOFDAY=""
            {{- end }}
        {{- end }}
    {{- else }}
ORGUNITS=("")
_ENDOFDAY=""
    {{- end }}
{{- else }}
ORGUNITS=("")
_ENDOFDAY=""
{{- end }}

# Define base directories
HOME_DIR="/opt/netreveal/standaloneHome"
TMP_ACQ_DIR_BASE="$HOME_DIR/pvc-mounts/tmp"

PID_FILE="$TMP_ACQ_DIR_BASE/acq_pid"

if [ -f "$PID_FILE" ]; then
    logger "Script is already running."
    exit 1
else
    logger "Creating pid file."
    echo $$ > "$PID_FILE"
    trap  "echo \"$(date +%D\ %R:%S) - ACQ: Remove pid file.\"; rm -f $PID_FILE" EXIT
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
        logger "Directory $dir created."
        if [ "$(id -u)" -eq 0 ]; then
            chown -R 200:200 "$dir"
            logger "Owner for $dir set"
        fi
    fi
}

function createOrgUnitFile() {
    local file_path=$1
    local org_unit=$2
    local base_name=${file_path%%.*}
    local base_ext=${file_path#*.}

    if [ ! -f "${base_name}${org_unit}.${base_ext}" ]; then
        touch "${base_name}${org_unit}.${base_ext}"
        logger "${base_name}${org_unit}.${base_ext} created"
        acqEndOfDay="${END_OF_DAY}"
        if [ "x${END_OF_DAY}" == "x" ]; then
            d=$(date '+%Y %m %d')
            a=( $d )
            printf -v acqEndOfDay "%04d%02d%02d" ${a[0]} ${a[1]} ${a[2]}
        fi
        echo "$acqEndOfDay" > "${base_name}${org_unit}.${base_ext}"
        logger "Set up end of day: $acqEndOfDay"
        if [ "$(id -u)" -eq 0 ]; then
            chown 200:200 "${base_name}${org_unit}.${base_ext}"
            logger "Update Owner for ${base_name}${org_unit}.${base_ext} set"
        fi
    fi
}

for orgunit in "${ORGUNITS[@]}"; do
    MINIO_ACQ_BUCKET_PATH="minio/private-bucket/landing/acquisition$orgunit"
    PVC_ACQ_DIR="$HOME_DIR/pvc-mounts/data/acquisition$orgunit"
    TMP_ACQ_DIR="$TMP_ACQ_DIR_BASE/acquisition$orgunit"
    tmpOrgunit=${orgunit//-/"_"}
    END_OF_DAY=$(eval echo "\$${tmpOrgunit}_ENDOFDAY")

    FLAG_OBJECTS=()
    mapfile -t FLAG_OBJECTS < <(mc find --name "*.zip.flag" "$MINIO_ACQ_BUCKET_PATH/waiting" 2>/dev/null || true)

    for file in `find $HOME_DIR/pvc-mounts/data -type f -iname "*endofday.txt"`; do
        base_file_name=$(basename "${file}")
        dir_name=$(dirname "${file}")
        file_dir_name=${dir_name##*/}
        if [ "${base_file_name}" == "endofday.txt" ] && [[ "${file_dir_name}" == acquisition* ]]; then
            continue
        fi
        createOrgUnitFile "${file}" "${orgunit}"
    done

    create_directory_if_not_exists "$TMP_ACQ_DIR"
    create_directory_if_not_exists "$PVC_ACQ_DIR/waiting"
    create_directory_if_not_exists "$PVC_ACQ_DIR/bad"
    create_directory_if_not_exists "$PVC_ACQ_DIR/done"
    create_directory_if_not_exists "$PVC_ACQ_DIR/feedback"
    create_directory_if_not_exists "$PVC_ACQ_DIR/feedback/reporting"
    create_directory_if_not_exists "$PVC_ACQ_DIR/processing"

    if [ ! -f "$PVC_ACQ_DIR/currentday.txt" ]; then
        touch "$PVC_ACQ_DIR/currentday.txt"
        logger "$PVC_ACQ_DIR/currentday.txt created"
        if [ "$(id -u)" -eq 0 ]; then
            chown 200:200 "$PVC_ACQ_DIR/currentday.txt"
            logger "Update Owner for $PVC_ACQ_DIR/currentday.txt set"
        fi
    fi

    if [ ! -f "$PVC_ACQ_DIR/endofday.txt" ]; then
        acqEndOfDay="${END_OF_DAY}"
        if [ "x${END_OF_DAY}" == "x" ]; then
            d=$(date '+%Y %m %d')
            a=( $d )
            printf -v acqEndOfDay "%04d%02d%02d" ${a[0]} ${a[1]} ${a[2]}
        fi
        echo "$acqEndOfDay" > "$PVC_ACQ_DIR/endofday.txt"
        logger "Set up end of day: $acqEndOfDay"
        logger "$PVC_ACQ_DIR/endofday.txt created"
        if [ "$(id -u)" -eq 0 ]; then
            chown 200:200 "$PVC_ACQ_DIR/endofday.txt"
            logger "Owner for $PVC_ACQ_DIR/endofday.txt set"
        fi
    fi

    if [ "${#FLAG_OBJECTS[@]}" -gt 0 ]; then
        DATE_PARTS=()
        for file in "${FLAG_OBJECTS[@]}"; do
            logger "Flag file found: $file"
            DATE_PART=$(echo "$file" | grep -oPi '(?<=([eE][nN][vV][eE][lL][oO][pP][eE]_))\d{8}(?=\.zip.flag)')
            DATE_PARTS+=("$DATE_PART")
        done
        LATEST_DATE=$(printf "%s\n" "${DATE_PARTS[@]}" | sort -rn | head -n 1)

        for flag_file in "${FLAG_OBJECTS[@]}"; do
            DATE_PART=$(echo "$flag_file" | grep -oPi '(?<=([eE][nN][vV][eE][lL][oO][pP][eE]_))\d{8}(?=\.zip.flag)')
            ZIP_FILE_OBJECT="${flag_file%.flag}"

            if mc stat "$ZIP_FILE_OBJECT" > /dev/null 2>&1; then
                logger "Corresponding zip file found: $ZIP_FILE_OBJECT"
                mc cp "$ZIP_FILE_OBJECT" "$TMP_ACQ_DIR/waiting/" && \
                unzip "$TMP_ACQ_DIR/waiting/$(basename "$ZIP_FILE_OBJECT")" -d "$TMP_ACQ_DIR/waiting"
                if [ $? -eq 0 ]; then
                    logger "Zip file successfully extracted to $TMP_ACQ_DIR/waiting"
                    logger "Removing the zip file from $TMP_ACQ_DIR/waiting"
                    if rm -f "$TMP_ACQ_DIR/waiting/$(basename "$ZIP_FILE_OBJECT")"; then
                        logger "Zip file successfully removed from $TMP_ACQ_DIR/waiting"
                    else
                        logger "Failed to remove zip file from $TMP_ACQ_DIR/waiting"
                    fi
                    logger "Moving Acquisition files to $PVC_ACQ_DIR/waiting"
                    find "$TMP_ACQ_DIR/waiting/" -maxdepth 1 -type f ! -name '*.sha' -exec mv -f {} "$PVC_ACQ_DIR/waiting" \;
                    if [ $? -eq 0 ]; then
                        logger "ENVLP-101: Acquisition files successfully moved to $PVC_ACQ_DIR/waiting" | tee "$TMP_ACQ_DIR/waiting/envelope_success_$DATE_PART.zip.flag"
                        mc cp "$TMP_ACQ_DIR/waiting/envelope_success_$DATE_PART.zip.flag" "$MINIO_ACQ_BUCKET_PATH/feedback/envelope_success_$DATE_PART.zip.flag"
                        if ! mc rm "$ZIP_FILE_OBJECT"; then
                            logger "WARNING: Failed to remove source zip $ZIP_FILE_OBJECT (will be skipped on next run due to missing flag)"
                        fi
                        if ! mc rm "$flag_file"; then
                            logger "WARNING: Failed to remove flag file $flag_file (may cause duplicate processing)"
                        fi
                        remove_directory "$TMP_ACQ_DIR/waiting"
                    else
                        logger "ENVLP-501: Failed to move acquisition files to $PVC_ACQ_DIR/waiting" | tee "$TMP_ACQ_DIR/waiting/envelope_error_$DATE_PART.zip.flag"
                        mc cp "$TMP_ACQ_DIR/waiting/envelope_error_$DATE_PART.zip.flag" "$MINIO_ACQ_BUCKET_PATH/feedback/envelope_error_$DATE_PART.zip.flag" || true
                        remove_directory "$TMP_ACQ_DIR/waiting"
                        exit 1
                    fi
                else
                    logger "ENVLP-502: Failed to extract zip file" | tee "$TMP_ACQ_DIR/waiting/envelope_error_$DATE_PART.zip.flag"
                    mc cp "$TMP_ACQ_DIR/waiting/envelope_error_$DATE_PART.zip.flag" "$MINIO_ACQ_BUCKET_PATH/feedback/envelope_error_$DATE_PART.zip.flag" || true
                    remove_directory "$TMP_ACQ_DIR/waiting"
                    exit 1
                fi
            else
                logger "ENVLP-503: Corresponding zip file does not exist" | tee "$TMP_ACQ_DIR/waiting/envelope_error_$DATE_PART.zip.flag"
                mc cp "$TMP_ACQ_DIR/waiting/envelope_error_$DATE_PART.zip.flag" "$MINIO_ACQ_BUCKET_PATH/feedback/envelope_error_$DATE_PART.zip.flag" || true
                exit 1
            fi
        done

        logger "Updating endofday.txt with proper date"
        echo "$LATEST_DATE" > "$PVC_ACQ_DIR/endofday.txt"
        if [ $? -eq 0 ]; then
            logger "$PVC_ACQ_DIR/endofday.txt was updated with $LATEST_DATE"
        else
            logger "ERROR $PVC_ACQ_DIR/endofday.txt wasn't updated with $LATEST_DATE"
            exit 1
        fi
    else
        logger "No flag file found in $MINIO_ACQ_BUCKET_PATH/waiting."
    fi
done
