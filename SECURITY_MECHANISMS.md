# Kubernetes Security: 3 Lightweight Solutions

> **Goal:** Document the three lightweight security mechanisms used in this cluster and explain how each one protects workloads.

---

## Table of Contents

1. [Security Overview](#1-security-overview)
2. [Solution 1: Role-Based Access Control (RBAC)](#2-solution-1-role-based-access-control-rbac)
3. [Solution 2: Network Policies (Calico)](#3-solution-2-network-policies-calico)
4. [Solution 3: Pod Security Admission (PSA)](#4-solution-3-pod-security-admission-psa)
5. [How These Three Work Together](#5-how-these-three-work-together)
6. [Quick Verification Commands](#6-quick-verification-commands)

---

## 1. Security Overview

This cluster uses three lightweight, built-in security controls that add almost no runtime overhead:
- **RBAC** limits what identities can do in the Kubernetes API.
- **Network Policies** restrict pod-to-pod and pod-to-external traffic.
- **Pod Security Admission** blocks unsafe pod specs at creation time.

---

## 2. Solution 1: Role-Based Access Control (RBAC)

RBAC is the core access-control system of Kubernetes. It ensures that each ServiceAccount only has the permissions it needs.

**Where used:**
- Jenkins has cluster-wide permissions to deploy workloads.
- Fullstack app has read-only access to a few resources.

**Files:**
- [kubernetes/jenkins/rbac.yml](kubernetes/jenkins/rbac.yml)
- [kubernetes/fullstack/security-rbac.yml](kubernetes/fullstack/security-rbac.yml)

**How we implemented it:**
- Created a dedicated ServiceAccount for Jenkins with a ClusterRole + ClusterRoleBinding.
- Created a namespace-scoped ServiceAccount, Role, and RoleBinding for the fullstack app.
- Applied the manifests before deploying workloads.

```bash
kubectl apply -f kubernetes/jenkins/rbac.yml
kubectl apply -f kubernetes/fullstack/security-rbac.yml
```

**YAML explained (what the key blocks do):**

**Jenkins RBAC** ([kubernetes/jenkins/rbac.yml](kubernetes/jenkins/rbac.yml))

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
	name: jenkins
	namespace: jenkins
```

- Creates a dedicated identity for the Jenkins pod.
- This identity is referenced by the Jenkins Deployment via `serviceAccountName: jenkins`.

```yaml
kind: ClusterRole
rules:
	- apiGroups: [""]
		resources: ["pods", "pods/log", "pods/exec", "services", "secrets"]
		verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
	- apiGroups: ["apps"]
		resources: ["deployments", "replicasets", "statefulsets"]
		verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
```

- Grants Jenkins the rights needed to deploy and update workloads across namespaces.
- ClusterRole is used (not Role) because Jenkins deploys outside the jenkins namespace.

```yaml
kind: ClusterRoleBinding
subjects:
	- kind: ServiceAccount
		name: jenkins
		namespace: jenkins
roleRef:
	kind: ClusterRole
	name: jenkins-cluster-role
```

- Binds the permissions to the Jenkins ServiceAccount.

**Fullstack RBAC** ([kubernetes/fullstack/security-rbac.yml](kubernetes/fullstack/security-rbac.yml))

```yaml
kind: ServiceAccount
metadata:
	name: fullstack-app-sa
	namespace: fullstack
```

- Dedicated identity for the fullstack pods.

```yaml
kind: Role
rules:
	- apiGroups: [""]
		resources: ["pods", "endpoints", "services"]
		verbs: ["get", "list", "watch"]
```

- Read-only access to basic service discovery resources.
- Limits the app from creating or deleting anything.

```yaml
kind: RoleBinding
subjects:
	- kind: ServiceAccount
		name: fullstack-app-sa
		namespace: fullstack
roleRef:
	kind: Role
	name: fullstack-app-role
```

- Attaches the Role to the app ServiceAccount.

---

## 3. Solution 2: Network Policies (Calico)

Network Policies act as a micro-firewall. In this cluster, the `fullstack` namespace uses a **default-deny** model with explicit allow rules.

**File:** [kubernetes/fullstack/security-network-policies.yml](kubernetes/fullstack/security-network-policies.yml)

**Policies enforced:**
- Default deny ingress and egress for all pods.
- Allow DNS egress to kube-system.
- Allow frontend -> backend on port 5000.
- Allow backend -> postgres on port 5432.
- Allow external ingress only to frontend.

**How we implemented it:**
- Installed Calico CNI during cluster init (required for NetworkPolicy enforcement).
- Created a default-deny policy, then added explicit allow rules for DNS, frontend, backend, and postgres.
- Applied the policies after the fullstack namespace exists.

```bash
kubectl apply -f kubernetes/fullstack/security-network-policies.yml
```

**YAML explained (what the key blocks do):**

**Default deny** ([kubernetes/fullstack/security-network-policies.yml](kubernetes/fullstack/security-network-policies.yml))

```yaml
kind: NetworkPolicy
metadata:
	name: default-deny-all
spec:
	podSelector: {}
	policyTypes:
		- Ingress
		- Egress
```

- Applies to all pods in `fullstack` (empty selector).
- Blocks all ingress and egress by default.

```yaml
kind: NetworkPolicy
metadata:
	name: allow-dns-egress
spec:
	podSelector: {}
	policyTypes: [Egress]
	egress:
		- to:
				- namespaceSelector:
						matchLabels:
							kubernetes.io/metadata.name: kube-system
			ports:
				- protocol: UDP
					port: 53
```

- Restores DNS so pods can resolve service names.

```yaml
kind: NetworkPolicy
metadata:
	name: frontend-network-policy
spec:
	podSelector:
		matchLabels:
			app: frontend
	ingress:
		- {}
	egress:
		- to:
				- podSelector:
						matchLabels:
							app: backend
			ports:
				- protocol: TCP
					port: 5000
```

- Allows external traffic to frontend and only lets frontend talk to backend:5000.

```yaml
kind: NetworkPolicy
metadata:
	name: backend-network-policy
spec:
	podSelector:
		matchLabels:
			app: backend
	ingress:
		- from:
				- podSelector:
						matchLabels:
							app: frontend
			ports:
				- protocol: TCP
					port: 5000
	egress:
		- to:
				- podSelector:
						matchLabels:
							app: postgres
			ports:
				- protocol: TCP
					port: 5432
```

- Backend only accepts traffic from frontend and only talks to postgres:5432.

---

## 4. Solution 3: Pod Security Admission (PSA)

PSA is a built-in admission controller that blocks unsafe pod specs before they run.
The `fullstack` namespace enforces the **baseline** policy.

**File:** [kubernetes/fullstack/namespace.yml](kubernetes/fullstack/namespace.yml)

**Key labels:**
- `pod-security.kubernetes.io/enforce: baseline`
- `pod-security.kubernetes.io/warn: baseline`
- `pod-security.kubernetes.io/audit: baseline`

**How we implemented it:**
- Added PSA labels directly on the fullstack namespace.
- Applied the namespace manifest before deploying fullstack workloads.

```bash
kubectl apply -f kubernetes/fullstack/namespace.yml
```

**YAML explained (what the key blocks do):**

**PSA labels** ([kubernetes/fullstack/namespace.yml](kubernetes/fullstack/namespace.yml))

```yaml
kind: Namespace
metadata:
	name: fullstack
	labels:
		pod-security.kubernetes.io/enforce: baseline
		pod-security.kubernetes.io/warn: baseline
		pod-security.kubernetes.io/audit: baseline
```

- `enforce`: blocks pods that violate baseline (for example: privileged containers).
- `warn`: logs warnings for non-compliant specs.
- `audit`: records violations for later review.

---

## 5. How These Three Work Together

- **RBAC** controls who can create or change resources.
- **PSA** blocks privileged pods at admission time.
- **Network Policies** control runtime traffic between pods.

These three cover access, workload safety, and network isolation with minimal resource cost.

---

## 6. Quick Verification Commands

```bash
# Check RBAC bindings
kubectl get sa -n jenkins
kubectl get sa -n fullstack
kubectl get clusterrolebinding | grep jenkins
kubectl get rolebinding -n fullstack

# Check NetworkPolicies
kubectl get netpol -n fullstack

# Check PSA labels
kubectl get ns fullstack --show-labels
```

---

