import http from 'k6/http';
import { check } from 'k6';
import { Kubernetes } from 'k6/x/kubernetes';
import * as deploy from "./common/common.js";
import { sleep } from 'k6';
import exec from 'k6/execution';

const testName = "hello-world";
// TODO: get this list from the scenario Option
const cases = ["rust", "go", "js", "py"];
const route = "hello"
const replicas = `${__ENV.REPLICAS}` != "undefined" ? parseInt(`${__ENV.REPLICAS}`) : 1;
const namespace = `${__ENV.NAMESPACE}` != "undefined" ? `${__ENV.NAMESPACE}` : "default";
let executor = `${__ENV.EXECUTOR}` != "undefined" ? `${__ENV.EXECUTOR}` : "containerd-shim-spin";
let repo = `${__ENV.REPO}` != "undefined" ? `${__ENV.REPO}` : "ghcr.io/kate-goldenring/performance";
let tag = `${__ENV.TAG}` != "undefined" ? `${__ENV.TAG}` : "latest";

export let options = {
  tags: {
    test: testName,
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
    let name = `${testName}-${testCase}`;
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
  let name = `${testName}-${testCase}`;
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
    let name = `${testName}-${testCase}`;
    kubernetes.delete("SpinApp.core.spinoperator.dev", name, namespace);
  }
}
