# 🚀 DevOps & Kubernetes Cluster Project

A complete DevOps lab featuring a **Kubernetes cluster** (1 master + 2 workers) and a **DevOps machine** (Jenkins + Nexus + Ansible), all automated with Vagrant and Ansible.

---

## 📐 Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Private Network: 192.168.56.0/24                    │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  k8s-master  │  │ k8s-worker1  │  │ k8s-worker2  │  │   devops   │ │
│  │  .56.10      │  │  .56.11      │  │  .56.12      │  │  .56.20    │ │
│  │  2GB / 2CPU  │  │  2GB / 2CPU  │  │  2GB / 2CPU  │  │  3GB / 2CPU│ │
│  │              │  │              │  │              │  │            │ │
│  │ Control Plane│  │   Worker     │  │   Worker     │  │ Jenkins    │ │
│  │ kubeadm      │  │   kubelet    │  │   kubelet    │  │ Nexus      │ │
│  │ Calico CNI   │  │   containerd │  │   containerd │  │ Ansible    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

**Total host resources needed:** ~9 GB RAM, 8 CPU cores

---

## 📁 Project Structure

```
Kubernities_Project/
├── Vagrantfile                       # 4 VM definitions
├── README.md                         # This file
├── ansible/
│   ├── ansible.cfg                   # Ansible settings
│   ├── inventory/
│   │   └── hosts.ini                 # All nodes inventory
│   ├── playbooks/
│   │   ├── common.yml                # Prerequisites (swap, sysctl, modules)
│   │   ├── install-containerd.yml    # Container runtime
│   │   ├── install-kubernetes.yml    # kubeadm, kubelet, kubectl
│   │   ├── init-master.yml           # kubeadm init + Calico
│   │   ├── join-workers.yml          # kubeadm join
│   │   ├── install-jenkins.yml       # Jenkins + Docker + kubectl
│   │   ├── install-nexus.yml         # Nexus Docker registry
│   │   └── configure-kubectl-devops.yml  # kubeconfig for Jenkins
│   └── files/
│       └── daemon.json               # Insecure registry config
├── kubernetes/
│   ├── deployment.yml                # App Deployment (2 replicas)
│   ├── service.yml                   # NodePort Service (port 30080)
│   └── nexus-secret.yml              # Registry credentials template
├── app/
│   ├── app.js                        # Express.js sample app
│   ├── package.json                  # Dependencies
│   ├── Dockerfile                    # Multi-stage build
│   └── test/
│       └── app.test.js               # Unit tests
├── jenkins/
│   └── Jenkinsfile                   # CI/CD pipeline
└── scripts/
    ├── setup-ssh-keys.sh             # SSH key distribution
    └── verify-cluster.sh             # Cluster health check
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

### Phase 3: Run Ansible Playbooks

**All Ansible commands are run from the DevOps machine.**

```bash
# Stay on devops VM (or: vagrant ssh devops)
cd /vagrant/ansible

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
ansible-playbook playbooks/common.yml

# Step 2: Install containerd on all K8s nodes
ansible-playbook playbooks/install-containerd.yml

# Step 3: Install kubeadm, kubelet, kubectl
ansible-playbook playbooks/install-kubernetes.yml

# Step 4: Initialize the master node + install Calico CNI
ansible-playbook playbooks/init-master.yml

# Step 5: Join worker nodes to the cluster
ansible-playbook playbooks/join-workers.yml

# Step 6: Install Jenkins + Docker + kubectl on DevOps
ansible-playbook playbooks/install-jenkins.yml

# Step 7: Install Nexus Docker registry
ansible-playbook playbooks/install-nexus.yml

# Step 8: Copy kubeconfig to DevOps for kubectl access
ansible-playbook playbooks/configure-kubectl-devops.yml
```

> **💡 Tip:** If a playbook fails, fix the issue and re-run it. Ansible playbooks are **idempotent** — running them again won't break anything.

---

### Phase 4: Verify Kubernetes Cluster

```bash
# On the devops machine (after Step 8 above)
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

### Phase 5: Configure Nexus Docker Registry

1. **Access Nexus Web UI:** Open `http://192.168.56.20:8081` in your browser

2. **Get initial admin password:**
   ```bash
   # On devops machine
   docker exec nexus cat /nexus-data/admin.password
   ```

3. **Log in** with username `admin` and the password from above

4. **Create Docker hosted repository:**
   - Go to ⚙️ **Settings** → **Repositories** → **Create Repository**
   - Select **docker (hosted)**
   - Configure:
     - **Name:** `docker-hosted`
     - **HTTP port:** `8082`
     - **Enable Docker V1 API:** ✅ checked
   - Click **Create Repository**

5. **Enable Docker Bearer Token Realm:**
   - Go to ⚙️ **Settings** → **Security** → **Realms**
   - Move **Docker Bearer Token Realm** to the **Active** column
   - Click **Save**

6. **Test Docker login:**
   ```bash
   # On devops machine
   docker login 192.168.56.20:8082 -u admin -p YOUR_NEW_PASSWORD
   ```

---

### Phase 6: Configure Jenkins

1. **Access Jenkins:** Open `http://192.168.56.20:8080` in your browser

2. **Get initial admin password:**
   ```bash
   # On devops machine
   sudo cat /var/lib/jenkins/secrets/initialAdminPassword
   ```

3. **Complete setup wizard:**
   - Paste the initial password
   - Install **suggested plugins**
   - Create an admin user
   - Set Jenkins URL: `http://192.168.56.20:8080/`

4. **Install additional plugins:**
   - Go to **Manage Jenkins** → **Plugins** → **Available plugins**
   - Install: **Docker Pipeline**, **NodeJS**, **Kubernetes CLI**

5. **Add Nexus credentials:**
   - Go to **Manage Jenkins** → **Credentials** → **Global**
   - Click **Add Credentials**
   - Kind: **Username with password**
   - Username: `admin`
   - Password: your Nexus password
   - ID: `nexus-docker-credentials`
   - Click **OK**

6. **Configure NodeJS tool:**
   - Go to **Manage Jenkins** → **Tools**
   - Under **NodeJS installations**: click **Add NodeJS**
   - Name: `nodejs-18`
   - Version: `NodeJS 18.x`
   - Click **Save**

7. **Create Pipeline Job:**
   - Click **New Item**
   - Name: `hello-devops`
   - Type: **Pipeline**
   - Under Pipeline:
     - Definition: **Pipeline script from SCM**
     - SCM: **Git**
     - Repository URL: your Git repo URL (or `/vagrant` for local testing)
     - Script Path: `jenkins/Jenkinsfile`
   - Click **Save**

---

### Phase 7: Deploy Sample Application

#### Manual deployment (to test before Jenkins):

```bash
# On devops machine
cd /vagrant/app

# Build and push Docker image
docker build -t 192.168.56.20:8082/hello-devops:v1 .
docker push 192.168.56.20:8082/hello-devops:v1
docker tag 192.168.56.20:8082/hello-devops:v1 192.168.56.20:8082/hello-devops:latest
docker push 192.168.56.20:8082/hello-devops:latest

# Create Kubernetes secret for Nexus registry
kubectl create secret docker-registry nexus-registry-secret \
  --docker-server=192.168.56.20:8082 \
  --docker-username=admin \
  --docker-password=YOUR_NEXUS_PASSWORD \
  --docker-email=admin@example.com

# Deploy to Kubernetes
kubectl apply -f /vagrant/kubernetes/deployment.yml
kubectl apply -f /vagrant/kubernetes/service.yml

# Watch pods start
kubectl get pods -l app=hello-devops -w

# Test the application
curl http://192.168.56.11:30080
curl http://192.168.56.12:30080
```

Expected response:
```json
{
  "message": "Hello DevOps! 🚀",
  "version": "1.0.0",
  "hostname": "hello-devops-xxxxx",
  "timestamp": "2026-03-01T..."
}
```

#### Automated deployment (via Jenkins):

- Go to Jenkins → `hello-devops` job → **Build Now**
- Watch the pipeline stages execute
- On success, the app is automatically deployed to Kubernetes

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
| `docker push` to Nexus fails | Ensure Docker hosted repo is created on port 8082 |
| `ImagePullBackOff` in K8s | Check: 1) Secret exists 2) containerd insecure registry config 3) Restart containerd |
| Jenkins can't run Docker | Run: `sudo usermod -aG docker jenkins && sudo systemctl restart jenkins` |
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

# Check events
kubectl get events --sort-by=.metadata.creationTimestamp

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
cd /vagrant/ansible && ansible all -m ping

# ✅ 4. Kubernetes nodes are Ready
kubectl get nodes

# ✅ 5. Calico CNI is running
kubectl get pods -n kube-system -l k8s-app=calico-node

# ✅ 6. Jenkins is accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.20:8080  # Should return 200

# ✅ 7. Nexus is accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.20:8081  # Should return 200

# ✅ 8. Docker push to Nexus works
docker push 192.168.56.20:8082/hello-devops:latest

# ✅ 9. Application is deployed
kubectl get pods -l app=hello-devops
curl http://192.168.56.11:30080

# ✅ 10. Full verification script
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
| CI/CD | Jenkins | Build pipeline |
| Registry | Nexus 3 | Docker images |
| Sample App | Node.js / Express | Demo application |
