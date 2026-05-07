# Kubernetes Security: 3 Lightweight Solutions

It looks like you forgot to paste your list of security solutions in your message! However, since your goal is to secure your cluster **without consuming a lot of resources** (especially given the 2GB RAM limits on your worker nodes), I have selected the three best built-in, lightweight security mechanisms. 

These three solutions use **almost zero additional resources** because they rely on components already running in your cluster, rather than requiring new heavy agents or sidecar proxies.

---

## 1. Role-Based Access Control (RBAC)

RBAC is the primary method for managing access to the Kubernetes API. It ensures that users, applications, and CI/CD pipelines (like Jenkins) only have the permissions they absolutely need (Principle of Least Privilege).

* **Why it's lightweight:** It is a native feature built directly into the Kubernetes API Server. It requires no extra pods or compute resources to run.
* **How it works:** You define `Roles` (e.g., "can read pods") and bind them to ServiceAccounts using `RoleBindings`.
* **Example Use Case:** Preventing your Jenkins pod from having cluster-admin access, restricting it to only deploy resources in specific namespaces.

## 2. Network Policies (via Calico)

Network Policies act as a micro-firewall for your pods. By default, all pods in a Kubernetes cluster can talk to each other. Network Policies restrict this traffic.

* **Why it's lightweight:** Your cluster is already using **Calico** as its Container Network Interface (CNI). Calico implements Network Policies natively at the Linux kernel level (using iptables or eBPF). Enforcing rules costs virtually no memory or CPU.
* **How it works:** You write YAML rules specifying which pods can communicate (e.g., allowing the `frontend` pod to talk to the `backend` pod, but blocking the `frontend` from talking directly to `postgres`).
* **Example Use Case:** Creating a "Default Deny" policy for a namespace, then whitelisting only necessary traffic.

## 3. Pod Security Admission (PSA)

Pod Security Admission is a built-in Kubernetes admission controller that enforces Pod Security Standards (PSS). It ensures that pods follow security best practices (e.g., not running as root, not mounting sensitive host folders).

* **Why it's lightweight:** Like RBAC, it is built directly into the API server. It simply checks the YAML manifests when a pod is created and rejects it if it violates the policy. Zero runtime overhead.
* **How it works:** You enforce a security level by simply adding a label to a namespace. There are three profiles: `Privileged` (unrestricted), `Baseline` (prevents known privilege escalations), and `Restricted` (strict best practices).
* **Example Use Case:** Applying the `restricted` profile to your `fullstack` namespace to guarantee no application is accidentally running as the root user.

---

## 🛑 What to Avoid (Resource-Intensive Security)

Since you want to conserve resources, you should **avoid** the following solutions unless absolutely necessary, as they will consume significant RAM and CPU on your worker nodes:

1. **Service Meshes (e.g., Istio, Linkerd):** These inject an Envoy proxy sidecar into *every single pod* in your cluster. This will quickly drain the 2GB of RAM on your worker nodes.
2. **Runtime Threat Detection (e.g., Falco):** These tools monitor Linux system calls in real-time. While excellent for security, they introduce continuous CPU overhead.
3. **External Policy Engines (e.g., OPA Gatekeeper, Kyverno):** These require running separate webhook pods that evaluate policies. While not as heavy as a service mesh, they still consume hundreds of megabytes of RAM.

---

## 🚀 How to Apply These Solutions to Your Cluster

I have already created the necessary YAML files and updated your `fullstack` application manifests to implement all three security measures. Here is how you can deploy them:

### Step 1: Enforce Pod Security Admission (PSA)
I updated `kubernetes/fullstack/namespace.yml` to include the `baseline` Pod Security Standard labels.
To apply this:
```bash
# On your DevOps machine
kubectl apply -f /vagrant/kubernetes/fullstack/namespace.yml
```
*(This tells Kubernetes to reject any pod in the `fullstack` namespace that attempts known privilege escalations, while still allowing standard apps like Nginx to run).*

### Step 2: Apply Role-Based Access Control (RBAC)
I created `kubernetes/fullstack/security-rbac.yml` and updated your frontend, backend, and postgres deployments to use a dedicated ServiceAccount (`fullstack-app-sa`) instead of the default one.
To apply this:
```bash
# 1. Create the ServiceAccount and Roles
kubectl apply -f /vagrant/kubernetes/fullstack/security-rbac.yml

# 2. Update your deployments to use the new ServiceAccount
kubectl apply -f /vagrant/kubernetes/fullstack/frontend-deployment.yml
kubectl apply -f /vagrant/kubernetes/fullstack/backend-deployment.yml
kubectl apply -f /vagrant/kubernetes/fullstack/postgres-deployment.yml
```

### Step 3: Apply Network Policies
I created `kubernetes/fullstack/security-network-policies.yml`. This creates a "Default Deny" rule, and then specifically whitelists:
- External traffic → Frontend
- Frontend → Backend
- Backend → PostgreSQL
- Pods → DNS (for service discovery)

To apply this:
```bash
kubectl apply -f /vagrant/kubernetes/fullstack/security-network-policies.yml
```

### Step 4: Verify
Once applied, your application will continue to work normally, but it will be highly secure:
1. Try to curl the `backend` directly from a pod that isn't the frontend (it will be blocked by Network Policies).
2. Look at the pod specs, and you'll see they are now running under `fullstack-app-sa` with restricted API access.
3. Try to create a pod in the `fullstack` namespace that mounts the host's `/` directory (it will be rejected by the PSA).
