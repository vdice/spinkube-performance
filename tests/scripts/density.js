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
const maxScenarioDurationSecs = `${__ENV.MAX_SCENARIO_DURATION_SECS}` != "undefined" ? `${__ENV.MAX_SCENARIO_DURATION_SECS}` : 180;
const restIntervalSecs = `${__ENV.REST_INTERVAL_SECONDS}` != "undefined" ? `${__ENV.REST_INTERVAL_SECONDS}` : 10;
const batchSize = `${__ENV.BATCH_SIZE}` != "undefined" ? `${__ENV.BATCH_SIZE}` : 10;

const timeToDeployTenApps = new Gauge(`time_to_deploy_${batchSize}_apps`);
const deployedApps = new Gauge('number_of_apps');

export let options = {
  tags: {
    test: testName,
  },
  thresholds: {
    // the rate of successful checks should be higher than 90%
    checks: ['rate>0.90'],
  },
  vus: 50,
  duration: '30s',
  setupTimeout: '300s',
  noConnectionReuse: true
};

class TestEndpoint {
  constructor(name, endpoint) {
    this.name = name;
    this.endpoint = endpoint;
  }
}

function createSpinApps(imagePrefix, numDeployed, batchSize) {
  console.log(`Creating ${batchSize} SpinApp custom resources also deployed ${numDeployed} apps`)
  let apps = [];
  for (let i = numDeployed + 1; i < numDeployed + batchSize + 1; i++) {
    console.log(`Creating SpinApp ${testName}-${i}`);
      let image = `${imagePrefix}${i}:${tag}`;
      let app = new deploy.SpinApp(
        `${testName}-${i}`,
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
}

/**
 * Setup function that is executed before the test starts.
 * It applies the SpinApp custom resource to the Kubernetes cluster.
 * @returns {string} The URL to be used for the test.
 */
export function setup() {
  const kubernetes = new Kubernetes();
  let allApps = deploy.getSpinApps(kubernetes, namespace).length;
  let startQuantity = allApps == 0 ? 0 : allApps;
  console.log(`Deploying ${batchSize} apps to cluster with ${startQuantity} already deployed`);
  let apps = createSpinApps(repo, startQuantity, batchSize);
  applySpinApps(kubernetes, apps);
  let totalAppsDeployed = deploy.getSpinApps(kubernetes, namespace).length;
  deployedApps.add(totalAppsDeployed);
  console.log(`Deployed ${totalAppsDeployed} apps`);
  let endpoints = [];
  // TODO: get the number of batches from the Options
  for (let i = 0; i < apps.length; i++) {
    let svc = deploy.serviceEndpointForApp(apps[i].metadata.name, namespace, route);
    endpoints.push(new TestEndpoint(apps[i].metadata.name, svc));
  }
  sleep(restIntervalSecs);
  return {
    totalAppsDeployed : totalAppsDeployed,
    endpoints: endpoints
  };
}

/**
 * Main function that is executed during the test.
 * It sends an HTTP GET request to the specified URL and performs a check on the response status.
 * @param {string} data - The URL to send the request to.
 */
export default function(data) {
  for(let i = 0; i < data.endpoints.length; i++) {
    const res = http.get(data.endpoints[i].endpoint, { tags: {number_of_apps: data.totalAppsDeployed} });
    check(res, {
      "response code was 200": (res) => res.status == 200,
      "body message started with 'Hello'": (res) => typeof res.body === 'string' && (res.body.trim().includes("Hello"))
    });
    sleep(0.1);
  }
}

/**
 * Teardown function that is executed after the test ends.
 * It deletes the SpinApp custom resource from the Kubernetes cluster.
 */
export function teardown() {
  console.log("Skipping teardown for density test");
  // const kubernetes = new Kubernetes();
  // for (let i = 0; i < endpoints.length; i++) {
  //   kubernetes.delete("SpinApp.core.spinoperator.dev", endpoints[i].name, namespace);
  // }
}
