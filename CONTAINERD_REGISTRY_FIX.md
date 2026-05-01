# Containerd Nexus Registry Authentication Issue

This document explains the root cause of the `ImagePullBackOff` and `ErrImagePull` errors encountered when attempting to deploy pods from the local Nexus registry (`192.168.56.20:8082`), and how the issue was successfully resolved.

## 1. The Symptoms
When Kubernetes attempted to pull the backend and frontend images, the worker nodes consistently returned the following fatal error:
```text
failed to do request: Head "https://192.168.56.20:8082/v2/fullstack-backend/manifests/latest": http: server gave HTTP response to HTTPS client
```
This indicated that `containerd` (the container runtime on the worker nodes) was attempting to communicate with the Nexus registry over **HTTPS**, while Nexus was only serving **HTTP**.

## 2. The Root Cause (The "Colon Bug")

To fix the HTTPS issue, we configured `containerd` to use the `certs.d` directory approach (which is the modern, recommended way to configure registries in `containerd v2.x`).

We created the directory `/etc/containerd/certs.d/192.168.56.20:8082/` and placed a `hosts.toml` file inside it containing:
```toml
server = "http://192.168.56.20:8082"

[host."http://192.168.56.20:8082"]
  capabilities = ["pull", "resolve", "push"]
  skip_verify = true
```

However, `crictl` and `kubelet` continued to fail with the exact same error, completely ignoring our `hosts.toml` file!

Upon deep investigation of the `containerd` default configuration, we discovered the `config_path` was set to:
```toml
config_path = '/etc/containerd/certs.d:/etc/docker/certs.d'
```
**The bug:** Because the `config_path` contained two paths separated by a colon (`:`), the Kubernetes CRI (Container Runtime Interface) plugin inside `containerd` failed to parse the path correctly. As a result, it silently ignored the entire `certs.d` directory and fell back to its default behavior: strict HTTPS.

## 3. The Fix

The fix was to explicitly force `containerd` to only use a single, colon-less path for `config_path`.

We updated our Ansible playbooks (`install-containerd.yml` and `configure-insecure-registry.yml`) to perform a regex replacement on the `config.toml` file:
```yaml
    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = [''"].*[''"]'
        replace: 'config_path = "/etc/containerd/certs.d"'
```

After modifying `/etc/containerd/config.toml` to:
```toml
config_path = "/etc/containerd/certs.d"
```
and restarting `containerd`, the CRI plugin correctly parsed the directory. It located the `hosts.toml` file, recognized that the registry was HTTP (`server = "http://192.168.56.20:8082"`), and successfully passed the `imagePullSecrets` credentials provided by Kubernetes.

The pods immediately transitioned to the `Running` state!

## 4. Updates to Playbooks
All fixes have been permanently integrated into the primary Ansible playbooks:
1. **`ansible/playbooks/configure-insecure-registry.yml`**: Will now automatically enforce the single-path `config_path` and apply the `hosts.toml` configuration securely.
2. **`ansible/playbooks/install-containerd.yml`**: Ensures that even if the cluster is completely rebuilt from scratch using `vagrant destroy` & `vagrant up`, the initial containerd installation will immediately patch the `config_path` bug out of the box.
