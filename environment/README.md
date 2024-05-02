# Test Suite Installation Scripts

To install SpinKube (kwasm operator and Spin operator), K6 operator, cert manager, and Datadog on a cluster accessible with `kubectl`:

```sh
DATADOG_API_KEY=xyz SHIM_VERSION=v0.13.1 ./spin-kube-k8s.sh
```

To first provision a single node K3s or K3d cluster before installing the test suite, use `spin-kube-k3s.sh` or `spin-kube-k3d.sh`, respectively.
