#!/bin/bash
set -eou pipefail

source $(dirname $(realpath "$0"))/../utils.sh

wait_for_testrun() {
    local name=$1
    local max_duration=$2
    local status
    local timeout=$((SECONDS+max_duration))

    # Possible statuses are: "initialization", "initialized", "created", "started", "stopped", "finished", "error"
    # see CRD: https://github.com/grafana/k6-operator/blob/main/config/crd/bases/k6.io_testruns.yaml#L5345
    status=$(kubectl get testrun $name -o jsonpath='{.status.stage}')
    while [[ $status != "finished" && $status != "error" && $status != "stopped" ]]; do
        if [[ $SECONDS -gt $timeout ]]; then
            echo "TestRun $name did not finish in $max_duration seconds"
            exit 1
        fi
        echo "TestRun $name status: $status"
        sleep 3
        status=$(kubectl get testrun $name -o jsonpath='{.status.stage}')
    done
    # The TestRun reports a status of "finished" even if it errored out, so
    # check job status instead
    res=$(kubectl get job $name-1  -o jsonpath='{.status.failed}')
    if [[ res -ne 0 ]]; then
        echo "TestRun $name failed with Job 'failed' status"
        exit 1
    fi
    echo "TestRun $name succeeded"
}

inject_envs_with_prefix() {
    local prefix=$1
    local file=$2
    env | grep $prefix | while IFS= read -r line; do
        IFS="=" read -r name value <<< "$line"
        export name
        export value
        yq -i '(.spec.runner.env += {"name": env(name),"value": strenv(value)}) ' $file
    done
}

inject_tags() {
    local file=$1
    i=0
    eval 'vars=(${!'"$PREFIX_TEST_TAGS"'@})'
    for var in "${vars[@]}"; do
        tag_name=$(echo $var | sed "s/$PREFIX_TEST_TAGS//")
        tag_name=$(echo $tag_name | tr '[:upper:]' '[:lower:]')
        if [ $i == 0 ]; then
            export tag="--tag $tag_name=${!var}"
        else
            export tag=" --tag $tag_name=${!var}"
        fi
        yq -i '(.spec.arguments += strenv(tag))' $file
        i+=1
    done
}

PREFIX_K6_ENVS="K6"
PREFIX_TEST_ENVS="SK"
PREFIX_TEST_TAGS="TAG_"
REGISTRY_URL=${1:-"spinkubeperf.azurecr.io"}
TEST=${TEST:-"hello-world"}
export TAG_TEST_NAME=$TEST
OUTPUT=${OUTPUT:-"datadog"}
export TAG_TEST_ID=${TEST_ID:-$(date "+%Y-%m-%d-%H:%M:%S")}
export SK_EXECUTOR=${EXECUTOR:-"containerd-shim-spin"}
MAX_DURATION=${MAX_DURATION:-"600"}
# Navigate to the directory containing the script
path="$(dirname "$0")"
echo "path is $path"

# Check for required binaries
for binary in docker yq kubectl; do
  which_binary "$binary"
done

# Apply RBAC for K6 tests
kubectl apply -f $path/rbac.yaml

# Extract values
# NOTE: export is needed for any value used by yq's 'env()' function
export runner_image=$REGISTRY_URL/k6:latest
export test_run_name=${SK_TEST_RUN_NAME:-$TEST}
echo "Running test $TEST"

# Create a tar archive of the test script and helper functions via the k6 runner image
docker run --rm \
    -u $(id -u ${USER}):$(id -g ${USER}) \
    -v "$(pwd):/workdir" \
    -w /workdir "${runner_image}" archive "${path}/scripts/${TEST}.js"

export_node_info
export TAG_NODE_OS=$NODE_OS
export TAG_NODE_ARCH=$NODE_ARCH
export TAG_NODE_INSTANCE_TYPE=$NODE_INSTANCE_TYPE

# Create the script ConfigMap
kubectl get configmap $test_run_name >/dev/null 2>&1 || \
    (kubectl create configmap $test_run_name --from-file=archive.tar && kubectl label configmap $test_run_name k6-test=true)

# Create temporary test run resource to customize per test app
tempfile="$(mktemp -d)/test-run-$test_run_name.yaml"
cp $path/test-run.yaml $tempfile

# Update with common values regardless of output method
yq -i '(.spec.runner.image = env(runner_image)) |
    (.spec.script.configMap.name = env(test_run_name)) |
    (.metadata.name = env(test_run_name))' $tempfile

# Run command with the appropriate output
if [ "$OUTPUT" == "prometheus" ];
then
    echo "Running with Prometheus output"
    export K6_PROMETHEUS_RW_SERVER_URL="http://localhost:9090/api/v1/write"
    export K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM="true"
    export K6_PROMETHEUS_RW_TREND_STATS="p(99),p(50),min,max,avg"
elif [ "$OUTPUT" == "datadog" ];
then
    echo "Running with Datadog output"
    export K6_OUT="output-statsd"
    export K6_STATSD_ADDR=datadog.datadog.svc.cluster.local:8125
    export K6_STATSD_ENABLE_TAGS=true
else
    echo "Running with no output"
fi

# Inject all K6 environment variable overrides
inject_envs_with_prefix $PREFIX_K6_ENVS $tempfile
# Inject all SpinKube test specific environment variable overrides
inject_envs_with_prefix $PREFIX_TEST_ENVS $tempfile
# Create K6 tags from environment variables
inject_tags $tempfile

cat $tempfile
kubectl apply -f $tempfile

wait_for_testrun $test_run_name $MAX_DURATION
