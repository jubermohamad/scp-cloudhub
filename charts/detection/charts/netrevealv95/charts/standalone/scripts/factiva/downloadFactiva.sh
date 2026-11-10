#!/bin/bash
. /opt/netreveal/standaloneHome/factivaScripts/netreveal_batch.conf
#. ~/.bash_profile

# Factiva Daily Download Script.
# Hits the Default Factiva URL and gets a list of available files, pulls the first daily file found in the list
# Pulls username/password from repository each time its required

# No arguments are required for this script - it assumes credential service is good to go with pre-set customer and
# environment name variables, and will default to a daily delta file download.
# A single optional argument containing the daily|weekly|full is allowed.
#
# This file will be renamed from downloadFactiva.sh to /usr/local/bin/downloadWatchlist when deployed.
#

MINIO_URL=${MINIO_URL:-empty}
MINIO_USER=${MINIO_USER:-netreveal}
MINIO_PASSWORD=${MINIO_PASSWORD:-pass}

export MC_CONFIG_DIR="/mc-config/.mc"

PATH=$PATH:/usr/local/bin
NR_HOME=/opt/netreveal/standaloneHome
DOWNLOAD_LIST_LOG="${NR_HOME}/logs/downloadWatchlist.log"
MINIO_FPFA_BUCKET_PATH="minio/private-bucket/landing/fpfa"
IMPORT_DIR=${NR_HOME}/conf/wlm/fpfa
WL_ARCHIVE_DIR=${NR_HOME}/conf/wlm/archive/lists
WL_FILES_IN_ARCHIVE_DIR_COUNT=0
WL_FILE_HASH=""
WL_LOADED_FILE_DATETIME_STAMP=""


touch ${DOWNLOAD_LIST_LOG}
exec 3>&1 1> >(tee -a ${DOWNLOAD_LIST_LOG}) 2>&1
#Setting permissions to ensure that other has no access
chmod 640 ${DOWNLOAD_LIST_LOG}

# Co-Op and Latitude use slightly different URL annoyingly
if [ "${CUSTOM_FACTIVA_IN_USE^^}" == "TRUE" ]; then
  HOST=djrcfeed.dowjones.com
  URL=https://${HOST}/xml/
else
  URL=$FACTIVA_URL
  HOST=$(echo $URL | cut -d'/' -f3)
fi

# If using cutom FACTIVA (this is currently as of Dec 2022 just the two projects COOP and Latitude) then read in the FILE_PREFIX from netreveal_batch.conf
if [ "${CUSTOM_FACTIVA_IN_USE^^}" == "TRUE" ]; then
  FILE_PREFIX=${CUSTOM_FACTIVA_FILE_PREFIX}
fi

FULL_SUFFIX="_f.zip"
FULL_LOADMETHOD=3

# Check if FULL_LOADMETHOD needs to be overwritten, which happens if set to custom in netreveal_batch.conf
if [ "${CUSTOM_FACTIVA_FULL_LOADMETHOD^^}" != "" ]; then
  FULL_LOADMETHOD=${CUSTOM_FACTIVA_FULL_LOADMETHOD}
fi

DAILY_SUFFIX="_d.zip"
DAILY_LOADMETHOD=1
WEEKLY_SUFFIX="_i.zip"
WEEKLY_LOADMETHOD=2

WL_DOWNLOAD_RETRY_X_TIMES=${WATCHLIST_DOWNLOAD_RETRY_X_TIMES:-5}
WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS=${WATCHLIST_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS:-60}
WL_TRIGGER_ONLY_AFTER_BATCH_FINISHES=${WATCHLIST_TRIGGER_ONLY_AFTER_BATCH_FINISHES}
WL_BATCH_COMPLETE_CHECK_RETRY_X_TIMES=${WATCHLIST_BATCH_COMPLETE_CHECK_RETRY_X_TIMES:-3}
WL_BATCH_COMPLETE_CHECK_RETRY_INTERVAL_IN_SECONDS=${WATCHLIST_BATCH_COMPLETE_CHECK_RETRY_INTERVAL_IN_SECONDS:-3600}
WL_LOAD_RUNNING_CHECK_REQUIRED=${WATCHLIST_LOAD_RUNNING_CHECK_REQUIRED}
WL_LOAD_RUNNING_CHECK_RETRY_X_TIMES=${WATCHLIST_LOAD_RUNNING_CHECK_RETRY_X_TIMES:-10}
WL_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS=${WATCHLIST_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS:-1800}
WLM_MONITORING_DIR="${NR_HOME}/wlmMonitoring"
WLM_running_flag="${WLM_MONITORING_DIR}/WLM_load_currently_running.flag"

function fn_remove_lock_file() {
	if [ -f "${WLM_running_flag}" ]; then
		logger "INFO: Removing lockfile ${WLM_running_flag}"
		rm -rf "${WLM_running_flag}"
	fi
}

function error_exit() {
	local msg="$1"
	local code="$2"
	local removeLockFile="${3:0}"
	# NRDVO-440 - Temp file path reviewed...this does not need to be in EFS.
	LOGFILE="${NR_HOME}/logs/getDXVLandingFilesTail.log"
	tail -200 ${DOWNLOAD_LIST_LOG} > ${LOGFILE}

	logger "FATAL_ERROR: Exiting - EXIT_CODE(${code}) - ${msg}"

	echo "{\"Reason\": EXIT_CODE(${code}) - \"${msg}\"}" >&3 3>&- # echo reason to stdout (instead of log) and then close fd 3
	if [ "${removeLockFile}" == "1" ]; then
		fn_remove_lock_file
	fi
	exit $code
}

function fn_exit() {
	logger "$1"
	echo "$1" >&3 3>&- # echo reason to stdout (instead of log) and then close fd 3
	fn_remove_lock_file
	exit $2
}

function logger() {
	local ts=$(date +%D\ %R:%S)
	echo "${ts} - ${1}"
}

function fn_create_lock_file() {
	# NRDVO-1395 - Creating Watchlist running flag file to prevent another load from running at the same time.

	if [ -f ${WLM_running_flag} ]; then
		logger "WARNING: [${WLM_running_flag}] was found - Checking if a previous Watchlist load is still running."
		logger "WARNING: ... and will recheck this a total of ${WL_LOAD_RUNNING_CHECK_RETRY_X_TIMES} times if required..."
		logger "WARNING: ... with an interval of ${WL_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS} seconds between retries."
		loopCounter=0
		while [ ${loopCounter} -lt ${WL_LOAD_RUNNING_CHECK_RETRY_X_TIMES} ]; do
			logger "WARNING: Previous Watchlist load running check: Loop [$(( ${loopCounter}+1 ))] of [${WL_LOAD_RUNNING_CHECK_RETRY_X_TIMES}]"
			(( loopCounter++ ))
			logger "WARNING: Re-checking in [${WL_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS}] seconds ..."
			sleep ${WL_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS}
			if [ ! -f ${WLM_running_flag} ]; then
				logger "INFO: Previous Watchlist load appears to have now completed, therefore this script will progress with the current load."
				break;
			fi;
		done
		if [[ ${loopCounter} -ge ${WL_LOAD_RUNNING_CHECK_RETRY_X_TIMES} ]]; then
			#ERROR - RAISE ALERT - PREVIOUS WATCHLIST LOAD WAS STILL RUNNING SO CURRENT LOAD COULD NOT BEGIN IN TIME AND EXIT
			logger "ERROR: Previous Watchlist load was still running or there has been a problem that requires manual intervention."
			logger "ERROR: Once the underlying issue has been resolved, then the [${WLM_running_flag}] must be deleted manually to allow the next run of this script to complete."
			logger "ERROR: If the previous run is simply taking a long time, then it may just be necessary to increase the time and/or number of re-checks by upping the [WATCHLIST_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS] and/or [WATCHLIST_LOAD_RUNNING_CHECK_RETRY_X_TIMES] values in the projects netreveal_batch.conf files."
			logger "ERROR: Note: The current Watchlist has NOT been loaded."

			error_exit "Previous Watchlist load was still running or there has been a problem that requires manual intervention. Current Watchlist has NOT been loaded." 4 0
		fi
	else
		logger "INFO: Previous Watchlist load appears to have completed as [${WLM_running_flag}] does not exist at this time."
	fi

	touch "${WLM_running_flag}"
	cmd_status=$?
	if [[ ${cmd_status} -ne 0 || ! -f ${WLM_running_flag} ]]; then
		error_exit "Unable to create [${WLM_running_flag}] file. Ensure [${WLM_running_flag%/*}] directory does exist and the [netreveal] user has write permissions to it." ${cmd_status}
	else
		trap 'fn_exit "Exiting and removing lock file. trap EXIT" 0' EXIT
		trap 'fn_exit "Exiting and removing lock file. trap SIGINT" 0' SIGINT
		trap 'fn_exit "Exiting and removing lock file. trap SIGTERM" 0' SIGTERM
		logger "INFO: Successfully created [${WLM_running_flag}] file."
	fi
}


function fn_prepare_credentials {
	# grab credentials and store.
	USERNAME='{{ .Values.factiva.factivaParameters.username }}'
	PASSWORD='{{ .Values.factiva.factivaParameters.password }}'
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
    error_exit "Failed to create MinIO alias 'minio'" 1
  fi
}

function fn_download_file() {
	local url="$1"
	local dest="$2"
	local username="$3"
	local password="$4"
	local retryXTimes=$5
	local retryInterval=$6

	logger "INFO: Downloading file from ${url} to ${dest}"
	logger "INFO: retryXTimes=${retryXTimes}, retryInterval=${retryInterval}"

	if [[ -z "$url" ]]; then
		error_exit "Download URL is empty." 3
	fi
	if [[ -z "$dest" ]]; then
		error_exit "Download destination file is empty." 3
	fi
	logger "INFO: Downloading: ${url}"
	local loopCounter=0
	while [[ ${loopCounter} -lt ${retryXTimes} ]]; do
		curl -s -u "${username}":"${password}" -o "$dest" "${url}"
		if [ $? -eq 0 ]; then
			if [ ! -s "$dest" ]; then
				logger "WARNING: Downloaded file is empty!"
			else
				logger "INFO: File downloaded  successfully"
				return 0
			fi
		fi
		logger "WARNING: Unable to download ${url}"
		logger "INFO: Loop $(( ${loopCounter}+1 )) of ${retryXTimes}"
		(( loopCounter++ )); logger "WARNING: Retrying in ${retryInterval} seconds ..."; sleep ${retryInterval}; continue;
	done;
	if [[ ${loopCounter} -ge ${retryXTimes} ]]; then
		#ERROR - RAISE ALERT - WATCHLIST DOWNLOAD DID NOT COMPLETE IN TIME AND EXIT
		error_exit "File ${url} download was NOT successful after ${retryXTimes} attempts. Manual remedial action required." 3
	fi
	return 1
}

function fn_wait_until_import_finish(){
	local lastImportStartedDate=${1}
	local loopCounter=0
	local lastImportStartedDateDB=""
	local importFileStarted=0

	while [ ${loopCounter} -lt ${WL_LOAD_RUNNING_CHECK_RETRY_X_TIMES} ]; do
		logger "INFO: Current Watchlist load running check: Loop [$(( ${loopCounter}+1 ))] of [${WL_LOAD_RUNNING_CHECK_RETRY_X_TIMES}]"
		lastImportStartedDateDB=$(bash ${NR_HOME}/factivaScripts/executeDBScript.sh --database-engine ${DBENGINE} --filename ${NR_HOME}/factivaScripts/getListImportStartDate.sql | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
		if [[ "${lastImportStartedDate}" != "${lastImportStartedDateDB}" && ${importFileStarted} -eq 0 ]]; then
			lastImportStartedDate="${lastImportStartedDateDB}"
			logger "INFO: Import of file has been started"
			importFileStarted=1
		fi

		if [[ ${importFileStarted} -eq 1 ]]; then
			local isListImported=$(bash ${NR_HOME}/factivaScripts/executeDBScript.sh --database-engine ${DBENGINE} --filename ${NR_HOME}/factivaScripts/isListImported.sql | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
			if [[ "${isListImported}" == "1" ]]; then
				logger "SUCCESS: Import of file has been finished"
				return 0
			fi
		fi
		(( loopCounter++ )); logger "INFO: Re-checking in [${WL_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS}] seconds ..."; sleep ${WL_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS}

	done
	#ERROR - RAISE ALERT - CURRENT WATCHLIST LOAD WAS STILL RUNNING AND DID NOT COMPLETE IN ALOTTED TIME AND EXIT
	logger "ERROR: Current Watchlist load is still running or there has been a problem that requires manual intervention."
	logger "ERROR: Once the underlying issue has been resolved, then the [${WLM_running_flag}] must be deleted manually to allow the next run of this script to complete."
	logger "ERROR: If the current run is simply taking a long time, then it may just be necessary to increase the time and/or number of re-checks by upping the [WATCHLIST_LOAD_RUNNING_CHECK_RETRY_INTERVAL_IN_SECONDS] and/or [WATCHLIST_LOAD_RUNNING_CHECK_RETRY_X_TIMES] values in the projects netreveal_batch.conf files."
	logger "ERROR: Note: The current Watchlist load has been started and may still be in progress."
	error_exit "Current Watchlist load is still running or there has been a problem that requires manual intervention. Current Watchlist load has been started and may still be in progress." 4
}

function fn_main() {
	fn_prepare_credentials
	fn_connect_to_minio

	#work out what type of file we're after/load type we're triggering.  Default to daily.
	if [ $# -ge 1 ]; then
		case $1 in
		daily)
			LOADMETHOD=${DAILY_LOADMETHOD}
			SUFFIX=${DAILY_SUFFIX}
			logger "INFO: Daily download selected"
		;;
		weekly)
			LOADMETHOD=${WEEKLY_LOADMETHOD}
			SUFFIX=${WEEKLY_SUFFIX}
			logger "INFO: Weekly download selected"
		;;
		full)
			LOADMETHOD=${FULL_LOADMETHOD}
			SUFFIX=${FULL_SUFFIX}
			logger "INFO: Full download selected"
		;;
		exact)
			LOADMETHOD=""
			#SUFFIX=${FULL_SUFFIX}
			EXACT_FILE=${2}
			logger "INFO: Exact download selected"
		;;
		*)
		# unknown option
			error_exit "Unknown/Unsupported download option selected. Valid options are daily|weekly|full. Defaults to daily if not specified" 4
		;;
		esac
	else
		logger "INFO: Download type not specified, defaulting to Daily"
		LOADMETHOD=${DAILY_LOADMETHOD}
		SUFFIX=${DAILY_SUFFIX}
	fi

	lastIngestedFile=""
	if [ "${LOADMETHOD}" == "${DAILY_LOADMETHOD}" ]; then
		if [ -f "${WLM_MONITORING_DIR}/lastIngestedFile.txt" ]; then
			lastIngestedFile=$(cat ${WLM_MONITORING_DIR}/lastIngestedFile.txt)
		fi
	fi
	if [ "${LOADMETHOD}" == "${WEEKLY_LOADMETHOD}" ]; then
		if [ -f "${WLM_MONITORING_DIR}/lastIngestedFile_weekly.txt" ]; then
			lastIngestedFile=$(cat ${WLM_MONITORING_DIR}/lastIngestedFile_weekly.txt)
		fi
	fi
	logger "INFO: Last ingested and imported file: ${lastIngestedFile}"

	#NRDVO-990: Add retry and wait time functionality to watchlist download
	logger "INFO: Attempting Watchlist download..."
	logger "INFO: ... and will retry this a total of ${WL_DOWNLOAD_RETRY_X_TIMES} times if required..."
	logger "INFO: ... with an interval of ${WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS} seconds between retries."

	if [ "${EXACT_FILE}" == "" ]; then
		# Awful Co-Op case first
		if [ "${FILE_PREFIX^^}" == "WATCHLIST_SEL_XML" ]; then
			URL="$URL$USERNAME/"
			fn_download_file "${URL}" "${IMPORT_DIR}/file_list.tmp" "${USERNAME}" "${PASSWORD}" ${WL_DOWNLOAD_RETRY_X_TIMES} ${WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS}
			fileList=$(cat "${IMPORT_DIR}/file_list.tmp" | awk -F '<div>|</div>' '{print $2}' | sed -E 's/^\s+//')
			rm -f "${IMPORT_DIR}/file_list.tmp"
		# Now the absolutely horrific Latitude case
		elif [ "${FILE_PREFIX^^}" == "DJRC_CUS_WL_XML" ]; then
			URL="$URL$USERNAME/"
			fn_download_file "${URL}" "${IMPORT_DIR}/file_list.tmp" "${USERNAME}" "${PASSWORD}" ${WL_DOWNLOAD_RETRY_X_TIMES} ${WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS}
			xml=$(cat "${IMPORT_DIR}/file_list.tmp")
			rm -f "${IMPORT_DIR}/file_list.tmp"
			somefilenames=()
			for val in ${xml//<br>/ }
			do
				filename=$(echo $val | perl -0777 -ne 'print "$1\n" if m/('"${FILE_PREFIX}"'[0-9A-Z_]*'"${SUFFIX}"')/i')
				if [ "${filename}" != "" ]; then
					somefilenames+=($filename)
				fi
			done
			# The above gives an array somefilenames in reverse chronological order, reverse it and put into array rev
			for (( i=${#somefilenames[@]}-1; i>=0; i--)); do rev[${#rev[@]}]=${somefilenames[i]}; done
			# Now turn this into single line csv to match other projects
			fileList=$(echo "$(IFS=,; echo "${rev[*]}")")
		# For all other projects, we can just easily curl the URL
		else
			fn_download_file "${URL}" "${IMPORT_DIR}/file_list.tmp" "${USERNAME}" "${PASSWORD}" ${WL_DOWNLOAD_RETRY_X_TIMES} ${WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS}
			fileList=$(cat "${IMPORT_DIR}/file_list.tmp")
			rm -f "${IMPORT_DIR}/file_list.tmp"
		fi
		if [[ -z "$fileList" ]]; then
			error_exit "ERROR: Unable to list available files [${fileList}]" 3
		fi

		files=$(echo ${fileList} | tr "," "\n" | grep ${SUFFIX})
		local filesToDownload=""
		local previousFileInList=""
		local watchlistIngestionOutOfDateFlag=""
		for file in $files
		do
			if [ "${previousFileInList}" == "" ]; then
				latestAvailableFile=${file}
			fi
			if [[ "${lastIngestedFile}" == ""  || ( "${LOADMETHOD}" != "${DAILY_LOADMETHOD}" && "${LOADMETHOD}" != "${WEEKLY_LOADMETHOD}" ) ]]; then
				filesToDownload="${file}"
				logger "INFO: Latest ${1} files available are: ${filesToDownload}"
				break
			fi
			if [ "${lastIngestedFile}" == "${file}" ]; then
				if [ "${previousFileInList}" == "" ]; then
					error_exit "No new watchlists available for download, latest ${1} file available ${file} has already been ingested" 5
				else
					if [ "${watchlistIngestionOutOfDateFlag}" != "" ]; then
						logger "WARNING: WLM watchlist ingestion not up to date. Last ingested file was ${lastIngestedFile}, latest files available from dow jones is ${latestAvailableFile}. Proceeding with ingestion of files: ${filesToDownload} which are next subsequent chronological files following ${lastIngestedFile}, however manual catchup to latest file ${latestAvailableFile} may be required."
					fi
					break
				fi
			else
				if [ "${previousFileInList}" != "" ]; then
					watchlistIngestionOutOfDateFlag="True"
					filesToDownload="$file $filesToDownload"
				else
					filesToDownload="$file"
				fi

				previousFileInList=${file}
				continue
			fi
		done
		else
			# download exact file
			filesToDownload="${EXACT_FILE}"
	fi
	if [ "${filesToDownload}" == "" ]; then
		error_exit "No files to download has been found in [${fileList}]" 3
	fi
	logger "INFO list files to download: ${filesToDownload}"
	for file in $filesToDownload
	do
		fn_download_file "${URL}${file}" "${IMPORT_DIR}/${file}" "${USERNAME}" "${PASSWORD}" ${WL_DOWNLOAD_RETRY_X_TIMES} ${WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS}
		logger "INFO: Watchlist file [$file] successfully downloaded, commencing with checksum"

		#NRDVO-759 - this section downloads md5 and does checksum
		logger "INFO: Downloading md5 checksum file"
		md5file="checksum_${file%.*}.txt"
		fn_download_file "${URL}feedlogs/${md5file}" "${IMPORT_DIR}/${md5file}" "${USERNAME}" "${PASSWORD}" ${WL_DOWNLOAD_RETRY_X_TIMES} ${WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS}
		if [ $? -ne 0 ]; then
			error_exit "ERROR: Unable to download checksum file [$md5file]" 3
		fi
		dos2unix ${IMPORT_DIR}/${md5file}
		hash1=$(cat ${IMPORT_DIR}/${md5file})
		hash2=`md5sum ${IMPORT_DIR}/${file} | awk '{ print $1 }'`
		WL_FILE_HASH="${hash2}"
		logger "INFO: Comparing checksum to that of file"
		if [ "${hash1^^}" != "${hash2^^}" ]; then
			rm -f ${IMPORT_DIR}/${file}
			rm -f ${IMPORT_DIR}/${md5file}
			error_exit "ERROR: checksum of [$file] failed" 3
		else
			rm -f ${IMPORT_DIR}/${md5file}
			# Move FPFA file to MinIO bucket
			if mc mv "${IMPORT_DIR}/${file}" "${MINIO_FPFA_BUCKET_PATH}/${file}"; then
				logger "INFO: File ${file} successfully moved to MinIO bucket ${MINIO_FPFA_BUCKET_PATH}"
			else
				error_exit "ERROR: Unable to move file ${file} to MinIO bucket ${MINIO_FPFA_BUCKET_PATH}" 3
			fi
			logger "INFO: Checksum of [$file] passed"
			logger "INFO: Checksum completed successfully so will progress to next stage."
		fi

		if [ "${SUFFIX}" != "" ]; then
			statsFile=$( echo "$file" | sed -e "s/${SUFFIX}$/.txt/" )
		else
			statsFile=$( echo "${file%_[a-zA-Z].zip}.txt" )
		fi
		mkdir -p $WLM_MONITORING_DIR/wlmDailyStats
		fn_download_file "${URL}feedlogs/${statsFile}" "$WLM_MONITORING_DIR/wlmDailyStats/${statsFile}" "${USERNAME}" "${PASSWORD}" ${WL_DOWNLOAD_RETRY_X_TIMES} ${WL_DOWNLOAD_RETRY_INTERVAL_IN_SECONDS}
		# Stats file is in DOS format, so convert to Unix
		dos2unix $WLM_MONITORING_DIR/wlmDailyStats/${statsFile}
		# Housekeep $NR_HOME/logs/wlmDailyStats folder - remove files older than 30 days
		rm -f "$(find "$WLM_MONITORING_DIR/wlmDailyStats" -type f -mtime +30)"
		# Output daily stats into a csv file
		grep -E 'FEED FILE NAME|TOTAL NUMBER OF RECORDS' $WLM_MONITORING_DIR/wlmDailyStats/${statsFile}| awk -F ':- *' '{printf "%s ", $2} NR%2==0{print ""}' >> $WLM_MONITORING_DIR/wlmDailyStats/dailyStats.csv

		logger "INFO: envelopeChecker.sh temporary disabled"

		# if [ "${CHECKWATCHLISTINGESTION^^}" == "TRUE" ]; then
		# 	#AUSNROD-751: Stops watchlist ingestion if there is a missing file
		# 	/usr/local/bin/envelopeChecker/envelopeChecker.sh checkWatchlistIngestion "${file}~${LOADMETHOD} > ${IMPORT_DIR}/flag.txt"
		# 	isThereWatchlistIngestionIssues=$?
		# 	if [[ $isThereWatchlistIngestionIssues -eq $FALSE ]]; then
		# 		logger "INFO: No Watchlist Ingestion issues, continue with creating flag for ingest Custom Factiva."
		# 	else
		# 		logger "ERROR: Watchlist Ingestion Issues found, not creating flag.txt and retrying."
		# 		error_exit "ERROR: DownloadCustomFactiva.sh ended early as there was Envelope Ingestion issues." 3
		# 	fi
		# else
		# 	logger "INFO: Skipping Watchlist ingestion check as CHECKWATCHLISTINGESTION=${CHECKWATCHLISTINGESTION}"
		# fi
	done

	#all files downloaded starting with import
	logger "INFO: Download of files completed starting import of files from list: ${filesToDownload}"
    # verify if there is more then 1 file to import and enable WL_LOAD_RUNNING_CHECK_REQUIRED if needed
	set -- $filesToDownload
	if [ $# -gt 1 ]; then
		logger "WARNING: There is more then one list to import. Setting WL_LOAD_RUNNING_CHECK_REQUIRED flag to TRUE"
		WL_LOAD_RUNNING_CHECK_REQUIRED="TRUE"
	fi

	if [ ${WL_LOAD_RUNNING_CHECK_REQUIRED} = "TRUE" ]; then
		fn_create_lock_file
	fi
	local lastImportStartedDate=""
	for file in $filesToDownload
		do
		logger "INFO: Importing file ${file}"
		#lastImportStartedDate before starting import is needed to verify if import is finished
		lastImportStartedDate=$(bash ${NR_HOME}/factivaScripts/executeDBScript.sh --database-engine ${DBENGINE} --filename ${NR_HOME}/factivaScripts/getListImportStartDate.sql | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

		# create flag file, unless exact mode
		if [ "${LOADMETHOD}" != "" ]; then
			#NRDVO-990: If preferred, check if batch processing is complete before watchlist processing
			logger "INFO: Do we want to check if batch processing is complete before proceeding? ${WL_TRIGGER_ONLY_AFTER_BATCH_FINISHES}"
			if [[ ${WL_TRIGGER_ONLY_AFTER_BATCH_FINISHES} == "TRUE" ]]; then
				logger "INFO: WL_TRIGGER_ONLY_AFTER_BATCH_FINISHES=${WL_TRIGGER_ONLY_AFTER_BATCH_FINISHES} so checking if batch processing is currently running..."
				logger "INFO: ... and will recheck this a total of ${WL_BATCH_COMPLETE_CHECK_RETRY_X_TIMES} times if required..."
				logger "INFO: ... with an interval of ${WL_BATCH_COMPLETE_CHECK_RETRY_INTERVAL_IN_SECONDS} seconds between retries."
				loopCounter=0
				while [[ ${loopCounter} -lt ${WL_BATCH_COMPLETE_CHECK_RETRY_X_TIMES} ]]; do
					logger "INFO: Checking if a batch process is currently running."
					logger "INFO: Loop $(( ${loopCounter}+1 )) of ${WL_BATCH_COMPLETE_CHECK_RETRY_X_TIMES}"
					NUMBER_OF_BATCHES_CURRENTLY_RUNNING=$(bash ${NR_HOME}/factivaScripts/executeDBScript.sh --database-engine ${DBENGINE} --filename ${NR_HOME}/factivaScripts/isBatchWLMRunning.sql)
					if [[ ${NUMBER_OF_BATCHES_CURRENTLY_RUNNING} -le 0 ]]; then
						logger "INFO: NO Batches were found to be currently running, progressing to creating flag file."
						break;
					else
						logger "INFO: Batches were found to be currently running..."
						logger "INFO: ... Will wait ${WL_BATCH_COMPLETE_CHECK_RETRY_INTERVAL_IN_SECONDS} seconds and recheck a total of ${WL_BATCH_COMPLETE_CHECK_RETRY_X_TIMES} times."
						(( loopCounter++ )); logger "WARNING: Retrying in ${WL_BATCH_COMPLETE_CHECK_RETRY_INTERVAL_IN_SECONDS} seconds ..."; sleep ${WL_BATCH_COMPLETE_CHECK_RETRY_INTERVAL_IN_SECONDS}
					fi;
				done
				if [[ ${loopCounter} -ge ${WL_BATCH_COMPLETE_CHECK_RETRY_X_TIMES} ]]; then
					#ERROR - RAISE ALERT - BATCH PROCESSING DID NOT COMPLETE IN TIME AND EXIT
					error_exit "Batch processing did not complete in the allotted time and there the Watchlist import was not started." 4
				fi
			fi

			logger "INFO: Creating flag file ${IMPORT_DIR}/flag.txt"
			loopCounter=0
			while [ ${loopCounter} -lt ${FLAGFILE_CREATE_RETRY_X_TIMES} ]; do
				if echo "${file}~${LOADMETHOD}" > ${IMPORT_DIR}/flag.txt; then
					if mc mv "${IMPORT_DIR}/flag.txt" "${MINIO_FPFA_BUCKET_PATH}/flag.txt"; then
						logger "INFO: File flag.txt successfully moved to MinIO bucket ${MINIO_FPFA_BUCKET_PATH}"
					else
						error_exit "ERROR: Unable to move file flag.txt to MinIO bucket ${MINIO_FPFA_BUCKET_PATH}" 3
					fi
					break;
				fi
				(( loopCounter++ )); logger "WARNING: Problem with creating flag.txt file retrying in [${FLAGFILE_CREATE_INTERVAL_IN_SECONDS}] seconds ..."; sleep ${FLAGFILE_CREATE_INTERVAL_IN_SECONDS}
			done
			if [[ ${loopCounter} -ge ${FLAGFILE_CREATE_RETRY_X_TIMES} ]]; then
				#ERROR - RAISE ALERT - it was not possible to create flag.txt file
				logger "ERROR: Could not create file ${IMPORT_DIR}/flag.txt (after ${loopCounter} retries). Verify access to directory. Import of file will not be started."
				error_exit "Could not create file flag.txt. Import not started" 4
			fi

		else
			logger "${file} specified with exact option, not creating flag.txt"
		fi

		#Waiting on import of list is finished
		if [ ${WL_LOAD_RUNNING_CHECK_REQUIRED} = "TRUE" ]; then
			fn_wait_until_import_finish "${lastImportStartedDate}"
		fi
		#updating last ingested file after full import of list
		if [ "${LOADMETHOD}" == "${DAILY_LOADMETHOD}" ]; then
			logger "INFO: updating lastIngestedFile.txt with value: ${file}"
			echo "${file}" > ${WLM_MONITORING_DIR}/lastIngestedFile.txt
		else
			if [ "${LOADMETHOD}" == "${WEEKLY_LOADMETHOD}" ]; then
				echo "${file}" > ${WLM_MONITORING_DIR}/lastIngestedFile_weekly.txt
				logger "INFO: updating lastIngestedFile_weekly.txt with value: ${file}"
			else
				logger "INFO: Not writing to lastIngestedFile.txt file as the script was run with the full option."
			fi
		fi
	done
	logger "SUCCESS: Files: ${filesToDownload} downloaded and imported successfully"
	fn_remove_lock_file
	exit 0
}

fn_main "$@"
