# Calico IPPool CIDR Exclusion Fix

> **Goal:** Allow the **Jenkins Pod** running inside the K8s cluster to reach the DevOps machine (`192.168.56.20`) using its **real IP address**, without any alias IP or manual routing workaround.

---

## 1. The Problem

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Kubernetes Cluster                      │
│                                                          │
│  ┌─────────────────┐          ┌─────────────────────┐    │
│  │  Jenkins Pod    │──GET──▶ │  Calico (CNI)       │    │
│  │  namespace:     │          │  192.168.0.0/16     │    │
│  │  jenkins        │          │  intercepts all     │    │
│  │  (Pod IP:       │          │  192.168.x.x traffic│    │
│  │  192.168.x.x)   │          └──────────┬──────────┘    │
│  └─────────────────┘                     │               │
│                                   BLACKHOLE ❌          │
│                              (no pod at .56.20)          │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│          DevOps Machine (tools) — OUTSIDE cluster        │
│  IP: 192.168.56.20                                       │
│  ┌──────────────┐  ┌─────────────┐                       │
│  │  Gitea       │  │   Nexus     │                       │
│  │  :3000       │  │   :8082     │                       │
│  └──────────────┘  └─────────────┘                       │
└──────────────────────────────────────────────────────────┘
```

### Network Layout

| Machine / Component | IP Address        | Location               | Role                                                |
|---------------------|-------------------|------------------------|-----------------------------------------------------|
| k8s-master          | 192.168.56.10     | VM (host-only)         | Kubernetes control plane                            |
| k8s-worker1         | 192.168.56.11     | VM (host-only)         | Kubernetes worker node                              |
| k8s-worker2         | 192.168.56.12     | VM (host-only)         | Kubernetes worker node                              |
| **Jenkins Pod**     | 192.168.x.x (pod) | **Inside K8s cluster** | CI/CD — originates the git fetch requests to Gitea  |
| devops              | 192.168.56.20     | VM **outside** cluster | Gitea (:3000) & Nexus (:8082)                       |

### Why Traffic Gets Blocked

When the cluster was initialized, Calico was given a Pod CIDR of `192.168.0.0/16`. This is a very large range — it includes **all** addresses from `192.168.0.0` to `192.168.255.255`.

The DevOps machine IP `192.168.56.20` **falls inside** this range.

When the **Jenkins Pod** tries to reach `http://192.168.56.20:3000` (Gitea on the DevOps machine):
1. The packet leaves the Jenkins Pod and enters the Calico virtual network.
2. Calico intercepts it — `192.168.56.20` is within its managed CIDR `192.168.0.0/16`.
3. Calico looks for a Pod with IP `192.168.56.20` — none exists.
4. The packet is **silently dropped (blackholed)**.
5. Jenkins reports: `Failed to connect to 192.168.56.20 port 3000 after 21028 ms`.

> ℹ️ This does **not** affect traffic from the K8s nodes themselves (e.g., SSH from master to devops). Only traffic **originating from inside a Pod** goes through Calico and is affected.

### Previous Workaround (Alias IP)

The previous fix assigned a secondary IP `10.56.20.20` to the DevOps machine (outside the `192.168.0.0/16` range) and added static routes on all K8s nodes. This worked, but:

- ❌ Routes are lost on every VM reboot (`ip route add` is not persistent).
- ❌ Requires manual intervention after every restart.
- ❌ Uses a fake IP instead of the real machine address.

---

## 2. The Real Solution: Calico IPPool CIDR Exclusion

### Core Idea

Instead of routing around the problem, we **fix Calico's configuration directly**.

We replace the single large `192.168.0.0/16` IPPool with **two smaller IPPools** that together cover the same space, but with a **deliberate gap at `192.168.56.0/24`** — the subnet of our DevOps machine.

```
Before:
  Calico owns: 192.168.0.0/16  ──────────────────────────────────────────
                                 includes 192.168.56.20 → BLOCKED ❌

After:
  Pool "low":  192.168.0.0/17  ──────────────────── (up to 192.168.55.255)
               GAP:             192.168.56.0/24    → HOST NETWORK ✅ FREE
  Pool "high": 192.168.57.0/23 ──────────────────── (from 192.168.57.0)
```

With the gap in place, when the Jenkins Pod sends traffic to `192.168.56.20`:
1. Calico sees the destination is **outside its IPPools**.
2. It does **not** intercept the packet.
3. The packet flows through the node's normal routing table.
4. The node sends it directly to the DevOps machine via the host-only network.
5. ✅ Connection succeeds using the **real IP** `192.168.56.20`.

---

## 3. Implementation

### Prerequisites

- `kubectl` access to the cluster (from `k8s-master`)
- Calico installed as the CNI
- `calicoctl` installed (optional, but recommended for verification)

### Step 1: Check the Current IPPool

```bash
# On k8s-master
kubectl get ippools.crd.projectcalico.org -o yaml
```

You should see one pool named `default-ipv4-ippool` with CIDR `192.168.0.0/16`. Note the exact name for Step 3.

### Step 2: Create the Two New IPPools

Apply the following manifest to create the two replacement pools:

```bash
kubectl apply -f - <<'EOF'
apiVersion: projectcalico.org/v3
kind: IPPool
metadata:
  name: pool-low
spec:
  cidr: 192.168.0.0/17
  ipipMode: Always
  natOutgoing: true
  disabled: false
---
apiVersion: projectcalico.org/v3
kind: IPPool
metadata:
  name: pool-high
spec:
  cidr: 192.168.57.0/23
  ipipMode: Always
  natOutgoing: true
  disabled: false
EOF
```

**What these pools cover:**

| Pool        | CIDR              | Range                              |
|-------------|-------------------|------------------------------------|
| `pool-low`  | `192.168.0.0/17`  | `192.168.0.0` → `192.168.55.255`  |
| *(gap)*     | `192.168.56.0/24` | **DevOps host network — excluded** |
| `pool-high` | `192.168.57.0/23` | `192.168.57.0` → `192.168.58.255` |

### Step 3: Disable the Old IPPool

Disable (do not delete) the old large pool. Disabling it means existing pods keep their IPs, but no new pods will get IPs from this pool.

```bash
kubectl patch ippool default-ipv4-ippool --type='merge' \
  -p '{"spec":{"disabled":true}}'
```

> ⚠️ **Do not delete** the old pool if you have running pods with IPs from `192.168.0.0/16`. Deletion would break those pods. Disabling is safe.

### Step 4: Verify the New Configuration

```bash
# Check all pools are present
kubectl get ippools.crd.projectcalico.org

# Expected output:
# NAME                  AGE
# default-ipv4-ippool   65d   ← disabled
# pool-low              1m
# pool-high             1m
```

```bash
# Confirm the old pool is disabled
kubectl get ippool default-ipv4-ippool -o jsonpath='{.spec.disabled}'
# Expected output: true
```

### Step 5: Test Connectivity from a Pod

```bash
# Launch a temporary test pod and try to reach Gitea
kubectl run test-conn --image=busybox --restart=Never --rm -it -- \
  wget -qO- --timeout=5 http://192.168.56.20:3000

# Expected: Gitea HTML page content (no timeout)
```

### Step 6: Update Jenkins Configuration

In the Jenkins job configuration, update the **Repository URL** back to the real DevOps IP:

```
http://192.168.56.20:3000/ahmedmessoudi/fullstack-app.git
```

Remove any references to the alias IP `10.56.20.20:3000` in:
- Jenkins job SCM configuration (Dashboard → Job → Configure → SCM)
- `Jenkinsfile.fullstack` (if the Gitea URL is hardcoded)

---

## 4. Rollback Procedure

If anything goes wrong, re-enable the old pool and delete the new ones:

```bash
# Re-enable the original pool
kubectl patch ippool default-ipv4-ippool --type='merge' \
  -p '{"spec":{"disabled":false}}'

# Delete the new pools
kubectl delete ippool pool-low pool-high
```

---

## 5. Comparison with Previous Workaround

| Aspect                     | Alias IP (Old Fix)      | IPPool Exclusion (This Fix)   |
|----------------------------|-------------------------|-------------------------------|
| Uses real DevOps IP        | ❌ Uses `10.56.20.20`   | ✅ Uses `192.168.56.20`       |
| Persistent across reboots  | ❌ Lost on every reboot | ✅ Stored in Kubernetes API   |
| Requires manual steps      | ✅ After every restart  | ❌ One-time setup             |
| Modifies cluster networking| ❌ No                   | ⚠️ Modifies Calico IPPools    |
| Safe for existing pods     | ✅ Yes                  | ✅ Yes (disable, not delete)  |
| Production-suitable        | ❌ Workaround only      | ✅ Proper Calico configuration|

---

## 6. How It Relates to the Previous Fix

The `CALICO_ROUTING_FIX.md` documented an **alias IP workaround** that was necessary because the Calico pod CIDR conflicted with the host network. This document supersedes that workaround.

Once this IPPool exclusion is applied:
- The alias IP `10.56.20.20` on the DevOps machine is **no longer needed**.
- The static routes (`ip route add 10.56.20.20 via 192.168.56.20`) on K8s nodes are **no longer needed**.
- All Jenkins job configurations should reference `192.168.56.20` directly.

The old alias IP can be removed from the DevOps machine:
```bash
# On the DevOps machine (optional cleanup)
sudo ip addr del 10.56.20.20/32 dev enp0s8
```
