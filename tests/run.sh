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

# TODO: change default to repo name
REGISTRY_URL=${1:-"ghcr.io/kate-goldenring/performance"}
SPIN_APP_REGISTRY_URL=${SPIN_APP_REGISTRY_URL:-"${REGISTRY_URL}"}
TEST=${TEST:-"hello-world"}
OUTPUT=${OUTPUT:-"datadog"}
SPIN_V_VERSION=${SPIN_V_VERSION:-"2.4.2"}
TEST_ID=${TEST_ID:-$(date "+%Y-%m-%d-%H:%M:%S")}
REPLICAS=${REPLICAS:-"1"}
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
export repo=$SPIN_APP_REGISTRY_URL
export tag=$SPIN_V_VERSION
export executor=${EXECUTOR:-"containerd-shim-spin"}
export runner_image=$REGISTRY_URL/k6:latest
export test_id=$TEST_ID
export name=${NAME:-$TEST}
export replicas=$REPLICAS
echo "Running test $name"

# Create a tar archive of the test script and helper functions via the k6 runner image
docker run --rm \
    -u $(id -u ${USER}):$(id -g ${USER}) \
    -v "$(pwd):/workdir" \
    -w /workdir "${runner_image}" archive "${path}/scripts/${TEST}.js"

export_node_info
export node_os=$NODE_OS
export node_arch=$NODE_ARCH
export node_instance_type=$NODE_INSTANCE_TYPE

# Create the script ConfigMap
kubectl get configmap $name >/dev/null 2>&1 || \
    (kubectl create configmap $name --from-file=archive.tar && kubectl label configmap $name k6-test=true)

# Create temporary test run resource to customize per test app
tempfile="$(mktemp -d)/test-run-$name.yaml"
cp $path/test-run.yaml $tempfile

# Update with common values regardless of output method
yq -i '(.spec.runner.image = env(runner_image)) |
    (.metadata.name = env(name)) |
    (.spec.arguments += "--tag testid=") |
    (.spec.arguments += env(test_id)) |
    (.spec.arguments += " --tag testname=") |
    (.spec.arguments += env(name)) |
    (.spec.arguments += " --tag node_os=") |
    (.spec.arguments += env(node_os)) |
    (.spec.arguments += " --tag node_arch=") |
    (.spec.arguments += env(node_arch)) |
    (.spec.arguments += " --tag node_instance_type=") |
    (.spec.arguments += env(node_instance_type)) |
    (.spec.runner.env += {"name": "REPO","value": env(repo)}) |
    (.spec.runner.env += {"name": "REPLICAS","value": strenv(replicas)}) |
    (.spec.runner.env += {"name": "EXECUTOR","value": env(executor)}) |
    (.spec.script.configMap.name = env(name))' $tempfile

if [[ "$TEST" == "density" ]]; then
    export tag="latest"
fi

yq -i '(.spec.runner.env += {"name": "TAG","value": env(tag)})' $tempfile

# Run command with the appropriate output
if [ "$OUTPUT" == "prometheus" ];
then
    echo "Running with Prometheus output"

    # TODO: update K6_PROMETHEUS_RW_SERVER_URL with correct url (k8s svc?)
    yq -i '(.spec.runner.env += {"name": "K6_PROMETHEUS_RW_SERVER_URL","value": "http://localhost:9090/api/v1/write"}) |
        (.spec.runner.env += {"name": "K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM","value": "true"}) |
        (.spec.runner.env += {"name": "K6_PROMETHEUS_RW_TREND_STATS","value": "p(99),p(50),min,max,avg"})' $tempfile
elif [ "$OUTPUT" == "datadog" ];
then
    echo "Running with Datadog output"
    export statsd_addr=datadog.datadog.svc.cluster.local:8125

    yq -i '(.spec.runner.env += {"name": "K6_OUT","value": "output-statsd"}) |
        (.spec.runner.env += {"name": "K6_STATSD_ADDR","value": env(statsd_addr)}) |
        (.spec.runner.env += {"name": "K6_STATSD_ENABLE_TAGS","value": "true"})' $tempfile
else
    echo "Running with no output"
    # TODO: write results summary to a file on the node?
fi

cat $tempfile
kubectl apply -f $tempfile

wait_for_testrun $name $MAX_DURATION
