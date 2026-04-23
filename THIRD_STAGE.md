# Third Stage — Deploy Hello World Microservice

> **Goal:** Build, push, and deploy the Hello DevOps microservice to the Kubernetes cluster.
> Then automate the entire process via the Jenkins CI/CD pipeline.

---

## Prerequisites

Before starting this stage, make sure:

- [x] **Second Stage** is complete:
  - NFS server running on k8s-master
  - Nexus Docker registry configured and tested
  - Jenkins running as a Kubernetes pod (2/2 containers)
  - Jenkins test-pipeline passed successfully
- [x] **Credentials configured in Jenkins:**
  - `nexus-docker-credentials` — Nexus registry login
- [x] `kubectl get nodes` shows all 3 nodes as **Ready**
- [x] `docker login 192.168.56.20:8082` succeeds from DevOps machine

---

## Part 1: Manual Deployment (Test Before Automating)

We'll first deploy the app manually to verify everything works, then automate it with Jenkins.

### Step 1: Build the Docker Image

SSH into the **DevOps machine** and build the app:

```bash
# From your Windows host
vagrant ssh devops

# Navigate to the app directory
cd /vagrant/app

# View the app source code
cat app.js
```

The app is a simple Express.js server with 3 endpoints:

| Endpoint | Response |
|---|---|
| `GET /` | `"Hello DevOps! 🚀"` + hostname + timestamp |
| `GET /health` | `{ "status": "healthy" }` |
| `GET /info` | App metadata (name, registry, CI/CD tool) |

Now build the Docker image:

```bash
# Build the image, tagged for Nexus registry
docker build -t 192.168.56.20:8082/hello-devops:v1 .
```

Expected output:
```
Successfully built xxxxxxxxxx
Successfully tagged 192.168.56.20:8082/hello-devops:v1
```

```bash
# Also tag as latest
docker tag 192.168.56.20:8082/hello-devops:v1 192.168.56.20:8082/hello-devops:latest
```

---

### Step 2: Push the Image to Nexus

```bash
# Make sure you're logged in to Nexus
docker login 192.168.56.20:8082 -u admin -p admin123

# Push both tags
docker push 192.168.56.20:8082/hello-devops:v1
docker push 192.168.56.20:8082/hello-devops:latest
```

Expected output:
```
The push refers to repository [192.168.56.20:8082/hello-devops]
v1: digest: sha256:... size: XXXX
latest: digest: sha256:... size: XXXX
```

**Verify in Nexus UI:**
1. Open `http://192.168.56.20:8081` → Login
2. Click **Browse** (left menu) → **docker-hosted**
3. You should see `hello-devops` with tags `v1` and `latest`

---

### Step 3: Create Kubernetes Secret for Nexus

The K8s workers need credentials to pull images from our private Nexus registry:

```bash
# Create the registry secret
kubectl create secret docker-registry nexus-registry-secret \
  --docker-server=192.168.56.20:8082 \
  --docker-username=admin \
  --docker-password=admin123 \
  --docker-email=admin@example.com

# Verify secret was created
kubectl get secrets
```

Expected:
```
NAME                    TYPE                             DATA   AGE
nexus-registry-secret   kubernetes.io/dockerconfigjson   1      5s
```

---

### Step 4: Deploy the Application to Kubernetes

```bash
# Apply the deployment manifest (2 replicas)
kubectl apply -f /vagrant/kubernetes/deployment.yml

# Apply the service manifest (NodePort 30080)
kubectl apply -f /vagrant/kubernetes/service.yml
```

---

### Step 5: Watch Pods Start

```bash
# Watch pods being created (press Ctrl+C to stop)
kubectl get pods -l app=hello-devops -o wide -w
```

Expected output:
```
NAME                           READY   STATUS    RESTARTS   AGE   IP            NODE
hello-devops-xxxxxxxxx-abc12   1/1     Running   0          30s   192.168.x.x   k8s-worker1
hello-devops-xxxxxxxxx-def34   1/1     Running   0          30s   192.168.x.x   k8s-worker2
```

> Kubernetes automatically distributes pods across worker nodes.

If pods show `ImagePullBackOff`:
```bash
# Check pod events
kubectl describe pod -l app=hello-devops

# Common fix: verify insecure registry is configured
ssh vagrant@k8s-worker1 "cat /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml"

# If missing, re-run:
ansible-playbook -i ~/ansible/inventory/hosts.ini ~/ansible/playbooks/configure-insecure-registry.yml
```

---

### Step 6: Test the Application

#### From the DevOps machine:

```bash
# Test via worker1
curl http://192.168.56.11:30080

# Test via worker2
curl http://192.168.56.12:30080
```

Expected JSON response:
```json
{
  "message": "Hello DevOps! 🚀",
  "version": "1.0.0",
  "hostname": "hello-devops-xxxxxxxxx-abc12",
  "environment": "development",
  "timestamp": "2026-04-23T..."
}
```

> **Notice:** The `hostname` field shows the pod name — each request may show a different hostname, proving load balancing works!

#### From your Windows browser:

Open either URL:
- `http://192.168.56.11:30080`
- `http://192.168.56.12:30080`

You should see the JSON response.

#### Test other endpoints:

```bash
# Health check
curl http://192.168.56.11:30080/health
# {"status":"healthy","timestamp":"..."}

# App info
curl http://192.168.56.11:30080/info
# {"app":"hello-devops","description":"...","kubernetes":true,...}
```

---

### Step 7: Explore What Kubernetes Created

```bash
# See all resources
kubectl get all -l app=hello-devops

# Detailed deployment info
kubectl describe deployment hello-devops

# View pod logs
kubectl logs -l app=hello-devops

# Check the service
kubectl get svc hello-devops-service
```

---

### Step 8: Test Self-Healing

```bash
# Delete one pod manually
kubectl delete pod $(kubectl get pods -l app=hello-devops -o jsonpath='{.items[0].metadata.name}')

# Watch Kubernetes recreate it immediately
kubectl get pods -l app=hello-devops -w
```

A new pod is created automatically to maintain the desired 2 replicas.

---

### Step 9: Test Scaling

```bash
# Scale up to 4 replicas
kubectl scale deployment hello-devops --replicas=4
kubectl get pods -l app=hello-devops -o wide

# Scale back down to 2
kubectl scale deployment hello-devops --replicas=2
kubectl get pods -l app=hello-devops -o wide
```

✅ **Manual deployment works! The app is running on Kubernetes.**

---

## Part 2: Automated Deployment via Jenkins

Now let's set up the CI/CD pipeline so Jenkins automatically builds, pushes, and deploys the app.

### Step 1: Access Jenkins

Open your browser:

```
http://192.168.56.11:32000
```

Log in with `admin` / `admin123`.

---

### Step 2: Create the Hello-DevOps Pipeline Job

1. Click **+ New Item** (left menu)

2. Name: `hello-devops-pipeline`

3. Select **Pipeline**

4. Click **OK**

5. Under **Pipeline**:
   - **Definition:** `Pipeline script from SCM`
   - **SCM:** `Git`
   - **Repository URL:** `/vagrant` (for local testing) or your Git repository URL
   - **Branch Specifier:** `*/main` (or `*/master`)
   - **Script Path:** `jenkins/Jenkinsfile`

6. Click **Save**

> **Alternative:** If Git SCM doesn't work from inside the pod, use **Pipeline script** and paste the Jenkinsfile content directly (copy from `/vagrant/jenkins/Jenkinsfile`).

---

### Step 3: Run the Pipeline

1. Click **Build Now** (left menu)

2. Watch the build execute by clicking the build number → **Console Output**

3. The pipeline stages are:

| Stage | What it does |
|---|---|
| **Checkout** | Pulls source code |
| **Install Dependencies** | Installs Node.js and npm packages |
| **Test** | Runs unit tests with Jest |
| **Build Docker Image** | Builds Docker image (via DinD sidecar) |
| **Push to Nexus** | Pushes image to `192.168.56.20:8082` |
| **Deploy to Kubernetes** | Runs `kubectl apply` and waits for rollout |

Expected: All stages green ✅

---

### Step 4: Verify Automated Deployment

After the pipeline succeeds:

```bash
# Check pods are running with the new image
kubectl get pods -l app=hello-devops -o wide

# Test the app
curl http://192.168.56.11:30080

# Check the image version
kubectl describe deployment hello-devops | grep Image
```

---

### Step 5: Trigger a Second Build

1. Make a small change to `app/app.js` (optional):
   ```bash
   # On devops VM
   vagrant ssh devops
   # Edit the welcome message
   sed -i "s/Hello DevOps/Hello DevOps v2/" /vagrant/app/app.js
   ```

2. In Jenkins, click **Build Now** again

3. Watch the new version get deployed

4. Verify:
   ```bash
   curl http://192.168.56.11:30080
   # Should show: "Hello DevOps v2! 🚀"
   ```

✅ **Automated CI/CD pipeline is working!**

---

## Part 3: Complete Verification

### Full System Check

```bash
# ✅ 1. Kubernetes cluster healthy
kubectl get nodes
# 3 nodes, all Ready

# ✅ 2. NFS working
ssh vagrant@k8s-master "showmount -e localhost"
# Shows /srv/nfs/jenkins and /srv/nfs/data

# ✅ 3. Jenkins running in K8s
kubectl get pods -n jenkins
# 1 pod, 2/2 Ready

# ✅ 4. Nexus accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.20:8081
# 200

# ✅ 5. App deployed and accessible
curl http://192.168.56.11:30080
# JSON response with "Hello DevOps! 🚀"

# ✅ 6. Jenkins pipeline passed
# Check Jenkins UI → hello-devops-pipeline → last build is GREEN
```

### Architecture Summary

```
YOUR COMPLETE DEVOPS LAB:

┌─────────────────────────────────────────────────────────────────────┐
│                         Your Windows Host                           │
│                                                                     │
│  Browser Access:                                                    │
│  • Jenkins:  http://192.168.56.11:32000                             │
│  • Nexus:    http://192.168.56.20:8081                              │
│  • App:      http://192.168.56.11:30080                             │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────┐   │
│  │  k8s-master  │  │ k8s-worker1  │  │ k8s-worker2  │  │ devops │   │
│  │  .56.10      │  │  .56.11      │  │  .56.12      │  │ .56.20 │   │
│  │              │  │              │  │              │  │        │   │
│  │ Control Plane│  │ Jenkins Pod  │  │ App Pods     │  │ Nexus  │   │
│  │ NFS Server   │  │  └─ DinD     │  │ hello-devops │  │ Docker │   │
│  │ /srv/nfs/    │  │              │  │              │  │ Ansible│   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| App pods `ImagePullBackOff` | 1) Check secret: `kubectl get secrets` 2) Check containerd config: re-run `configure-insecure-registry.yml` 3) Restart containerd: `ssh k8s-worker1 "sudo systemctl restart containerd"` |
| `curl` returns nothing | Check service: `kubectl get svc hello-devops-service` — verify NodePort is 30080 |
| Jenkins build fails at Docker | Check DinD sidecar: `kubectl logs -n jenkins -l app=jenkins -c dind` |
| Jenkins can't deploy (kubectl fails) | Check kubeconfig: `kubectl exec -n jenkins <pod> -c jenkins -- cat /var/jenkins_home/.kube/config` |
| App returns old version | Force rollout: `kubectl rollout restart deployment/hello-devops` |

---

## What's Next?

Congratulations! 🎉 You now have a complete DevOps lab with:

- ✅ **Kubernetes cluster** (1 master + 2 workers)
- ✅ **NFS shared storage** (on k8s-master)
- ✅ **Jenkins CI/CD** (running as a K8s pod)
- ✅ **Nexus Docker registry** (private image storage)
- ✅ **Hello World microservice** (auto-deployed via pipeline)

Possible next steps:
- Add **monitoring** (Prometheus + Grafana)
- Add **Ingress controller** (Nginx Ingress for proper routing)
- Add **Helm charts** for templated deployments
- Set up **GitOps** (ArgoCD for declarative deployments)
- Add **more microservices** and inter-service communication
