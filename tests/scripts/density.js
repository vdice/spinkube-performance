import http from 'k6/http';
import { check } from 'k6';
import { Kubernetes } from 'k6/x/kubernetes';
import * as deploy from "./common/common.js";
import { Gauge } from 'k6/metrics';
import exec from 'k6/execution';
import { sleep } from 'k6';

const testName = "density";
const route = ""
const replicas = 1;
const namespace = `${__ENV.NAMESPACE}` != "undefined" ? `${__ENV.NAMESPACE}` : "default";
const executor = `${__ENV.EXECUTOR}` != "undefined" ? `${__ENV.EXECUTOR}` : "containerd-shim-spin";
const repo = `${__ENV.REPO}` != "undefined" ? `${__ENV.REPO}` : "rg.fr-par.scw.cloud/dlancshire-public/template-app-";
const tag = `${__ENV.TAG}` != "undefined" ? `${__ENV.TAG}` : "latest";
const timeToDeployTenApps = new Gauge('time_to_deploy_ten_apps');
const deployedApps = new Gauge('deployed_apps');
const maxScenarioDurationSecs = `${__ENV.MAX_SCENARIO_DURATION_SECS}` != "undefined" ? `${__ENV.MAX_SCENARIO_DURATION_SECS}` : 180;
const restIntervalSecs = `${__ENV.REST_INTERVAL_SECONDS}` != "undefined" ? `${__ENV.REST_INTERVAL_SECONDS}` : 10;

// Should match the number of apps deployed by the last stage
// and be divisible by the batch size
// TODO: make this configurable
const totalApps = 50;

export let options = {
  tags: {
    test: testName,
  },
  thresholds: {
    // the rate of successful checks should be higher than 90%
    checks: ['rate>0.90'],
  },
  noConnectionReuse: true,
  setupTimeout: '120s',
  scenarios: {
    deploy1: {
      executor: 'per-vu-iterations',
      exec: 'deployApps',
      iterations: 1,
      vus: 1,
      maxDuration: `${maxScenarioDurationSecs}s`,
      env: { BATCH_NUMBER: '0', BATCH_SIZE: '10' },
    },
    test1: {
      executor: 'constant-vus',
      vus: 20,
      exec: 'test',
      startTime: `${maxScenarioDurationSecs * 1 + restIntervalSecs}s`,
      env: { BATCH_NUMBER: '0', BATCH_SIZE: '10' },
      duration: '10s',
    },
    deploy2: {
      executor: 'per-vu-iterations',
      exec: 'deployApps',
      iterations: 1,
      vus: 1,
      maxDuration: `${maxScenarioDurationSecs}s`,
      startTime: `${maxScenarioDurationSecs * 1 + restIntervalSecs * 2}s`,
      env: { BATCH_NUMBER: '1', BATCH_SIZE: '10' },
    },
    test2: {
      executor: 'constant-vus',
      vus: 20,
      exec: 'test',
      startTime: `${maxScenarioDurationSecs * 2 + restIntervalSecs * 2}s`,
      env: { BATCH_NUMBER: '1', BATCH_SIZE: '10' },
      duration: '10s',
    },
    deploy3: {
      executor: 'per-vu-iterations',
      exec: 'deployApps',
      iterations: 1,
      vus: 1,
      maxDuration: `${maxScenarioDurationSecs}s`,
      startTime: `${maxScenarioDurationSecs * 2 + restIntervalSecs * 3}s`,
      env: { BATCH_NUMBER: '2', BATCH_SIZE: '10' },
    },
    test3: {
      executor: 'constant-vus',
      vus: 20,
      exec: 'test',
      startTime: `${maxScenarioDurationSecs * 3 + restIntervalSecs * 3}s`,
      env: { BATCH_NUMBER: '2', BATCH_SIZE: '10' },
      duration: '10s',
    },
    deploy4: {
      executor: 'per-vu-iterations',
      exec: 'deployApps',
      iterations: 1,
      vus: 1,
      maxDuration: `${maxScenarioDurationSecs}s`,
      startTime: `${maxScenarioDurationSecs * 3 + restIntervalSecs * 4}s`,
      env: { BATCH_NUMBER: '3', BATCH_SIZE: '10' },
    },
    test4: {
      executor: 'constant-vus',
      vus: 20,
      exec: 'test',
      startTime: `${maxScenarioDurationSecs * 4 + restIntervalSecs * 4}s`,
      env: { BATCH_NUMBER: '3', BATCH_SIZE: '10' },
      duration: '10s',
    },
    deploy5: {
      executor: 'per-vu-iterations',
      exec: 'deployApps',
      iterations: 1,
      vus: 1,
      maxDuration: `${maxScenarioDurationSecs}s`,
      startTime: `${maxScenarioDurationSecs * 4 + restIntervalSecs * 5}s`,
      env: { BATCH_NUMBER: '4', BATCH_SIZE: '10' },
    },
    test5: {
      executor: 'constant-vus',
      vus: 20,
      exec: 'test',
      startTime: `${maxScenarioDurationSecs * 5 + restIntervalSecs * 5}s`,
      env: { BATCH_NUMBER: '4', BATCH_SIZE: '10' },
      duration: '10s',
    },
  },
};

class TestEndpoint {
  constructor(name, endpoint) {
    this.name = name;
    this.endpoint = endpoint;
  }
}

function createSpinApps(imagePrefix, batchNumber, batchSize) {
  console.log(`Creating ${batchSize} SpinApp custom resources`)
  let apps = [];
  for (let i = 0; i < batchSize; i++) {
    let appNum = batchNumber * batchSize + i + 1;
    console.log(`Creating SpinApp ${testName}-${appNum}`);
      let image = `${imagePrefix}${appNum}:${tag}`;
      let app = new deploy.SpinApp(
        `${testName}-${appNum}`,
        {
          "image": image,
          "replicas": replicas,
          "executor": executor
        }
      );
      apps.push(app);
  }
  return apps;
}

function applySpinApps(kubernetes, spinApps) {
  console.log(`Applying ${spinApps.length} SpinApp custom resources to the cluster`)
  let i
  for (i = 0; i < spinApps.length; i++) {
    console.log("Creating SpinApp: " + JSON.stringify(spinApps[i]));
    kubernetes.create(spinApps[i]);
  }
  const timeout = maxScenarioDurationSecs - 10 > 0 ? maxScenarioDurationSecs - 10 : 10;
  const timeToReady = deploy.waitAllAppsReady(kubernetes, timeout, namespace, replicas);
  if (timeToReady === -1) {
    exec.test.abort(`SpinApps not ready after ${timeout} seconds after deploying ${i - 1} apps`);
  }
  timeToDeployTenApps.add(timeToReady, true);
  let totalAppsDeployed = deploy.getSpinApps(kubernetes, namespace).length;
  deployedApps.add(totalAppsDeployed);
  console.log(`Deployed ${totalAppsDeployed} apps`);
}

/**
 * Setup function that is executed before the test starts.
 * It applies the SpinApp custom resource to the Kubernetes cluster.
 * @returns {string} The URL to be used for the test.
 */
export function setup() {
  let endpoints = [];
  // TODO: get the number of batches from the Options
  for (let i = 1; i <= totalApps; i++) {
    let appName = `${testName}-${i}`;
    let svc = deploy.serviceEndpointForApp(appName, namespace, route);
    endpoints.push(new TestEndpoint(appName, svc));
  }
  return endpoints;
}

export function deployApps() {
  const kubernetes = new Kubernetes();
  let batchSize = `${__ENV.BATCH_SIZE}` != "undefined" ? `${__ENV.BATCH_SIZE}` : 10;
  let batchNumber = `${__ENV.BATCH_NUMBER}` != "undefined" ? `${__ENV.BATCH_NUMBER}` : 0;
  console.log("Deploying apps for batch " + batchNumber);
  let totalAppsDeployed = deploy.getSpinApps(kubernetes, namespace).length;
  deployedApps.add(totalAppsDeployed);
  let apps = createSpinApps(repo, batchNumber, batchSize);
  console.log(`Density test configured for batch ${batchNumber} of ${batchSize} apps`);
  applySpinApps(kubernetes, apps);
  sleep(10);
}

/**
 * Function to test the deployed apps.
 * It sends an HTTP GET request to the specified URL and performs a check on the response status.
 * @param {string} data - The URL to send the request to.
 */
export function test(endpoints) {
  let batchSize = `${__ENV.BATCH_SIZE}` != "undefined" ? `${__ENV.BATCH_SIZE}` : 10;
  let batchNumber = `${__ENV.BATCH_NUMBER}` != "undefined" ? `${__ENV.BATCH_NUMBER}` : 0;
  let totalAppsDeployed = batchNumber * batchSize + batchSize; 
  for(let i = 0; i < totalAppsDeployed; i++) {
    const res = http.get(endpoints[i].endpoint);
    check(res, {
      "response code was 200": (res) => res.status == 200,
      "body message started with 'Hello'": (res) => typeof res.body === 'string' && (res.body.trim().includes("Hello"))
    },
    { apps: totalAppsDeployed });
    sleep(0.1);
  }
}

/**
 * Teardown function that is executed after the test ends.
 * It deletes the SpinApp custom resource from the Kubernetes cluster.
 */
export function teardown(endpoints) {
  console.log("Tearing down density test");
  const kubernetes = new Kubernetes();
  for (let i = 0; i < endpoints.length; i++) {
    kubernetes.delete("SpinApp.core.spinoperator.dev", endpoints[i].name, namespace);
  }
}
