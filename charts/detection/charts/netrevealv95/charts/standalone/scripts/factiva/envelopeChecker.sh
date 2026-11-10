#!/bin/bash


. /opt/netreveal/standaloneHome/factivaScripts/netreveal_batch.conf

readonly LOCKFILE_DIR=/opt/netreveal/tmp
PATH=$PATH:/usr/local/bin
HOME=/opt/netreveal/standaloneHome
LOGFILE=/opt/netreveal/standaloneHome/logs/envelopeChecker.log

exec 3>&1 1> >(tee -a ${LOGFILE}) 2>&1
#Setting permissions to ensure that other has no access
chmod 640 $LOGFILE

# Static Parameters
# Note that no matter the type of sql, it is set in the XXX.template
SQL_LOCATION=/usr/local/bin/sql

envelopeCheckerFilePrefix=missing_envelope_
envelopeCheckerFilePath=$LOCKFILE_DIR/envelopeChecker

# Initialised variables
# The batchDateFromDB is from the database
batchDateFromDB=
# While the batchDateFromEODFile is from the endofdayfile
batchDateFromEODFile=

# Variables to count current
missingEnvelopesCount=
startWatchlistIngestionCommand=

# This is used for the SQLs to support for Oracle or Postgres
# The only variable that is shared
g_sql_value=


function fn_setup_script() {
  # SSM Parameters / Static Parameters

  # Reminder: These values are set via  /etc/netreveal/netreveal_batch.conf

  # 0 - false (disable) (default value) | 1 - true (enable)
  # createMissingEnvelopes defaults to disable, change to 1 to enable it.
  createMissingEnvelopes=$(override_if_null "$ENVELOPE_CHECKER_SETTING" $FALSE)

  # defaults to 0. So even if there is just 1 missing envelope it stop any script activity
  missingEnvelopesLimit=$(override_if_null "$MISSING_ENVELOPE_LIMIT" 0)

  # disableEnvelopeIngestion defaults to true(enable)
  disableEnvelopeIngestion=$(override_if_null "$ENVELOPE_INGESTION_SWITCH" $TRUE)

  # disableWatchlistIngestion defaults to true(enable)
  #  0 - false (disable)| 1 - true (enable) (default value)
  disableWatchlistIngestion=$(override_if_null "$WATCHLIST_INGESTION_SWITCH" $TRUE)

  #  This is used in one of the checks where the daily envelope date is calculated on the fly for today
  calculatedEnvelopeDate=$(override_if_null "$ENVELOPE_CHECKER_ENVELOPE_DATE" 'is_not_set')

  # The date can +/- a day if the queries to the db is done the next day, so it is placed in this variable
  # NRDVO-1206 - Updated to use epoch time, so the input should be defined like $(date -d "-2 days" +%s)
  calculatedEnvelopeDateForQueries=$(override_if_null "$ENVELOPE_CHECKER_CALCULATED_ENVELOPE_DATE" 'is_not_set')

  logger "calculatedEnvelopeDateForQueries=$calculatedEnvelopeDateForQueries, which translates to $(date -d "@$calculatedEnvelopeDateForQueries" +"%Y-%m-%d %H:%M:%S")"

  envelopeStartEpochDateFile="$envelopeCheckerFilePath/envelopeStartDateInEpoch.txt"

  # NRDVO-699 - Support multibatch
  # 1 is true, 0 is false
  isMultiBatchEnabled=$(override_if_null "$MULTIBATCH" $FALSE)
  # isMultiBatchCompleted also uses $TRUE and $FALSE
  isMultiBatchCompleted=


  #NRDVO-1046- Check for WLM, CDD, AML
  targetWLMBatches=$(override_if_null "$ENVELOPE_CHECKER_WLM_BATCH_TARGET" 0)
  isWLMBatchesCompleted=

  targetAMLBatches=$(override_if_null "$ENVELOPE_CHECKER_AML_BATCH_TARGET" 0)
  isAMLBatchesCompleted=

  targetCDDBatches=$(override_if_null "$ENVELOPE_CHECKER_CDD_BATCH_TARGET" 0)
  isCDDBatchesCompleted=
}


### Small functions
function override_if_null() {
  THIS_INPUT=$1
  THIS_OVERRIDE=$2

  if [ -z "$1" ]
  then
    # logger "Is null, overriding with '$THIS_OVERRIDE"
    THIS_INPUT=$THIS_OVERRIDE
  fi
  echo "$THIS_INPUT"
}

function fn_exit() {
  rm -f ~/.netrc
  echo "$1"
  echo "$1" >&3 3>&- # echo reason to stdout (instead of log) and then close fd 3
  exit $2
}

function fn_return_exit() {
  logger "fn_return_exit: $1"
  # This exit is used by:
  #   checkEnvelopeIngestion
  #   checkWatchlistIngestion

  # When it exits, it returns either:
  # 0 - False. No issues found
  # 1 - True. Don't proceed with next action
  3>&- #close fd 3
  exit $1
}

function fn_example_for_return_exit() {
  logger "Doing quick test"
  /usr/local/bin/envelopeChecker/envelopeChecker.sh checkEnvelopeIngestion
  sampleIsThereEnvelopeIngestionIssues=$?
  logger "sampleIsThereEnvelopeIngestionIssues: $sampleIsThereEnvelopeIngestionIssues"

  if [[ $sampleIsThereEnvelopeIngestionIssues -eq $FALSE ]];
    then
      logger "No issues found, please proceed checkEnvelopeIngestion"
    else
      logger "Issues found, please exit checkEnvelopeIngestion"
  fi

  /usr/local/bin/envelopeChecker/envelopeChecker.sh checkWatchlistIngestion
  sampleIsThereWatchlistIngestionIssues=$?
  logger "sampleIsThereWatchlistIngestionIssues: $sampleIsThereWatchlistIngestionIssues"
  if [[ $sampleIsThereWatchlistIngestionIssues -eq $FALSE ]];
    then
      logger "No issues found, please proceed with the scripts checkWatchlistIngestion"
    else
      logger "Issues found, please update to exit script checkWatchlistIngestion"
  fi
}

function logger() {
  local ts=$(date +%D\ %R:%S)
  echo "${ts}:${0##*/} - ${1}"
}

function blank_space() {
  echo -e "\n"
}

function fn_send_notification() {
  subject=$1
  logFile=$2

  logger "subject: $1"
  logger "logFile: $2"
  logger "Running fn_send_notification"
  /usr/local/bin/sendnotification.sh $ALARM_SNS_TOPIC "$subject" $logFile
  cmd_status=$?
  if test $cmd_status -ne 0
  then
    logger "ALARM_SNS_TOPIC not set, notification not sent: $1"
  fi
}

function fn_send_missing_envelope_notification() {
  message=$1
  subject='Missing Daily Envelope'
  # NRDVO-440 - Temp file path reviewed...this does not need to be in EFS.
  logFile=/tmp/envelopeCheckerMessage.log
  echo "$message" > $logFile
  fn_send_notification "$subject" $logFile
  logger "Completed fn_send_missing_envelope_notification"
}

function fn_send_disable_watchlist_notification() {
  #log SNS - limit log to last 200 lines of output otherwise file will be over SNS message limit.
  #make sure ALARM_SNS_TOPIC is under 256 chars length otherwise SNS will not send.
  subject='Disabled Watchlist Ingestion'

  # NRDVO-440 - Temp file path reviewed...this does not need to be in EFS.
  logFile=/tmp/disableWatchlistMessage.log

  logger "input script command: $startWatchlistIngestionCommand"

  echo "The automatic watchlist ingestion for $CUSTOMER_NAME.$ENV_TYPE was stopped as createMissingEnvelopes($createMissingEnvelopes) > missingEnvelopesLimit($missingEnvelopesLimit).

  Support team will have to manually create the flag file command with
  $startWatchlistIngestionCommand

  ***Current Parameters***
    createMissingEnvelopes: $createMissingEnvelopes
      If createMissingEnvelops = 1 (true), it will create missing envelopes

    calculatedEnvelopeDate: $calculatedEnvelopeDate
      If this is not set, it will create missing envelopes as it will fail 1 of the checks.

    missingEnvelopesLimit: $missingEnvelopesLimit
      If missingEnvelopesLimit is 0, that means there must not be any missing envelops

    disableEnvelopeIngestion: $disableEnvelopeIngestion
      If disabableEnvelopeIngestion = 1, it will disable Envelope Ingestions (at DXVLanding.sh)

    disableWatchlistIngestion: $disableWatchlistIngestion
      If disableWatchlistIngestion = 1, it will disable Watchlist Ingestions (eg downloadWatchlist.sh)
    *************************
  " > $logFile

  fn_send_notification "$subject" $logFile
}

function fn_create_a_missing_envelope() {
  message=$1
  logger "Creating a missing envelope for $calculatedEnvelopeDate at $envelopeCheckerFilePath/$envelopeCheckerFilePrefix$calculatedEnvelopeDate"
  mkdir -p $envelopeCheckerFilePath
  echo $message > $envelopeCheckerFilePath/$envelopeCheckerFilePrefix$calculatedEnvelopeDate

  fn_push_an_envelope_to_dxv "$envelopeCheckerFilePath/$envelopeCheckerFilePrefix$calculatedEnvelopeDate"
}


function fn_push_an_envelope_to_dxv() {
  logger "Start fn_push_an_envelope_to_dxv"

  export_file=$1
  logger "export_file=$export_file"

  # The same $LOCKFILE_DIR exists in both DMZ and Batch
  dxvLocation=$LOCKFILE_DIR/envelopeChecker
  if [ -f "$export_file" ]
    then
      # This file is sent back to LOCKFILE_DIR to allow the DXV to check if there was any failed batches from the day before.
      # The DXV will then look out for this at the start of envelope and stop processing if it exists
      ssh -i /home/netreveal/.ssh/id_rsa -o "LogLevel=error" $SSHUSER@$DXVSERVER "mkdir -p $dxvLocation"
      scp -i /home/netreveal/.ssh/id_rsa $export_file $SSHUSER@$DXVSERVER:$dxvLocation
      cmd_status=$?

      if test $cmd_status -eq $SUCCESS
        then
          logger "Copied $export_file successfully to $dxvLocation"

      else
        #If scp fails
        #Perform further inspection on the return code from the ssh test.
        #it could be that no files were present, but it could also be due to untrusted ssh host keys, connection failures, etc.
        case $cmd_status in
          2) logger "SSH Connection failed. SSH command returned $cmd_status - $cmd_result";;
          65) logger "SSH Host not allowed to connect. SSH command returned $cmd_status - $cmd_result";;
          67) logger "Key exchange failed. SSH command returned $cmd_status - $cmd_result";;
          79) logger "Invalid SSH User. SSH command returned $cmd_status - $cmd_result";;
          255) logger "Invalid SSH host. SSH command returned $cmd_status - $cmd_result";;
          *) logger "No files found for processing. SSH command returned $cmd_status - $cmd_result";;
        esac

        logger "Error copying files from the Extract directory to Feedback folder, files not deleted. SSH command returned $cmd_status - $cmd_result"
      fi
  else
    logger "$THIS_FILE_NAME, file not found"
  fi

  logger "End fn_push_an_envelope_to_dxv"
}

function fn_get_missing_envelopes_count() {
  logger "Checking for missing_envelopes at:$envelopeCheckerFilePath"

  if [[ -d "$envelopeCheckerFilePath" ]]; then
    missingEnvelopesCount=$(find $envelopeCheckerFilePath/$envelopeCheckerFilePrefix* -type f 2> /dev/null | wc -l)
  else
    logger "$envelopeCheckerFilePath does not exist, set to 0."
    missingEnvelopesCount=0
  fi

  logger "fn_get_missing_envelopes_count Result: $missingEnvelopesCount"
}

function fn_get_current_daily_envelope_date() {
  # 20-August-2021 update: This is no longer in use and the calculatedEnvelopeDate is set in th customer specific
  # This sets what the current daily envelope date would look like based on CUSTOMER_NAME

   case $CUSTOMER_NAME in
      boq)
        #TBD
          # BOQ
        # ENVELOPE_20201207_3
        # ENVELOPE_20201207_2
        # ENVELOPE_20201207_1
        # Need to pick the #3rd
        # Need to enhanced other script to not delete the envelope number
        calculatedEnvelopeDate=$(date -d "-1 days" +%Y%m%d)
      ;;
      lfs)
        #ENVELOPE_20201208.ZIP.PGP.archive
        calculatedEnvelopeDate=$(date +%Y%m%d)
      ;;
      mgl)
        #ENVELOPE_20201208.ZIP.PGP.archive
        calculatedEnvelopeDate=$(date +%Y%m%d)
      ;;
      suncorp)
        # Suncorp
        # If today is 08 December, file that is uploaded is -2
        #ENVELOPE_20201206.ZIP.GPG.archive
        calculatedEnvelopeDate=$(date -d "-2 days" +%Y%m%d)
      ;;
      *)
        # unknown optioneDate CUSTOMER_NAME is invalid." 5
      ;;
    esac
}


function fn_get_wlm_success_count() {
  # What is the number of successful WLM runs for X date?


  #WLM_FULL_GROUP is defined in the netreveal_batch.conf
  # Default value is WLMFullSubjectVsDeltaListGroup
  wlmTargetGroupName=$WLM_FULL_GROUP
  # logger "wlmTargetGroupName: $wlmTargetGroupName"
  # logger "calculatedEnvelopeDateForQueries:$calculatedEnvelopeDateForQueries"

  thisComponentType=WLM

  fn_trigger_sql getSuccessfulXBatch.sql "$wlmTargetGroupName" "$calculatedEnvelopeDateForQueries" "$thisComponentType"
  successfulWLMCount=$g_sql_value
  # logger "successfulWLMCount:$successfulWLMCount"

  if [[ $? -ne $SUCCESS ]]
  then
    logger "Count failed for wlmTargetGroupName"
    fn_exit "Query failed for wlmTargetGroupName" 5
  else
    logger "The successful WLM runs for Envelope($calculatedEnvelopeDate) = $successfulWLMCount(This is calculated using $calculatedEnvelopeDateForQueries) that queries for wlmTargetGroupName($wlmTargetGroupName)"
  fi
}

function fn_get_aml_success_count() {
  # What is the number of successful aml runs for X date?

  # This parameters is for v7
  targetGroupName=AMLDetectionProcessing
  # logger "targetGroupName: $targetGroupName"
  # logger "calculatedEnvelopeDateForQueries:$calculatedEnvelopeDateForQueries"
  thisComponentType=DirectSourceProcessJob

  # NRDVO-1719 - Update parameters for v8
  if [[ "${NR_MAJOR_VERSION}" == "v8" ]]; then
    # Note that the SMBD/SMDB difference/typo is on purpose as that is configured in the db.
    targetGroupName=SMBD_Profiling
    thisComponentType=SMDBJob
  fi

  fn_trigger_sql getSuccessfulXBatch.sql "$targetGroupName" "$calculatedEnvelopeDateForQueries" "$thisComponentType"
  successfulAMLCount=$g_sql_value
  logger "successfulAMLCount:$successfulAMLCount"

  if [[ $? -ne $SUCCESS ]]
  then
    logger "Count failed for successfulAMLCount"
    fn_exit "Query failed for successfulAMLCount" 6
  else
    logger "The successful AML runs for Envelope($calculatedEnvelopeDate) =$successfulAMLCount(This is calculated using $calculatedEnvelopeDateForQueries) that queries for targetGroupName($targetGroupName)"
  fi
}

function fn_get_cdd_success_count() {
  # What is the number of successful cdd runs for X date?

  targetGroupName=CDDProcessing
  # logger "targetGroupName: $targetGroupName"
  # logger "calculatedEnvelopeDateForQueries:$calculatedEnvelopeDateForQueries"

  thisComponentType=BatchBridgeJob

  fn_trigger_sql getSuccessfulXBatch.sql "$targetGroupName" "$calculatedEnvelopeDateForQueries" "$thisComponentType"
  successfulCDDCount=$g_sql_value
  # logger "successfulCDDCount:$successfulCDDCount"

  if [[ $? -ne $SUCCESS ]]
  then
    logger "Calendar State select query failed for successfulCDDCount"
    fn_exit "Query failed for successfulCDDCount" 7
  else
    logger "The successful CDD runs for Envelope($calculatedEnvelopeDate) =$successfulCDDCount(This is calculated using $calculatedEnvelopeDateForQueries) that queries for targetGroupName($targetGroupName)"
  fi
}

function fn_get_db_calendar_state() {
  # Gets ENDOFDAY
  batchComponent="EIM DataLoad"
  # batchDateFromDB=$(/opt/sqlcl/bin/sql -s $DB_CONNECT_STRING @${SQL_LOCATION}/selectCalendarState.sql "$batchComponent")

  fn_trigger_sql selectCalendarState.sql "$batchComponent"
  batchDateFromDB=$g_sql_value
  logger "batchDateFromDB:$batchDateFromDB"
  # Gets ENDOFDAY
  # ENDOFDAY,CURRENTDAY,COMPONENT,ORGUNIT_CODE,MESSAGE,UPDATE_TIMESTAMP
  # 20160624,20160624,EIM DataLoad,,BatchBridge 'CustomerBatchBridge' finished Acquisition Source Structured File 'CUSTOMERS_20160624.txt'.Processed Record count 2, duration 0.151, speed 13.245033112582782 rec/sec,05/11/2020 05:35:51.586000000

  if [[ $? -ne $SUCCESS ]]
  then
    logger "Calendar State select query failed for $batchComponent"
    fn_exit "Query failed for $batchComponent" 4
  else
    logger "Calendar State select query returned endofday=$batchDateFromDB for $batchComponent"
  fi
}

function fn_get_eod_from_file() {
  logger "Start fn_get_eod_from_file "
  # Get batch date from endofday.txt file
  # check endofday.txt file exists
  endofdayfile="$ACQHOME/endofday.txt"
  if [ -f "$endofdayfile" ]
  then
    # If exists then read the batchDateFromEODFile from it
    echo "$endofdayfile found, reading batch date"
    read -r batchDateFromEODFile < $endofdayfile
  else
    fn_exit "No Endofday file - $endofdayfile not found."
  fi
}

function fn_is_multi_batch_completed() {
  logger "Start Multibatch tests"
  # Get batch date from endofday.txt file
  # check endofday.txt file exists
  # This relies on the fact that the multibatches will create an aml_$batchDate.flag file after the aml has completed processing, which indicates the end of day file
  estimatedBatchEOD=$1

   if [[ $MULTIBATCH -eq $TRUE ]];
    then
      logger "Test 1 - Client is using MULTIBATCH"
      logger "Test 2 - Looking for $LOCKFILE_DIR/aml_$estimatedBatchEOD.flag"
      if  [[ -f "$LOCKFILE_DIR/aml_$estimatedBatchEOD.flag" ]];
        then
          logger "SUCCESS: All good. Able to find the aml_$estimatedBatchEOD.flag for today."
          isMultiBatchCompleted=$TRUE
        else
          logger "FAILURE: Multibatch is not done for today"
          isMultiBatchCompleted=$FALSE
      fi
    else
    logger "SUCCESS: Client not using MULTIBATCH feature. Has passed the multibatch test."
    isMultiBatchCompleted=$TRUE
  fi
}

function fn_check_wlm() {
  if [[ $NR_WLM_BATCH -eq $TRUE ]];
    then
      logger "WLM - Client is using WLM Module"
      logger "WLM Test - Checking count of successful WLM for $calculatedEnvelopeDate"

      fn_get_wlm_success_count

      # It is set to be greater than the target as if an environment has manual intervention it will be more.
      if  [[ $successfulWLMCount -ge $targetWLMBatches ]];
        then
          logger "SUCCESS: All good. The successfulWLMCount($successfulWLMCount) >= targetWLMBatches($targetWLMBatches)."
          isWLMBatchesCompleted=$TRUE
        else
          logger "FAILURE: WLM is not done for today"
          isWLMBatchesCompleted=$FALSE
      fi
    else
      logger "SUCCESS: Client not using WLM Module. Pass by default."
      isWLMBatchesCompleted=$TRUE
  fi
}

function fn_check_aml() {
  if [[ $NR_AML_BATCH -eq $TRUE ]];
    then
      logger "AML - Client is using AML Module"
      logger "AML Test - Checking count of successful AML for $calculatedEnvelopeDate"

      fn_get_aml_success_count

      # It is set to be greater than the target as if an environment has manual intervention it will be more.
      if  [[ $successfulAMLCount -ge $targetAMLBatches ]];
        then
          logger "SUCCESS: All good. The successfulAMLCount($successfulAMLCount) >= targetAMLBatches($targetAMLBatches)."
          isAMLBatchesCompleted=$TRUE
        else
          logger "FAILURE: AML is not done for today"
          isAMLBatchesCompleted=$FALSE
      fi
    else
      logger "SUCCESS: Client not using AML Module. Pass by default."
      isAMLBatchesCompleted=$TRUE
  fi
}

function fn_check_cdd() {
  if [[ $NR_CDD_BATCH -eq $TRUE ]];
    then
      logger "CDD - Client is using CDD Module"
      logger "CDD Test - Checking count of successful CDD for $calculatedEnvelopeDate"

      fn_get_cdd_success_count

      # It is set to be greater than the target as if an environment has manual intervention it will be more.
      if  [[ $successfulCDDCount -ge $targetCDDBatches ]];
        then
          logger "SUCCESS: All good. The successfulCDDCount($successfulCDDCount) >= targetCDDBatches($targetCDDBatches)."
          isCDDBatchesCompleted=$TRUE
        else
          logger "FAILURE: CDD is not done for today"
          isCDDBatchesCompleted=$FALSE
      fi
    else
      logger "SUCCESS: Client not using CDD Module. Pass by default."
      isCDDBatchesCompleted=$TRUE
  fi
}

function fn_test_create_missing_envelope() {
  logger "Start fn_test_create_missing_envelope"
  logger "createMissingEnvelopes: $createMissingEnvelopes (1 indicates that this is enabled)"

  # NRDVOX-887
  fn_use_envelope_start_epoch_time

  fn_get_eod_from_file
  fn_get_db_calendar_state

  fn_check_wlm
  fn_check_aml
  fn_check_cdd

  fn_is_multi_batch_completed $calculatedEnvelopeDate

  logger "*****Quick Summary*********"
  logger "batchDateFromEODFile:$batchDateFromEODFile"
  logger "batchDateFromDB:$batchDateFromDB"
  logger "calculatedEnvelopeDate for $CUSTOMER_NAME:$calculatedEnvelopeDate"
  logger "****Details on WLM/AML/CDD ******"
  logger "isWLMBatchesCompleted: $isWLMBatchesCompleted (This should be 1)"
  logger "isAMLBatchesCompleted: $isAMLBatchesCompleted  (This should be 1)"
  logger "isCDDBatchesCompleted: $isCDDBatchesCompleted  (This should be 1)"
  logger "****Details on MULTIBATCH******"
  logger "isMultiBatchEnabled: $isMultiBatchEnabled (This should be 1)"
  logger "isMultiBatchCompleted: $isMultiBatchCompleted  (This should be 1)"
  logger "***************************"

  if [ $batchDateFromEODFile -eq 20160101 ]
  then
    logger "As batchDateFromEODFile=20160101, usually this indicates that the batch has not been run (recent snapshot update), no need to continue."
    logger "Note that in the test we pass through to see how the system behaves"
   fi

  if [[ $batchDateFromEODFile -eq $batchDateFromDB ]] && [[ $batchDateFromEODFile -eq $calculatedEnvelopeDate ]] && [[ $batchDateFromDB -eq $calculatedEnvelopeDate ]] && [[ $isMultiBatchCompleted -eq $TRUE ]]
  then
    logger "TEST: SUCCESS: All 3 checks equals to each other, no further action"
    logger "batchDateFromDB($batchDateFromDB) = batchDateFromEODFile($batchDateFromEODFile) = calculatedEnvelopeDate($calculatedEnvelopeDate)"
    logger "isMultiBatchEnabled($isMultiBatchEnabled), isMultiBatchCompleted($isMultiBatchCompleted)"
    fn_exit "$batchDateFromDB = $batchDateFromEODFile, batch is completed, no further action"
  else
    logger "TEST: It will create missing envelope for for $calculatedEnvelopeDate"
  fi
}

function fn_create_missing_envelope() {
  logger "createMissingEnvelopes: $createMissingEnvelopes (1 indicates that this is enabled)"

  # NRDVOX-887
  fn_use_envelope_start_epoch_time

  fn_get_eod_from_file
  fn_get_db_calendar_state

  fn_check_wlm
  fn_check_aml
  fn_check_cdd


  # Multi batch specific
  fn_is_multi_batch_completed $calculatedEnvelopeDate

  logger "*****Quick Summary*********"
  logger "batchDateFromEODFile:$batchDateFromEODFile"
  logger "batchDateFromDB:$batchDateFromDB"
  logger "calculatedEnvelopeDate for $CUSTOMER_NAME:$calculatedEnvelopeDate"
  logger "****Details on WLM/AML/CDD ******"
  logger "isWLMBatchesCompleted: $isWLMBatchesCompleted (This should be 1)"
  logger "isAMLBatchesCompleted: $isAMLBatchesCompleted  (This should be 1)"
  logger "isCDDBatchesCompleted: $isCDDBatchesCompleted  (This should be 1)"
  logger "****Details on MULTIBATCH******"
  logger "isMultiBatchEnabled: $isMultiBatchEnabled (This should be 1)"
  logger "isMultiBatchCompleted: $isMultiBatchCompleted  (This should be 1)"
  logger "***************************"

  if [ $batchDateFromEODFile -eq 20160101 ]
  then
    logger "As batchDateFromEODFile=20160101, usually this indicates that the batch has not been run (recent snapshot update), no need to continue."
    fn_exit "SUCCESS: As batchDateFromEODFile=20160101, usually this indicates that the batch has not been run (recent snapshot update), no need to continue."
  fi

  #Test
  #calculatedEnvelopeDate=20160101

  if [[ $batchDateFromEODFile -eq $batchDateFromDB ]] && [[ $batchDateFromEODFile -eq $calculatedEnvelopeDate ]] && [[ $batchDateFromDB -eq $calculatedEnvelopeDate ]] && [[ $isMultiBatchCompleted -eq $TRUE ]] && [[ $isWLMBatchesCompleted -eq $TRUE ]] && [[ $isAMLBatchesCompleted -eq $TRUE ]] && [[ $isCDDBatchesCompleted -eq $TRUE ]]
  then
    logger "SUCCESS: All 7 checks equals to each other, no further action"
    logger "batchDateFromDB($batchDateFromDB) = batchDateFromEODFile($batchDateFromEODFile) = calculatedEnvelopeDate($calculatedEnvelopeDate)"
    logger "isMultiBatchCompleted: $isMultiBatchCompleted"
    logger "isWLMBatchesCompleted: $isWLMBatchesCompleted (This should be 1)"
    logger "isAMLBatchesCompleted: $isAMLBatchesCompleted  (This should be 1)"
    logger "isCDDBatchesCompleted: $isCDDBatchesCompleted  (This should be 1)"
    fn_exit "SUCCESS: $batchDateFromDB = $batchDateFromEODFile, batch is completed, no further action"
  else
    logger "Did not detect any envelope for today, $calculatedEnvelopeDate, creating a MissingEnvelope"
    message="
    The batch file for $CUSTOMER_NAME.$ENV_TYPE was not received today at this time (Actual: $(date +%D\ %R:%S)).

    Impact:
    1.A 'missing_envelope' is created at: $envelopeCheckerFilePath/$envelopeCheckerFilePrefix$calculatedEnvelopeDate
    2.This might stop any subsequent automated envelope processing
        To enable, remove the missing_envelope(#1)
    3.This might stop any subsequent automated watchlist ingestions
        To enable
          Remove the missing_envelope (#1)
          Run the command to create the watchlist flag file

    ***Current Parameters***
    createMissingEnvelopes: $createMissingEnvelopes
      If createMissingEnvelopes = 1 (true), it will create missing envelopes

    calculatedEnvelopeDate: $calculatedEnvelopeDate
      If this is not set, it results in creating missing envelopes as it will fail 1 of the checks.

    isMultiBatchEnabled: $isMultiBatchEnabled
      If isMultiBatchEnabled = 1, it is enabled
      If isMultiBatchEnabled = 0, it is disabled

    missingEnvelopesLimit: $missingEnvelopesLimit
      If missingEnvelopesLimit is 0, that means there must not be any missing envelope

    disableEnvelopeIngestion: $disableEnvelopeIngestion
     If disabableEnvelopeIngestion = 1, it will disable Envelope Ingestions (at DXVLanding.sh)

    disableWatchlistIngestion: $disableWatchlistIngestion
      If disableWatchlistIngestion = 1, it will disable Watchlist Ingestions (eg downloadWatchlist.sh)
    *************************
    "

    fn_create_a_missing_envelope "$message"
    fn_send_missing_envelope_notification "$message"

    logger "SUCCESS: Sent an email and created a file for $calculatedEnvelopeDate"
  fi
}

function fn_get_envelope_ingestion_status() {
  fn_get_missing_envelopes_count
  logger "missingEnvelopesCount: $missingEnvelopesCount"
  logger "missingEnvelopesLimit: $missingEnvelopesLimit"
  logger "disableEnvelopeIngestion: $disableEnvelopeIngestion"

  checkOutputValue=

  # Checks for Envelop Ingestion
  if [[ $disableEnvelopeIngestion -eq $TRUE && $missingEnvelopesCount -gt $missingEnvelopesLimit ]];
  then
    logger "Not proceeding with Envelope Ingestion"
    checkOutputValue=1
  else
    logger "Safe to continue with Envelope Ingestion"
    checkOutputValue=0
  fi

  fn_return_exit $checkOutputValue
}

function fn_get_watchlist_ingestion_status() {
  fn_get_missing_envelopes_count
  logger "missingEnvelopesCount: $missingEnvelopesCount"
  logger "missingEnvelopesLimit: $missingEnvelopesLimit"
  logger "disableWatchlistIngestion: $disableWatchlistIngestion"

  checkOutputValue=

  if [[ $disableWatchlistIngestion -eq $TRUE && $missingEnvelopesCount -gt $missingEnvelopesLimit ]];
  then
    logger "Not proceeding with Watchlist Ingestion"
    fn_send_disable_watchlist_notification
    checkOutputValue=1
  else
    logger "Safe to continue with Watchlist Ingestion"
    checkOutputValue=0
  fi

  fn_return_exit $checkOutputValue
}

function fn_set_envelope_start_epoch_time() {
  logger "Start fn_set_envelope_start_epoch_time"
  # NRDVOX-887
  ## Set the current EPOCH time into a file to be used later.
  envelopeStartDateInEpoch=$(date +%s)

  logger "Update Envelope Processing start time to $envelopeStartDateInEpoch $envelopeCheckerFilePath/envelopeStartDateInEpoch.txt"

  echo "$envelopeStartDateInEpoch" > "$envelopeStartEpochDateFile"
  logger "End fn_set_envelope_start_epoch_time"
}

function fn_use_envelope_start_epoch_time() {
  # NRDVOX-887
  logger "Start fn_use_envelope_start_epoch_time"
  # logger "IF the value exists, use it for the upcoming calculations by replacing the value of calculatedEnvelopeDateForQueries"

  logger "Question #88: Does the file($envelopeStartEpochDateFile) exists?"
  if [ -f "$envelopeStartEpochDateFile" ]
  then
    # If exists then read the batchDateFromEODFile from it
    echo "Answer #88: File($envelopeStartEpochDateFile) found, reading batch start time in EPOCH"
    read -r envelopeStartEpochDateValueFromFile < "$envelopeStartEpochDateFile"

    if [ -n "$envelopeStartEpochDateValueFromFile" ]; then
      logger "Envelope Start Processing Epoch Time is available, updating calculatedEnvelopeDateForQueries from ($calculatedEnvelopeDateForQueries) to ($envelopeStartEpochDateValueFromFile)"

      calculatedEnvelopeDateForQueries=$envelopeStartEpochDateValueFromFile

      logger "calculatedEnvelopeDateForQueries=$calculatedEnvelopeDateForQueries, which translates to $(date -d "@$calculatedEnvelopeDateForQueries" +"%Y-%m-%d %H:%M:%S")"
    fi

  else
    logger "Answer #88: File($envelopeStartEpochDateFile) not found, do nothing"
  fi

  logger "End fn_use_envelope_start_epoch_time"
}

function fn_decision_tree() {
  logger "fn_decision_tree: START"
  logger "Number of arguments : $#"
  logger "Argument 1: $1"
  logger "Argument 2: $2"

  if [ $# -ge 1 ]; then
    case $1 in
      testCreateMissingEnvelope)
        logger "INFO: Running testCreateMissingEnvelope function"
        # This is a handy feature to test the main code (createMissingEnvelope)
        fn_test_create_missing_envelope
      ;;
      createMissingEnvelope)
        logger "INFO: Running createMissingEnvelope function"
        # This is the main code that does the checks... once a day
        if [ $createMissingEnvelopes -eq $TRUE ];
        then
          fn_create_missing_envelope
        else
          logger "INFO: createMissingEnvelope is disabled."
        fi
      ;;
      checkEnvelopeIngestion)
        logger "INFO: Running currentStatus function"
        fn_get_envelope_ingestion_status
      ;;
      checkWatchlistIngestion)
        logger "INFO: Running currentStatus function"
        startWatchlistIngestionCommand=$2
        fn_get_watchlist_ingestion_status
      ;;
      setEnvelopeStartEpochTime)
        logger "INFO: setEnvelopeStartEpochTime"
        fn_set_envelope_start_epoch_time
      ;;
      useEnvelopeStartEpochTime)
        logger "INFO: getEnvelopeStartEpochTime"
        fn_use_envelope_start_epoch_time
      ;;

      *)
        # unknown option
        fn_exit "ERROR: Unknown/Unsupported Function option selected. Valid options are createMissingEnvelope|checkEnvelopeIngestion|checkWatchlistIngestion|testCreateMissingEnvelope|setEnvelopeStartEpochTime." 5
      ;;
    esac
  else
    logger "INFO: Function and Type is not specified. Defaulting to count"
    fn_create_missing_envelope
  fi

  logger "fn_decision_tree: END"
}

function fn_sql_db_setup() {
  # logger "DBENGINE: $DBENGINE"

  # Have thought about putting this in its own shellscript but in most cases the following might be unique to a shellscript so it is placed within the shellscript
  # -- User to call
  # -- SQL location
  case $DBENGINE in
    postgres)
      export dbendpoint="$DBENDPOINT"
      export PGPASSWORD='{{ .Values.global.baseConfigProperties.clusterdb.AppPassword }}'
      {{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") }}
      export PGSSLMODE="{{ .Values.global.baseConfigProperties.db.postgresql.sslmode }}"
      export PGSSLROOTCERT="{{ .Values.global.baseConfigProperties.db.postgresql.sslrootcert }}"
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
  # Just give me the script name and some variables
  scriptName=$1
  variable1="$2"
  variable2="$3"
  variable3="$4"
  variable4="$5"
  variable5="$6"
  # Always set this to null when it is triggered
  g_sql_value=

  #  logger "DBENGINE: $DBENGINE"
  #  logger "$scriptName, $variable1 $variable2 $variable3"

  case $DBENGINE in
    postgres)
      g_sql_value=$(psql -qtAX -U {{ .Values.global.baseConfigProperties.db.postgresql.userid }} -h ${dbendpoint} -p 5432 -d {{ .Values.global.baseConfigProperties.db.postgresql.database }} -f $SQL_LOCATION/$scriptName -v v1="'$variable1'" -v v2="'$variable2'" -v v3="'$variable3'" -v v4="'$variable4'" -v v5="'$variable5'")
      # The postgres version will automatically print the output so no logger is required
    ;;
  esac

  # logger "End fn_trigger_sql"
}



blank_space
logger "Start Script"
fn_setup_script
fn_sql_db_setup
fn_decision_tree "$@"
logger "End Script"

##############################################################################
##############################################################################
# TERMS
# missingEnvelope: This is a flag file that is created when there is a missing envelope

# Command Summary
#
# createMissingEnvelope
#      Checks 3 things to see if the acquisition has been completed
#      (EOD file, database table, ad-hoc calculation based on todays date)
#
# checkEnvelopeIngestion
# This is a command that other scripts can call to see if there was any issue with past envelope ingestions
# It returns:
#   0 - No issues found
#   1 - Issues found
# An issue is defined as:
#   There are missingEnvelope(s) that was created, and it exceeds the limit
#   The disableEnvelopeIngestion SSM parameter is set to true

# checkWatchlistIngestion
# Same as checkEnvelopeIngestion but it uses a different SSM parameter so both can be controlled independently
# Also since there is multiple watchlist shellscripts and they all don't have the function to send SNS, it is done here
# This is a command that other scripts can call to see if there was any issue with past envelope ingestions
# It returns:
#   0 - No issues found
#   1 - Issues found
# An issue is defined as:
#   There are missingEnvelope(s) that was created, and it exceeds the limit
#   The disableWatchlistIngestion SSM parameter is set to true

# NRDVOX-887
#setEnvelopeStartEpochTime
# When triggered, it sets the current time in EPOCH to a file

#useEnvelopeStartEpochTime
#  When triggered, it gets the EPOCH time from a file
#  Then it can overwrite calculatedEnvelopeDateForQueries, which is used in the queries
#   This will help to further finetune the query to get the exact hour of when the query starts. And use that instead of the current +/- 1 day.

# Sample
#sh ./envelopeChecker createMissingEnvelope
#sh ./envelopeChecker checkEnvelopeIngestion
#sh ./envelopeChecker checkWatchlistIngestion 'flag command'
##############################################################################
##############################################################################
