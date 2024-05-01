import { sleep } from 'k6';

/**
 * Resource representing a SpinApp deployment configuration.
 * @type {object}
 */
export class SpinApp {
  constructor(name, spec) {
    this.apiVersion = "core.spinoperator.dev/v1alpha1";
    this.kind = "SpinApp";
    this.metadata = { name };
    this.spec = spec;
  }
}

export function serviceEndpointForApp(appName, namespace, route) {
  let endpoint = `http://${appName}.${namespace}.svc.cluster.local/${route}`;
  return endpoint;
}

export function imageForApp(repo, tag, appName) {
  return `${repo}/${appName}:${tag}`;
}

export function getSpinApps(kubernetes, namespace) {
  return kubernetes.list("SpinApp.core.spinoperator.dev", namespace);
}

export function applySpinApp(kubernetes, name, image, replicas, executor, namespace) {
  let spinApp = new SpinApp(
    name,
    {
      "image": image,
      "replicas": replicas,
      "executor": executor
    }
  );
  console.log("Creating SpinApp: " + JSON.stringify(spinApp));
  try {
    kubernetes.create(spinApp);
  } catch (e) {
    let exists = kubernetes.list("SpinApp.core.spinoperator.dev", namespace).filter((app) => app.metadata.name == spinApp.metadata.name);
    if (exists.length == 0) {
      throw e;
    }
  }
}

export function waitAllAppsReady(kubernetes, duration_sec, namespace, replicas) {
  let now = new Date().getTime();
  let end = now + (duration_sec * 1000);
  while (now < end) {
    let spinApps = getSpinApps(kubernetes, namespace);
    console.log(`Waiting for ${spinApps.length} apps to be ready`);
    // List should only contain one SpinApp, so return on first ready SpinApp
    let ready = 0;
    for (let i = 0; i < spinApps.length; i++) {
      if (spinApps.length == 0 || spinApps[i].status == undefined) {
        continue;
      }
      if (spinApps[i].status.readyReplicas == replicas) {
        ready = ready + 1;
      }
      if (ready == spinApps.length) {
        console.log(`All apps are ready`);
        return end - now;
      }
    }
    now = new Date().getTime();
    sleep(1);
  }
  return -1;
}