#!/bin/bash

MINIO_URL=${MINIO_URL:-empty}
MINIO_USER=${MINIO_USER:-netreveal}
MINIO_PASSWORD=${MINIO_PASSWORD:-pass}

export MC_CONFIG_DIR="/mc-config/.mc"

# Define the directories
readonly HOME_DIR="/opt/netreveal/standaloneHome"
# Minio bucket path
readonly SCHEMA_IMPORT_DIR="minio/private-bucket/landing/historical_data"
readonly TMP_DIR="$HOME_DIR/tmp"
readonly TMP_ZIP_FILE_DIR="$TMP_DIR/zip"
readonly TMP_FLAG_DIR="$TMP_DIR/flags"
readonly TMP_SCHEMA_IMPORT_DIR="$TMP_DIR/apps-schema-import"
# Minio bucket path
readonly FEEDBACK_DIR="minio/private-bucket/landing/acquisition/feedback/historical_data"
readonly PGPASSWORD="$PGPASSWORD"
readonly APPS_SCHEMA_IMPORT_USER="$APPS_SCHEMA_IMPORT_USER"


{{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") }}
readonly PGSSLMODE={{ .Values.global.baseConfigProperties.db.postgresql.sslmode }}
readonly PGSSLROOTCERT={{ .Values.global.baseConfigProperties.db.postgresql.sslrootcert }}
{{- end }}

# Define the logger
function logger() {
    local ts=$(date +%D\ %R:%S)
    echo -e "${ts} - SCHEMA_IMPORT: ${1}"
}

# Function to extract zip files
function extract_zip() {
    local zip_path=$1
    local extract_to=$2
    logger "Unzipping $zip_path to $extract_to"
    if unzip "$zip_path" -d "$extract_to"; then
        local flag_file_name="$(basename "$zip_path")_success.flag"
        mkdir -p "$TMP_FLAG_DIR"
        logger "$zip_path was extracted" | tee "$TMP_FLAG_DIR/$flag_file_name"
        if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
            logger "Flag file $flag_file_name copied to MinIO successfully"
        else
            logger "Failed to copy flag file $flag_file_name to MinIO"
            remove_file "$zip_path"
            exit 1
        fi
        remove_file "$zip_path"
        if mc rm "$SCHEMA_IMPORT_DIR/apps_schema_import.zip"; then
            logger "$zip_path was removed from MinIO successfully"
        else
            logger "Failed to remove $zip_path from MinIO"
            exit 1
        fi
    else
        local flag_file_name="$(basename "$zip_path")_error.flag"
        logger "Extraction of the $zip_path was failed" | tee "$TMP_FLAG_DIR/$flag_file_name"
        if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
            logger "Flag file $flag_file_name copied to MinIO successfully"
        else
            logger "Failed to copy flag file $flag_file_name to MinIO"
        fi
        remove_file "$zip_path"
        if mc rm "$SCHEMA_IMPORT_DIR/apps_schema_import.zip"; then
            logger "$zip_path was removed from MinIO successfully"
        else
            logger "Failed to remove $zip_path from MinIO"
        fi
        exit 1
    fi
}

# Function to remove files
function remove_file() {
    local file=$1
    logger "Removing $file"
    if rm -f "$file"; then
        logger "$file was successfully removed"
    else
        logger "Removing $file was failed"
        exit 1
    fi
}

# Function to delete directories
function clean_up_directory() {
    local dir=$1
    logger "Cleaning up $dir"
    if rm -rf "$dir/*"; then
        logger "$dir was successfully cleaned up"
    else
        logger "Cleaning up $dir was failed"
        exit 1
    fi
}

# Function to execute SQL files
function execute_sql_file() {
    local sql_file_path=$1
    logger "Executing $sql_file_path..."
    psql_command=$(psql  -U $APPS_SCHEMA_IMPORT_USER -d  {{ .Values.global.baseConfigProperties.db.postgresql.database }} -h {{ include "db.host" . }} -p  {{ .Values.global.baseConfigProperties.db.postgresql.port }} -f "$sql_file_path")
    if [ $? -eq 0 ]; then
        local flag_file_name="$(basename "$sql_file_path")_success.flag"
        logger "Executed $sql_file_path successfully: \n$psql_command" | tee "$TMP_FLAG_DIR/$flag_file_name"
        if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
            logger "Flag file $flag_file_name copied to MinIO successfully"
        else
            logger "Failed to copy flag file $flag_file_name to MinIO"
            clean_up_directory "$TMP_DIR"
            exit 1
        fi
    else
        local flag_file_name="$(basename "$sql_file_path")_error.flag"
        logger "Failed to execute $sql_file_path: \n$psql_command" | tee "$TMP_FLAG_DIR/$flag_file_name"
        if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
            logger "Flag file $flag_file_name copied to MinIO successfully"
        else
            logger "Failed to copy flag file $flag_file_name to MinIO"
        fi
        clean_up_directory "$TMP_DIR"
        exit 1
    fi
}

function execute_batch_sql_file() {
    local sql_file_path=$1
    # Batch size (number of lines per batch)
    BATCH_SIZE="{{ .Values.appsSchemaImportJob.script.batches }}"
    batch=""
    batch_number=1
    line_count=0

    # Read the SQL file and process it in batches
    while IFS= read -r line || [ -n "$line" ]
    do
        # Skip BEGIN; and COMMIT; since we're handling them in the script
        if [[ "$line" == "BEGIN;" || "$line" == "COMMIT;" ]]; then
            continue
        fi

        # Append line to the current batch
        batch+="$line"$'\n'
        ((line_count++))
        full_batch="BEGIN;
$batch
COMMIT;"
        # Check if we reached the batch size
        if (( line_count % BATCH_SIZE == 0 )); then
            logger "Executing $sql_file_path batch $batch_number"
            psql_batch_command=$(psql  -U $APPS_SCHEMA_IMPORT_USER -d  {{ .Values.global.baseConfigProperties.db.postgresql.database }} -h {{ include "db.host" . }} -p  {{ .Values.global.baseConfigProperties.db.postgresql.port }} -c "$full_batch" )
            psql_batch_command_result=$?
            # Increment batch counter
            current_batch_number=$batch_number
            ((batch_number++))
            batch="" # Reset batch
            if [ "$psql_batch_command_result" -eq 0 ]; then
                local flag_file_name="$(basename "${sql_file_path}_${current_batch_number}")_success.flag"
                logger "Executed $sql_file_path for batch $current_batch_number successfully: \n$psql_batch_command" | tee "$TMP_FLAG_DIR/$flag_file_name"
                if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
                    logger "Flag file $flag_file_name copied to MinIO successfully"
                else
                    logger "Failed to copy flag file $flag_file_name to MinIO"
                    clean_up_directory "$TMP_DIR"
                    exit 1
                fi
            else
                local flag_file_name="$(basename "${sql_file_path}_${current_batch_number}")_error.flag"
                logger "Failed to execute $sql_file_path for batch $current_batch_number: \n$psql_batch_command" | tee "$TMP_FLAG_DIR/$flag_file_name"
                if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
                    logger "Flag file $flag_file_name copied to MinIO successfully"
                else
                    logger "Failed to copy flag file $flag_file_name to MinIO"
                fi
                clean_up_directory "$TMP_DIR"
                exit 1
            fi

        fi
    done < "$sql_file_path"

    # Apply any remaining SQL commands that didn't form a complete batch
    if [ -n "$batch" ]; then
        logger "Executing $sql_file_path final batch"
        psql_batch_final_command=$(psql  -U $APPS_SCHEMA_IMPORT_USER -d  {{ .Values.global.baseConfigProperties.db.postgresql.database }} -h {{ include "db.host" . }} -p  {{ .Values.global.baseConfigProperties.db.postgresql.port }} -c "$full_batch" )
        if [ $? -eq 0 ]; then
            local flag_file_name="$(basename "${sql_file_path}_final")_success.flag"
            logger "Executed $sql_file_path for final batch successfully: \n$psql_batch_final_command" | tee "$TMP_FLAG_DIR/$flag_file_name"
            if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
                logger "Flag file $flag_file_name copied to MinIO successfully"
            else
                logger "Failed to copy flag file $flag_file_name to MinIO"
                clean_up_directory "$TMP_DIR"
                exit 1
            fi
        else
            local flag_file_name="$(basename "${sql_file_path}_final")_error.flag"
            logger "Failed to execute $sql_file_path for final batch: \n$psql_batch_final_command" | tee "$TMP_FLAG_DIR/$flag_file_name"
            if mc cp "$TMP_FLAG_DIR/$flag_file_name" "$FEEDBACK_DIR/$flag_file_name"; then
                logger "Flag file $flag_file_name copied to MinIO successfully"
            else
                logger "Failed to copy flag file $flag_file_name to MinIO"
            fi
            clean_up_directory "$TMP_DIR"
            exit 1
        fi
    fi
}

function setup_minio_client() {
    logger "Setting up MinIO client..."
    mc alias set minio "$MINIO_URL" "$MINIO_USER" "$MINIO_PASSWORD"
    # Verify the alias was created successfully
    if mc alias list | grep -q "minio"; then
        logger "INFO: MinIO alias 'minio' created successfully"
    else
        logger "ERROR: Failed to create MinIO alias 'minio'"
        exit 1
    fi
}

function copy_zip_from_minio() {
    logger "Copying zip files from MinIO $SCHEMA_IMPORT_DIR/apps_schema_import.zip to $TMP_ZIP_FILE_DIR/apps_schema_import.zip"

    if mc stat $SCHEMA_IMPORT_DIR/apps_schema_import.zip > /dev/null 2>&1; then
        echo "$SCHEMA_IMPORT_DIR/apps_schema_import.zip found in MINIO"
        if mc cp "$SCHEMA_IMPORT_DIR/apps_schema_import.zip" "$TMP_ZIP_FILE_DIR/apps_schema_import.zip"; then
            logger "Zip files copied successfully from MinIO."
        else
            logger "Failed to copy zip files from MinIO."
            exit 1
        fi
    else
        logger "$SCHEMA_IMPORT_DIR/apps_schema_import.zip not found in MINIO"
        exit 0
    fi
}

# Main script logic
function main() {
    clean_up_directory "$TMP_DIR"
    setup_minio_client
    copy_zip_from_minio
    # Check for zip files in the SCHEMA_IMPORT_DIR
    zip_path="$TMP_ZIP_FILE_DIR/apps_schema_import.zip"
    if [ ! -z "$zip_path" ]; then

        # Extract the first zip file found
        extract_zip "$zip_path" "$TMP_SCHEMA_IMPORT_DIR"

        # Find and remove .sha files
        find $TMP_SCHEMA_IMPORT_DIR -maxdepth 1 -type f -name '*.sha' -exec rm -f {} \;

        # Execute SQL files in the specified order
        file_patterns=("DELETE_" "DROP_" "TABLE_" "INSERT_" "CONSTRAINTS_" "INDEXES_")

        for pattern in "${file_patterns[@]}"; do
            sql_files=("$TMP_SCHEMA_IMPORT_DIR"/"$pattern"*.sql)
            for sql_file in "${sql_files[@]}"; do
                if [ -f "$sql_file" ]; then
                    if [ "$(basename "$sql_file")" == "INSERT_CASES.sql" ]; then
                        execute_batch_sql_file "$sql_file"
                    else
                        execute_sql_file "$sql_file"
                    fi
                else
                    logger "$sql_file not found, skipping..."
                fi
            done
        done
        # clean_up_directory "$TMP_DIR"
    else
        logger "No zip archive found."
    fi

    # Remove temporary directory with sql files
    clean_up_directory "$TMP_DIR"
}

echo "Starting apps-schema-importer script..."
# Execute the main function
main
