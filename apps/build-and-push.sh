#!/bin/bash
set -eou pipefail

source $(dirname $(realpath "$0"))/../utils.sh

# TODO: change default to repo name
REGISTRY_URL=${1:-"spinkubeperf.azurecr.io"}
DENSITY_COUNT=${DENSITY_COUNT:-50}

# Navigate to the directory containing the script
cd "$(dirname "$0")" || exit

# Check for required binaries
for binary in spin tinygo npm python3; do
  which_binary "$binary"
done

# List of build and pushed images
pushed_apps=()

spin_version=$(spin --version | awk '{print $2}')
# Loop through each directory in the current directory
for dir in */; do
    # Remove the trailing slash from the directory name
    dir_name="${dir%/}"
    image_address="$REGISTRY_URL"/"$dir_name":"$spin_version"
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
    # If density app, build and push a bunch
    if [[ "$dir_name" == density* ]]; then
        for (( i=1; i<=${DENSITY_COUNT}; i++ )); do
            image_address="${REGISTRY_URL}/${dir_name}-$i:${spin_version}"
            cp -r . "/tmp/${dir_name}-$i"
            sed -i '' -e "s/SENTINEL_VALUE/$i/g" "/tmp/${dir_name}-$i/src/lib.rs"
            pushd "/tmp/${dir_name}-$i"
            spin build && spin registry push "${image_address}"
            popd
        done
    else
        spin build && spin registry push $image_address
    fi
    if [ $? -eq 0 ]; then
        pushed_apps+=("$image_address")
    fi
    popd || exit
done

echo ""
echo "Images pushed:"
for entry in "${pushed_apps[@]}"; do
    echo "$entry"
done
