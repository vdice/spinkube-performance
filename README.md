# SpinKube Performance Test Suite

> WARNING: THIS IS A VERY IN PROGRESS POC

The suite consists of multiple sections:

1. Spin apps
2. JS K6 test scripts
3. Test configuration files (`test-config.json`)
4. Test options files (`options.json`)
5. Environment/cluster set up scripts
6. Datadog dashboard

This guide will help you run the K6 scripts for testing SpinKube deployments.

## Setting Up Your Cluster

Several scripts are provided in the [`environment` directory](./environment/) to help set up your Kubernetes environment. 
After executing, ensure you have access to the cluster by storing the cluster config at `$HOME/.kube/config`.

### Accessing a Remote Cluster

A remote cluster can be accessed by pointing a Kubernetes client to a cluster config (kubeconfig file).

After using one of the [environment installation scripts](./environment/), copy over the config and update the server address to be the remote machine's IP. For example, for K3s:

```sh
scp <user>@<NODE_IP>:/etc/rancher/k3s/k3s.yaml $HOME/.kube/config
sed -i '' 's/127\.0\.0\.1/<NODE_IP>/g' $HOME/.kube/config
```

For K3d, the remote server IP is originally set to `0.0.0.0`, so the text replacement should be slightly modified as follows:

```sh
scp <user>@<NODE_IP>:$HOME/.kube/config $HOME/.kube/config
sed -i '' 's/0\.0\.0\.0/<NODE_IP>/g' $HOME/.kube/config
```

## Executing a Test with the k6 Operator

1. Install _all the operators_ in the Kubernetes environment you're pointed at after [Setting Up Your Cluster](#setting-up-your-cluster)

    Here we're pointed to a generic Kubernetes cluster and just need to run the [spin-kube-k8s.sh](./environment/spin-kube-k8s.sh) script:

    ```sh
    ./environment/spin-kube-k8s.sh
    ```

1. (Optional) If using your own `REGISTRY_URL`, you'll want to build and push the apps as well as the k6 operator image:

    ```sh
    export REGISTRY_URL=ghcr.io/kate-goldenring/performance
    make build-and-push-apps
    make build-k6-image push-k6-image
    ```

1. Run the tests

    ```sh
    make run-tests
    ```

1. Once the test Pods have `Completed` you can get the results of the tests

    Here we view the logs from the pod corresponding to the `hello-world-rust-1` job:

    ```sh
    kubectl logs -f job/hello-world-rust-1
    ```
    
    Output should look similar to:

    ```sh
         ✓ response code was 200
     ✓ body message was 'Hello, World'

     █ setup

     checks.........................: 100.00% ✓ 39054      ✗ 0
     data_received..................: 2.6 MB  129 kB/s
     data_sent......................: 2.2 MB  110 kB/s
     http_req_blocked...............: avg=19.56µs  min=1.89µs   med=8.94µs   max=37.92ms p(90)=11.68µs  p(95)=12.8µs
     http_req_connecting............: avg=8.27µs   min=0s       med=0s       max=37.71ms p(90)=0s       p(95)=0s
     http_req_duration..............: avg=2.46ms   min=301.71µs med=1.95ms   max=38.38ms p(90)=3.8ms    p(95)=4.98ms
       { expected_response:true }...: avg=2.46ms   min=301.71µs med=1.95ms   max=38.38ms p(90)=3.8ms    p(95)=4.98ms
     http_req_failed................: 0.00%   ✓ 0          ✗ 19527
     http_req_receiving.............: avg=116.57µs min=19.83µs  med=108.82µs max=6.14ms  p(90)=153.71µs p(95)=186.96µs
     http_req_sending...............: avg=41.5µs   min=6.31µs   med=36.68µs  max=1.75ms  p(90)=52.72µs  p(95)=67.84µs
     http_req_tls_handshaking.......: avg=0s       min=0s       med=0s       max=0s      p(90)=0s       p(95)=0s
     http_req_waiting...............: avg=2.3ms    min=266.22µs med=1.79ms   max=38.2ms  p(90)=3.62ms   p(95)=4.77ms
     http_reqs......................: 19527   973.225586/s
     iteration_duration.............: avg=103.14ms min=38.15µs  med=102.67ms max=145.6ms p(90)=104.54ms p(95)=105.78ms
     iterations.....................: 19527   973.225586/s
     vus............................: 19      min=0        max=200
     vus_max........................: 200     min=200      max=200
     ```

## Customizing Tests

Tests can be customized to your use case using environment variables. All environment variables prefixed with `K6` and `SK` will be injected as environment variables in the K6 TestRun pod. All environment variables prefixed with `TAG_` will be injected into a TestRun as a `--tag <SOMETHING>=$TAG_<SOMETHING>`.

The `SK` (for "SpinKube") prefixed environment variables are specific to this suite of scripts. Some are specific to certain scripts; however, the following can be used to configure any script:

- `SK_REPLICAS`: `replicas` to set in the [`SpinApp` custom resources](https://www.spinkube.dev/docs/spin-operator/reference/spin-app/) created by the test
- `SK_NAMESPACE`: `namespace` to set in the [`SpinApp` custom resources](https://www.spinkube.dev/docs/spin-operator/reference/spin-app/) created by the test
- `SK_EXECUTOR`: executor to set in the [`SpinApp` custom resources](https://www.spinkube.dev/docs/spin-operator/reference/spin-app/) created by the test
- `SK_OCI_REPO`: Base OCI repository for the Spin application artifacts
- `SK_OCI_TAG`: OCI image tag for all the apps
- `SK_ROUTE`: The HTTP route for the Spin app ([assumes HTTP trigger](https://developer.fermyon.com/spin/v2/manifest-reference#the-trigger-table))

The `K6` prefixed environment variables are specific to k6, which supports overriding [options](https://k6.io/docs/using-k6/k6-options/reference/) that are configured in a test script with environment variables prefixed with `K6_`. For example, the [`constant-vus` test](tests/scripts/constant-vus.js) can be updated to use 40 VUs by running the following:

    ```sh
    K6_VUS=40 make run-constant-vus-test-1
    ```

## Guidelines for K6 Scripts

Some pointers to keep in mind:

- Tests that are not evaluating RPS load should use a baseline of 20 VUs and 0.01s sleep between requests.
