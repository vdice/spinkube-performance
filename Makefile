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

deploy-apps:
	./apps/deploy.sh $(REGISTRY_URL)

run-tests:
	./tests/run.sh $(REGISTRY_URL)