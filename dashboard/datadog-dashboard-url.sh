#! /bin/bash

# This script constructs a Datadog dashboard URL given the specified timestamp and dashboard template variables.
# It expects the following environment variables to be set:
#   DASHBOARD_ID: The ID of the Datadog dashboard.
#   VARIABLE_KEYS: Comma-separated list of the names of the dashboard template variables.
#   VARIABLE_VALS: Comma-separated list of the values for the dashboard template variables.
#   TEST_START_UTC: The start timestamp of dashboard time frame in UTC.
#   TEST_END_UTC: The end timestamp  of dashboard time frame in UTC.
# The script verifies that all required environment variables are set and that the number of keys and values match.
# It then constructs the URL by appending each template variable, start time, and end time as a query parameter.
# The constructed URL is printed to the console.

unset_vars=""
for var in DASHBOARD_ID VARIABLE_KEYS VARIABLE_VALS TEST_START_UTC TEST_END_UTC; do
    if [ -z "${!var}" ]; then
        unset_vars="$unset_vars $var"
    fi
done
if [ ! -z "$unset_vars" ]; then
    echo "Error: the following required env vars are not set:$unset_vars"
    exit 1
fi
IFS=', ' read -r -a var_keys_arr <<< "$VARIABLE_KEYS"
IFS=', ' read -r -a var_vals_arr <<< "$VARIABLE_VALS"
if [ ${#var_keys_arr[@]} -ne ${#var_vals_arr[@]} ]; then
    echo "Error: the number of keys and values do not match"
    echo "Keys: ${var_keys_arr[@]}"
    echo "Values: ${var_vals_arr[@]}"
    exit 1
fi


echo "Constructing Datadog dashboard URL with the following parameters:"
echo "   DASHBOARD_ID=$DASHBOARD_ID"
echo "   VARIABLE_KEYS=$VARIABLE_KEYS"
echo "   VARIABLE_VALS=$VARIABLE_VALS"
echo "   TEST_START_UTC=$TEST_START_UTC"
echo "   TEST_END_UTC=$TEST_END_UTC"

url="https://app.datadoghq.com/dashboard/$DASHBOARD_ID?"
for i in "${!var_keys_arr[@]}"
do
    # K6 seems to convert all tags to lowercase
    value_lowercased=$(echo ${var_vals_arr[i]} | tr '[:upper:]' '[:lower:]')
    url="${url}&tpl_var_${var_keys_arr[i]}=$value_lowercased"
done
# Use exact time rather than relative time
live="false"
url="${url}&view=spans&from_ts=$TEST_START_UTC&to_ts=$TEST_END_UTC&live=$live"

echo "URL is:"
echo $url