import http from 'k6/http';
import { Kubernetes } from 'k6/x/kubernetes';
import * as deploy from "./common/common.js";
import { sleep } from 'k6';

const testScriptName = "ramping-vus";
const replicas = `${__ENV.SK_REPLICAS}` != "undefined" ? parseInt(`${__ENV.SK_REPLICAS}`) : 1; 
const namespace = `${__ENV.SK_NAMESPACE}` != "undefined" ? `${__ENV.SK_NAMESPACE}` : "default";
const executor = `${__ENV.SK_EXECUTOR}` != "undefined" ? `${__ENV.SK_EXECUTOR}` : "containerd-shim-spin";
const repo = `${__ENV.SK_OCI_REPO}` != "undefined" ? `${__ENV.SK_OCI_REPO}` : "ghcr.io/kate-goldenring/performance";
const tag = `${__ENV.SK_OCI_TAG}` != "undefined" ? `${__ENV.SK_OCI_TAG}` : "latest";
const route = `${__ENV.SK_SPIN_APP_ROUTE}` != "undefined" ? `${__ENV.SK_SPIN_APP_ROUTE}` : "";
const appToTest = `${__ENV.SK_SPIN_APP}` != "undefined" ? `${__ENV.SK_SPIN_APP}` : "hello-world-rust";

const name = `${__ENV.SK_TEST_RUN_NAME}` != "undefined" ? `${__ENV.SK_TEST_RUN_NAME}` : testScriptName;

export let options = {
  tags: {
    test: testScriptName
  },
  thresholds: {
    http_req_failed: ['rate<0.1'],
  },
  setupTimeout: '300s',
  noConnectionReuse: false,
  discardResponseBodies: true,
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '30s', target: 20 },
        { duration: '30s', target: 30 },
        { duration: '30s', target: 40 },
        { duration: '30s', target: 50 },
        { duration: '60s', target: 100 },
        { duration: '60s', target: 200 },
        { duration: '60s', target: 300 },
      ],
      gracefulRampDown: '10s',
    },
  },
};

/**
 * Setup function that is executed before the test starts.
 * It applies the SpinApp custom resource to the Kubernetes cluster.
 * @returns {string} The URL to be used for the test.
 */
export function setup() {
  console.log("Setting up test")
  const kubernetes = new Kubernetes();
  let image = deploy.imageForApp(repo, tag, appToTest);
  deploy.applySpinApp(kubernetes, name, image, replicas, executor, namespace);
  const timeout = 60;
  if (deploy.waitAllAppsReady(kubernetes, timeout, namespace, replicas) === -1) {
    console.error(`SpinApps not ready after ${timeout} seconds`);
    return;
  }
  sleep(20);
  return deploy.serviceEndpointForApp(name, namespace, route);
}

/**
 * Main function that is executed during the test.
 * It sends an HTTP GET request to the specified URL and performs a check on the response status.
 * @param {string} data - The URL to send the request to.
 */
export default function (endpoint) {
  http.get(endpoint, {tags: {
    replicas: replicas,
  }});
  sleep(0.1);
}

/**
 * Teardown function that is executed after the test ends.
 * It deletes the SpinApp custom resource from the Kubernetes cluster.
 */
export function teardown() {
  console.log("Tearing down test")
  const kubernetes = new Kubernetes();
  kubernetes.delete("SpinApp.core.spinoperator.dev", name, namespace);
}
