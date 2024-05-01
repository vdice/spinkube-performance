SHELL := /bin/bash

REGISTRY_URL ?= ghcr.io/kate-goldenring/performance

k6-build:
	go install go.k6.io/xk6/cmd/xk6@latest
	xk6 build --with github.com/LeonAdato/xk6-output-statsd --with github.com/grafana/xk6-kubernetes

build-k6-image:
	cd image/k6 && \
	docker build --platform linux/amd64,linux/arm64 -t $(REGISTRY_URL)/k6:latest .

push-k6-image:
	docker push $(REGISTRY_URL)/k6:latest

build-and-push-apps:
	./apps/build-and-push.sh $(REGISTRY_URL)

run-density-test-%:
	SPIN_APP_REGISTRY_URL="rg.fr-par.scw.cloud/dlancshire-public/template-app-" TEST=density NAME=density-$* ./tests/run.sh $(REGISTRY_URL)
	echo "Logs from Density Test $*"
	kubectl logs job/density-$*-1

run-density-tests: run-density-test-1 run-density-test-2 run-density-test-3
	kubectl delete spinapp --all

run-hello-world-test:
	TEST=hello-world ./tests/run.sh $(REGISTRY_URL)
	echo "Logs from Hello World Test"
	kubectl logs job/hello-world-1

run-ramping-vus-test:
	TEST=ramping-vus ./tests/run.sh $(REGISTRY_URL)
	echo "Logs from Ramp Test"
	kubectl logs job/ramping-vus-1

run-tests: run-hello-world-test run-ramping-vus-test run-density-tests

cleanup: cleanup-apps cleanup-tests cleanup-configmaps

cleanup-apps:
	source utils.sh && delete_k8s_resources spinapps

cleanup-tests:
	source utils.sh && delete_k8s_resources testruns

cleanup-configmaps:
	kubectl delete configmap -l k6-test=true