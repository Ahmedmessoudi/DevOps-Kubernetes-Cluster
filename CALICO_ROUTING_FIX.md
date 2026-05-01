# Calico Subnet Conflict & Alias IP Fix

This document explains the "Subnet Conflict" issue encountered when Jenkins (running in a Kubernetes Pod) tried to communicate with Gitea or Nexus (running on the DevOps machine), and how we fixed it.

## 1. The Problem: Subnet Overlap
In our VirtualBox environment:
*   The **Vagrant Host-Only Network** is `192.168.56.0/24`.
*   The **Kubernetes Pod CIDR** (managed by Calico) was initialized as `192.168.0.0/16`.

**The Conflict:** Because `192.168.56.0/24` falls **inside** the larger `192.168.0.0/16` range, Calico believes that any traffic destined for `192.168.56.x` is intended for another Pod inside the cluster.

When Jenkins (in a Pod) tries to reach Gitea at `192.168.56.20`:
1.  Calico intercepts the packet.
2.  It looks for a Pod with IP `192.168.56.20`.
3.  Since no such Pod exists, the traffic is blackholed (dropped).
4.  Jenkins fails with a "Connection Timeout" or "Failed to connect" error.

## 2. The Solution: Alias IP Workaround
To fix this without rebuilding the entire cluster with a different CIDR, we created a "Virtual Bridge":

### Step A: Add an Alias IP to DevOps
We assigned a secondary IP address to the `devops` machine that is **outside** the Calico `/16` range.
*   **Alias IP:** `10.56.20.20`
*   **Command:** `sudo ip addr add 10.56.20.20/32 dev enp0s8`

### Step B: Add Routing Rules to K8s Nodes
We told the Kubernetes nodes that any traffic for `10.56.20.20` should be sent to the DevOps machine's real IP (`192.168.56.20`).
*   **Command:** `sudo ip route add 10.56.20.20 via 192.168.56.20`

### Step C: Update Jenkins & Containerd
1.  **Jenkins Job:** The Gitea Repository URL was updated to `http://10.56.20.20:3000/...`.
2.  **Jenkinsfile:** The `NEXUS_REGISTRY` variable was updated to `10.56.20.20:8082`.
3.  **Containerd:** We added a new `hosts.toml` configuration for `10.56.20.20:8082` so that K8s nodes trust the registry under its new alias IP.

## 3. Result
When Jenkins now tries to reach `10.56.20.20`:
1.  Calico sees the destination is **outside** its `192.168.0.0/16` range.
2.  It allows the packet to leave the Pod network and hit the Node's routing table.
3.  The Node follows the route we added and sends the packet to `192.168.56.20`.
4.  Communication succeeds!

## 4. Persistent Fix
These tasks have been integrated into the Ansible `common.yml` and `configure-insecure-registry.yml` playbooks to ensure the fix persists across reboots or cluster recreations.
