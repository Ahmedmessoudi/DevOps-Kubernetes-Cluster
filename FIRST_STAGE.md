# First Stage — Testing the Kubernetes Cluster

> **Goal:** Verify the Kubernetes cluster works correctly by deploying a simple nginx app
> using a public Docker Hub image. No Nexus or Jenkins needed.

---

## Prerequisites

Before starting this stage, make sure:

- [x] All 4 VMs are running (`vagrant status`)
- [x] SSH keys are distributed (`setup-ssh-keys.sh`)
- [x] Ansible playbooks executed successfully:
  - `common.yml`
  - `install-containerd.yml`
  - `install-kubernetes.yml`
  - `init-master.yml`
  - `join-workers.yml`
- [x] `kubectl get nodes` shows all 3 nodes as **Ready**

---

## Step 1: Connect to the Master Node

```bash
# From your Windows host (PowerShell)
vagrant ssh k8s-master
```

---

## Step 2: Verify Cluster Health

```bash
# Check all nodes are Ready
kubectl get nodes

# Expected output:
# NAME          STATUS   ROLES           AGE   VERSION
# k8s-master    Ready    control-plane   Xm    v1.29.x
# k8s-worker1   Ready    <none>          Xm    v1.29.x
# k8s-worker2   Ready    <none>          Xm    v1.29.x
```

```bash
# Check system pods are running
kubectl get pods -n kube-system

# You should see: coredns, etcd, kube-apiserver, calico-node, etc. all Running
```

---

## Step 3: Deploy a Test Application (nginx)

```bash
# Create a deployment with 2 replicas of nginx
kubectl create deployment test-app --image=nginx --replicas=2
```

**What this does:**
- Tells Kubernetes to run 2 copies of the nginx web server
- Kubernetes automatically distributes one pod to each worker node
- The image `nginx` is pulled from Docker Hub (public, no Nexus needed)

---

## Step 4: Expose the App with a NodePort Service

```bash
# Expose the deployment on port 30080 across all nodes
kubectl expose deployment test-app \
  --type=NodePort \
  --port=80 \
  --target-port=80 \
  --name=test-app-service \
  --overrides='{"spec":{"ports":[{"port":80,"targetPort":80,"nodePort":30080}]}}'
```

**What this does:**
- Creates a Service of type `NodePort`
- Maps external port `30080` → internal port `80` → nginx container port `80`
- The app becomes accessible on ANY node's IP at port 30080

---

## Step 5: Watch Pods Start

```bash
# Watch pods until they show STATUS = Running (press Ctrl+C to stop)
kubectl get pods -o wide -w
```

Expected output:
```
NAME                        READY   STATUS    RESTARTS   AGE   IP             NODE
test-app-6d4f8b7c9-abc12   1/1     Running   0          30s   192.168.x.x    k8s-worker1
test-app-6d4f8b7c9-def34   1/1     Running   0          30s   192.168.x.x    k8s-worker2
```

Notice how Kubernetes automatically placed one pod on each worker node.

---

## Step 6: Test the Application

### From inside the master node:

```bash
# Test via worker1
curl http://192.168.56.11:30080

# Test via worker2
curl http://192.168.56.12:30080
```

Both commands should return the **nginx welcome page** (HTML starting with `<!DOCTYPE html>`).

### From your Windows browser:

Open either of these URLs:
- `http://192.168.56.11:30080`
- `http://192.168.56.12:30080`

You should see the **"Welcome to nginx!"** page.

---

## Step 7: Explore What Kubernetes Created

```bash
# See all resources
kubectl get all

# Detailed view of the deployment
kubectl describe deployment test-app

# Detailed view of a pod (replace with your actual pod name)
kubectl describe pod test-app-6d4f8b7c9-abc12

# View pod logs
kubectl logs -l app=test-app

# Check the service details
kubectl get svc test-app-service
```

---

## Step 8: Test Self-Healing

Kubernetes automatically restarts failed pods. Let's test it:

```bash
# Delete one pod manually
kubectl delete pod -l app=test-app --field-selector=status.phase=Running --wait=false

# Watch Kubernetes recreate it immediately
kubectl get pods -w
```

You'll see the deleted pod terminate and a new one start automatically. This is Kubernetes keeping the desired state (2 replicas).

---

## Step 9: Test Scaling

```bash
# Scale up to 4 replicas
kubectl scale deployment test-app --replicas=4

# Watch new pods appear
kubectl get pods -o wide

# Scale back down to 2
kubectl scale deployment test-app --replicas=2

# Watch extra pods terminate
kubectl get pods -o wide
```

---

## Step 10: Clean Up

```bash
# Delete everything we created
kubectl delete deployment test-app
kubectl delete service test-app-service

# Verify cleanup
kubectl get all
```

---

## Verification Summary

| Check | Command | Expected Result |
|---|---|---|
| Nodes ready | `kubectl get nodes` | 3 nodes, all `Ready` |
| Pods running | `kubectl get pods -o wide` | 2 pods on different workers |
| Service exists | `kubectl get svc` | NodePort 30080 |
| App accessible | `curl http://192.168.56.11:30080` | nginx HTML page |
| Self-healing | Delete a pod | New pod auto-created |
| Scaling | Scale to 4, then back to 2 | Pods added/removed |

---

## What's Next?

Once this stage passes, your Kubernetes cluster is fully functional! You can proceed to:

- **Second Stage:** Install Jenkins and Nexus (`install-jenkins.yml`, `install-nexus.yml`)
- **Third Stage:** Build and push Docker images to Nexus
- **Fourth Stage:** Set up the Jenkins CI/CD pipeline to automate everything
