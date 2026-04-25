# Full-Stack DevOps Pipeline — Frontend + Backend + Database → Gitea → Jenkins → Nexus → K8s

## Goal

Create a complete full-stack application (frontend, backend, MongoDB database) with Docker images, automate the CI/CD pipeline through:

1. **Push source code** to Gitea (Docker container on DevOps VM, port 3000)
2. **Jenkins pipeline** pulls code from Gitea
3. **Build Docker images** for frontend and backend
4. **Push images** to Nexus Docker registry (192.168.56.20:8082)
5. **Deploy to Kubernetes** cluster (3 services: frontend, backend, MongoDB)

## Existing Infrastructure

| Component | Type | Location | Access |
|---|---|---|---|
| K8s Master | VM | 192.168.56.10 | Control plane + NFS server |
| K8s Worker 1 | VM | 192.168.56.11 | Worker node |
| K8s Worker 2 | VM | 192.168.56.12 | Worker node |
| DevOps VM | VM | 192.168.56.20 | Hosts Nexus + Gitea containers |
| **Gitea** | **Docker container** | **192.168.56.20:3000** (HTTP), **:2222** (SSH) | Source code repository |
| Nexus | Docker container | 192.168.56.20:8081 (UI), :8082 (Docker registry) | Docker image registry |
| Jenkins | K8s pod | 192.168.56.11:32000 | CI/CD pipeline |

> [!NOTE]
> **Gitea** runs as a Docker container on the DevOps VM (`192.168.56.20`), installed via `ansible/playbooks/install-gitea.yml`. Data is persisted at `/srv/gitea` on the DevOps VM.

---

## Proposed Changes

### Application — Full-Stack Task Manager App

A task manager application with a modern UI. The frontend is served by Nginx, the backend is an Express.js API, and MongoDB handles data persistence.

#### [NEW] fullstack-app/backend/server.js
- Express.js REST API with CRUD endpoints for tasks (`/api/tasks`)
- MongoDB connection via Mongoose
- Health check endpoint (`/health`)
- CORS enabled for frontend communication

#### [NEW] fullstack-app/backend/package.json
- Dependencies: express, mongoose, cors
- Scripts: start, dev

#### [NEW] fullstack-app/backend/Dockerfile
- Multi-stage build on `node:18-alpine`
- Non-root user for security
- Health check built-in, exposes port 5000

#### [NEW] fullstack-app/backend/.dockerignore

#### [NEW] fullstack-app/frontend/index.html
- Modern single-page task manager UI
- Calls backend API for CRUD operations

#### [NEW] fullstack-app/frontend/styles.css
- Modern dark-themed CSS with animations

#### [NEW] fullstack-app/frontend/app.js
- Frontend JavaScript — fetches from backend API, renders tasks

#### [NEW] fullstack-app/frontend/nginx.conf
- Serves static files
- Reverse proxies `/api` requests to the backend K8s service

#### [NEW] fullstack-app/frontend/Dockerfile
- Based on `nginx:alpine`
- Copies static files + custom nginx config, exposes port 80

#### [NEW] fullstack-app/frontend/.dockerignore

#### [NEW] fullstack-app/docker-compose.yml
- Local dev/testing with all 3 services (frontend, backend, MongoDB)

---

### Kubernetes Manifests — Full-Stack Deployment

#### [NEW] kubernetes/fullstack/namespace.yml
- Creates `fullstack` namespace

#### [NEW] kubernetes/fullstack/mongodb-nfs-pv-pvc.yml
- PersistentVolume + PVC using NFS at `192.168.56.10:/srv/nfs/data` (subfolder: mongodb)

#### [NEW] kubernetes/fullstack/mongodb-deployment.yml
- MongoDB 6 deployment, 1 replica, mounts NFS PVC

#### [NEW] kubernetes/fullstack/mongodb-service.yml
- ClusterIP service (port 27017, internal only)

#### [NEW] kubernetes/fullstack/backend-deployment.yml
- 2 replicas, image from Nexus (`192.168.56.20:8082/fullstack-backend`)
- Env vars pointing to MongoDB service, uses `nexus-registry-secret`

#### [NEW] kubernetes/fullstack/backend-service.yml
- ClusterIP service (port 5000, accessed via frontend Nginx proxy)

#### [NEW] kubernetes/fullstack/frontend-deployment.yml
- 2 replicas, image from Nexus (`192.168.56.20:8082/fullstack-frontend`)

#### [NEW] kubernetes/fullstack/frontend-service.yml
- NodePort service (port 80 → NodePort **30090**) — public entry point

---

### Jenkins Pipeline

#### [NEW] jenkins/Jenkinsfile.fullstack
- Pulls source code from **Gitea** (`http://192.168.56.20:3000/<user>/fullstack-app.git`)
- Builds Docker images for frontend and backend via DinD sidecar
- Pushes both images to Nexus registry (192.168.56.20:8082)
- Deploys all K8s manifests to the cluster
- Uses `nexus-docker-credentials` from Jenkins credential store

---

### Ansible Playbook

#### [NEW] ansible/playbooks/setup-nfs-mongodb.yml
- Creates `/srv/nfs/mongodb` on k8s-master
- Adds to NFS exports, restarts NFS server

---

### Documentation

#### [NEW] FOURTH_STAGE.md
Comprehensive step-by-step guide covering:
1. Set up NFS for MongoDB storage
2. Access Gitea UI and create a repository
3. Push full-stack app code to Gitea
4. Configure Jenkins pipeline job pointing to Gitea repo
5. Manual Docker build & push to Nexus (verification)
6. Manual K8s deployment (verification)
7. Run automated Jenkins pipeline
8. Full verification checklist + troubleshooting

---

## Architecture Diagram

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
│  │  │  Frontend   │───▶│  Backend    │───▶│  MongoDB    │      │◀────┘     │
│  │  │  (Nginx)    │    │  (Express)  │    │  (DB)       │      │           │
│  │  │  NodePort   │    │  ClusterIP  │    │  ClusterIP  │      │           │
│  │  │  :30090     │    │  :5000      │    │  :27017     │      │           │
│  │  │  2 replicas │    │  2 replicas │    │  1 replica  │      │           │
│  │  └─────────────┘    └─────────────┘    └──────┬──────┘      │           │
│  │                                               │              │           │
│  │                                        ┌──────┴──────┐      │           │
│  │                                        │  NFS PV/PVC │      │           │
│  │                                        │  (Master)   │      │           │
│  │                                        └─────────────┘      │           │
│  └──────────────────────────────────────────────────────────────┘           │
│                                                                              │
│  DevOps VM (192.168.56.20):                                                  │
│  ┌──────────────┐  ┌──────────────┐                                         │
│  │  Gitea       │  │  Nexus       │                                         │
│  │  Container   │  │  Container   │                                         │
│  │  :3000/:2222 │  │  :8081/:8082 │                                         │
│  └──────────────┘  └──────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Verification Plan

### Automated Tests
- Docker builds complete for both frontend and backend
- Docker Compose brings up all 3 services locally
- K8s deployments reach `Running` state in `fullstack` namespace
- Frontend accessible at `http://192.168.56.11:30090`
- Backend API responds at `http://192.168.56.11:30090/api/tasks`
- Jenkins pipeline completes all stages (GREEN)

### Manual Verification
- Access task manager UI in browser → create/read/update/delete tasks
- Verify data persists across pod restarts (MongoDB NFS)
- Check Nexus UI shows both images (`fullstack-frontend`, `fullstack-backend`)
- Verify Gitea repo contains all pushed source code
