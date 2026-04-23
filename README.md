# 🚀 DevOps & Kubernetes Cluster Project

A complete DevOps lab featuring a **Kubernetes cluster** (1 master + 2 workers) and a **DevOps machine** (Nexus + Ansible), with **Jenkins running as a K8s pod** and **NFS shared storage**, all automated with Vagrant and Ansible.

---

## 📐 Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Private Network: 192.168.56.0/24                    │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  k8s-master  │  │ k8s-worker1  │  │ k8s-worker2  │  │   devops   │  │
│  │  .56.10      │  │  .56.11      │  │  .56.12      │  │  .56.20    │  │
│  │  2GB / 2CPU  │  │  2GB / 2CPU  │  │  2GB / 2CPU  │  │  3GB / 2CPU│  │
│  │              │  │              │  │              │  │            │  │
│  │ Control Plane│  │  Jenkins Pod │  │   App Pods   │  │ Nexus      │  │
│  │ NFS Server   │  │   └─ DinD    │  │ hello-devops │  │ Docker     │  │
│  │ kubeadm      │  │   kubelet    │  │   kubelet    │  │ Ansible    │  │
│  │ Calico CNI   │  │   containerd │  │   containerd │  │ kubectl    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

**Key features:**
- **Jenkins** runs as a Kubernetes pod (with Docker-in-Docker sidecar)
- **NFS** on k8s-master provides persistent storage for Jenkins home
- **Nexus** on DevOps VM serves as a private Docker registry

**Total host resources needed:** ~9 GB RAM, 8 CPU cores

---

## 📁 Project Structure

```
Kubernities_Project/
├── Vagrantfile                            # 4 VM definitions
├── README.md                              # This file
├── FIRST_STAGE.md                         # Stage 1: Test K8s cluster (nginx)
├── SECOND_STAGE.md                        # Stage 2: NFS + Nexus + Jenkins in K8s
├── THIRD_STAGE.md                         # Stage 3: Deploy Hello World microservice
├── ansible/
│   ├── ansible.cfg                        # Ansible settings
│   ├── inventory/
│   │   └── hosts.ini                      # All nodes inventory
│   └── playbooks/
│       ├── common.yml                     # Prerequisites (swap, sysctl, modules)
│       ├── install-containerd.yml         # Container runtime
│       ├── install-kubernetes.yml         # kubeadm, kubelet, kubectl
│       ├── init-master.yml                # kubeadm init + Calico
│       ├── join-workers.yml               # kubeadm join
│       ├── setup-nfs-server.yml           # NFS server on k8s-master
│       ├── setup-nfs-clients.yml          # NFS client on workers + devops
│       ├── install-jenkins.yml            # Docker + kubectl on DevOps
│       ├── install-nexus.yml              # Nexus Docker registry
│       ├── configure-insecure-registry.yml # Nexus registry on K8s nodes
│       └── configure-kubectl-devops.yml   # kubeconfig for DevOps + Jenkins NFS
├── kubernetes/
│   ├── deployment.yml                     # App Deployment (2 replicas)
│   ├── service.yml                        # NodePort Service (port 30080)
│   ├── nexus-secret.yml                   # Registry credentials template
│   └── jenkins/                           # Jenkins-in-K8s manifests
│       ├── namespace.yml                  # Jenkins namespace
│       ├── rbac.yml                       # ServiceAccount + ClusterRole
│       ├── nfs-pv-pvc.yml                 # NFS PersistentVolume + Claim
│       ├── deployment.yml                 # Jenkins + DinD sidecar pod
│       └── service.yml                    # NodePort (32000 UI, 32001 agent)
├── app/
│   ├── app.js                             # Express.js sample app
│   ├── package.json                       # Dependencies
│   ├── Dockerfile                         # Multi-stage build
│   └── test/
│       └── app.test.js                    # Unit tests
├── jenkins/
│   └── Jenkinsfile                        # CI/CD pipeline
└── scripts/
    ├── setup-ssh-keys.sh                  # SSH key distribution
    └── verify-cluster.sh                  # Cluster health check
```

---

## 📋 Prerequisites

| Software | Version | Purpose |
|---|---|---|
| [VirtualBox](https://www.virtualbox.org/wiki/Downloads) | 7.0+ | VM hypervisor |
| [Vagrant](https://www.vagrantup.com/downloads) | 2.3+ | VM provisioning |
| Git | any | Version control |

Ensure **VT-x/AMD-v** (hardware virtualization) is enabled in your BIOS.

---

## 🚀 Step-by-Step Setup Guide

### Phase 1: Create Virtual Machines

```powershell
# From the project directory on your Windows host
cd C:\Users\AHMED\OneDrive\Desktop\Kubernities_Project

# Start all 4 VMs (takes 10-15 minutes first time)
vagrant up

# Verify all VMs are running
vagrant status
```

Expected output:
```
k8s-master    running (virtualbox)
k8s-worker1   running (virtualbox)
k8s-worker2   running (virtualbox)
devops        running (virtualbox)
```

---

### Phase 2: Set Up SSH Key Authentication

SSH into the DevOps machine and distribute SSH keys:

```bash
# SSH into devops machine
vagrant ssh devops

# Run the SSH key setup script
chmod +x /vagrant/scripts/setup-ssh-keys.sh
bash /vagrant/scripts/setup-ssh-keys.sh

# Verify SSH connectivity
ssh vagrant@k8s-master "hostname"    # Should print: k8s-master
ssh vagrant@k8s-worker1 "hostname"   # Should print: k8s-worker1
ssh vagrant@k8s-worker2 "hostname"   # Should print: k8s-worker2
```

---

### Phase 3: Run Ansible Playbooks (Kubernetes Cluster)

**All Ansible commands are run from the DevOps machine.**

```bash
# Stay on devops VM (or: vagrant ssh devops)
# Sync ansible files
sync-ansible
cd ~/ansible

# Verify Ansible can reach all nodes
ansible all -m ping
```

Expected:
```
k8s-master | SUCCESS => { "ping": "pong" }
k8s-worker1 | SUCCESS => { "ping": "pong" }
k8s-worker2 | SUCCESS => { "ping": "pong" }
```

Now run the playbooks **in order**:

```bash
# Step 1: Common prerequisites (swap, kernel modules, sysctl)
ansible-playbook -i inventory/hosts.ini playbooks/common.yml

# Step 2: Install containerd on all K8s nodes
ansible-playbook -i inventory/hosts.ini playbooks/install-containerd.yml

# Step 3: Install kubeadm, kubelet, kubectl
ansible-playbook -i inventory/hosts.ini playbooks/install-kubernetes.yml

# Step 4: Initialize the master node + install Calico CNI
ansible-playbook -i inventory/hosts.ini playbooks/init-master.yml

# Step 5: Join worker nodes to the cluster
ansible-playbook -i inventory/hosts.ini playbooks/join-workers.yml
```

> **💡 Tip:** If a playbook fails, fix the issue and re-run it. Ansible playbooks are **idempotent** — running them again won't break anything.

---

### Phase 4: Verify Kubernetes Cluster

```bash
# On the devops machine (after configure-kubectl-devops.yml)
kubectl get nodes
```

Expected output:
```
NAME          STATUS   ROLES           AGE   VERSION
k8s-master    Ready    control-plane   10m   v1.29.x
k8s-worker1   Ready    <none>          8m    v1.29.x
k8s-worker2   Ready    <none>          8m    v1.29.x
```

```bash
# Check Calico CNI is running
kubectl get pods -n kube-system | grep calico

# Run full verification
chmod +x /vagrant/scripts/verify-cluster.sh
bash /vagrant/scripts/verify-cluster.sh
```

---

### Phase 5: First Stage — Test the Cluster

Follow the detailed instructions in **[FIRST_STAGE.md](FIRST_STAGE.md)** to:
- Deploy a test nginx app
- Verify NodePort access
- Test self-healing and scaling
- Clean up test resources

---

### Phase 6: Second Stage — NFS + Nexus + Jenkins in K8s

Follow the detailed instructions in **[SECOND_STAGE.md](SECOND_STAGE.md)** to:

```bash
# Step 1: Set up NFS server on k8s-master
ansible-playbook -i inventory/hosts.ini playbooks/setup-nfs-server.yml

# Step 2: Install NFS clients on workers + devops
ansible-playbook -i inventory/hosts.ini playbooks/setup-nfs-clients.yml

# Step 3: Install Docker + kubectl on DevOps
ansible-playbook -i inventory/hosts.ini playbooks/install-jenkins.yml

# Step 4: Install Nexus Docker registry
ansible-playbook -i inventory/hosts.ini playbooks/install-nexus.yml

# Step 5: Configure insecure registry on K8s nodes
ansible-playbook -i inventory/hosts.ini playbooks/configure-insecure-registry.yml

# Step 6: Copy kubeconfig to DevOps + NFS
ansible-playbook -i inventory/hosts.ini playbooks/configure-kubectl-devops.yml

# Step 7: Deploy Jenkins to Kubernetes
kubectl apply -f /vagrant/kubernetes/jenkins/namespace.yml
kubectl apply -f /vagrant/kubernetes/jenkins/rbac.yml
kubectl apply -f /vagrant/kubernetes/jenkins/nfs-pv-pvc.yml
kubectl apply -f /vagrant/kubernetes/jenkins/deployment.yml
kubectl apply -f /vagrant/kubernetes/jenkins/service.yml
```

Then configure Nexus and Jenkins via their web UIs (see SECOND_STAGE.md for details).

---

### Phase 7: Third Stage — Deploy Hello World Microservice

Follow the detailed instructions in **[THIRD_STAGE.md](THIRD_STAGE.md)** to:
- Build and push the Docker image to Nexus
- Deploy the hello-devops app to Kubernetes
- Set up and run the Jenkins CI/CD pipeline
- Verify end-to-end automated deployment

---

## 🌐 Access Points

| Service | URL | Notes |
|---|---|---|
| **Jenkins** | `http://192.168.56.11:32000` | Runs as K8s pod (NodePort) |
| **Nexus Web UI** | `http://192.168.56.20:8081` | Docker container on DevOps |
| **Docker Registry** | `192.168.56.20:8082` | Nexus hosted repo |
| **Hello DevOps App** | `http://192.168.56.11:30080` | Your microservice |

---

## 🔧 Troubleshooting

### Common Issues

| Problem | Solution |
|---|---|
| `vagrant up` fails with VT-x error | Enable virtualization in BIOS |
| `ansible all -m ping` fails | Re-run `setup-ssh-keys.sh`, check connectivity |
| `kubeadm init` fails | Ensure swap is disabled: `sudo swapoff -a` |
| Nodes show `NotReady` | Wait 2-3 min for Calico pods to start |
| Calico pods `CrashLoopBackOff` | Check `kubectl logs -n kube-system calico-node-xxxxx` |
| NFS PVC stays `Pending` | Check NFS client: `dpkg -l nfs-common` on workers |
| Jenkins pod stuck `Pending` | Check worker resources: `kubectl describe pod -n jenkins` |
| Jenkins DinD sidecar fails | Check logs: `kubectl logs -n jenkins -l app=jenkins -c dind` |
| `docker push` to Nexus fails | Ensure Docker hosted repo is created on port 8082 |
| `ImagePullBackOff` in K8s | Check: 1) Secret exists 2) containerd insecure registry config 3) Restart containerd |
| `kubectl` on devops fails | Re-run `ansible-playbook playbooks/configure-kubectl-devops.yml` |

### Useful Debug Commands

```bash
# Check kubelet logs on any node
sudo journalctl -u kubelet -f

# Check containerd logs
sudo journalctl -u containerd -f

# Describe a failing pod
kubectl describe pod <pod-name>

# Check pod logs
kubectl logs <pod-name>

# Check Jenkins pod logs (both containers)
kubectl logs -n jenkins -l app=jenkins -c jenkins
kubectl logs -n jenkins -l app=jenkins -c dind

# Check events
kubectl get events --sort-by=.metadata.creationTimestamp

# Check NFS exports
ssh vagrant@k8s-master "showmount -e localhost"

# Restart containerd on a node
sudo systemctl restart containerd

# Re-generate join command from master
sudo kubeadm token create --print-join-command

# Reset a node (to rejoin cluster)
sudo kubeadm reset -f
```

---

## 📝 Verification Checklist

```bash
# ✅ 1. All VMs running
vagrant status

# ✅ 2. SSH connectivity from devops
ssh vagrant@k8s-master hostname
ssh vagrant@k8s-worker1 hostname
ssh vagrant@k8s-worker2 hostname

# ✅ 3. Ansible can reach all nodes
cd ~/ansible && ansible all -m ping

# ✅ 4. Kubernetes nodes are Ready
kubectl get nodes

# ✅ 5. Calico CNI is running
kubectl get pods -n kube-system -l k8s-app=calico-node

# ✅ 6. NFS server is working
ssh vagrant@k8s-master "showmount -e localhost"

# ✅ 7. Jenkins is running in K8s (2/2 containers)
kubectl get pods -n jenkins

# ✅ 8. Jenkins is accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.11:32000  # Should return 200

# ✅ 9. Nexus is accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.20:8081  # Should return 200

# ✅ 10. Docker push to Nexus works
docker push 192.168.56.20:8082/hello-devops:latest

# ✅ 11. Application is deployed
kubectl get pods -l app=hello-devops
curl http://192.168.56.11:30080

# ✅ 12. Full verification script
bash /vagrant/scripts/verify-cluster.sh
```

---

## 🔄 Daily Operations

```bash
# Start all VMs
vagrant up

# Stop all VMs (saves state)
vagrant halt

# SSH into a specific VM
vagrant ssh k8s-master
vagrant ssh k8s-worker1
vagrant ssh devops

# Destroy all VMs (start fresh)
vagrant destroy -f

# Re-provision a single VM
vagrant provision k8s-master
```

---

## 📚 Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Hypervisor | VirtualBox 7 | VM management |
| Provisioning | Vagrant | VM automation |
| OS | Ubuntu 22.04 (Jammy) | Server base |
| Config Management | Ansible | Automated setup |
| Container Runtime | containerd | Run containers |
| K8s Bootstrap | kubeadm | Cluster setup |
| CNI | Calico | Pod networking |
| CI/CD | Jenkins (K8s pod) | Build pipeline |
| Registry | Nexus 3 | Docker images |
| Storage | NFS | Persistent volumes |
| Sample App | Node.js / Express | Demo application |
