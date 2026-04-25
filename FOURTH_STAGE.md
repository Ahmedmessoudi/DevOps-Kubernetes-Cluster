# Fourth Stage — Deploy Full-Stack Contact Form App

> **Goal:** Build, push, and deploy a full-stack application (Frontend + Backend + PostgreSQL) to the Kubernetes cluster.
> Then automate the entire process via the Jenkins CI/CD pipeline, with source code hosted on Gitea.

---

## Prerequisites

Before starting this stage, make sure:

- [x] **Third Stage** is complete:
  - Hello DevOps microservice deployed and accessible
  - Jenkins pipeline passing (all stages GREEN)
  - Nexus Docker registry configured and tested
- [x] **Gitea** running on DevOps VM (`http://192.168.56.20:3000`)
- [x] **Credentials configured in Jenkins:**
  - `nexus-docker-credentials` — Nexus registry login
- [x] `kubectl get nodes` shows all 3 nodes as **Ready**
- [x] `docker login 192.168.56.20:8082` succeeds from DevOps machine

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CI/CD Pipeline Flow                             │
│                                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────┐           │
│  │  Dev PC  │───▶│    Gitea     │───▶│ Jenkins  │───▶│  Nexus   │──────┐    │
│  │ git push │    │  Container   │    │ K8s Pod  │    │Container │      │    │
│  └──────────┘    │ DevOps:3000  │    │  :32000  │    │  :8082   │      │    │
│                  └──────────────┘    └──────────┘    └──────────┘      │    │
│                                                                        ▼    │
│  Kubernetes Cluster:                                              ┌────────┐│
│  ┌──────────────────────────────────────────────────────────────┐ │ docker ││
│  │  Namespace: fullstack                                        │ │ pull   ││
│  │                                                              │ └───┬────┘│
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │     │     │
│  │  │  Frontend   │───▶│  Backend    │───▶│ PostgreSQL  │      │◀────┘     │
│  │  │  (Nginx)    │    │  (Express)  │    │  (DB)       │      │           │
│  │  │  NodePort   │    │  ClusterIP  │    │  ClusterIP  │      │           │
│  │  │  :30090     │    │  :5000      │    │  :5432      │      │           │
│  │  │  2 replicas │    │  2 replicas │    │  1 replica  │      │           │
│  │  └─────────────┘    └─────────────┘    └──────┬──────┘      │           │
│  │                                               │              │           │
│  │                                        ┌──────┴──────┐      │           │
│  │                                        │  NFS PV/PVC │      │           │
│  │                                        │  (Master)   │      │           │
│  │                                        └─────────────┘      │           │
│  └──────────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
```

The application consists of three services:

| Service | Technology | Port | Type | Replicas |
|---|---|---|---|---|
| **Frontend** | Nginx (static files + reverse proxy) | 30090 (NodePort) | Public | 2 |
| **Backend** | Express.js REST API | 5000 (ClusterIP) | Internal | 2 |
| **PostgreSQL**| PostgreSQL 15 | 5432 (ClusterIP) | Internal | 1 |

---

## Part 1: Set Up NFS Storage for PostgreSQL

PostgreSQL data needs to persist across pod restarts. We use the same NFS server on k8s-master.

### Step 1: Run the Ansible Playbook

```bash
# From the DevOps machine
vagrant ssh devops

# Run the playbook to create /srv/nfs/postgres on k8s-master
ansible-playbook -i ~/ansible/inventory/hosts.ini ~/ansible/playbooks/setup-nfs-postgres.yml
```

### Step 2: Verify NFS

```bash
# Check from DevOps machine
ssh vagrant@192.168.56.10 "showmount -e localhost"
```

You should see `/srv/nfs/postgres` listed among the exports.

---

## Part 2: Set Up Gitea Repository

### Step 1: Access Gitea

Open your browser and go to:

```
http://192.168.56.20:3000
```

Log in or register an account (first user becomes admin).

### Step 2: Create Repository

1. Click **+** (top right) → **New Repository**
2. **Repository Name:** `fullstack-app`
3. Leave other defaults
4. Click **Create Repository**

### Step 3: Push Source Code to Gitea

From the **DevOps machine**:

```bash
# Navigate to the project directory
cd /vagrant

# Initialize git (if not already)
git init

# Add the Gitea remote
git remote add gitea http://192.168.56.20:3000/<your-username>/fullstack-app.git

# Add all fullstack-app files
git add fullstack-app/ kubernetes/fullstack/ jenkins/Jenkinsfile.fullstack

# Commit
git commit -m "Add full-stack Contact Form application"

# Push to Gitea
git push -u gitea main
```

> **Note:** Replace `<your-username>` with your actual Gitea username.

### Step 4: Verify in Gitea UI

Browse to `http://192.168.56.20:3000/<your-username>/fullstack-app` and confirm the files are there:
- `fullstack-app/backend/` — Express.js API source
- `fullstack-app/frontend/` — HTML/CSS/JS + Nginx config
- `kubernetes/fullstack/` — All K8s manifests
- `jenkins/Jenkinsfile.fullstack` — CI/CD pipeline

---

## Part 3: Manual Deployment (Test Before Automating)

### Step 1: Build the Docker Images

SSH into the **DevOps machine** and build both images:

```bash
vagrant ssh devops

# Build backend image
cd /vagrant/fullstack-app/backend
docker build -t 192.168.56.20:8082/fullstack-backend:v1 .

# Build frontend image
cd /vagrant/fullstack-app/frontend
docker build -t 192.168.56.20:8082/fullstack-frontend:v1 .
```

```bash
# Also tag as latest
docker tag 192.168.56.20:8082/fullstack-backend:v1  192.168.56.20:8082/fullstack-backend:latest
docker tag 192.168.56.20:8082/fullstack-frontend:v1 192.168.56.20:8082/fullstack-frontend:latest
```

---

### Step 2: Push Images to Nexus

```bash
# Login to Nexus
docker login 192.168.56.20:8082 -u admin -p admin123

# Push backend
docker push 192.168.56.20:8082/fullstack-backend:v1
docker push 192.168.56.20:8082/fullstack-backend:latest

# Push frontend
docker push 192.168.56.20:8082/fullstack-frontend:v1
docker push 192.168.56.20:8082/fullstack-frontend:latest
```

---

### Step 3: Deploy to Kubernetes

```bash
# Create the namespace
kubectl apply -f /vagrant/kubernetes/fullstack/namespace.yml

# Create Nexus registry secret in the fullstack namespace
kubectl create secret docker-registry nexus-registry-secret \
  --docker-server=192.168.56.20:8082 \
  --docker-username=admin \
  --docker-password=admin123 \
  --docker-email=admin@example.com \
  -n fullstack

# Deploy PostgreSQL (storage + deployment + service)
kubectl apply -f /vagrant/kubernetes/fullstack/postgres-nfs-pv-pvc.yml
kubectl apply -f /vagrant/kubernetes/fullstack/postgres-deployment.yml
kubectl apply -f /vagrant/kubernetes/fullstack/postgres-service.yml

# Wait for PostgreSQL to be ready
kubectl rollout status deployment/postgres -n fullstack --timeout=120s

# Deploy Backend
kubectl apply -f /vagrant/kubernetes/fullstack/backend-deployment.yml
kubectl apply -f /vagrant/kubernetes/fullstack/backend-service.yml

# Wait for Backend to be ready
kubectl rollout status deployment/backend -n fullstack --timeout=120s

# Deploy Frontend
kubectl apply -f /vagrant/kubernetes/fullstack/frontend-deployment.yml
kubectl apply -f /vagrant/kubernetes/fullstack/frontend-service.yml

# Wait for Frontend to be ready
kubectl rollout status deployment/frontend -n fullstack --timeout=120s
```

---

### Step 4: Watch Pods Start

```bash
# Watch all pods in the fullstack namespace
kubectl get pods -n fullstack -o wide -w
```

> 5 pods total: 1 PostgreSQL + 2 Backend + 2 Frontend

---

### Step 5: Test the Application

#### From the DevOps machine:

```bash
# Test the backend API directly (via frontend proxy)
curl http://192.168.56.11:30090/api/submissions
# Expected: [] (empty array — no submissions yet)

# Test the health endpoint
curl http://192.168.56.11:30090/health
# Expected: {"status":"healthy","service":"fullstack-backend","database":"connected",...}

# Create a submission
curl -X POST http://192.168.56.11:30090/api/submissions \
  -H "Content-Type: application/json" \
  -d '{"name":"John", "email":"john@example.com", "message":"Testing the form!"}'
# Expected: {"id":1,"name":"John","email":"john@example.com","message":"Testing the form!",...}
```

#### From your Windows browser:

Open the Contact Form App UI:

```
http://192.168.56.11:30090
```

You should see the **Contact Form** interface. Try:
1. **Add a submission** — Fill in Name, Email, and Message, then click "Send Message"
2. **View submissions** — Sent messages will appear below the form
3. **Delete a submission** — Click the "Delete" button
4. **Check health badge** — Top right shows "API healthy" (green dot)

✅ **Manual deployment works! The full-stack app is running on Kubernetes.**

---

## Part 4: Automated Deployment via Jenkins

### Step 1: Access Jenkins

Open your browser:
```
http://192.168.56.11:32000
```

Log in with `admin` / `admin123`.

---

### Step 2: Create the Full-Stack Pipeline Job

1. Click **+ New Item** (left menu)
2. Name: `fullstack-pipeline`
3. Select **Pipeline**
4. Click **OK**
5. Under **Pipeline**:
   - **Definition:** `Pipeline script from SCM`
   - **SCM:** `Git`
   - **Repository URL:** `http://192.168.56.20:3000/<your-username>/fullstack-app.git`
   - **Branch Specifier:** `*/main`
   - **Script Path:** `jenkins/Jenkinsfile.fullstack`
6. Click **Save**

---

### Step 3: Run the Pipeline

1. Click **Build Now** (left menu)
2. Watch the build: click the build number → **Console Output**
3. The pipeline stages are: Checkout → Build Backend → Build Frontend → Push Images → Deploy to Kubernetes

Expected: All stages green ✅

---

### Step 4: Trigger a Second Build (Code Change)

1. Make a small change to the app — e.g., update the page title:
   ```bash
   # On DevOps VM
   sed -i 's/Contact Form/Contact Form v2/' /vagrant/fullstack-app/frontend/index.html
   ```

2. Commit and push to Gitea:
   ```bash
   cd /vagrant
   git add fullstack-app/frontend/index.html
   git commit -m "Update title to v2"
   git push gitea main
   ```

3. In Jenkins, click **Build Now** again
4. After the build completes, verify in the browser: `http://192.168.56.11:30090`

✅ **Automated CI/CD pipeline is working!**

---

## Part 5: Complete Verification

### Full System Check

```bash
# ✅ 1. Kubernetes cluster healthy
kubectl get nodes
# 3 nodes, all Ready

# ✅ 2. NFS has PostgreSQL export
ssh vagrant@k8s-master "showmount -e localhost"
# Shows /srv/nfs/jenkins, /srv/nfs/data, /srv/nfs/postgres

# ✅ 3. All fullstack pods running
kubectl get pods -n fullstack
# 5 pods: 1 PostgreSQL + 2 Backend + 2 Frontend

# ✅ 4. Services configured correctly
kubectl get svc -n fullstack
# frontend-service (NodePort 30090), backend-service (ClusterIP), postgres-service (ClusterIP)

# ✅ 5. Nexus has both images
curl -s http://192.168.56.20:8081/service/rest/v1/repositories | python3 -m json.tool

# ✅ 6. App accessible and functional
curl http://192.168.56.11:30090
curl http://192.168.56.11:30090/api/submissions

# ✅ 7. Data persists across pod restarts
kubectl delete pod -n fullstack -l app=postgres
kubectl rollout status deployment/postgres -n fullstack --timeout=120s
curl http://192.168.56.11:30090/api/submissions
# Submissions should still be there!
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| PostgreSQL pod `Pending` (PVC not bound) | 1) Verify NFS playbook ran 2) Check PV: `kubectl get pv postgres-pv` 3) Check PVC: `kubectl get pvc -n fullstack` |
| Backend pods `CrashLoopBackOff` | Check logs: `kubectl logs -n fullstack -l app=backend`. Usually means PostgreSQL isn't ready yet — wait and check PostgreSQL pod status first |
| Frontend shows "API offline" | 1) Check backend service: `kubectl get svc backend-service -n fullstack` 2) Check Nginx proxy config |
| `ImagePullBackOff` on any pod | 1) Check secret: `kubectl get secrets -n fullstack` 2) Verify insecure registry: re-run `configure-insecure-registry.yml` |
| Data lost after DB restart | Check PVC is bound: `kubectl get pvc -n fullstack`. If unbound, verify NFS exports and re-create PV/PVC |
