#!/bin/bash
### See readme section below
MINIO_URL=${MINIO_URL:-empty}
MINIO_USER=${MINIO_USER:-netreveal}
MINIO_PASSWORD=${MINIO_PASSWORD:-pass}

export MC_CONFIG_DIR="/mc-config/.mc"

LOG_LEVEL=${LOG_LEVEL:-info}
ADD_QUERY_LIMIT=${ADD_QUERY_LIMIT:-"true"}
QUERY_LIMIT=${QUERY_LIMIT:-1000000}
PATH=$PATH:/usr/local/bin
HOME=/opt/netreveal/standaloneHome
#LOGFILE="$HOME/logs/dbExtract.log"

# Configuration Management - Retry Parameters
MAX_RETRIES=${MAX_RETRIES:-3}
BASE_RETRY_DELAY=${BASE_RETRY_DELAY:-60}
MAX_RETRY_DELAY=${MAX_RETRY_DELAY:-300}
RETRY_IN_PROGRESS=false

readonly PROGNAME=$(basename "$0")
readonly TRUE=1

ALL_ORGUNIT_LIST=()
ALLOWED_SCHEMA_NAMES=("apps" "apps_import")

# Error trap function for better error handling
error_exit() {
  local line_no=$1
  local error_code=$2
  if [ "$RETRY_IN_PROGRESS" = true ]; then
    logger "WARNING: SQL retry in progress while error_exit called"
    return
  fi

  logger "Script failed at line $line_no with exit code $error_code"

  exit $error_code
}

is_retryable_error() {
  local exit_code="$1"
  local error_output="$2"

  if echo "$error_output" | grep -qiE "(timeout|lock|resource|temporary|conflict with recovery|connection|could not connect|server closed|connection reset)"; then
    return 0  # Retryable
  fi

  if echo "$error_output" | grep -qiE "(syntax error|permission denied|authentication failed|role.*does not exist|database.*does not exist|relation.*does not exist)"; then
    return 1  # Not retryable
  fi

  return 1  # Default to non-retryable
}

function fn_setup_script() {
  fn_header_h3 "fn_setup_script"
  ##################################################################
  ## The actual program is at /usr/local/bin/downloadWatchlist
  ## The actual cron is at /etc/cron.d/dbExtract
  ## The PROGRAM_LOCATION here is used to point where the
  ##  INPUT - Text Files that contains lines of SQLS to run
  ##  SQL - Customer specific SQL files to run
  ##  OUTPUT - Folder where it stores the results
  PROGRAM_LOCATION="$HOME"
  logger "PROGRAM_LOCATION: $PROGRAM_LOCATION"
  SQL_LOCATION=$PROGRAM_LOCATION/sql
  logger "SQL_LOCATION: $SQL_LOCATION"
  INPUT_LOCATION=$PROGRAM_LOCATION/input
  logger "INPUT_LOCATION: $INPUT_LOCATION"
  OUTPUT_LOCATION=$PROGRAM_LOCATION/output
  logger "OUTPUT_LOCATION: $OUTPUT_LOCATION"
  ZIP_OUTPUT_LOCATION=$PROGRAM_LOCATION/zip_output
  logger "ZIP_OUTPUT_LOCATION: $ZIP_OUTPUT_LOCATION"
  DBENGINE="PostgreSQL"
  readonly INPUT_FILE_PREFIX="dbextract"
  readonly INPUT_FILE_EXT="txt"
  readonly SQL_FILE_EXT="sql"
  readonly SCRIPT_LOCATION=$PROGRAM_LOCATION/dbExtractScripts

  tmp_input_file_name="$2"
  FEEDBACK_DIRECTORY_PREFIX="minio/private-bucket/landing/acquisition"
  FEEDBACK_DIRECTORY_POSTFIX="feedback/reporting"
  if [ "$tmp_input_file_name" != "" ]; then
    if [ "$(dirname $tmp_input_file_name)" != "." ]; then
        FEEDBACK_DIRECTORY="$FEEDBACK_DIRECTORY_PREFIX$(dirname $tmp_input_file_name)/$FEEDBACK_DIRECTORY_POSTFIX"
    else
        FEEDBACK_DIRECTORY="$FEEDBACK_DIRECTORY_PREFIX/$FEEDBACK_DIRECTORY_POSTFIX"
    fi
  else
    FEEDBACK_DIRECTORY="$FEEDBACK_DIRECTORY_PREFIX/$FEEDBACK_DIRECTORY_POSTFIX"
  fi
  logger "FEEDBACK_DIRECTORY: $FEEDBACK_DIRECTORY"

  dbname={{ .Values.global.baseConfigProperties.db.postgresql.database }}
  {{- $dbConnectionType := default "ro" .Values.dbextract.script.dbConnectionType }}
  {{- if eq $dbConnectionType "ro" }}
  export dbendpoint="{{ include "db.host.r" . }}"
  {{- else }}
  export dbendpoint="{{ include "db.host" . }}"
  {{- end }}
  export PGPASSWORD_APPS="${PGPASSWORD_APPS}"
  export PGPASSWORD_APPS_IMPORT="${PGPASSWORD_APPS_IMPORT}"
  {{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") }}
  export PGSSLMODE="{{ .Values.global.baseConfigProperties.db.postgresql.sslmode }}"
  export PGSSLROOTCERT="{{ .Values.global.baseConfigProperties.db.postgresql.sslrootcert }}"
  {{- end }}

  ##################################################################

  ##################################################################


  # EXTRACT_FILE_PREFIX='nrodExtract_', defaults to none
  EXTRACT_FILE_PREFIX={{ default "" .Values.dbextract.script.extractFilePrefix }}

  # EXTRACT_FILE_EXTENSION='txt' | 'log'
  #  Examples= txt|csv, without the "."
  EXTRACT_FILE_EXTENSION={{ default "csv" .Values.dbextract.script.extractFileExtention }}

  logger "EXTRACT_FILE_PREFIX=$EXTRACT_FILE_PREFIX"
  logger "EXTRACT_FILE_EXTENSION=$EXTRACT_FILE_EXTENSION"

  mkdir -p $OUTPUT_LOCATION
  ###################################################################
}

function fn_exit() {
  echo "$1"
  #echo "$1" >&3 3>&- # echo reason to stdout (instead of log) and then close fd 3
  if [ $2 -ne 0 ]; then
    logger "Script dbExtract.sh encountered an error."
  fi

  RETRY_IN_PROGRESS=false


  exit $2
}


function override_if_null() {
  THIS_INPUT=$1
  THIS_OVERRIDE=$2

  if [ -z "$1" ]
  then
    #logger "Is null, overriding with '$THIS_OVERRIDE"
    THIS_INPUT=$THIS_OVERRIDE
  fi
  echo "$THIS_INPUT"
}

function logger() {
  local ts=$(date +%D\ %R:%S)
  echo "${ts}:${0##*/} - ${1}"
}

function fn_header_h1() {
  # Use this to make logs easier to digest
  blank_space
  logger "*************************************************************"
  logger "$1"
  logger "*************************************************************"
}

function fn_header_h2() {
  # Use this to make logs easier to digest
  blank_space
  logger "*******************************************"
  logger "$1"
  logger "*******************************************"
}

function fn_header_h3() {
  # Use this to make logs easier to digest
  blank_space
  logger "*********************************"
  logger "$1"
  logger "*********************************"
}

function fn_header_h4() {
  # Use this to make logs easier to digest
  blank_space
  logger "***********************"
  logger "$1"
  logger "************************"
}

function blank_space() {
  echo -e "\n"
}

function fn_clean_up() {
  fn_header_h3 "Start fn_clean_up"
  rm -f $OUTPUT_LOCATION/*.*
  rm -f $ZIP_OUTPUT_LOCATION/*.zip
}

function fn_clean_up_for_db_export() {
  rm -rf $INPUT_LOCATION/*
  rm -rf $OUTPUT_LOCATION/*
  rm -rf $SQL_LOCATION/*
  rm -f $ZIP_OUTPUT_LOCATION/*.zip
}

# Function to check if a schema exists on allowed list
fn_is_schema_allowed() {
  local value="$1"
  if [ -z "$value" ]; then
    return 0  # empty is allowed
  fi
  for item in "${ALLOWED_SCHEMA_NAMES[@]}"; do
    if [[ "$item" == "$value" ]]; then
      return 0
    fi
  done
  return 1
}

function fn_set_database_password() {
  # Set the PGPASSWORD environment variable. If parameter 1 (schemaName) is set password is taken from $PGAPASSWORD_$schemaName environment variable. If schemaName is not set default PGPASSWORD_{{ .Values.global.baseConfigProperties.db.postgresql.userid }} user is used.
  local schemaName=$1
  PGPASSWORD_VAR="PGPASSWORD_${schemaName:-{{ .Values.global.baseConfigProperties.db.postgresql.userid }}}"
  PGPASSWORD_VAR=${PGPASSWORD_VAR^^}
  PGPASSWORD="${!PGPASSWORD_VAR}"
  export PGPASSWORD
}

function execute_sql_with_retry() {
  local sql_file="$1"
  local export_file="$2"
  local db_user="$3"
  local start_date="$4"
  local end_date="$5"
  local frequency="$6"
  local orgunit="$7"
  local psql_flags="$8"
  local attempt=1
  local retry_delay=$BASE_RETRY_DELAY

  while [ $attempt -le $MAX_RETRIES ]; do
    logger "Attempt $attempt of $MAX_RETRIES for $sql_file"

    RETRY_IN_PROGRESS=true

    local output
    local psql_exit_code

    output=$(psql -U "$db_user" -h ${dbendpoint} -p 5432 -d ${dbname} -f "$sql_file"  $psql_flags -v FROMDATE="'$start_date'" -v TODATE="'$end_date'" -v ON_ERROR_STOP=on -v frequency="$frequency" -v orgunit="$orgunit" -o "$export_file" 2>&1)
    psql_exit_code=$?
    RETRY_IN_PROGRESS=false
    if [ $psql_exit_code -eq 0 ]; then
      logger "SQL execution successful on attempt $attempt"
      return 0
    fi

    logger "SQL execution failed with exit code $psql_exit_code"
    logger "psql output: $output"

    if is_retryable_error "$psql_exit_code" "$output"; then
      if [ $attempt -lt $MAX_RETRIES ]; then
        logger "Retryable error detected, retrying in $retry_delay seconds..."
        sleep $retry_delay
        # Exponential backoff with maximum cap
        retry_delay=$((retry_delay * 2))
        if [ $retry_delay -gt $MAX_RETRY_DELAY ]; then
            retry_delay=$MAX_RETRY_DELAY
        fi
      fi
    else
      logger "Non-recoverable error detected with exit code $psql_exit_code and output $output"
      return $psql_exit_code
    fi

    ((attempt++))
  done

  logger "All retry attempts failed for $sql_file"
  return 1
}

function fn_verify_automated_export_table(){
  local dbUser="{{ .Values.global.baseConfigProperties.db.postgresql.userid }}"

  fn_header_h3 "Start fn_verify_automated_export_table"
  fn_set_database_password
  if ! execute_sql_with_retry "$SCRIPT_LOCATION/automated_exports_tableVerify.sql" "$INPUT_LOCATION/_tableExists.txt" "$dbUser" "" "" "$frequency" "" "-q  -t -A"; then
    logger "Script dbExtract.sh encountered an error."
    logger "SQL script automated_exports_tableVerify.sql failed after all retry attempts"
    fn_exit "SQL execution failed for automated_exports_tableVerify.sql" 1
  fi
  local tableExists=$(cat "$INPUT_LOCATION/_tableExists.txt")
  #local tableExists=$(psql -q -U {{ .Values.global.baseConfigProperties.db.postgresql.userid }} -h ${dbendpoint} -p 5432 -d {{ .Values.global.baseConfigProperties.db.postgresql.database }} -f "$SCRIPT_LOCATION/automated_exports_tableVerify.sql" -v frequency=$frequency -t -A)
  if [ "$tableExists" != "1" ]; then
    fn_header_h3 "WARN: missing automated_exports table."
    export AUTOMATED_EXPORTS_TABLE_PRESENT="false"
  fi
  fn_header_h3 "End fn_verify_automated_export_table"
}
function fn_zip_file() {
  ZIP_FILE_NAME=$1;
  local orgunit=$2;

  fn_header_h3 "Starting fn_zip_file"
  # Name must be .zip
  THIS_FILE_NAME="${ZIP_FILE_NAME}_$(date +'%Y%m%d_%H%M%S').zip"
  #NRDVO-1770: custom logic for only generali project
  if [[ $CUSTOMER_NAME = 'gen' ]]; then
    if [[ "$GEN_CREATE_ALERTS_EXTRACTION_DIR" == "true" && "$ZIP_FILE_NAME" == "NETREVEAL_ALERTES" ]]; then
      THIS_FILE_NAME="${ZIP_FILE_NAME}_$(date +'%Y%m%d').zip"
    fi
  fi

  for f in $(find ${OUTPUT_LOCATION} -iname '*.csv' -o -iname '*.ctl')
  do
    logger "Working on f : $f"
    baseFile=${f%.*}
    baseFileNoPath=$(basename $baseFile)
    baseFileExtension=${f##*.}

    # Update each export file to add the prefix and file extension
    #   Check the early sections as the default is no prefix and uses the csv extension
    newFileName="${EXTRACT_FILE_PREFIX}${baseFileNoPath}"
    newFileNameWithExtension=${newFileName}.${EXTRACT_FILE_EXTENSION}
    logger "New File Name: $newFileName"
    logger "newFileNameWithExtension: $newFileNameWithExtension"

    if [[ $baseFileExtension == 'csv' ]]; then
      logger "This is a *.csv, will add in EXTRACT_FILE_PREFIX($EXTRACT_FILE_PREFIX), EXTRACT_FILE_EXTENSION($EXTRACT_FILE_EXTENSION)"
      if [[ "$f" != "$OUTPUT_LOCATION/$newFileNameWithExtension" ]]; then
        mv -f "$f" "$OUTPUT_LOCATION/$newFileNameWithExtension"
      fi

      # # Create checksum file for each output
      # sha256sum "${OUTPUT_LOCATION}/$newFileNameWithExtension" | awk -v newFileNameWithExtension="$newFileNameWithExtension" 'BEGIN {OFS="  "} {print $1, newFileNameWithExtension}' > "${OUTPUT_LOCATION}/$newFileName.sha256"

    else
      logger "This is not a *.csv, will just add in the new file extension"
      if [[ "$f" != "$OUTPUT_LOCATION/$newFileName.$baseFileExtension" ]]; then
        mv -f "$f" "$OUTPUT_LOCATION/$newFileName.$baseFileExtension"
      fi
    fi

  done

  mkdir -p $ZIP_OUTPUT_LOCATION
  # Basically take everything from the OUTPUT_LOCATION
  zip -j9 "$ZIP_OUTPUT_LOCATION/$THIS_FILE_NAME" $OUTPUT_LOCATION/*.csv $OUTPUT_LOCATION/*.$EXTRACT_FILE_EXTENSION $OUTPUT_LOCATION/*.*

  logger "Zip file created: $ZIP_OUTPUT_LOCATION/$THIS_FILE_NAME"
  logger "Files present in the zip output location:"
  ls -l $ZIP_OUTPUT_LOCATION

  # Avoid sending datafiles of 0 size if SEND_EMPTY_FILES is set to false
  # It should be noted that if the extract SQL completed successfully a header will have been produced and the file will not be of zero size. We only expect a 0 sized file if the SQL errors
  # NRDVOX-512: If SEND_EMPTY_FILES is set to false, it will also now not send files if they have exactly one word.

  SEND_EMPTY_FILES={{ .Values.dbextract.script.sendEmptyFiles }}
  logger "SEND_EMPTY_FILES:$SEND_EMPTY_FILES"

  if [[ "$SEND_EMPTY_FILES" == "false" ]] && { [[ -n $(find "$OUTPUT_LOCATION" -maxdepth 1 -name "*.csv" -empty) ]] || [[ -n $(find "$OUTPUT_LOCATION" -maxdepth 1 -name "*.$EXTRACT_FILE_EXTENSION" -empty) ]] || [[ $(find "$OUTPUT_LOCATION" -maxdepth 1 -name "*.$EXTRACT_FILE_EXTENSION" -exec cat {} + | xargs echo -n | wc -m) = 5 ]] || [[ $(find "$OUTPUT_LOCATION" -maxdepth 1 -name "*.csv" -exec cat {} + | xargs echo -n | wc -m) = 5 ]]; }; then
    logger "Not transferring the zip file $THIS_FILE_NAME to the DXV as the contained datafile is 0 bytes in size"
  else
    fn_push_a_file_to_s3 "$ZIP_OUTPUT_LOCATION" "$THIS_FILE_NAME" "$orgunit"
  fi
}

function fn_create_companion_file() {
  logger "start fn_create_companion_file"

  # outputFile path is needed if we want to
  # 1. count the rows for the output csv
  # 2. calculate the checksum
  # 3. others...
  outputFileName=$1

  # Extract Start Date and Start Time
  thisStartDate=$2
  thisEndDate=$3

  thisExtractDateInEpoch=$4
  thisCompanionFileType=$5


  if [[ $CUSTOMER_NAME = 'boq' ]]; then
    # Reminder that at this point the output file is still .csv
    thisExtractFilePath=$OUTPUT_LOCATION/$outputFileName'_'$thisEndDate.csv
    thisFileName=$OUTPUT_LOCATION/$outputFileName'_'$thisEndDate.ctl

    touch "$thisFileName"

    # Create contents of the file
    # For BOQ they need a one csv row with...
    thisExtractDateAndtime=$(date -d "@$thisExtractDateInEpoch" +"%Y-%m-%d %H:%M:%S")

    # Number of records
    thisRowCount=$(wc -l "$thisExtractFilePath" | cut -d ' ' -f1);
    # Minus -1 aka the header
    ((thisRowCount--))

    # Checksum value (BOQ is asking for MD5 checksum)
    thisChecksumValue=$(md5sum "$thisExtractFilePath" | cut -d ' ' -f1)

    thisBusinessDate=$thisEndDate

    logger "thisExtractDateAndtime($thisExtractDateAndtime),thisRowCount($thisRowCount),thisChecksumValue($thisChecksumValue),thisBusinessDate($thisBusinessDate)"
    outputString="$thisExtractDateAndtime,$thisRowCount,$thisChecksumValue,$thisBusinessDate"
    echo "$outputString" > "$thisFileName"
  fi
  logger "end fn_create_companion_file"

  # The zip function will do the renaming with the final file name
}

function fn_connect_to_minio() {
  echo "Wait for MINIO to be ready..."
  timeout 300 bash -c '
    until mc --quiet alias set minio ${MINIO_URL} "${MINIO_USER}" "${MINIO_PASSWORD}" > /dev/null 2>&1
    do
      echo "Trying to connect to ${MINIO_URL} server..."
      sleep 10
    done
  '
  # Verify the alias was created successfully
  if mc alias list | grep -q "minio"; then
    logger "INFO: MinIO alias 'minio' created successfully"
  else
    logger "ERROR: Failed to create MinIO alias 'minio'"
    fn_exit "Failed to create MinIO alias 'minio'" 1
  fi
}

function fn_push_a_file_to_s3() {
  fn_header_h4 "Start fn_push_a_file_to_s3"

  # Relative from root
  #Example - $PROGRAM_LOCATION/ $PROGRAM_LOCATION/output
  THIS_FILE_DIRECTORY=$1

  # Example - TestFile.zip
  THIS_FILE_NAME=$2
  THIS_FILE_PATH=$THIS_FILE_DIRECTORY/$THIS_FILE_NAME

  # logger "THIS_FILE_DIRECTORY:$THIS_FILE_DIRECTORY"
  # logger "THIS_FILE_NAME:$THIS_FILE_NAME"
  # logger "THIS_FILE_PATH:$THIS_FILE_PATH"

  #orgunit for db table based exports
  local orgunit=$3
  if [ -n "$orgunit" ]; then
    FEEDBACK_DIRECTORY=$FEEDBACK_DIRECTORY_PREFIX$orgunit/$FEEDBACK_DIRECTORY_POSTFIX
  fi


  export_file=$( find $THIS_FILE_DIRECTORY -iname "$THIS_FILE_NAME" | wc -l)
  if [[ $export_file == 1 ]]
    then
      fn_connect_to_minio
      mc mv $THIS_FILE_PATH $FEEDBACK_DIRECTORY/$THIS_FILE_NAME
      cmd_status=$?
      if [[ $cmd_status -eq 0 ]]
        then
          logger "Copied $THIS_FILE_PATH successfully to $FEEDBACK_DIRECTORY/$THIS_FILE_NAME"
      else
        logger "Script dbExtract.sh encountered an error."
        logger "Error copying files from the Extract directory to S3 Feedback folder, files not deleted. cp command returned $cmd_status for file $THIS_FILE_PATH and feedback directory $FEEDBACK_DIRECTORY"
      fi
  else
    logger "Script dbExtract.sh encountered an error."
    logger "$THIS_FILE_NAME, file not found in directory $THIS_FILE_DIRECTORY"
  fi

  fn_header_h4 "End fn_push_a_file_to_s3"
}

function fn_add_query_limit() {
  fn_header_h4 "Start fn_add_query_limit"
  logger "Number of arguments : $#"
  logger "Argument 1: $1"
  logger "Add Query Limit: $ADD_QUERY_LIMIT"
  logger "Query Limit: $QUERY_LIMIT"
  logger "LogLevel: $LOG_LEVEL"

  local sqlFile=$1

  if [ $ADD_QUERY_LIMIT == "true" ]; then
    logger "Adding query limit to $sqlFile"
    if [ $LOG_LEVEL == "debug" ]; then
      logger "Original SQL file:"
      cat $sqlFile
    fi
    sed -i '0,/^[[:space:]]*select/I {/^[[:space:]]*--/!s/^[[:space:]]*select/select * from (select/I}' $sqlFile
    sed -i -r "/^[[:space:]]*--/!s/;/) dbexp limit ${QUERY_LIMIT};/" $sqlFile
    if [ $LOG_LEVEL == "debug" ]; then
      logger "Modified SQL file:"
      cat $sqlFile
    fi
  else
    logger "Query limit is off, skipping"
  fi
}

function fn_run_an_input_file_postgres() {
  fn_header_h3 "Start fn_run_an_input_file_postgres"
  logger "Number of arguments : $#"
  logger "Argument 1: $1"
  logger "Argument 2: $2"
  logger "Argument 3: $3"
  logger "Argument 4: $4"
  logger "Argument 5: $5"

  FILE_NAME=$1
  START_DATE=$2
  END_DATE=$3
  local dbUser="{{ .Values.global.baseConfigProperties.db.postgresql.userid }}"

  logger "FILE_NAME: $FILE_NAME"
  FILE_PATH=$INPUT_LOCATION/$FILE_NAME

  # check for file
  if [ -f "$FILE_PATH" ]; then
    logger "$FILE_PATH exists."
  else
    logger "$FILE_PATH does not exist, this extract will not be run."
    fn_exit "Early Exit - Cannot find the file: $FILE_PATH" 7
  fi

  [[ $(tail -c1 $FILE_PATH) && -f $FILE_PATH ]]&&echo ''>>"$FILE_PATH"

  Counter=1;
  # NRDVO-1048 - creates an additional companion file for each extract, these are optional values
  # createCompanionFile = TRUE(1) or FALSE(0)
  # companionFileType = If a client has multiple requirements, use this to differentiate
  logger "SQL_FILE: ${SQL_FILE}"
  logger "EXPORT_FILE_NAME: ${EXPORT_FILE_NAME}"
  logger "createCompanionFile: ${createCompanionFile}"
  logger "companionFileType: ${companionFileType}"
  while IFS=" " read -r SQL_FILE EXPORT_FILE_NAME createCompanionFile companionFileType;
  do
    fn_header_h4 "Processing #$Counter: $SQL_FILE";
    if [[ "$SQL_FILE" != *"|"* ]]; then
      #adding | at the end of SQL_FILE to make sure it is processed correctly
      SQL_FILE="${SQL_FILE}|"
    fi
    schemaName=$(echo "${SQL_FILE#*|}" | xargs)
    SQL_FILE=$(echo "${SQL_FILE%%|*}" | xargs)
    logger "SQL_FILE after schema conversion: '$SQL_FILE'";
    logger "schemaName: '$schemaName'";
    # Check if schemaName is allowed or empty
    if ! fn_is_schema_allowed "$schemaName"; then
      fn_exit "ERROR: Unsupported schemaName '$schemaName' is set... Check documentation for supported schemas" 5
    fi

    if [[ "$SQL_FILE" == *.sql ]]; then
      SQL_FILE_PATH="$SQL_LOCATION/$SQL_FILE"
    else
      SQL_FILE_PATH="$SQL_LOCATION/$SQL_FILE.sql"
    fi

    if [ ! -f "$SQL_FILE_PATH" ]; then
      logger "Script dbExtract.sh encountered an error."
      logger "WARN: Cannot find $SQL_FILE_PATH, skipping export"
      ((Counter++))
      continue;
    fi

    if [ -z "$EXPORT_FILE_NAME" ]; then
      logger "WARN: Extra extract file name is not provided, using the SQL File name";
      EXPORT_FILE_NAME=$SQL_FILE;
    fi
    EXPORT_FILE_PATH=$OUTPUT_LOCATION/$EXPORT_FILE_NAME'_'$END_DATE.csv;

    logger "EXPORT_FILE_PATH: $EXPORT_FILE_PATH";

    TMP_EXPORT_FILE_PATH=$(dirname "$EXPORT_FILE_PATH");
    mkdir -p $TMP_EXPORT_FILE_PATH;

    # NRDVO-1048 Setting the extractDate in epoch.., in which the formatting can be customized for each client at a sub function
    extractDateInEpoch=$(date +%s)

    #Fail safe
    #usePostgresV1Extract=$TRUE

    # Postgres SQL versions
    # Only v2 version can be used,
    #   - v2 AKA NRDVOX-570 and its variations
    #   - Optional version that allows PS team to craft more complex queries to meet the project needs.
    #   - A 'simple' option to run postgres queries. This is modeled after the current Oracle query where there is only one extract command.
    #   - Parameters
    #   - FROMDATE - Use this instead of v1
    #   - TODATE - Use this instead of v2
    #   - EXPORT_DELIMITER - not used, can be defined directly in client specific SQL.

    fn_add_query_limit "$SQL_FILE_PATH";

    logger "Export Started for $SQL_FILE_PATH";



    #if [[ $usePostgresV1Extract -eq $FALSE ]]; then
    logger "Running v2 (simple) postgres export"

    # Set dbUser and password
    if [ -z "$schemaName" ] || [ "$schemaName" == "{{ .Values.global.baseConfigProperties.db.postgresql.userid }}" ]; then
      # set default user if no other specified or matches default value
      dbUser="{{ .Values.global.baseConfigProperties.db.postgresql.userid }}"
    else
      dbUser=${schemaName}
    fi

    logger "Connecting as user '$dbUser' for schema '$schemaName'"

    logger "Query to be run:"
    cat "$SQL_LOCATION/$SQL_FILE.sql"

    fn_set_database_password "$dbUser"

    if ! execute_sql_with_retry "$SQL_FILE_PATH" "$EXPORT_FILE_PATH" "$dbUser" "$START_DATE" "$END_DATE"; then
      logger "Script dbExtract.sh encountered an error."
      logger "SQL script $SQL_FILE_PATH failed after all retry attempts"
      logger "{\"sql_file\":\"$SQL_FILE_PATH\",\"export_file\":\"$EXPORT_FILE_PATH\",\"user\":\"$dbUser\",\"start_date\":\"$START_DATE\",\"end_date\":\"$END_DATE\"}"
      fn_exit "SQL execution failed for $SQL_FILE_PATH" 1
    fi

    if [ ! -f "$EXPORT_FILE_PATH" ]; then
      logger "Output file $EXPORT_FILE_PATH was not created"
      logger "{\"sql_file\":\"$SQL_FILE_PATH\",\"export_file\":\"$EXPORT_FILE_PATH\",\"user\":\"$dbUser\"}"
      fn_exit "Output file not created: $EXPORT_FILE_PATH" 1
    fi

    local file_size=$(stat -c%s "$EXPORT_FILE_PATH" 2>/dev/null || echo "0")
    local line_count=$(wc -l < "$EXPORT_FILE_PATH" 2>/dev/null || echo "0")

    logger "SQL execution completed successfully"
    logger "{\"sql_file\":\"$SQL_FILE_PATH\",\"export_file\":\"$EXPORT_FILE_PATH\",\"file_size\":$file_size,\"line_count\":$line_count,\"user\":\"$dbUser\",\"start_date\":\"$START_DATE\",\"end_date\":\"$END_DATE\"}"

    logger "Export Ended for $SQL_FILE_PATH";
    if [[ $createCompanionFile -eq $TRUE ]];
      then
        logger "createCompanionFile($createCompanionFile) equals TRUE($TRUE), running custom function"
        fn_create_companion_file "$EXPORT_FILE_NAME" "$START_DATE" "$END_DATE" "$extractDateInEpoch" "$companionFileType"
    fi

    ((Counter++))
  done < "$FILE_PATH"

  fn_header_h3 "End fn_run_an_input_file_postgres"
}

function fn_get_orgunits_from_db_table() {
  fn_header_h3 "Start fn_get_orgunits_from_db_table"

  local frequency=$1
  local dbUser="{{ .Values.global.baseConfigProperties.db.postgresql.userid }}"

  logger "frequency: $frequency"
  fn_set_database_password
  if ! execute_sql_with_retry "$SCRIPT_LOCATION/automated_exports_orgunitList.sql" "$INPUT_LOCATION/_orgunitList.txt" "$dbUser" "" "" "$frequency" "" "-q  -t -A"; then
    logger "Script dbExtract.sh encountered an error."
    logger "SQL script automated_exports_orgunitList.sql failed after all retry attempts"
    fn_exit "SQL execution failed for automated_exports_orgunitList.sql" 1
  fi
  local orgunitList=$(cat "$INPUT_LOCATION/_orgunitList.txt")
  # Iterate over each orgunit in the orgunitList
  local orgunitVal=""
  local IFS='#' # Set Internal Field Separator to #
  for orgunitVal in $orgunitList; do
    #add orgunit to global list to run fn_run_an_input_file_postgres on it later.
    if [ "$orgunitVal" = "empty" ]; then
      orgunitVal=''
    fi
    ALL_ORGUNIT_LIST+=("$orgunitVal")
  done
  fn_header_h3 "End fn_get_orgunits_from_db_table"
}


function fn_prepare_input_files_from_db_table() {
  fn_header_h3 "Start fn_prepare_input_files_from_db_table"

  local orgunit=$1
  local frequency=$2
  logger "orgunit: $orgunit"
  logger "frequency: $frequency"
  if [ -n "$orgunit" ]; then
    mkdir -p "$INPUT_LOCATION/$orgunit"
  fi
  touch "$INPUT_LOCATION/$orgunit${orgunit:+/}$INPUT_FILE_PREFIX-$frequency${INPUT_FILE_EXT:+.}$INPUT_FILE_EXT"
  fn_header_h3 "End fn_prepare_input_files_from_db_table"
}


function fn_prepare_input_file() {
  # Function to prepare direcotry structure with sql and input files from db table automated_exports
  local fileNamePrefix=$1
  local orgunit=$2
  local preScript=$3
  local selectScript=$4
  local postScript=$5
  local frequency=$6
  local schemaName=$7
  local inputFullPath="$INPUT_LOCATION/$orgunit${orgunit:+/}$INPUT_FILE_PREFIX-$frequency${INPUT_FILE_EXT:+.}$INPUT_FILE_EXT"
  local sqlFullPath="$SQL_LOCATION/$orgunit${orgunit:+/}$fileNamePrefix${SQL_FILE_EXT:+.}$SQL_FILE_EXT"

  logger "Adding content to input file... $inputFullPath"
  mkdir -p $(dirname $inputFullPath)
  echo -e "${orgunit}${orgunit:+/}${fileNamePrefix}|$schemaName" >> "$inputFullPath"
  logger "Wrote input file row: ${orgunit}${orgunit:+/}${fileNamePrefix}|$schemaName"
  logger "Preparing sql file... $sqlFullPath"
  mkdir -p $(dirname $sqlFullPath)

  # Prepare the SQL file
  # Add preScript and selectScript
  echo -e "${preScript}" >> "$sqlFullPath"
  echo -e "${selectScript};" >> "$sqlFullPath"

  logger "START SQL file: $sqlFullPath"
  while IFS= read -r line; do
    logger "$line"
  done < "$sqlFullPath"
  logger "END SQL file: $sqlFullPath"
}

function fn_run_master_from_db_table() {
  fn_header_h2 "Start fn_run_master_from_db_table"
  # Function to run the master script from the database table automated_exports
  local START_DATE=$1
  local END_DATE=$2
  local ZIP_FILE_NAME=$3
  local orgunit=$4
  local frequency=$5
  local dbUser="{{ .Values.global.baseConfigProperties.db.postgresql.userid }}"

  logger "Get list entries from 'Automated_export' table"
  logger "START_DATE: $2"
  logger "END_DATE: $3"
  logger "orgunit: $orgunit"
  logger "frequency: $frequency"



  fn_set_database_password
  if ! execute_sql_with_retry "$SCRIPT_LOCATION/automated_exports_exportList.sql" "$INPUT_LOCATION/_automatedExportList.txt" "$dbUser" "" "" "$frequency" "$orgunit" "-q  -t -A"; then
    logger "Script dbExtract.sh encountered an error."
    logger "SQL script automated_exports_exportList.sql failed after all retry attempts"
    fn_exit "SQL execution failed for automated_exports_exportList" 1
  fi
  local exportList=$(cat "$INPUT_LOCATION/_automatedExportList.txt")
  # Iterate over each export in the exportList
  local IFS='#' # Set Internal Field Separator to #
  for export in $exportList; do
    # Split the export by |
    IFS='|' read -d '' -r -a fields <<< "$export"
    # Check if the export has the required number of fields
    if [ ${#fields[@]} -lt 6 ]; then
      logger "Error: Export does not have enough fields. Expected at least 6, got ${#fields[@]}"
      continue
    fi
    #fill input file and create sql files with queries
    fn_prepare_input_file "${fields[0]}" "${fields[1]}" "${fields[2]}" "${fields[3]}" "${fields[4]}" "$frequency" "${fields[5]}"
  done
  #execute input file for specified orgunit
  fn_run_an_input_file_postgres "$orgunit${orgunit:+/}$INPUT_FILE_PREFIX-$frequency${INPUT_FILE_EXT:+.}$INPUT_FILE_EXT" $START_DATE $END_DATE $ZIP_FILE_NAME

  fn_header_h2 "End fn_run_master_from_db_table"
}

function fn_run_master() {
  logger "USER_FILE: $1"
  logger "START_DATE: $2"
  logger "END_DATE: $3"
  logger "ZIP_FILE_NAME: $4"
  logger "frequency: $5"

  ZIP_FILE_NAME=$4;
  local frequency=$5


  fn_header_h1 "Start fn_run_master"
  fn_clean_up

  if [  -z "$1" ]; then
    #run exports based on automated_exports table
    logger "Empty USER_FILE so exporting from automated_exports db table"
    export AUTOMATED_EXPORTS_TABLE_PRESENT="true"
    fn_verify_automated_export_table
    #get orgunitlist form db table and store in ALL_ORGUNIT_LIST
    if [ "${AUTOMATED_EXPORTS_TABLE_PRESENT}" == "true" ]; then
      fn_get_orgunits_from_db_table $frequency
      local orgunit=""
      for orgunit in "${ALL_ORGUNIT_LIST[@]}"; do
        logger "Exporting orgunit: $orgunit"
        fn_clean_up_for_db_export
        fn_prepare_input_files_from_db_table "$orgunit" $frequency
        fn_run_master_from_db_table $2 $3 $4 "$orgunit" $frequency
        fn_zip_file $ZIP_FILE_NAME "$orgunit"
      done
    fi
   else
    #run exports based on USER_FILE
  logger "Engine is postgres, running postgres extract function"
  fn_run_an_input_file_postgres $1 $2 $3 $4 $5

  fn_zip_file $ZIP_FILE_NAME
  fi


  fn_header_h1 "End fn_run_master"
}

function fn_create_dummy_files() {
  mkdir -p $SQL_LOCATION $INPUT_LOCATION $OUTPUT_LOCATION $ZIP_OUTPUT_LOCATION

  touch $INPUT_LOCATION/hourExtract.txt $INPUT_LOCATION/dayExtract.txt $INPUT_LOCATION/weekExtract.txt $INPUT_LOCATION/monthExtract.txt
  echo 'test_sql_file_name' > $INPUT_LOCATION/file_example.txt
  echo 'valid_sql_file_name_2 sql_extract_file_name_2 1 extractA' >> $INPUT_LOCATION/file_example.txt

}

function fn_decision_tree() {
  fn_header_h1 "fn_decision_tree: START"
  logger "Number of arguments : $#"
  logger "Argument 1: $1 - Type ? (Mandatory) hour|day|week|month|createDummyFiles"
  logger "Argument 2: $2 - Your file name with rows of SQL Files? If empty automated_exports db table will be used"
  logger "Argument 4: $3 - Provide filename to zip into 1 file (Optional)"
  logger "Argument 5: $4 - Start date in YYYYMMDD"
  logger "Argument 6: $5 - End Date in YYYYMMDD"

  THIS_FILE_NAME=$2;
  ZIP_FILE_NAME="${3}_${1}";

  if [ -z "$1" ] ; then
    fn_exit "Error: Missing mandatory parameter" 5
  fi

  if [ $# -ge 1 ]; then
    case $1 in
      hour)
        logger "INFO: Running 'hour' extract from beginning of previous hour to beginning of current"
        # Means yesterday
        START_DATE=$(date -d '- 1 hour' +'%Y%m%d%H')
        END_DATE=$(date +'%Y%m%d%H')
        fn_run_master "$THIS_FILE_NAME" $START_DATE $END_DATE $ZIP_FILE_NAME "hourly"
      ;;
      day)
        logger "INFO: Running 'day' yesterday extract"
        # Means yesterday
        START_DATE=$(date -d '- 1 day' +'%Y%m%d')
        END_DATE=$(date -d '- 1 day' +'%Y%m%d')
        fn_run_master "$THIS_FILE_NAME" $START_DATE $END_DATE $ZIP_FILE_NAME "daily"
      ;;
      week)
        # Yesterday - 8 days
        logger "INFO: Running 'week' extract"
        START_DATE=$(date -d '- 8 day' +'%Y%m%d')
        END_DATE=$(date -d '- 1 day' +'%Y%m%d')
        fn_run_master "$THIS_FILE_NAME" $START_DATE $END_DATE $ZIP_FILE_NAME "weekly"
      ;;
      month)
        # This should be scheduled on the first of the next month, and it will extract the previous month (which can be 28/30/31 days)
        logger "INFO: Running 'month' extract"
        START_DATE=$(date -d '- 1 month' +'%Y%m%d')
        END_DATE=$(date -d '- 1 day' +'%Y%m%d')
        fn_run_master "$THIS_FILE_NAME" $START_DATE $END_DATE $ZIP_FILE_NAME "monthly"
      ;;
      year)
        # This can crash RDS/EC2 if the data slice is too big :)
        logger "INFO: Running 'year' extract"
        START_DATE=$(date -d '- 1 year' +'%Y%m%d')
        END_DATE=$(date +'%Y%m%d')
        fn_run_master "$THIS_FILE_NAME" $START_DATE $END_DATE $ZIP_FILE_NAME "yearly"
      ;;
      custom)
        # This can crash RDS/EC2 if the data slice is too big :)
        logger "INFO: Running custom extract"
        START_DATE=$5
        END_DATE=$6
        fn_run_master $THIS_FILE_NAME $START_DATE $END_DATE $ZIP_FILE_NAME
      ;;
      createDummyFiles)
        logger "INFO: Running createDummyFiles function"
        fn_create_dummy_files
      ;;
      *)
        # unknown option
        fn_exit "ERROR: Unknown/Unsupported Function option selected. Valid options are day|week|month... open the dbExtract.sh for more details" 5
      ;;
    esac
  #else
    #logger "No action"
  fi

  fn_header_h1 "fn_decision_tree: END"
}


fn_setup_script "$@"
fn_decision_tree "$@"


function read_me() {
  logger "Read me"
  ################################
  ##### Variables
  ################################
    # Variable 1 - Type  (Mandatory)
    #   This will set the START_DATE and END_DATE automatically, unless you choose custom
    #   Options:
    #     day
    #     week
    #     month
    #     year
    #     custom

    # Variable 2 - Filename (Mandatory)
    #   A file should be place in the root directory
    #   This should be a normal LF text file
    #   From each line, it will try to find the corresponding sql file in the $PROGRAM_LOCATION/sql directory

    #   Can try running "sh dbExtract.sh createDummyFiles 0 && sh dbExtract.sh day file_example.txt"
    #   Example file name:
    #     file_example.txt

    #   Example row:
    #     valid_sql_file_name sql_extract_another_name
    #   In this Example, it will try to find $PROGRAM_LOCATION/sql/valid_sql_file_name.sql, and the dump file name will have sql_extract_another_name, see code for more details

    # Variable 3 - Send to DXV? (Optional)
    #   Most of the time, internal users might not want to send the exports to the client via the DXV.
    #   Options:
    #     yes
    #     no
    #
    #   If this is a 'yes', it will send whatever is in output folder straight to the client, by copying the file into the DMZ instances' feedback folder and creates a flag file.


    # Variable 4 -Output  Filename for ZIP? (Optional)
    #   If you provide a name, instead of sending individual extracts, it sends a single zip file through to the DXV
    # Eg if it is set to 'specialClient', it will create XXXPREFIX-specialClient-TODAYSYYYYMMDD.zip
    # Note that a normal sql output has the extract day/week/month end date like $EXPORT_FILE_NAME'_'$END_DATE.csv

    # Variable 5 - Start Date for custom (Optional)
    # Variable 6 - End Date  for custom (Optional)
    #   If you pick the 'custom' option, fill in these options as well as the X to Y date filter

    ################################

    ####
    ### Examples
    ##
    #
    # sh dbExtract.sh day boqFile.txt yes testCalvin
      # This will run a day extract with boqFile.txt, it will send a zip file to the dxv

    # sh dbExtract.sh week boqFile.txt
      # This will run a week extract with boqFile.txt, should remain on the batch instance

    #sh dbExtract.sh custom boqFile.txt '' '' 20210601 20210620
      # Ths will run a custom extract with boqFile.txt, from 20210601 to 20210620
    #sh dbExtract.sh custom boqFile.txt 'yes' 'calvintest' 20210601 20210601
      # Same as above but will send to dxv


    ##############
    # Example SQL File below
    # ----------------------------
    # -- Your notes
    # ----------------------------
    # -- SET WRAP OFF
    # SET TERMOUT OFF
    # -- NOT GOING TO DISPLAY THE 'X ROWS SELECTED'
    # SET FEEDBACK OFF
    # SET AUTOPRINT OFF
    # -- DISPLAY HEADER
    # SET HEADING ON
    # SET VERIFY OFF
    # WHENEVER SQLERROR EXIT 1
    # WHENEVER OSERROR EXIT 1
    # SET SPOOL ON

    # DEFINE OUTPUT_PATH = &1;
    # DEFINE FROMDATE = &2;
    # DEFINE TODATE = &3;

    # spool &OUTPUT_PATH
    # ------------------------------
    # -- Your select statement below
    # ------------------------------
    # SELECT /*csv*/
    #     AH.ALERT_KEY,
    #     AR.ALERT_REASON_KEY,
    #     AH.ALERT_IDENTIFIER,
    #     AH.WW_ORGUNIT_CODE AS ORGUNIT_CODE,
    #     AH.SOURCE_SYSTEM,
    #     TO_CHAR(AH.WW_CREATION_TIMESTAMP,'YYYYMMDDHH24MISS') AS ALERT_CREATION_TIMESTAMP,
    #     TO_CHAR(AR.EVENT_TIMESTAMP,'YYYYMMDDHH24MISS') AS TRANSACTION_TIMESTAMP
    # FROM ALERT_REASONS AR
    # LEFT OUTER JOIN ALERT_HEADER AH ON AH.ALERT_KEY = AR.ALERT_KEY
    # WHERE SOURCE_SYSTEM = 'SM' AND
    # TO_CHAR(AH.WW_CREATION_TIMESTAMP, 'YYYYMMDD') BETWEEN '&&FROMDATE' AND '&&TODATE'
    # ORDER BY AH.ALERT_KEY;
    # -------------------------------------------
    # -- Ensure that the boilerplate below exists
    # ------------------------------------------
    # spool off;
    # EXIT;
    # /
  }
