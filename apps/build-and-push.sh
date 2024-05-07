#!/bin/bash
set -eou pipefail

source $(dirname $(realpath "$0"))/../utils.sh

# TODO: change default to repo name
REGISTRY_URL=${1:-"spinkubeperf.azurecr.io"}

# Navigate to the directory containing the script
cd "$(dirname "$0")" || exit

# Check for required binaries
for binary in spin tinygo npm python3; do
  which_binary "$binary"
done

main() {
    # List of build and pushed images
    pushed_apps=()
    spin_version=$(spin --version | awk '{print $2}')

    # Loop through each directory in the current directory
    for dir in */; do
        # Remove the trailing slash from the directory name
        dir_name="${dir%/}"
        pushd "$dir_name" || exit
        # If JS or TS app, install dependencies
        if [[ "$dir_name" == *js || "$dir_name" == *ts ]]; then
            spin plugins update && spin plugin install --yes js2wasm
            npm install
        fi
        # If python app, install requirements
        if [[ "$dir_name" == *py ]]; then
            python3 -m venv .venv
            source .venv/bin/activate
            python3 -m pip install -r requirements.txt
        fi
        # If density app, build and push concurrently in batches
        DENSITY_COUNT=${DENSITY_COUNT:-50}
        BATCH_COUNT=10
        if [[ "$dir_name" == density* ]]; then
            for (( i=1; i<=${DENSITY_COUNT}; i++ )); do
                # use the same mutable tag to avoid bloating the registry.
                image_address="${REGISTRY_URL}/${dir_name}-$i:perf"
                pushed_apps+=("${image_address}")
                build-and-push-density "${image_address}" $i &
                # Execute up to $BATCH_COUNT jobs in parallel
                if [[ $(jobs -r -p | wc -l) -ge $BATCH_COUNT ]]; then
                    wait -n
                fi
            done
        else
            image_address="${REGISTRY_URL}/${dir_name}:${spin_version}"
            pushed_apps+=("${image_address}")
            spin build && spin registry push $image_address
        fi
        popd || exit
    done
}

build-and-push-density() {
    tempfile="$(mktemp -d)"
    cp -r . "${tempfile}"
    sed -i.bak -e "s/<NUMBER>/$2/g" "${tempfile}/src/lib.rs"
    pushd "${tempfile}"
    spin build && spin registry push $1
    popd
}

main

wait

echo ""
echo "Images pushed:"
for entry in "${pushed_apps[@]}"; do
    echo "$entry"
done