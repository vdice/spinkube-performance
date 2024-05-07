import http from 'k6/http';
import { check } from 'k6';
import { Kubernetes } from 'k6/x/kubernetes';
import * as deploy from "./common/common.js";
import { sleep } from 'k6';
import exec from 'k6/execution';

const testScriptName = "hello-world";
const replicas = `${__ENV.SK_REPLICAS}` != "undefined" ? parseInt(`${__ENV.SK_REPLICAS}`) : 1; 
const namespace = `${__ENV.SK_NAMESPACE}` != "undefined" ? `${__ENV.SK_NAMESPACE}` : "default";
const executor = `${__ENV.SK_EXECUTOR}` != "undefined" ? `${__ENV.SK_EXECUTOR}` : "containerd-shim-spin";
const repo = `${__ENV.SK_OCI_REPO}` != "undefined" ? `${__ENV.SK_OCI_REPO}` : "spinkubeperf.azurecr.io";
const tag = `${__ENV.SK_OCI_TAG}` != "undefined" ? `${__ENV.SK_OCI_TAG}` : "latest";
const route = `${__ENV.SK_SPIN_APP_ROUTE}` != "undefined" ? `${__ENV.SK_SPIN_APP_ROUTE}` : "";

// TODO: get this list from the scenario Option
const cases = ["rust", "go", "js", "py"];

export let options = {
  tags: {
    test: testScriptName
  },
  thresholds: {
    // the rate of successful checks should be higher than 90%
    checks: ['rate>0.90'],
  },
  setupTimeout: '300s',
  noConnectionReuse: true,
  scenarios: {
    rust: {
      executor: 'constant-vus',
      vus: 20,
      duration: '30s',
    },
    py: {
      executor: 'constant-vus',
      vus: 20,
      startTime: '40s',
      duration: '30s',
    },
    js: {
      executor: 'constant-vus',
      vus: 20,
      startTime: '80s',
      duration: '30s',
    },
    go: {
      executor: 'constant-vus',
      vus: 20,
      startTime: '130s',
      duration: '30s',
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
  for (const testCase of cases) {
    let name = `${testScriptName}-${testCase}`;
    let image = deploy.imageForApp(repo, tag, name);
    deploy.applySpinApp(kubernetes, name, image, replicas, executor, namespace);
  }
  const timeout = 60;
  if (deploy.waitAllAppsReady(kubernetes, timeout, namespace, replicas) === -1) {
    console.error(`SpinApps not ready after ${timeout} seconds`);
    return;
  }
  sleep(20);
}

/**
 * Main function that is executed during the test.
 * It sends an HTTP GET request to the specified URL and performs a check on the response status.
 * @param {string} data - The URL to send the request to.
 */
export default function () {
  let testCase = exec.scenario.name;
  let name = `${testScriptName}-${testCase}`;
  let endpoint = deploy.serviceEndpointForApp(name, namespace, route);
  const res = http.get(endpoint, {
    tags: {
      language: testCase,
    },
  });
  check(res, {
    "response code was 200": (res) => res.status == 200,
    "body message was 'Hello, World'": (res) => typeof res.body === 'string' && (res.body.trim() == "Hello, World")
  }, 
    {
      language: testCase,
    },
  );
  sleep(0.1);
}

/**
 * Teardown function that is executed after the test ends.
 * It deletes the SpinApp custom resource from the Kubernetes cluster.
 */
export function teardown() {
  console.log("Tearing down test")
  const kubernetes = new Kubernetes();
  for (const testCase of cases) {
    let name = `${testScriptName}-${testCase}`;
    kubernetes.delete("SpinApp.core.spinoperator.dev", name, namespace);
  }
}
