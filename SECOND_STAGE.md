# Second Stage — Configure Nexus & Jenkins

> **Goal:** Set up Nexus Docker Registry and Jenkins CI/CD pipeline on the DevOps machine.
> These will be used to build, push, and deploy the sample application.

---

## Prerequisites

Before starting this stage, make sure:

- [x] **First Stage** is complete:
  - Kubernetes cluster running with all 3 nodes **Ready**
  - Sample nginx app deployed and tested
- [x] **Ansible playbooks** executed:
  - `install-jenkins.yml` — completed successfully
  - `install-nexus.yml` — completed successfully
- [x] **DevOps machine** is accessible at `192.168.56.20`

---

## Part 1: Configure Nexus Docker Registry

### Step 1: Access Nexus Web UI

Open your browser and navigate to:

```
http://192.168.56.20:8081
```

You should see the Nexus login page.

---

### Step 2: Get Nexus Initial Admin Password

SSH into the DevOps machine and retrieve the initial password:

```bash
# From your Windows host
vagrant ssh devops

# Get the admin password
docker exec nexus cat /nexus-data/admin.password
```

**Copy this password** — you'll need it to log in.

---

### Step 3: Log In to Nexus

1. On the login page, enter:
   - **Username:** `admin`
   - **Password:** *(paste the password from Step 2)*

2. Click **Sign in**

3. A **Setup Wizard** may appear — click **Next** to proceed through the quick setup

---

### Step 4: Change the Admin Password

1. After login, click the **gear icon** (⚙️) in the top-right corner → **Account**

2. Click **Change password**

3. Enter:
   - **Current password:** *(the one you just used)*
   - **New password:** `admin123` (or your preferred password)
   - **Confirm password:** *(repeat)*

4. Click **Change password**

> **Save this new password** — you'll need it for Docker login and Jenkins configuration.

---

### Step 5: Create a Docker Hosted Repository

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

### Step 6: Enable Docker Bearer Token Realm

1. Click **gear icon** (⚙️) → **Security** → **Realms**

2. In the **Available column**, find and click **Docker Bearer Token Realm**

3. Click the **right arrow** button `>` to move it to the **Active column**

4. Click **Save** (bottom-right)

Expected: `Docker Bearer Token Realm` now appears in the Active column.

---

### Step 7: Test Docker Login

SSH to the DevOps machine and test the Docker login:

```bash
# Still on devops VM
docker logout 192.168.56.20:8082

# Try to log in (use the new password from Step 4)
docker login 192.168.56.20:8082 -u admin -p admin123
```

Expected output:
```
Login Succeeded
```

If it fails, double-check the IP, port, and password.

---

### Step 8: Verify Nexus is Ready

Test pushing a tag to ensure the registry works:

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

## Part 2: Configure Jenkins

### Step 1: Access Jenkins Web UI

Open your browser and navigate to:

```
http://192.168.56.20:8080
```

You should see the Jenkins setup page.

---

### Step 2: Get Jenkins Initial Admin Password

From your DevOps machine SSH session:

```bash
# Get the admin password
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```

**Copy this password**.

---

### Step 3: Complete Jenkins Setup Wizard

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
   - **Jenkins URL:** `http://192.168.56.20:8080/`
   - Click **Save and Finish**

6. Click **Start using Jenkins**

✅ **Jenkins is ready!**

---

### Step 4: Install Required Plugins

1. Click **Manage Jenkins** (left menu) → **Manage Plugins**

2. Go to the **Available plugins** tab

3. Search for and install these plugins:
   - **Docker Pipeline**
   - **NodeJS Plugin**
   - **Kubernetes CLI**
   - **Git Parameter**

4. For each plugin:
   - Check the checkbox
   - Click **Install without restart** at the bottom

5. Wait for all to complete and refresh the page

---

### Step 5: Add Nexus Docker Credentials to Jenkins

1. Click **Manage Jenkins** → **Credentials** → **Global** (or System)

2. Click **Add Credentials** (left menu)

3. Configure:
   - **Kind:** `Username with password`
   - **Scope:** `Global (Jenkins, nodes, items, all child items, etc.)`
   - **Username:** `admin`
   - **Password:** `admin123` *(the Nexus password from Part 1, Step 4)*
   - **ID:** `nexus-docker-credentials`
   - **Description:** `Nexus Docker Registry Credentials`

4. Click **Create**

---

### Step 6: Configure NodeJS Tool

1. Click **Manage Jenkins** → **Tools**

2. Scroll down to **NodeJS installations** section

3. Click **Add NodeJS**

4. Configure:
   - **Name:** `nodejs-18`
   - **Version:** `NodeJS 18.x` *(select from dropdown)*
   - **Install automatically:** ✅ checked

5. Click **Save**

---

### Step 7: Create a Test Pipeline Job

Let's create a simple test job to verify Jenkins can run builds:

1. Click **+ New Item** (left menu)

2. Enter name: `test-pipeline`

3. Select **Pipeline**

4. Click **OK**

5. Under **Pipeline**, select:
   - **Definition:** `Pipeline script`

6. Paste this script in the **Script** box:

```groovy
pipeline {
    agent any
    
    stages {
        stage('Hello') {
            steps {
                echo 'Hello, DevOps World!'
                sh 'whoami'
                sh 'pwd'
            }
        }
        
        stage('NodeJS Check') {
            steps {
                sh 'node --version'
                sh 'npm --version'
            }
        }
        
        stage('Docker Check') {
            steps {
                sh 'docker --version'
                sh 'docker ps'
            }
        }
    }
}
```

7. Click **Save**

8. Click **Build Now** (left menu)

9. Watch the build execute — click the build number to see logs

Expected output includes:
- `Hello, DevOps World!`
- `node version: v18.x.x`
- `npm version: 9.x.x`
- Docker container list

✅ **Jenkins pipeline works!**

---

### Step 8: Create the Hello-DevOps Pipeline Job

Now create the main job for our sample app:

1. Click **+ New Item**

2. Name: `hello-devops-pipeline`

3. Select **Pipeline**

4. Click **OK**

5. Under **General**, check **GitHub project** (or leave unchecked for now)

6. Under **Pipeline**:
   - **Definition:** `Pipeline script`
   - Paste this script:

```groovy
pipeline {
    agent any
    
    environment {
        REGISTRY = '192.168.56.20:8082'
        REGISTRY_CREDS = credentials('nexus-docker-credentials')
        IMAGE_NAME = "${REGISTRY}/hello-devops"
        IMAGE_TAG = "${BUILD_NUMBER}"
        KUBECONFIG = '/var/lib/jenkins/.kube/config'
    }
    
    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source code...'
                // For now, just use /vagrant/app
                sh 'ls -la /vagrant/app/'
            }
        }
        
        stage('Build Image') {
            steps {
                echo "Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}"
                sh '''
                    cd /vagrant/app
                    docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
                    docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
                '''
            }
        }
        
        stage('Login to Registry') {
            steps {
                echo 'Logging in to Nexus registry...'
                sh '''
                    echo "${REGISTRY_CREDS_PSW}" | docker login -u "${REGISTRY_CREDS_USR}" --password-stdin ${REGISTRY}
                '''
            }
        }
        
        stage('Push Image') {
            steps {
                echo "Pushing image to: ${IMAGE_NAME}:${IMAGE_TAG}"
                sh '''
                    docker push ${IMAGE_NAME}:${IMAGE_TAG}
                    docker push ${IMAGE_NAME}:latest
                '''
            }
        }
        
        stage('Deploy to Kubernetes') {
            steps {
                echo 'Deploying to Kubernetes...'
                sh '''
                    cd /vagrant/kubernetes
                    
                    # Create namespace if not exists
                    kubectl create namespace default 2>/dev/null || true
                    
                    # Create/update secret for Nexus
                    kubectl delete secret nexus-registry-secret 2>/dev/null || true
                    kubectl create secret docker-registry nexus-registry-secret \
                        --docker-server=192.168.56.20:8082 \
                        --docker-username=admin \
                        --docker-password=admin123 \
                        --docker-email=admin@example.com
                    
                    # Apply deployment and service
                    sed "s|IMAGE_PLACEHOLDER|${IMAGE_NAME}:${IMAGE_TAG}|g" deployment.yml | kubectl apply -f -
                    kubectl apply -f service.yml
                    
                    # Wait for pods to be ready
                    kubectl rollout status deployment/hello-devops --timeout=5m
                '''
            }
        }
        
        stage('Verify Deployment') {
            steps {
                echo 'Verifying deployment...'
                sh '''
                    echo "Pods:"
                    kubectl get pods -l app=hello-devops
                    
                    echo "Service:"
                    kubectl get svc hello-devops-service
                    
                    echo "Testing endpoints..."
                    sleep 10
                    curl http://192.168.56.11:30080 || true
                '''
            }
        }
    }
    
    post {
        always {
            echo 'Pipeline complete!'
        }
        
        failure {
            echo 'Pipeline failed!'
        }
    }
}
```

7. Click **Save**

8. Click **Build Now** to test

Watch the build logs. It should:
- Build the Docker image
- Push to Nexus
- Deploy to Kubernetes
- Verify the pods are running

---

## Part 3: Verification Checklist

Run these checks to verify everything is configured:

### Nexus Checks

```bash
# From the DevOps machine
# ✅ 1. Docker login works
docker logout 192.168.56.20:8082
docker login 192.168.56.20:8082 -u admin -p admin123
# Expected: "Login Succeeded"

# ✅ 2. Image was pushed
curl -u admin:admin123 http://192.168.56.20:8081/service/rest/v1/repositories
# Should show "docker-hosted" repository

# ✅ 3. Pull the test image from Nexus
docker pull 192.168.56.20:8082/hello-world:latest
```

### Jenkins Checks

```bash
# ✅ 1. Jenkins is accessible
curl -s -o /dev/null -w "%{http_code}" http://192.168.56.20:8080
# Expected: 200

# ✅ 2. Jenkins has NodeJS installed
# Check in Jenkins UI: Manage Jenkins → Tools → NodeJS installations
# Should show "nodejs-18"

# ✅ 3. Credentials are configured
# Check in Jenkins UI: Manage Jenkins → Credentials → Global
# Should show "nexus-docker-credentials"
```

### Complete Integration Test

```bash
# From devops machine
# ✅ 1. Check Kubernetes cluster
kubectl get nodes
# All 3 nodes should be Ready

# ✅ 2. Trigger the hello-devops-pipeline job
# Go to Jenkins UI → hello-devops-pipeline → Build Now
# Wait for build to complete

# ✅ 3. Verify app is deployed
kubectl get pods -l app=hello-devops
# Should show 2 pods, both Running

# ✅ 4. Test the app endpoints
curl http://192.168.56.11:30080
curl http://192.168.56.12:30080
# Should return JSON response with "Hello DevOps! 🚀"
```

---

## Troubleshooting

### Nexus Issues

| Problem | Solution |
|---|---|
| Can't access Nexus Web UI | Check if Docker container is running: `docker ps \| grep nexus` |
| Docker login fails | Verify Nexus password is correct, check firewall on port 8082 |
| Repository not listed | Create manually via Web UI: Settings → Repositories → Create Repository |
| Push fails with 401 | Re-authenticate: `docker logout && docker login 192.168.56.20:8082` |
| "http: server gave HTTP response to HTTPS client" | Docker is trying HTTPS but Nexus uses HTTP. Configure insecure registry: Edit `/etc/docker/daemon.json` and add `"insecure-registries": ["192.168.56.20:8082"]`, then `sudo systemctl restart docker` |
| "connection refused" after Docker restart | Docker restart stops all containers. Restart Nexus: `docker start nexus && sleep 180` (wait 2-3 min for startup) |

### Jenkins Issues

| Problem | Solution |
|---|---|
| Can't access Jenkins Web UI | Check if service is running: `sudo systemctl status jenkins` |
| Plugins won't install | Check internet connectivity, try installing one at a time |
| Docker push fails in pipeline | Verify credentials ID is correct (`nexus-docker-credentials`) |
| Kubernetes deployment fails | Check `kubectl get events` for error details on master node |
| Permission denied errors | Run: `sudo usermod -aG docker jenkins && sudo systemctl restart jenkins` |

### Image Pull Errors in Kubernetes

If pods show `ImagePullBackOff`:

```bash
# On the devops machine
# 1. Verify the image exists in Nexus
docker pull 192.168.56.20:8082/hello-devops:latest

# 2. Verify the secret is created
kubectl get secrets
# Should show: nexus-registry-secret

# 3. Check pod events
kubectl describe pod <pod-name>
# Look for error messages

# 4. Verify containerd insecure registry config
ssh vagrant@k8s-worker1
sudoedit /etc/containerd/config.toml
# Check for: [plugins."io.containerd.grpc.v1.cri".registry.configs."192.168.56.20:8082"]

# 5. Restart containerd if config changed
sudo systemctl restart containerd
```

---

## Next Steps

Once this stage is complete, you're ready for:

- **Third Stage:** Build and test Docker images independently
- **Fourth Stage:** Automate everything with Jenkins CI/CD pipeline
- **Fifth Stage:** Monitor and scale the application in Kubernetes

---

## Summary of Credentials

Keep these safe — you'll need them throughout the project:

| Service | URL | Username | Password |
|---|---|---|---|
| Nexus | `http://192.168.56.20:8081` | `admin` | `admin123` |
| Jenkins | `http://192.168.56.20:8080` | `admin` | `admin123` |
| Docker Registry | `192.168.56.20:8082` | `admin` | `admin123` |
| Kubernetes | Command-line (kubectl) | (certificate-based) | N/A |
