#!/bin/bash
set -eou pipefail

source $(dirname $(realpath "$0"))/../utils.sh

wait_for_testrun() {
    local name=$1
    local max_duration=${2:-90}
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
        echo "TestRun $name is $status"
        sleep 3
        status=$(kubectl get testrun $name -o jsonpath='{.status.stage}')
    done
    if [[ $status == "error" || $status == "stopped" ]]; then
        echo "TestRun $name failed with status $status"
        exit 1
    fi
    echo "TestRun $name succeeded"
}

# TODO: change default to repo name
REGISTRY_URL=${1:-"ghcr.io/kate-goldenring/performance"}
TEST=${TEST:-"hello-world"}
OUTPUT=${OUTPUT:-"datadog"}
SPIN_VERSION=${SPIN_VERSION:-"2.4.2"}
# Navigate to the directory containing the script
path="$(dirname "$0")/$TEST"
echo "path is $path"

# Check for required binaries
for binary in jq yq kubectl; do
  which_binary "$binary"
done

# Apply RBAC for K6 tests
kubectl apply -f $path/../rbac.yaml
test_config_json=$(cat $path/test-config.json)

# Loop through each entry in the JSON array
for entry in $(echo "$test_config_json" | jq -r '.[] | @base64'); do
    # Decode the base64 entry
    _jq() {
     echo ${entry} | base64 --decode | jq -r ${1}
    }

    # Extract values
    # NOTE: export is needed for any value used by yq's 'env()' function
    export name=$(_jq '.service')
    export language=$(_jq '.language')
    export route=$(_jq '.route')
    export image=$REGISTRY_URL/$name:$SPIN_VERSION
    export executor=${EXECUTOR:-"containerd-shim-spin"}
    export runner_image=$REGISTRY_URL/k6:latest

    # Create the script ConfigMap
    kubectl get configmap $name >/dev/null 2>&1 || \
        kubectl create configmap $name --from-file $path/script.js

    # Create temporary test run resource to customize per test app
    tempfile="$(mktemp -d)/test-run-$name.yaml"
    echo "Temporary TestRun resource: $tempfile"
    cp $path/test-run.yaml $tempfile

    # Update with common values regardless of output method
    yq -i '(.spec.runner.image = env(runner_image)) |
        (.metadata.name = env(name)) |
        (.spec.arguments += "--tag language=") |
        (.spec.arguments += env(language)) |
        (.spec.runner.env += {"name": "SERVICE","value": env(name)}) |
        (.spec.runner.env += {"name": "ROUTE","value": env(route)}) |
        (.spec.runner.env += {"name": "EXECUTOR","value": env(executor)}) |
        (.spec.runner.env += {"name": "IMAGE","value": env(image)}) |
        (.spec.runner.metadata.labels.language = env(language)) |
        (.spec.script.configMap.name = env(name))' $tempfile

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
        # TODO: use datadog k8s svc from installed Helm release
        export statsd_addr=datadog.datadog.svc.cluster.local:8125

        yq -i '(.spec.runner.env += {"name": "K6_OUT","value": "output-statsd"}) |
            (.spec.runner.env += {"name": "K6_STATSD_ADDR","value": env(statsd_addr)}) |
            (.spec.runner.env += {"name": "K6_STATSD_ENABLE_TAGS","value": "true"})' $tempfile
    else
        echo "Running with no output"
        # TODO: write results summary to a file on the node?
    fi

    kubectl apply -f $tempfile

    wait_for_testrun $name
done
