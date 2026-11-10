
#!/bin/bash

# Define the logger
function logger() {
    local ts=$(date +%D\ %R:%S)
    echo "${ts} - WLM-ARCHIVE-CLEANER: ${1}"
}

# Define the directory path
WLM_ARCHIVE_DIR="/opt/netreveal/standaloneHome/pvc-mounts/wlm/archive"

logger "Search for archives older than {{ .Values.sideCar.houseKeeping.wlm.archive.period }} days"
if [ "$(find "$WLM_ARCHIVE_DIR" -type f -mtime +{{ .Values.sideCar.houseKeeping.wlm.archive.period }} 2>/dev/null | wc -l)" -gt 0 ]; then
    logger "Removing old WLM archives"
    # Find and delete files that are {{ .Values.sideCar.houseKeeping.wlm.archive.period }} days or older
    find "$WLM_ARCHIVE_DIR" -type f -mtime +{{ .Values.sideCar.houseKeeping.wlm.archive.period }} -print -delete
    if [ $? -eq 0 ]; then
        logger "Old WLM archives successfully removed"
    else
        logger "Old WLM archives were not removed"
        exit 1
    fi
else
    logger "No old WLM archives found"
fi
