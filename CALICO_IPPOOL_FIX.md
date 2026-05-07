# Calico Routing Conflict Fix (NAT Masquerade)

> **Goal:** Allow the **Jenkins Pod** running inside the K8s cluster to reach the DevOps machine (192.168.56.20) using its **real IP address**, without any alias IP or manual routing workaround.

---

## 1. The Problem

### Architecture

`
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
`

### Why Traffic Gets Blocked

When the cluster was initialized, Calico was given a Pod CIDR of 192.168.0.0/16. This is a very large range — it includes **all** addresses from 192.168.0.0 to 192.168.255.255.
The DevOps machine IP 192.168.56.20 **falls inside** this range.

When the **Jenkins Pod** tries to reach http://192.168.56.20:3000 (Gitea on the DevOps machine):
1. The packet leaves the Jenkins Pod and enters the Calico virtual network.
2. Because the destination IP is within Calico's CIDR (192.168.0.0/16), Calico thinks the destination is another internal Pod.
3. It performs **no NAT (Network Address Translation)**.
4. The packet exits the Node with the source IP of the Pod (e.g. 192.168.56.129).
5. When the DevOps machine tries to reply, it doesn't know where 192.168.56.129 is (there is no route to the Pods), so the connection drops.

---

## 2. The Real Solution: iptables MASQUERADE

Instead of using Alias IPs (10.56.20.20), modifying Calico's IPPools, or adding complex routing rules, the cleanest solution is to force **Network Address Translation (NAT)** for traffic leaving the K8s cluster destined for the 192.168.56.0/24 subnet.

We accomplish this by adding an iptables rule on every Kubernetes Node:

`ash
iptables -t nat -A POSTROUTING -s 192.168.0.0/16 -d 192.168.56.0/24 -o enp0s8 -j MASQUERADE
`

### How It Works Now:

1. Pod sends packet to 192.168.56.20.
2. Packet hits the Node's iptables.
3. The POSTROUTING rule matches (Source is Pod network, Destination is DevOps network).
4. iptables **MASQUERADES** the packet, rewriting its Source IP to the Node's physical IP (e.g., 192.168.56.11).
5. Packet reaches 192.168.56.20.
6. DevOps machine replies directly to the Node (192.168.56.11).
7. Node de-NATs the reply and forwards it back to the Pod.
8. ✅ **SUCCESS**

---

## 3. Implementation Details

We made this fix persistent across VM reboots by creating a systemd service on all K8s Nodes (k8s-master, k8s-worker1, k8s-worker2).

### Systemd Service: k8s-nat-masquerade.service

**Location on Nodes:** /etc/systemd/system/k8s-nat-masquerade.service

`ini
[Unit]
Description=NAT MASQUERADE for pod-to-host traffic (Calico CIDR overlap fix)
After=network-online.target containerd.service kubelet.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/sbin/iptables -t nat -A POSTROUTING -s 192.168.0.0/16 -d 192.168.56.0/24 -o enp0s8 -j MASQUERADE
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`

This ensures the iptables rule is automatically applied every time the K8s nodes start up.

---

## 4. Gitea Internal DNS Resolution

To make the system even more robust and K8s-native, we created an External Service inside Kubernetes that maps an internal DNS name directly to the real DevOps IP.

**Service Location:** kubernetes/gitea/gitea-external-service.yml

This allows your Jenkins pods to access Gitea using the following URL:

`	ext
http://gitea.gitea.svc.cluster.local:3000/ahmedmessoudi/fullstack-app.git
`

This internal DNS name automatically resolves to 192.168.56.20 under the hood.

---

## 5. Next Steps for Jenkins

Now that the network layer is fully working, you should update your CI/CD configuration:

1. **Jenkins Repository URL:** Update any Git source URLs in Jenkins to use either:
   - http://192.168.56.20:3000/ahmedmessoudi/fullstack-app.git
   - http://gitea.gitea.svc.cluster.local:3000/ahmedmessoudi/fullstack-app.git
2. **Containerd & Docker Registries:** You can now revert your insecure registry settings from the 10.56.20.20 alias back to the real IP 192.168.56.20.

