
#!/bin/bash

# Define the logger
function logger() {
    local ts=$(date +%D\ %R:%S)
    echo "${ts} - ACQ FEEDBACK: ${1}"
}

# Define the pattern for the flag files
readonly FLAG_PATTERN="*_*.flag"

# Define the source directories
readonly HOME_DIR="/opt/netreveal/standaloneHome"
readonly TMP_DIR_BASE="$HOME_DIR/pvc-mounts/tmp"

# Zip timestamp format for bad files parameters
readonly ZIP_TIMESTAMP_ENABLED="{{ default "false" .Values.sideCar.badFileZipTimestampEnabled }}"
readonly ZIP_TIMESTAMP_FORMAT="%H%M%S"

# Flag name regex pattern variable
readonly ACQ_FLAG_FILENAME_REGEX='^acq_.*_.*\.flag$'

# Verify that this script is not running... It can be run only one copy of it.
PID_FILE="$TMP_DIR_BASE/acq-feedback-mover-pid"

# Check if the lock file exists
if [ -f "$PID_FILE" ]; then
    logger "Script is already running."
    exit 1
else
    # Create a pid file
    logger "Creating pid file."
    echo $$ > "$PID_FILE"
    trap  "echo \"$(date +%D\ %R:%S) - ACQ FEEDBACK: Remove pid file.\"; rm -f $PID_FILE" EXIT
fi

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

for orgunit in "${ORGUNITS[@]}"; do
    # Define the source directories
    SOURCE_FEEDBACK_DIR="$HOME_DIR/pvc-mounts/data/acquisition$orgunit/feedback"
    SOURCE_BAD_DIR="$HOME_DIR/pvc-mounts/data/acquisition$orgunit/bad"
    SOURCE_DONE_DIR="$HOME_DIR/pvc-mounts/data/acquisition$orgunit/done"

    # Define the target bucket path
    TARGET_FEEDBACK_BUCKET_PATH="minio/private-bucket/landing/acquisition$orgunit/feedback"
    TMP_DIR="$TMP_DIR_BASE/feedback$orgunit"

    if [ ! -d "$TMP_DIR" ]; then
        mkdir -p "$TMP_DIR"
    fi

    ACQ_FLAG_PATTERN="acq_$FLAG_PATTERN"

    # Check if the flag file exists in the feedback folder
    acq_flag_files=$(find "$SOURCE_FEEDBACK_DIR" -type f -name "$ACQ_FLAG_PATTERN")
    BAD_FILES_FOUND=0

    if [ ! -z "$acq_flag_files" ]; then
        for acq_flag_file in $SOURCE_FEEDBACK_DIR/$ACQ_FLAG_PATTERN; do
            # Extract necessary information from the flag file
            acq_date=$(echo "$acq_flag_file" | grep -oP '\d{8}')
            acq_status=$(echo "$acq_flag_file" | grep -oP '(?<=acq_)[a-z]+(?=_)')
            acq_files_pattern="*$acq_date*"

            # Check if there are any files in the bad folder
            if [ "$(ls -1 "${SOURCE_BAD_DIR}"/$acq_files_pattern 2>/dev/null | wc -l)" -gt 0 ]; then
                BAD_FILES_FOUND=1
                logger "Acquisition file flag and bad files are found"
                logger "Zipping bad files..."

                if [[ "$ZIP_TIMESTAMP_ENABLED" == "true" ]]; then
                    zip_timestamp=$(date +"$ZIP_TIMESTAMP_FORMAT")
                    zip_file_pattern="acq_bad_${acq_date}_${zip_timestamp}.zip"
                else
                    zip_file_pattern="acq_bad_${acq_date}.zip"
                fi

                zip -j "$TMP_DIR/$zip_file_pattern" "$SOURCE_BAD_DIR"/$acq_files_pattern
                if [ $? -eq 0 ]; then
                    logger "Bad files are zipped: $TMP_DIR/$zip_file_pattern"
                else
                    logger "Bad files can't be zipped"
                    exit 1
                fi

                logger "Moving archive with bad files to $TARGET_FEEDBACK_BUCKET_PATH"
                if mc mv "$TMP_DIR/$zip_file_pattern" "$TARGET_FEEDBACK_BUCKET_PATH/$zip_file_pattern"; then
                    logger "Archive with bad files was moved successfully"
                else
                    logger "Archive with bad files was not moved"
                    exit 1
                fi

                rm "$SOURCE_BAD_DIR"/$acq_files_pattern
                if [ $? -eq 0 ]; then
                    logger "Old bad files were removed successfully"
                else
                    logger "Old bad files was not removed"
                    exit 1
                fi

                logger "Skipping moving acq flag file this iteration because bad files were processed."
            fi

            if [ $BAD_FILES_FOUND -eq 0 ]; then
                logger "Moving acq flag File..."
                if mc mv "$SOURCE_FEEDBACK_DIR/acq_${acq_status}_${acq_date}.flag" "$TARGET_FEEDBACK_BUCKET_PATH/acq_${acq_status}_${acq_date}.flag"; then
                    logger "Acq flag file was moved successfully"
                else
                    logger "Acq flag file was not moved"
                    exit 1
                fi
            fi

            if [ "$(ls -1 "${SOURCE_DONE_DIR}"/$acq_files_pattern 2>/dev/null | wc -l)" -gt 0 ]; then
                logger "Removing files in done directory"
                rm "$SOURCE_DONE_DIR"/$acq_files_pattern
                if [ $? -eq 0 ]; then
                    logger "Done files were removed successfully"
                else
                    logger "Done files was not removed"
                    exit 1
                fi
            else
                logger "No files in the done folder."
            fi
        done
    else
        logger "No acq flag file found in the feedback folder."
    fi

    solution_flag_files=$(find "$SOURCE_FEEDBACK_DIR" -type f -name "$FLAG_PATTERN" ! -name "$ACQ_FLAG_PATTERN")

    if [ $BAD_FILES_FOUND -eq 0 ]; then
        if [ ! -z "$solution_flag_files" ]; then
            for flagFile in "$SOURCE_FEEDBACK_DIR"/$FLAG_PATTERN; do
                if [[ ! $(basename "$flagFile") =~ $ACQ_FLAG_FILENAME_REGEX ]]; then
                    if mc mv "$flagFile" "$TARGET_FEEDBACK_BUCKET_PATH/$(basename "$flagFile")"; then
                        logger "Moving $(basename "$flagFile") flag file"
                    else
                        logger "Failed to move $(basename "$flagFile")"
                    fi
                fi
            done
        fi
    fi
done
