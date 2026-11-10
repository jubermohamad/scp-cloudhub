#!/bin/bash

MINIO_URL=${MINIO_URL:-empty}
MINIO_USER=${MINIO_USER:-netreveal}
MINIO_PASSWORD=${MINIO_PASSWORD:-pass}

export MC_CONFIG_DIR="/mc-config/.mc"

# location at usr/local/bin
PATH=$PATH:/usr/local/bin

DBENGINE=postgres
ENVELOPE_CHECKER_ENABLED={{ .Values.worldcheck.worldcheckParameters.envelopeCheckerEnabled }}
# Worldcheck related variables
NR_HOME=/opt/netreveal/standaloneHome
MINIO_WORLDCHECK_BUCKET_PATH="minio/private-bucket/landing/worldcheck"
IMPORT_DIR=${NR_HOME}/conf/wlm/worldcheck
HOST=www.world-check.com
TODAY=$(date +"%m-%d-%Y")


touch ${NR_HOME}/logs/downloadWatchlist.log
exec 3>&1 1> >(tee -a ${NR_HOME}/logs/downloadWatchlist.log) 2>&1
chmod 640 ${NR_HOME}/logs/downloadWatchlist.log


# Smart Delete variables
WorldcheckTotalFiles=0
WorldcheckDoneFiles=0

# Database variables
# Note that no matter the type of sql, it is set in the XXX.template
SQL_LOCATION=/opt/netreveal/standaloneHome/worldcheckScripts

#Global Var
# This is used to check the watchlist file download status
g_download_result=1

# This is used for the SQLs to support for Oracle or Postgres
# The only variable that is shared
g_sql_value=


# This is used to pass the file and loadmethod between the functions, especially for the delete worldcheck
g_file_name=
g_load_method=

function fn_notes() {
  ###### Options######
  # This script has 4 functions.
    # 1. Ingest
    #   Download the worldcheck list, AKA the ingest list.
    #   Supported Options: daily|weekly|full
    #   Example: 'downloadWorldcheck ingest daily'
    #   IMPORTANT NOTE: To also trigger RebuildIndex

    # 2. Delete
    #   Download the worldcheck 'delete' list, AKA the delete list.
    #   This will also trigger the script to do index rebuild
    #   Supported Options: daily|full
    #   Example: 'downloadWorldcheck delete daily'

    # 3. SmartDelete
    #   Function to check if the ingest list is downloaded before initiating the 'delete list', AKA smart delete
    #   No options for this.
    #   This calls the worldcheck 'delete' list with the daily option.
    #   Example: 'downloadWorldcheck smartdelete'

    # 4. RebuildIndex
    #   Trigger the SQL to trigger the Index Rebuild for Worldcheck
    #   No options for this.
    #   Example: 'downloadWorldcheck rebuildindex'
  #########################################

  ######### Worldcheck Daily Download Script Notes ##############
  # Worldcheck Daily Download Script.
  # Hits the Default WorldCheck URL and gets a list of available files, pulls the first daily file found in the list
  # Pulls username/password from repository each time its required

  # No arguments are required for this script - it assumes credential service is good to go with pre-set customer and
  # environment name variables, and will default to a daily delta file download.
  # A single optional argument containing the daily|weekly|full is allowed.
  #
  # This file will be renamed from downloadWorldcheck.sh to /usr/local/bin/downloadWatchlist when deployed.
  #
  #############################################################

  ################# Smart Delete #############
  # This script shows whether daily Worldcheck file import is completed before proceeding to deletion.

  # For a daily run there is 3 outcomes

  # 1. Delete did not start. There was no worldcheck import.
    # The count of worldcheck rows is 0.
    # look out for STATUS: FAILED, No worldcheck import activity detected for today.

  # 2. Delete did not start. Waited for X time for import to complete, but it did not
    # The count of worldcheck rows is greater than 0.
    # The count of completed worldcheck rows is equal to total files.
    # look out for STATUS: FAILED, Worldcheck import still in progress.

  # 3. Delete completed successfully
    # look out for STATUS: SUCCESS
  ##############################################
  echo "notes"
}

function fn_exit() {
  echo "$1"
  exit $2
}

function logger() {
  local ts=$(date +%D\ %R:%S)
  echo "${ts} - ${1}"
}

function fn_decision_tree() {
  logger "fn_decision_tree: START"
  logger "Number of arguments : $#"
  logger "Argument 1: $1"
  logger "Argument 2: $2"
  logger "Argument 3: $3"

  if [ $# -ge 1 ]; then
    case $1 in
      ingest)
        logger "INFO: Running Ingest Worldcheck"
        fn_ingest_worldcheck "$@"
      ;;
      delete)
        logger "INFO: Running Delete Worldcheck"
        fn_delete_worldcheck "$@"
        fn_exit "INFO ${FILE} downloaded successfully" 0
      ;;
      smartdelete)
        logger "INFO: Running SmartDelete program."
        fn_worldcheck_import_current_status
      ;;
      rebuildindex)
        logger "INFO: Running Worldcheck Index Rebuild"
        fn_trigger_worldcheck_index_rebuild
      ;;
      stoprebuildindex)
        logger "INFO: Running Stop Worldcheck Index Rebuild"
        fn_trigger_stop_worldcheck_index_rebuild
      ;;
      *)
        # unknown option
        fn_exit "ERROR: Unknown/Unsupported Function option selected. Valid options are ingest|delete|smartdelete|rebuildindex." 5
      ;;
    esac
  else
    logger "INFO: Function and Type is not specified. Defaulting to Ingest - Daily."
    fn_ingest_worldcheck
  fi

  logger "fn_decision_tree: END"
}

function fn_ingest_worldcheck() {
  logger "fn_ingest_worldcheck: START"
  logger "Number of arguments : $#"
  logger "Argument 1: $1"
  logger "Argument 2: $2"
  logger "Argument 3: $3"

  # Full = Refresh, Daily = Append, Weekly = Merge
  FULL_URL=
  FULL_LOADMETHOD=2
  DAILY_URL=\&lag\=DAY
  DAILY_LOADMETHOD=4
  WEEKLY_URL=\&lag\=WEEK
  WEEKLY_LOADMETHOD=4
  DOWNLOAD_URL=https://${HOST}/premium-dynamic-download?format\=TSV

  #work out what type of file we're after/load type we're triggering. Defaults to daily.

  if [ $# -ge 1 ]; then
    case $2 in
      daily)
        LOADMETHOD=${DAILY_LOADMETHOD}
        DOWNLOAD_URL=${DOWNLOAD_URL}${DAILY_URL}
        FILE=worldcheck-day-${TODAY}.cvn
        logger "INFO: Daily/Partial Merge download selected"
      ;;
      weekly)
        LOADMETHOD=${WEEKLY_LOADMETHOD}
        DOWNLOAD_URL=${DOWNLOAD_URL}${WEEKLY_URL}
        FILE=worldcheck-week-${TODAY}.cvn
        logger "INFO: Weekly/Partial Merge download selected"
      ;;
      full)
        LOADMETHOD=${FULL_LOADMETHOD}
        DOWNLOAD_URL=${DOWNLOAD_URL}${FULL_URL}
        FILE=worldcheck-full-${TODAY}.cvn
        logger "INFO: Full/Merge download selected"
      ;;
      *)
        # unknown option
        logger "ERROR: Unknown/Unsupported download option selected. Valid options are daily|weekly|full. Defaulting to daily..."
        LOADMETHOD=${DAILY_LOADMETHOD}
        DOWNLOAD_URL=${DOWNLOAD_URL}${DAILY_URL}
        FILE=worldcheck-day-${TODAY}.cvn
      ;;
    esac
  else
    # Based on the previous function it will flow here
    LOADMETHOD=${DAILY_LOADMETHOD}
    DOWNLOAD_URL=${DOWNLOAD_URL}${DAILY_URL}
    FILE=worldcheck-day-${TODAY}.cvn
  fi

  fn_download_file $DOWNLOAD_URL $FILE
  logger "Result:$g_download_result"

  #test if ok, create flag file...
  if [ $g_download_result -ne 0 ]; then
    fn_exit "ERROR: Unable to download [$FILE] $g_download_result" 3
  else
    if [ ${ENVELOPE_CHECKER_ENABLED} = "TRUE" ]; then
      #TODO THIS BLOCK CAN BE REMOVED WHEN envelopeChecker.sh will be adopted for K8S
      logger "envelopeChecker.sh temporary disabled"
      logger "Can't check if there are Watchlist Ingestion issues, continue with creating flag for ingest worldcheck."
      echo "${FILE}~${LOADMETHOD}" > ${IMPORT_DIR}/flag.txt
      # #AUSNROD-751: Stops watchlist ingestion if there is a missing file
      # /usr/local/bin/envelopeChecker/envelopeChecker.sh checkWatchlistIngestion "${FILE}~${LOADMETHOD} > ${IMPORT_DIR}/flag.txt"
      # isThereWatchlistIngestionIssues=$?
      # logger "isThereWatchlistIngestionIssues: $isThereWatchlistIngestionIssues"
      # if [[ $isThereWatchlistIngestionIssues -eq $FALSE ]];
      # then
      #   logger "No Watchlist Ingestion issues, continue with creating flag for ingest worldcheck."
      #   echo "${FILE}~${LOADMETHOD}" > ${IMPORT_DIR}/flag.txt
      # else
      #   logger "Watchlist Ingestion Issues found, not creating flag.txt and exiting."
      #   fn_exit "ERROR: fn_ingest_worldcheck ended early as there was Envelope Ingestion issues." 0
      # fi
    else
      #TODO THIS BLOCK CAN BE REMOVED WHEN envelopeChecker.sh will be adopted for K8S
      logger "envelopeChecker.sh temporary disabled"
      logger "Can't check if there are Watchlist Ingestion issues, continue with creating flag for ingest worldcheck."
      echo "${FILE}~${LOADMETHOD}" > ${IMPORT_DIR}/flag.txt
    fi
  fi
  if [ -f ${IMPORT_DIR}/flag.txt ]; then
    if mc mv "${IMPORT_DIR}/flag.txt" "${MINIO_WORLDCHECK_BUCKET_PATH}/flag.txt"; then
      logger "INFO: File flag.txt successfully moved to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}"
    else
      fn_exit "ERROR: Unable to move file flag.txt to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}" 3
    fi
  fi
  fn_exit "INFO ${FILE} downloaded successfully" 0
}

function fn_delete_worldcheck() {
  logger "fn_delete_worldcheck: START"
  fn_download_delete_worldcheck $1 $2


  if [ $g_download_result -ne 0 ]; then
    fn_exit "ERROR: Unable to download [$g_file_name] $g_download_result" 3

    elif [ $# -ge 1 ]; then
      if [ ${ENVELOPE_CHECKER_ENABLED} = "TRUE" ]; then
        #TODO THIS BLOCK CAN BE REMOVED WHEN envelopeChecker.sh will be adopted for K8S
        logger "envelopeChecker.sh temporary disabled"
        logger "Can't check if there are Watchlist Ingestion issues, continue with creating flag for ingest delete worldcheck."
        # #AUSNROD-751: Stops watchlist ingestion if there is a missing file
        # /usr/local/bin/envelopeChecker/envelopeChecker.sh checkWatchlistIngestion "${g_file_name}~${g_load_method} > ${IMPORT_DIR}/flag.txt"
        # isThereWatchlistIngestionIssues=$?
        # logger "isThereWatchlistIngestionIssues: $isThereWatchlistIngestionIssues"
        if [[ $isThereWatchlistIngestionIssues -eq $FALSE ]];
        then
          logger "No Watchlist Ingestion issues, continue with creating flag for ingest delete worldcheck."
          case $2 in
            full)
              logger "INFO ${g_file_name} downloaded successfully and No Flag file is created for Full File"
            ;;
            daily)
              logger "INFO ${g_file_name} downloaded successfully and Flag file is created for Daily File"
              echo "${g_file_name}~${g_load_method}" > ${IMPORT_DIR}/flag.txt
              if mc mv "${IMPORT_DIR}/flag.txt" "${MINIO_WORLDCHECK_BUCKET_PATH}/flag.txt"; then
                logger "INFO: File flag.txt successfully moved to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}"
              else
                fn_exit "ERROR: Unable to move file flag.txt to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}" 3
              fi
            ;;
            *)
              # unknown option
              logger "INFO ${g_file_name} downloaded successfully. As Download type not specified , Flag file is created for Daily File"
              echo "${g_file_name}~${g_load_method}" > ${IMPORT_DIR}/flag.txt
              if mc mv "${IMPORT_DIR}/flag.txt" "${MINIO_WORLDCHECK_BUCKET_PATH}/flag.txt"; then
                logger "INFO: File flag.txt successfully moved to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}"
              else
                fn_exit "ERROR: Unable to move file flag.txt to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}" 3
              fi
            ;;
          esac

        else
          logger "Watchlist Ingestion Issues found, not creating flag.txt and exiting."
          fn_exit "ERROR: smartDelete ended early as there was Envelop Ingestion issues." 0
        fi
      else
        #TODO THIS BLOCK CAN BE REMOVED WHEN envelopeChecker.sh will be adopted for K8S
        logger "envelopeChecker.sh temporary disabled"
        logger "Can't check if there are Watchlist Ingestion issues, continue with creating flag for ingest delete worldcheck."
        case $2 in
          full)
            logger "INFO ${g_file_name} downloaded successfully and No Flag file is created for Full File"
          ;;
          daily)
            logger "INFO ${g_file_name} downloaded successfully and Flag file is created for Daily File"
            echo "${g_file_name}~${g_load_method}" > ${IMPORT_DIR}/flag.txt
            if mc mv "${IMPORT_DIR}/flag.txt" "${MINIO_WORLDCHECK_BUCKET_PATH}/flag.txt"; then
              logger "INFO: File flag.txt successfully moved to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}"
            else
              fn_exit "ERROR: Unable to move file flag.txt to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}" 3
            fi
          ;;
          *)
            # unknown option
            logger "INFO ${g_file_name} downloaded successfully. As Download type not specified , Flag file is created for Daily File"
            echo "${g_file_name}~${g_load_method}" > ${IMPORT_DIR}/flag.txt
            if mc mv "${IMPORT_DIR}/flag.txt" "${MINIO_WORLDCHECK_BUCKET_PATH}/flag.txt"; then
              logger "INFO: File flag.txt successfully moved to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}"
            else
              fn_exit "ERROR: Unable to move file flag.txt to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}" 3
            fi
          ;;
        esac
      fi
  fi

  #Exit is moved to parent function
}

# This will download the delete worldchecklist
function fn_download_delete_worldcheck() {
  logger "fn_download_delete_worldcheck: START"
  logger "Number of arguments : $#"
  logger "Argument 1: $1"
  logger "Argument 2: $2"
  logger "Argument 3: $3"
  DAILY_URL=world-check-deleted-day-v2.csv
  DAILY_LOADMETHOD=3
  FULL_URL=world-check-deleted-v2.csv
  FULL_LOADMETHOD=3
  DOWNLOAD_URL=https://${HOST}/datafile/premium/

  #work out what type of file we're after/load type we're triggering.  Default to daily.
  case $2 in
    daily)
      g_load_method=${DAILY_LOADMETHOD}
      DOWNLOAD_URL=${DOWNLOAD_URL}${DAILY_URL}
      g_file_name=worldcheck-day-delete-${TODAY}.csv
      logger "INFO: Daily download selected"
    ;;
    full)
      g_load_method=${FULL_LOADMETHOD}
      DOWNLOAD_URL=${DOWNLOAD_URL}${FULL_URL}
      g_file_name=worldcheck-full-delete-${TODAY}.csv
      logger "INFO: Full download selected"
    ;;
    *)
      # unknown option
      logger "INFO: Download type not specified, defaulting to Daily"
      g_load_method=${DAILY_LOADMETHOD}
      DOWNLOAD_URL=${DOWNLOAD_URL}${DAILY_URL}
      g_file_name=worldcheck-day-delete-${TODAY}.csv
    ;;
  esac

  fn_download_file $DOWNLOAD_URL $g_file_name
  logger "Result:$g_download_result"

  if [ $g_download_result -ne 0 ]; then
    fn_exit "ERROR: Unable to download [$g_file_name] $g_download_result" 3
    elif [ $# -ge 1 ]; then
      logger "INFO ${g_file_name} downloaded successfully. No flag file created."
  fi

}

function fn_download_file() {
  downloadURL=$1
  fileName=$2
  returnValue=""

  retryLoginCurrent=1
  retryLoginMax=4
  retryLoginWaitDuration=30

  logger "Calling fn_download_file with $ $downloadURL, $fileName"

  # Variables for download


  # grab credentials and store.
	USERNAME='{{ .Values.worldcheck.worldcheckParameters.username }}'
	PASSWORD='{{ .Values.worldcheck.worldcheckParameters.password }}'

  START_URL=https://${HOST}/frontend/login/
  LOGOUT_URL=https://${HOST}/frontend/logout/


  ###############################
  while [[ $retryLoginCurrent -lt $retryLoginMax ]]
    do
      logger "INFO: LOGIN Count $retryLoginCurrent (current)/$retryLoginMax (max)"
      curl -c ${NR_HOME}/tmp/.wc_cookies -s -u ${USERNAME}:${PASSWORD} ${START_URL} -o ${NR_HOME}/tmp/wc1.html
      curl -b ${NR_HOME}/tmp/.wc_cookies  -s -c ${NR_HOME}/tmp/.wc_cookies  -o ${NR_HOME}/tmp/wc2.html -u ${USERNAME}:${PASSWORD} -d "username=${USERNAME}&password=${PASSWORD}&csrf_token=None" ${START_URL}

      #should test that our login was actually successful before proceeding.
      countLoginFail=$(grep -rsc 'Invalid username or password' ${NR_HOME}/tmp/wc2.html)

      # $TODO? may also need to parse the returned output for a CSRF token

      if [[ $countLoginFail -eq 0 ]]
        then
          logger "Login was successful"
          # CURL to grab file
          logger "INFO: Downloading ${downloadURL} to ${IMPORT_DIR}/${fileName}"

          curl -b ${NR_HOME}/tmp/.wc_cookies -sS -c ${NR_HOME}/tmp/.wc_cookies -u ${USERNAME}:${PASSWORD} -L -o ${IMPORT_DIR}/${fileName} ${downloadURL}
          returnValue=$?

          countDownloadFail=$(grep -rsc 'Basic auth' ${IMPORT_DIR}/${fileName})

          if [[ $countDownloadFail -eq 0 ]] && [[ $returnValue -eq 0 ]]
            then
              logger "Download file looks correct."
               #CURL to log out
              logger "INFO: Logging out of $LOGOUT_URL"
              curl -b ${NR_HOME}/tmp/.wc_cookies -sS -c ${NR_HOME}/tmp/.wc_cookies -u ${USERNAME}:${PASSWORD} -o ${NR_HOME}/tmp/wc3.html ${LOGOUT_URL}

              g_download_result=$returnValue
             if mc mv "${IMPORT_DIR}/${fileName}" "${MINIO_WORLDCHECK_BUCKET_PATH}/${fileName}"; then
                logger "INFO: File ${fileName} successfully moved to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}"
              else
                fn_exit "ERROR: Unable to move file ${fileName} to MinIO bucket ${MINIO_WORLDCHECK_BUCKET_PATH}" 3
              fi
              break
          else
            logger "Download failed"
          fi


      else
        logger "Login failed"
      fi

      logger "Login or downloaded file had issues, retrying in $retryLoginWaitDuration seconds."
      ((retryLoginCurrent++))
      sleep $retryLoginWaitDuration
      # then back to while loop
  done

  logger "Completed fn_download_file()"
}

function fn_sql_db_setup() {
  # logger "DBENGINE: $DBENGINE"

  # Have thought about putting this in its own shellscript but in most cases the following might be unique to a shellscript so it is placed within the shellscript
  # -- User to call
  # -- SQL location
  case $DBENGINE in
    postgres)
      export dbendpoint={{ include "db.host" . }}
      export PGPASSWORD='{{ .Values.global.baseConfigProperties.clusterdb.AppPassword }}'
      {{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") }}
      export PGSSLMODE={{ .Values.global.baseConfigProperties.db.postgresql.sslmode }}
      export PGSSLROOTCERT={{ .Values.global.baseConfigProperties.db.postgresql.sslrootcert }}
      {{- end }}

      # Example call
      # Output=$(psql -qtAX -U netreveal -h ${dbendpoint} -p 5432 -d netrevealdb -f $SQL_LOCATION/$scriptName)
    ;;
    *)
      # unknown option
      fn_exit "DBENGINE variable is not set, please check and rerun"
    ;;
  esac
}

function fn_trigger_sql() {
  # Based on the current environment, I will run the correct SQL script for Oracle or Postgres based clients
  # Just give me the script name
  scriptName=$1
  # Always set this to null when it is triggered
  g_sql_value=

  # logger "DBENGINE: $DBENGINE"

  case $DBENGINE in
    postgres)
      g_sql_value=$(psql -qtAX -U {{ .Values.global.baseConfigProperties.db.postgresql.userid }} -h ${dbendpoint} -p 5432 -d {{ .Values.global.baseConfigProperties.db.postgresql.database }} -f $SQL_LOCATION/$scriptName)
      # The postgres version will automatically print the output so no logger is required
    ;;
  esac

  # logger "End fn_trigger_sql"
}

function fn_trigger_worldcheck_index_rebuild() {
  logger "Start fn_trigger_worldcheck_index_rebuild"
  fn_trigger_sql triggerWorldcheckIndexRebuild.sql

  # Output=$g_sql_value
  # logger "Output: $Output"
  logger "End fn_trigger_worldcheck_index_rebuild"
}

function fn_trigger_stop_worldcheck_index_rebuild() {
  logger "Start fn_trigger_stop_worldcheck_index_rebuild"
  logger "Stopping the following worldcheck indexes:"
  fn_trigger_sql triggerStopWorldcheckIndexRebuild.sql

  # Output=$g_sql_value
  # logger "Output: $Output"
  logger "End fn_trigger_stop_worldcheck_index_rebuild"
}

function fn_run_worldcheck_delete() {
  # From the previous value, we +1 as the delete activities will add a new row
  COMPLETED_STATE=$(($WorldcheckTotalFiles+1))

  fn_trigger_sql getWorldcheckDoneFiles.sql
  CURRENT_STATE=$g_sql_value
  # First round is to wait 1800 seconds, that is the current average
  SLEEP_DURATION=1800


  logger "Start Run on Delete WorldCheck."
  # The script will:
    # Import the Worldcheck list for delete
    # Remove index
    # Then write the details to the log that is queried with getWorldcheckDoneFiles.sql
  fn_delete_worldcheck delete daily
  logger "End Run on Worldcheck."


  logger "Starting loop until the Current State (${CURRENT_STATE}) is equal to Completed State (${COMPLETED_STATE})"
  logger "Going to sleep for $SLEEP_DURATION seconds."
  sleep $SLEEP_DURATION

  while [[ $CURRENT_STATE -lt $COMPLETED_STATE ]]
    do
      fn_trigger_sql getWorldcheckDoneFiles.sql
      CURRENT_STATE=$g_sql_value
      logger "In Loop, Current State (${CURRENT_STATE}) != Complete State (${COMPLETED_STATE})"

      if [[ $CURRENT_STATE -eq $COMPLETED_STATE ]]
        then
        logger "STATUS: SUCCESS"
        break
      else
        logger "Going to sleep for 120 seconds."
        sleep 120
        # then back to while loop
      fi
  done

  # The system is usually configured to auto rebuild indexes after a list is imported
  # fn_trigger_worldcheck_index_rebuild

  logger "fn_run_worldcheck_delete() completed."
  fn_exit "smartDelete ran successfully" 0
}

function fn_worldcheck_import_current_status() {
  logger "Starting fn_worldcheck_import_current_status()"
  # waitingVar start off at -1 and will turn to 0 only when all jobs from today is completed.
  # The average time for the import to finish is about 16 minutes, a 60 minute buffer should be sufficent
  waitingVar=-1
  currentWait=0
  maxWait=30
  #Sleeping Time
  sleepinterval=120

  while [[ $waitingVar != 0 ]]
   do
    # Example
    # totalFiles=1
    # doneFiles=1
    # Will start delete activity when there is a 1:1 match
    fn_trigger_sql getWorldcheckTotalFiles.sql
    WorldcheckTotalFiles=$g_sql_value

    fn_trigger_sql getWorldcheckDoneFiles.sql
    WorldcheckDoneFiles=$g_sql_value

    ((currentWait++))

    # to set -eq to 0 as that would mean there was 0 imports done for the day
    # merged this logic into block below
    # if [[ $WorldcheckTotalFiles -eq 0 ]]
    #   then
    #   logger "STATUS: FAILED, No worldcheck import activity detected for today."
    #   waitingVar=0
    #   break
    # fi

    logger "Loop #$currentWait. Comparing between Total (${WorldcheckTotalFiles}) and Done Files (${WorldcheckDoneFiles})"

    if [[ $WorldcheckTotalFiles == $WorldcheckDoneFiles ]] && [[ $WorldcheckTotalFiles -ne 0 ]]
      then
        waitingVar=0
        logger "Complete checks, continuing with delete script"
        fn_trigger_stop_worldcheck_index_rebuild
        fn_run_worldcheck_delete

      elif [[ $currentWait -ge $maxWait ]] && [[ $WorldcheckTotalFiles -eq 0 ]]
        then
          logger "Waited for ($currentWait x $sleepinterval) seconds, ending run..."
          logger "STATUS: FAILED, No worldcheck import activity detected for today."
          waitingVar=0
          logger "Continuing to download the worldcheck deleted csv file.."
          fn_download_delete_worldcheck delete daily
          fn_exit "STATUS: FAILED, No worldcheck import activity detected for today, but file is successfully downloaded"

      elif [[ $currentWait -ge $maxWait ]]
        then
          logger "Waited for ($currentWait x $sleepinterval seconds), ending run..."
          logger "STATUS: FAILED, Worldcheck import still in progress."
          waitingVar=0
      else
        sleep ${sleepinterval}
        logger "Still in loop...sleeping for ${sleepinterval} seconds"
    fi
  done

  logger "Completed fn_worldcheck_import_current_status()"
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

fn_sql_db_setup
fn_connect_to_minio
fn_decision_tree "$@"
