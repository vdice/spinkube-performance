#!/bin/bash
set -eou pipefail

source $(dirname $(realpath "$0"))/../utils.sh

# TODO: change default to repo name
REGISTRY_URL=${REGISTRY_URL:-"spinkubeperf.azurecr.io"}

# Navigate to the directory containing the script
cd "$(dirname "$0")" || exit

# Check for required binaries
for binary in kubectl spin; do
  which_binary "$binary"
done

# List of deployed apps
deployed_apps=()

# TODO: this is fragile as it assumes the same spin version
# was used to build and push the apps
spin_version=$(spin --version | awk '{print $2}')

# Ensure the kube plugin is installed
export SPIN_PLUGINS_SUPPRESS_COMPATIBILITY_WARNINGS=true
spin plugins update && spin plugins install --yes kube

# Loop through each directory in the current directory
for dir in */; do
    # Remove the trailing slash from the directory name
    dir_name="${dir%/}"
    image_address="$REGISTRY_URL"/"$dir_name":"$spin_version"

    # Deploy app via spin kube
    spin kube scaffold --from $image_address | kubectl apply -f -

    # Wait for deployment to be ready
    kubectl wait --for=condition=available --timeout=60s deployment/$dir_name

    if [ $? -eq 0 ]; then
        deployed_apps+=("$image_address")
    fi
done

echo ""
echo "Apps deployed:"
for entry in "${deployed_apps[@]}"; do
    echo "$entry"
done