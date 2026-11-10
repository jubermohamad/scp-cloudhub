#!/bin/bash
##
# Script to execute a DB script with command line parameters, dynamically based upon DB Engine.
##

. /opt/netreveal/standaloneHome/factivaScripts/netreveal_batch.conf

touch /opt/netreveal/standaloneHome/logs/executeDBScript.log
exec 3>&1 1> >(tee -a /opt/netreveal/standaloneHome/logs/executeDBScript.log) 2>&1

function fn_exit() {
    echo "$1" >&3 3>&- # echo reason to stdout (instead of log) and then close fd 3
    exit $2
}

function logger() {
    local ts=$(date +%D\ %R:%S)
    echo "${ts}:${0##*/} - ${1}"
}

#Execute script against PostgreSQL
function fn_executePostgresql() {
    # Get necessary credentials
    export PGPASSWORD='{{ .Values.global.baseConfigProperties.clusterdb.AppPassword }}'
    {{- if and .Values.global.baseConfigProperties.db.postgresql.sslmode (ne .Values.global.baseConfigProperties.db.postgresql.sslmode "disable") }}
    export PGSSLMODE="{{ .Values.global.baseConfigProperties.db.postgresql.sslmode }}"
    export PGSSLROOTCERT="{{ .Values.global.baseConfigProperties.db.postgresql.sslrootcert }}"
    {{- end }}

    #Create list of variables
    ##NRDVO-1236: Bug found with passing arguments to psql bash command whereby additonal ' were being added and caused the command to fail.
    ###This outputs the entire command onto 1 line by eliminateing the new line character from echo.
    ###A space is added between each entry, except for the first entry.
    VARLIST="$(for (( i=0; i<=$((var-1)); i++ )); do echo -n "$(test ${i} -ne 0 && echo -n " ")-v ${varnames[$i]}=${vars[$i]}"; done)"

    #Execute script
    ##NRDVO-1236: Bug found with passing arguments to psql bash command whereby additonal ' were being added and caused the command to fail.
    ###This echos the full psql command & pipes out to execute in another shell, then stores the result in the variable as normal.
    RESULT="$(echo "psql -q -t -h ${DBENDPOINT} -U ${DBUSERNAME} -d ${DBNAME} -f $FILE_NAME $VARLIST" | sh)"
}

function fn_set_dbusername() {
    if [ -z "${DBUSERNAME}" ]; then
        # NRDVO-1443
        # Some scripts like the runBatchSCM runBatchWLM will be called directly but it does not set the DBUSERNAME.
        logger "DBUSERNAME is not set.... so setting it to netreveal_batch"
        export DBUSERNAME="{{ .Values.global.baseConfigProperties.db.postgresql.userid }}"
    fi
}

#calls some other credential management service - when we're not in AWS.  Currently not implemented.
function fn_callOtherService() {
    fn_exit "Other Service Not Implemented" 64
}

function main () {
    #Parse command line. Create array of variables to pass down. vars will end up being the array size.
    #Vars must be passed like varname=var for numbers and varname='var' for strings
    var=0
    declare -A vars=()
    declare -A varnames=()
    while [[ $# > 1 ]]; do
        key="$1"

        case $key in
            --database-engine)
                DB_ENGINE="$2"
                shift # past argument
            ;;
            --filename)
                FILE_NAME="$2"
                shift # past argument
            ;;
            -v)
                temp_array=(${2//=/ })
                varnames[$var]=${temp_array[0]}
                #NRDVO-1236: Allow spaces to be used when being passed to SQL script/command, i.e. use the rest of the array from index 1 onwards (as some arguments included spaces and were being cut off inadvertently)
                vars[$var]=${temp_array[@]:1}
                ((var=var+1))
                shift # past argument
            ;;
            *)
                # unknown option
            ;;
        esac
        shift # past argument or value
    done

    if [ -z "${DB_ENGINE}" ]; then
        fn_exit "DB Engine is required." 64
    fi

    if [ -z "${FILE_NAME}" ]; then
        fn_exit "File name is required." 64
    fi

    fn_set_dbusername
    #Run script
    case $DB_ENGINE in
        PostgreSQL|postgres)
            fn_executePostgresql
            fn_exit "${RESULT}" $?
        ;;
        *)
            fn_exit "DB Engine not recognised." 64
        ;;
    esac
}

main "$@"
