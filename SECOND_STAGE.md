# Second Stage — NFS Storage, Nexus Registry & Jenkins on Kubernetes

> **Goal:** Set up NFS shared storage on the master node, configure the Nexus Docker Registry,
> and deploy Jenkins as a Kubernetes pod on the worker nodes.

---

## Prerequisites

Before starting this stage, make sure:

- [x] **First Stage** is complete:
  - Kubernetes cluster running with all 3 nodes **Ready**
  - Sample nginx app deployed and tested successfully
- [x] **Ansible playbooks** executed (from Phase 3 in README):
  - `common.yml` ✅
  - `install-containerd.yml` ✅
  - `install-kubernetes.yml` ✅
  - `init-master.yml` ✅
  - `join-workers.yml` ✅
- [x] **DevOps machine** is accessible at `192.168.56.20`
- [x] `kubectl get nodes` shows all 3 nodes as **Ready**

---

## Part 1: Set Up NFS Server on k8s-master

NFS (Network File System) provides shared persistent storage for the Kubernetes cluster. We install the NFS server on `k8s-master` so that pods on any worker node can mount the same shared directories.

### Step 1: Run the NFS Server Playbook

From the **DevOps machine**:

```bash
# SSH into devops (from Windows PowerShell)
vagrant ssh devops

# Sync ansible files if needed
sync-ansible

# Run the NFS server playbook
cd ~/ansible
ansible-playbook -i inventory/hosts.ini playbooks/setup-nfs-server.yml
```

**What this does:**
- Installs `nfs-kernel-server` on k8s-master
- Creates two export directories:
  - `/srv/nfs/jenkins` — persistent storage for Jenkins home directory
  - `/srv/nfs/data` — general purpose shared storage for apps
- Configures `/etc/exports` to allow access from the `192.168.56.0/24` subnet
- Starts and enables the NFS service

Expected output at the end:
```
TASK [Display NFS exports] ****************************************************
ok: [k8s-master] => {
    "msg": "NFS Server configured on k8s-master!\nExports:\n/srv/nfs/jenkins  192.168.56.0/24\n/srv/nfs/data     192.168.56.0/24\n"
}
```

---

### Step 2: Run the NFS Clients Playbook

Still on the **DevOps machine**:

```bash
ansible-playbook -i inventory/hosts.ini playbooks/setup-nfs-clients.yml
```

**What this does:**
- Installs `nfs-common` on both worker nodes and the DevOps VM
- Tests connectivity to the NFS server on k8s-master

Expected output:
```
TASK [Display NFS test results] ***********************************************
ok: [k8s-worker1] => {
    "msg": "NFS server exports visible from k8s-worker1:\n/srv/nfs/jenkins 192.168.56.0/24\n/srv/nfs/data    192.168.56.0/24\n"
}
ok: [k8s-worker2] => { ... }
ok: [devops] => { ... }
```

---

### Step 3: Verify NFS Manually (Optional)

```bash
# Test NFS from worker1
ssh vagrant@k8s-worker1
sudo mount -t nfs 192.168.56.10:/srv/nfs/data /mnt
echo "NFS works!" | sudo tee /mnt/test.txt
cat /mnt/test.txt
sudo umount /mnt
exit

# Verify the file was created on master
ssh vagrant@k8s-master
cat /srv/nfs/data/test.txt
# Should print: NFS works!
sudo rm /srv/nfs/data/test.txt
exit
```

✅ **NFS is ready!**

---

## Part 2: Configure Nexus Docker Registry

### Step 1: Run the Nexus and Docker Playbooks

From the **DevOps machine**:

```bash
# Install Docker & kubectl on DevOps
ansible-playbook -i inventory/hosts.ini playbooks/install-jenkins.yml

# Install Nexus
ansible-playbook -i inventory/hosts.ini playbooks/install-nexus.yml
```

> **Note:** The `install-jenkins.yml` playbook now only installs Docker and kubectl on the DevOps machine. Jenkins itself is deployed as a Kubernetes pod (Part 3).

---

### Step 2: Access Nexus Web UI

Open your browser and navigate to:

```
http://192.168.56.20:8081
```

You should see the Nexus login page.

---

### Step 3: Get Nexus Initial Admin Password

From your DevOps machine SSH session:

```bash
# Get the admin password
docker exec nexus cat /nexus-data/admin.password
```

**Copy this password** — you'll need it to log in.

---

### Step 4: Log In to Nexus

1. On the login page, enter:
   - **Username:** `admin`
   - **Password:** *(paste the password from Step 3)*

2. Click **Sign in**

3. A **Setup Wizard** may appear — click **Next** to proceed through the quick setup

---

### Step 5: Change the Admin Password

1. After login, click the **gear icon** (⚙️) in the top-right corner → **Account**

2. Click **Change password**

3. Enter:
   - **Current password:** *(the one you just used)*
   - **New password:** `admin123` (or your preferred password)
   - **Confirm password:** *(repeat)*

4. Click **Change password**

> **Save this new password** — you'll need it for Docker login and Jenkins configuration.

---

### Step 6: Create a Docker Hosted Repository

1. Click the **gear icon** (⚙️) → **Repositories**

2. Click **Create repository** (blue button on the right)

3. Select **docker (hosted)**

4. Configure with these settings:
   - **Name:** `docker-hosted`
   - **Online:** ✅ checked
   - **HTTP port:** `8082` (must be unique)
   - **Hosted:**
     - **Deployment policy:** `Allow redeploy`
   - **Docker API support:**
     - **Enable Docker V1 API:** ✅ checked
   - **Cleanup policies:** *(leave empty for now)*

5. Click **Create repository**

Expected: You'll see `docker-hosted` in the Repositories list.

---

### Step 7: Enable Docker Bearer Token Realm

1. Click **gear icon** (⚙️) → **Security** → **Realms**

2. In the **Available column**, find and click **Docker Bearer Token Realm**

3. Click the **right arrow** button `>` to move it to the **Active column**

4. Click **Save** (bottom-right)

Expected: `Docker Bearer Token Realm` now appears in the Active column.

---

### Step 8: Test Docker Login

```bash
# Still on devops VM
docker logout 192.168.56.20:8082

# Try to log in (use the new password from Step 5)
docker login 192.168.56.20:8082 -u admin -p admin123
```

Expected output:
```
Login Succeeded
```

---

### Step 9: Verify Nexus — Push a Test Image

```bash
# Pull a small test image
docker pull hello-world

# Tag it for Nexus
docker tag hello-world 192.168.56.20:8082/hello-world:latest

# Push to Nexus
docker push 192.168.56.20:8082/hello-world:latest
```

Expected output:
```
latest: digest: sha256:... size: XXXX
The push refers to repository [192.168.56.20:8082/hello-world]
```

✅ **Nexus is ready!**

---

### Step 10: Configure Insecure Registry on K8s Workers

The Kubernetes workers use `containerd`, not Docker. We need to configure containerd to trust our Nexus registry so pods can pull images from it.

```bash
# On devops VM
ansible-playbook -i inventory/hosts.ini playbooks/configure-insecure-registry.yml
```

**What this does:**
- Configures `containerd` on all K8s nodes (master + workers) to accept images from `192.168.56.20:8082` over HTTP
- Restarts containerd to apply the changes

---

## Part 3: Deploy Jenkins to Kubernetes

Jenkins now runs as a **Kubernetes pod** on the worker nodes, with its home directory stored on the NFS server (k8s-master).

### Step 1: Copy kubeconfig to NFS

Jenkins needs `kubectl` access to deploy apps. We copy the kubeconfig into the NFS Jenkins directory:

```bash
# On devops VM
ansible-playbook -i inventory/hosts.ini playbooks/configure-kubectl-devops.yml
```

**What this does:**
- Copies kubeconfig to `/home/vagrant/.kube/config` on DevOps (for manual `kubectl`)
- Copies kubeconfig to `/srv/nfs/jenkins/.kube/config` on k8s-master (for Jenkins pod)

---

### Step 2: Apply Jenkins Kubernetes Manifests

From the **DevOps machine**:

```bash
# Apply all Jenkins manifests in order
kubectl apply -f /vagrant/kubernetes/jenkins/namespace.yml
kubectl apply -f /vagrant/kubernetes/jenkins/rbac.yml
kubectl apply -f /vagrant/kubernetes/jenkins/nfs-pv-pvc.yml
kubectl apply -f /vagrant/kubernetes/jenkins/deployment.yml
kubectl apply -f /vagrant/kubernetes/jenkins/service.yml
```

**What each manifest does:**

| File | Purpose |
|---|---|
| `namespace.yml` | Creates isolated `jenkins` namespace |
| `rbac.yml` | ServiceAccount + ClusterRole for Jenkins pod to manage K8s resources |
| `nfs-pv-pvc.yml` | PersistentVolume (NFS) + PersistentVolumeClaim for Jenkins home |
| `deployment.yml` | Jenkins pod with Docker-in-Docker (DinD) sidecar |
| `service.yml` | NodePort service (port 32000 for UI, 32001 for agents) |

---

### Step 3: Watch Jenkins Pod Start

```bash
# Watch the Jenkins pod start (press Ctrl+C to stop)
kubectl get pods -n jenkins -w
```

Expected output (takes 2-5 minutes, Jenkins image is ~400MB):
```
NAME                       READY   STATUS              RESTARTS   AGE
jenkins-xxxxxxxxx-xxxxx   0/2     ContainerCreating   0          10s
jenkins-xxxxxxxxx-xxxxx   1/2     Running             0          90s
jenkins-xxxxxxxxx-xxxxx   2/2     Running             0          120s
```

> **Important:** Wait until `READY` shows `2/2` (both Jenkins and DinD containers are ready).

If the pod shows `Pending`, check:
```bash
kubectl describe pod -n jenkins -l app=jenkins
kubectl get events -n jenkins --sort-by=.metadata.creationTimestamp
```

---

### Step 4: Verify Jenkins PersistentVolume

```bash
# Check PV and PVC status
kubectl get pv
kubectl get pvc -n jenkins
```

Expected:
```
NAME         CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                STORAGECLASS   AGE
jenkins-pv   5Gi        RWO            Retain           Bound    jenkins/jenkins-pvc                  2m

NAME          STATUS   VOLUME       CAPACITY   ACCESS MODES   STORAGECLASS   AGE
jenkins-pvc   Bound    jenkins-pv   5Gi        RWO                           2m
```

Both should show `Bound` status.

---

### Step 5: Access Jenkins Web UI

Open your browser and navigate to:

```
http://192.168.56.11:32000
```

Or:

```
http://192.168.56.12:32000
```

> Both URLs work because it's a NodePort service — Kubernetes routes the traffic to the Jenkins pod regardless of which worker node you use.

You should see the Jenkins setup page.

---

### Step 6: Get Jenkins Initial Admin Password

```bash
# Get the password from the Jenkins pod
kubectl exec -n jenkins $(kubectl get pod -n jenkins -l app=jenkins -o jsonpath='{.items[0].metadata.name}') -c jenkins -- cat /var/jenkins_home/secrets/initialAdminPassword
```

**Copy this password.**

---

### Step 7: Complete Jenkins Setup Wizard

1. Paste the initial password on the Jenkins page and click **Continue**

2. On the **Customize Jenkins** page, click **Install suggested plugins**
   - Jenkins will download and install common plugins (~5 minutes)

3. After plugins install, create an admin user:
   - **Username:** `admin`
   - **Password:** `admin123`
   - **Full name:** `DevOps Admin`
   - **E-mail address:** `admin@example.com`

4. Click **Save and Continue**

5. On the **Jenkins URL** page:
   - **Jenkins URL:** `http://192.168.56.11:32000/`
   - Click **Save and Finish**

6. Click **Start using Jenkins**

✅ **Jenkins is running as a Kubernetes pod!**

---

### Step 8: Install Required Plugins

1. Click **Manage Jenkins** (left menu) → **Manage Plugins**

2. Go to the **Available plugins** tab

3. Search for and install these plugins:
   - **Docker Pipeline**
   - **Git Parameter**

4. For each plugin:
   - Check the checkbox
   - Click **Install without restart** at the bottom

5. Wait for all to complete and refresh the page

---

### Step 9: Add Nexus Docker Credentials

1. Click **Manage Jenkins** → **Credentials** → **Global** (or System)

2. Click **Add Credentials** (left menu)

3. Configure:
   - **Kind:** `Username with password`
   - **Scope:** `Global (Jenkins, nodes, items, all child items, etc.)`
   - **Username:** `admin`
   - **Password:** `admin123` *(the Nexus password from Part 2, Step 5)*
   - **ID:** `nexus-docker-credentials`
   - **Description:** `Nexus Docker Registry Credentials`

4. Click **Create**

---

### Step 10: Create a Test Pipeline

Verify Jenkins can build Docker images via the DinD sidecar:

1. Click **+ New Item**

2. Name: `test-pipeline`

3. Select **Pipeline**

4. Click **OK**

5. Under **Pipeline**, select **Pipeline script** and paste:

```groovy
pipeline {
    agent any
    
    environment {
        DOCKER_HOST = "tcp://localhost:2375"
    }
    
    stages {
        stage('Hello') {
            steps {
                echo 'Hello from Jenkins running in Kubernetes!'
                sh 'whoami'
                sh 'hostname'
            }
        }
        
        stage('Docker Check') {
            steps {
                sh '''
                    until docker info > /dev/null 2>&1; do
                        echo "Waiting for Docker..."
                        sleep 2
                    done
                    docker --version
                    docker ps
                '''
            }
        }
        
        stage('Kubectl Check') {
            steps {
                sh '''
                    kubectl version --client
                    kubectl get nodes
                '''
            }
        }
    }
}
```

6. Click **Save**, then **Build Now**

7. Watch the build — it should:
   - Print the pod hostname (proving it runs in K8s)
   - Show Docker is available (via DinD sidecar)
   - Show `kubectl` can see the cluster nodes

✅ **Jenkins pipeline works inside Kubernetes!**

---

## Part 4: Verification Checklist

### NFS Checks

```bash
# ✅ 1. NFS server is running on master
ssh vagrant@k8s-master "systemctl status nfs-kernel-server | head -5"

# ✅ 2. Exports are configured
ssh vagrant@k8s-master "showmount -e localhost"

# ✅ 3. NFS is accessible from workers
ssh vagrant@k8s-worker1 "showmount -e 192.168.56.10"
```

### Nexus Checks

```bash
# From the DevOps machine
# ✅ 1. Docker login works
docker login 192.168.56.20:8082 -u admin -p admin123

# ✅ 2. Nexus Web UI accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.20:8081
# Expected: 200
```

### Jenkins Checks

```bash
# ✅ 1. Jenkins pod is running (2/2 containers)
kubectl get pods -n jenkins

# ✅ 2. Jenkins PVC is bound
kubectl get pvc -n jenkins

# ✅ 3. Jenkins Web UI accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.11:32000
# Expected: 200

# ✅ 4. Test pipeline passed
# Check in Jenkins UI: test-pipeline → last build → SUCCESS
```

---

## Troubleshooting

### NFS Issues

| Problem | Solution |
|---|---|
| `showmount` fails | Check NFS server: `ssh k8s-master "systemctl status nfs-kernel-server"` |
| PVC stays `Pending` | Check NFS client installed on workers: `ssh k8s-worker1 "dpkg -l nfs-common"` |
| Permission denied on NFS mount | Check `/etc/exports` uses `no_root_squash` |

### Jenkins Pod Issues

| Problem | Solution |
|---|---|
| Pod stuck in `Pending` | Check resources: `kubectl describe pod -n jenkins -l app=jenkins` |
| Pod in `CrashLoopBackOff` | Check logs: `kubectl logs -n jenkins -l app=jenkins -c jenkins` |
| DinD sidecar won't start | Check: `kubectl logs -n jenkins -l app=jenkins -c dind` |
| Can't access Jenkins UI | Verify service: `kubectl get svc -n jenkins` |
| `ImagePullBackOff` | Check internet: `ssh k8s-worker1 "ping -c 2 8.8.8.8"` |

### Jenkins Pipeline Issues

| Problem | Solution |
|---|---|
| `docker: command not found` | Install docker CLI in pipeline: `apt-get update && apt-get install -y docker.io` |
| `Cannot connect to Docker daemon` | Verify DinD sidecar: `kubectl logs -n jenkins -l app=jenkins -c dind` |
| `kubectl: command not found` | The kubeconfig must exist at `/var/jenkins_home/.kube/config` — re-run `configure-kubectl-devops.yml` |
| Docker push to Nexus fails | Verify credentials ID is `nexus-docker-credentials` |

---

## Next Steps

Once this stage is complete, proceed to:

- **Third Stage:** Deploy the Hello World microservice (build, push, deploy, automate with Jenkins)

---

## Summary of Credentials

| Service | URL | Username | Password |
|---|---|---|---|
| Nexus Web UI | `http://192.168.56.20:8081` | `admin` | `admin123` |
| Docker Registry | `192.168.56.20:8082` | `admin` | `admin123` |
| Jenkins | `http://192.168.56.11:32000` | `admin` | `admin123` |
| Kubernetes | `kubectl` (kubeconfig) | (certificate-based) | N/A |
| NFS Server | `192.168.56.10:/srv/nfs/*` | N/A | N/A |
