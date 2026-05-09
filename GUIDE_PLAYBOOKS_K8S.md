## 📚 DevOps & Kubernetes Project — Playbooks & Manifests Explanation Guide

> **This document explains what each Ansible playbook and Kubernetes manifest DOES and WHY, organized by blocks.
> Follow the same style as GUIDE.md: focus on purpose, not full code listing.**

---

## Table of Contents

**Part 1: Ansible Playbooks**
1. [Playbook 1: common.yml](#playbook-1-commonyml) — Base OS setup
2. [Playbook 2: install-containerd.yml](#playbook-2-install-containerdyml) — Container runtime
3. [Playbook 3: install-kubernetes.yml](#playbook-3-install-kubernetesyml) — K8s tools
4. [Playbook 4: init-master.yml](#playbook-4-init-masteryml) — Master initialization
5. [Playbook 5: join-workers.yml](#playbook-5-join-workersyml) — Worker join
6. [Playbook 6: configure-insecure-registry.yml](#playbook-6-configure-insecure-registryyml) — Nexus registry trust
7. [Playbook 7: configure-kubectl-devops.yml](#playbook-7-configure-kubectl-devopsyml) — DevOps kubectl access
8. [Playbook 8: install-jenkins.yml](#playbook-8-install-jenkinsyml) — Docker & kubectl
9. [Playbook 9: install-gitea.yml](#playbook-9-install-giteayml) — Git server
10. [Playbook 10: install-nexus.yml](#playbook-10-install-nexusyml) — Docker registry
11. [Playbook 11: setup-nfs-server.yml](#playbook-11-setup-nfs-serveryml) — NFS server
12. [Playbook 12: setup-nfs-postgres.yml](#playbook-12-setup-nfs-postgresyml) — Postgres storage
13. [Playbook 13: setup-nfs-clients.yml](#playbook-13-setup-nfs-clientsyml) — NFS client

**Part 2: Kubernetes Manifests**
14. [Sample App Manifests](#sample-app-manifests) — hello-devops deployment
15. [Jenkins Manifests](#jenkins-manifests) — Jenkins CI/CD server
16. [Fullstack Manifests](#fullstack-manifests) — Complete Task Manager app

---

# Part 1: Ansible Playbooks

## Playbook 1: common.yml

**Purpose:** Prepare all Kubernetes nodes (master + workers) with system prerequisites before installing container runtime or K8s.

**Runs on:** `k8s_cluster` (all 3 K8s nodes)

---

## 2. Playbook 1: common.yml

File: [ansible/playbooks/common.yml](ansible/playbooks/common.yml)

Purpose: Prepare all Kubernetes nodes with system prerequisites (swap off, kernel modules, sysctl settings, base packages).

Runs on: k8s_cluster (master + workers).

Key parts:
- Updates /etc/hosts for name resolution.
- Disables swap and removes it from fstab.
- Loads and persists kernel modules.
- Applies sysctl networking settings.
- Installs common packages.

```yaml
---
# ==============================================================================
# Playbook: common.yml
# Purpose: Prepare ALL Kubernetes nodes (master + workers) with prerequisites
# Run: ansible-playbook playbooks/common.yml
# ==============================================================================

- name: Common setup for all Kubernetes nodes
  hosts: k8s_cluster
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Update /etc/hosts for name resolution
    # ------------------------------------------------------------------
    - name: Add cluster hosts to /etc/hosts
      lineinfile:
        path: /etc/hosts
        line: "{{ item }}"
        state: present
      loop:
        - "192.168.56.10 k8s-master"
        - "192.168.56.11 k8s-worker1"
        - "192.168.56.12 k8s-worker2"
        - "192.168.56.20 devops"

    # ------------------------------------------------------------------
    # 2. Disable swap (required by Kubernetes)
    # ------------------------------------------------------------------
    - name: Disable swap immediately
      command: swapoff -a
      changed_when: false

    - name: Remove swap entry from /etc/fstab
      lineinfile:
        path: /etc/fstab
        regexp: '.*swap.*'
        state: absent

    # ------------------------------------------------------------------
    # 3. Load required kernel modules
    # ------------------------------------------------------------------
    - name: Load kernel modules for containerd
      modprobe:
        name: "{{ item }}"
        state: present
      loop:
        - overlay
        - br_netfilter

    - name: Ensure kernel modules load on boot
      copy:
        dest: /etc/modules-load.d/k8s.conf
        content: |
          overlay
          br_netfilter

    # ------------------------------------------------------------------
    # 4. Set sysctl parameters for Kubernetes networking
    # ------------------------------------------------------------------
    - name: Set sysctl params for Kubernetes
      sysctl:
        name: "{{ item.key }}"
        value: "{{ item.value }}"
        sysctl_file: /etc/sysctl.d/k8s.conf
        reload: yes
      loop:
        - { key: "net.bridge.bridge-nf-call-iptables",  value: "1" }
        - { key: "net.bridge.bridge-nf-call-ip6tables", value: "1" }
        - { key: "net.ipv4.ip_forward",                 value: "1" }

    # ------------------------------------------------------------------
    # 5. Install common packages
    # ------------------------------------------------------------------
    - name: Update apt cache
      apt:
        update_cache: yes
        cache_valid_time: 3600

    - name: Install prerequisite packages
      apt:
        name:
          - apt-transport-https
          - ca-certificates
          - curl
          - gnupg
          - lsb-release
          - software-properties-common
        state: present
```

---

## 3. Playbook 2: install-containerd.yml

File: [ansible/playbooks/install-containerd.yml](ansible/playbooks/install-containerd.yml)

Purpose: Install and configure containerd on all Kubernetes nodes.

Runs on: k8s_cluster (master + workers).

Key parts:
- Adds Docker repo and installs containerd.
- Regenerates config and enables systemd cgroup driver.
- Configures Nexus registry trust using certs.d.
- Restarts containerd.

```yaml
---
# ==============================================================================
# Playbook: install-containerd.yml
# Purpose: Install containerd as the container runtime on all K8s nodes
# Run: ansible-playbook playbooks/install-containerd.yml
# ==============================================================================

- name: Install and configure containerd
  hosts: k8s_cluster
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Add Docker's official GPG key and repository (containerd is part of Docker repo)
    # ------------------------------------------------------------------
    - name: Create keyrings directory
      file:
        path: /etc/apt/keyrings
        state: directory
        mode: '0755'

    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        state: present
        filename: docker

    # ------------------------------------------------------------------
    # 2. Install containerd
    # ------------------------------------------------------------------
    - name: Update apt cache
      apt:
        update_cache: yes

    - name: Install containerd.io
      apt:
        name: containerd.io
        state: present

    # ------------------------------------------------------------------
    # 3. Configure containerd to use systemd cgroup driver
    # ------------------------------------------------------------------
    - name: Create containerd config directory
      file:
        path: /etc/containerd
        state: directory

    - name: Remove old containerd config (to regenerate cleanly)
      file:
        path: /etc/containerd/config.toml
        state: absent

    - name: Generate fresh default containerd config
      shell: containerd config default > /etc/containerd/config.toml

    - name: Set SystemdCgroup to true in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'SystemdCgroup = false'
        replace: 'SystemdCgroup = true'

    # ------------------------------------------------------------------
    # 4. Configure containerd to trust Nexus insecure registry
    #    Using config_path approach with certs.d directory (safe, no TOML corruption)
    # ------------------------------------------------------------------
    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = [''"].*[''"']'
        replace: 'config_path = "/etc/containerd/certs.d"'

    - name: Create Nexus registry certs directory
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'

    - name: Create Nexus registry hosts.toml config
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true

    # ------------------------------------------------------------------
    # 5. Restart and enable containerd
    # ------------------------------------------------------------------
    - name: Restart containerd
      systemd:
        name: containerd
        state: restarted
        daemon_reload: yes
        enabled: yes
```

---

## 4. Playbook 3: install-kubernetes.yml

File: [ansible/playbooks/install-kubernetes.yml](ansible/playbooks/install-kubernetes.yml)

Purpose: Install kubeadm, kubelet, and kubectl on all nodes and hold versions.

Runs on: k8s_cluster (master + workers).

Key parts:
- Adds Kubernetes APT repo and key.
- Installs kubeadm, kubelet, kubectl.
- Holds versions to prevent drift.
- Enables kubelet service.

```yaml
---
# ==============================================================================
# Playbook: install-kubernetes.yml
# Purpose: Install kubeadm, kubelet, kubectl on all K8s nodes
# Run: ansible-playbook playbooks/install-kubernetes.yml
# ==============================================================================

- name: Install Kubernetes components
  hosts: k8s_cluster
  become: yes
  vars:
    kube_version: "1.29"
  tasks:

    # ------------------------------------------------------------------
    # 1. Add Kubernetes APT repository
    # ------------------------------------------------------------------
    - name: Create keyrings directory
      file:
        path: /etc/apt/keyrings
        state: directory
        mode: '0755'

    - name: Download Kubernetes GPG key
      shell: |
        curl -fsSL https://pkgs.k8s.io/core:/stable:/v{{ kube_version }}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
      args:
        creates: /etc/apt/keyrings/kubernetes-apt-keyring.gpg

    - name: Add Kubernetes APT repository
      apt_repository:
        repo: "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v{{ kube_version }}/deb/ /"
        state: present
        filename: kubernetes

    # ------------------------------------------------------------------
    # 2. Install kubeadm, kubelet, kubectl
    # ------------------------------------------------------------------
    - name: Update apt cache
      apt:
        update_cache: yes

    - name: Install Kubernetes packages
      apt:
        name:
          - kubelet
          - kubeadm
          - kubectl
        state: present

    # ------------------------------------------------------------------
    # 3. Hold Kubernetes packages to prevent auto-update
    # ------------------------------------------------------------------
    - name: Hold Kubernetes packages at current version
      dpkg_selections:
        name: "{{ item }}"
        selection: hold
      loop:
        - kubelet
        - kubeadm
        - kubectl

    # ------------------------------------------------------------------
    # 4. Enable kubelet service
    # ------------------------------------------------------------------
    - name: Enable and start kubelet
      systemd:
        name: kubelet
        enabled: yes
        state: started
```

---

## 5. Playbook 4: init-master.yml

File: [ansible/playbooks/init-master.yml](ansible/playbooks/init-master.yml)

Purpose: Initialize the Kubernetes control plane, install Calico, and generate the join command.

Runs on: masters (k8s-master only).

Key parts:
- Runs kubeadm init with API and pod CIDR.
- Writes kubeconfig for vagrant and root.
- Applies Calico CNI.
- Generates and stores join command for workers.

```yaml
---
# ==============================================================================
# Playbook: init-master.yml
# Purpose: Initialize Kubernetes master node with kubeadm and install Calico CNI
# Run: ansible-playbook playbooks/init-master.yml
# ==============================================================================

- name: Initialize Kubernetes Master Node
  hosts: masters
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Check if cluster is already initialized
    # ------------------------------------------------------------------
    - name: Check if kubeadm has already been initialized
      stat:
        path: /etc/kubernetes/admin.conf
      register: kubeadm_init_check

    # ------------------------------------------------------------------
    # 2. Initialize the cluster with kubeadm
    # ------------------------------------------------------------------
    - name: Initialize Kubernetes cluster with kubeadm
      command: >
        kubeadm init
        --apiserver-advertise-address=192.168.56.10
        --pod-network-cidr=192.168.0.0/16
        --node-name=k8s-master
      when: not kubeadm_init_check.stat.exists
      register: kubeadm_output

    # ------------------------------------------------------------------
    # 3. Set up kubeconfig for vagrant user
    # ------------------------------------------------------------------
    - name: Create .kube directory for vagrant user
      file:
        path: /home/vagrant/.kube
        state: directory
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Copy admin.conf to vagrant user kubeconfig
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /home/vagrant/.kube/config
        remote_src: yes
        owner: vagrant
        group: vagrant
        mode: '0644'

    # ------------------------------------------------------------------
    # 4. Set up kubeconfig for root user
    # ------------------------------------------------------------------
    - name: Create .kube directory for root
      file:
        path: /root/.kube
        state: directory
        mode: '0755'

    - name: Copy admin.conf to root kubeconfig
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /root/.kube/config
        remote_src: yes
        mode: '0644'

    # ------------------------------------------------------------------
    # 5. Install Calico CNI network plugin
    # ------------------------------------------------------------------
    - name: Download Calico manifest
      get_url:
        url: https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml
        dest: /home/vagrant/calico.yaml
        owner: vagrant
        group: vagrant

    - name: Apply Calico CNI
      become_user: vagrant
      command: kubectl apply -f /home/vagrant/calico.yaml
      environment:
        KUBECONFIG: /home/vagrant/.kube/config

    # ------------------------------------------------------------------
    # 6. Generate join command for worker nodes
    # ------------------------------------------------------------------
    - name: Generate kubeadm join command
      command: kubeadm token create --print-join-command
      register: join_command

    - name: Save join command to file
      copy:
        content: "{{ join_command.stdout }}"
        dest: /home/vagrant/join-command.sh
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Store join command as fact
      set_fact:
        kubernetes_join_command: "{{ join_command.stdout }}"
```

---

## 6. Playbook 5: join-workers.yml

File: [ansible/playbooks/join-workers.yml](ansible/playbooks/join-workers.yml)

Purpose: Join worker nodes to the cluster using the join command from master.

Runs on: masters (first play) and workers (second play).

Key parts:
- Generates join command on master and stores it as a fact.
- Joins each worker if it is not already joined.
- Ensures kubelet is running.

```yaml
---
# ==============================================================================
# Playbook: join-workers.yml
# Purpose: Join worker nodes to the Kubernetes cluster
# Run: ansible-playbook playbooks/join-workers.yml
# ==============================================================================

- name: Get join command from master
  hosts: masters
  become: yes
  tasks:
    - name: Get join command
      command: kubeadm token create --print-join-command
      register: join_command_raw

    - name: Set join command fact
      set_fact:
        join_command: "{{ join_command_raw.stdout }}"

- name: Join worker nodes to the cluster
  hosts: workers
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Check if already joined
    # ------------------------------------------------------------------
    - name: Check if node is already part of a cluster
      stat:
        path: /etc/kubernetes/kubelet.conf
      register: kubelet_conf

    # ------------------------------------------------------------------
    # 2. Join the cluster
    # ------------------------------------------------------------------
    - name: Join node to Kubernetes cluster
      command: "{{ hostvars['k8s-master']['join_command'] }}"
      when: not kubelet_conf.stat.exists

    # ------------------------------------------------------------------
    # 3. Verify kubelet is running
    # ------------------------------------------------------------------
    - name: Ensure kubelet is running
      systemd:
        name: kubelet
        state: started
        enabled: yes
```

---

## 7. Playbook 6: configure-insecure-registry.yml

File: [ansible/playbooks/configure-insecure-registry.yml](ansible/playbooks/configure-insecure-registry.yml)

Purpose: Configure containerd on nodes to trust the Nexus HTTP registry using certs.d.

Runs on: k8s_cluster (master + workers).

Key parts:
- Removes deprecated registry config blocks.
- Forces config_path to certs.d.
- Writes hosts.toml for Nexus.
- Restarts containerd and verifies pull.

```yaml
---
# ==============================================================================
# Playbook: configure-insecure-registry.yml
# Purpose: Configure containerd on K8s nodes to trust the Nexus HTTP registry
# Run: ansible-playbook playbooks/configure-insecure-registry.yml
# ==============================================================================
# Compatible with containerd v2.x (removes deprecated grpc.v1.cri config)
# Uses the hosts.toml approach via config_path for registry resolution
# ==============================================================================

- name: Configure Insecure Registry on K8s Nodes
  hosts: k8s_cluster
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Remove old deprecated registry config (breaks containerd v2)
    # ------------------------------------------------------------------
    - name: Remove old NEXUS INSECURE REGISTRY block from config.toml
      blockinfile:
        path: /etc/containerd/config.toml
        marker: "# {mark} NEXUS INSECURE REGISTRY"
        state: absent

    - name: Remove orphaned grpc.v1.cri registry section header
      lineinfile:
        path: /etc/containerd/config.toml
        regexp: '^\[plugins\."io\.containerd\.grpc\.v1\.cri"\.registry\]'
        state: absent

    # ------------------------------------------------------------------
    # 2. Configure hosts.toml for Nexus HTTP registry
    # ------------------------------------------------------------------
    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = [''"].*[''"']'
        replace: 'config_path = "/etc/containerd/certs.d"'

    - name: Create containerd certs.d directory for Nexus
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'
        recurse: yes

    - name: Write hosts.toml for Nexus HTTP registry
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
        mode: '0644'

    - name: Create containerd certs.d directory for Nexus Alias IP
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'
        recurse: yes

    - name: Write hosts.toml for Nexus HTTP registry Alias IP
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
        mode: '0644'

    # ------------------------------------------------------------------
    # 3. Verify containerd config is parseable
    # ------------------------------------------------------------------
    - name: Check effective config_path in containerd
      shell: containerd config dump 2>/dev/null | grep 'config_path' | grep 'certs.d' | head -1
      register: config_dump_check
      changed_when: false
      ignore_errors: yes

    - name: Show effective config_path
      debug:
        msg: "Effective config_path: {{ config_dump_check.stdout | default('NOT FOUND - config may need regeneration') }}"

    # ------------------------------------------------------------------
    # 4. Restart containerd and verify
    # ------------------------------------------------------------------
    - name: Restart containerd
      systemd:
        name: containerd
        state: restarted

    - name: Wait for containerd to stabilize
      pause:
        seconds: 10

    - name: Verify containerd is active
      shell: systemctl is-active containerd
      register: containerd_active
      changed_when: false

    - name: Test image pull from Nexus
      shell: |
        crictl --image-endpoint unix:///run/containerd/containerd.sock pull 192.168.56.20:8082/fullstack-backend:latest 2>&1
      register: pull_test
      ignore_errors: yes
      timeout: 30

    - name: Display results
      debug:
        msg: |
          containerd: {{ containerd_active.stdout }}
          config_path: {{ config_dump_check.stdout | default('NOT FOUND') }}
          Pull test: {{ 'SUCCESS' if pull_test.rc == 0 else pull_test.stderr | default(pull_test.stdout | default('FAILED')) }}
```

---

## 8. Playbook 7: configure-kubectl-devops.yml

File: [ansible/playbooks/configure-kubectl-devops.yml](ansible/playbooks/configure-kubectl-devops.yml)

Purpose: Copy kubeconfig from master to devops and to NFS for Jenkins.

Runs on: masters (read kubeconfig) and devops (write local config) and masters (write NFS path).

Key parts:
- Uses slurp to read admin.conf.
- Writes kubeconfig for vagrant user on devops.
- Updates API server address to master IP.
- Writes kubeconfig for Jenkins via NFS mount.

```yaml
---
# ==============================================================================
# Playbook: configure-kubectl-devops.yml
# Purpose: Copy kubeconfig from master to devops machine and NFS Jenkins dir
# Run: ansible-playbook playbooks/configure-kubectl-devops.yml
# ==============================================================================
# Configures kubectl access for:
#   1. vagrant user on DevOps machine (manual cluster management)
#   2. Jenkins pod via NFS mount (so Jenkins can deploy to K8s)
# ==============================================================================

- name: Fetch kubeconfig from master
  hosts: masters
  become: yes
  tasks:
    - name: Read kubeconfig from master
      slurp:
        src: /etc/kubernetes/admin.conf
      register: kubeconfig_content

    - name: Set kubeconfig fact
      set_fact:
        kubeconfig_data: "{{ kubeconfig_content.content | b64decode }}"

- name: Configure kubectl on DevOps machine and NFS
  hosts: devops
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Set up kubectl for vagrant user
    # ------------------------------------------------------------------
    - name: Create .kube directory for vagrant user
      file:
        path: /home/vagrant/.kube
        state: directory
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Write kubeconfig for vagrant user
      copy:
        content: "{{ hostvars['k8s-master']['kubeconfig_data'] }}"
        dest: /home/vagrant/.kube/config
        owner: vagrant
        group: vagrant
        mode: '0600'

    # ------------------------------------------------------------------
    # 2. Update kubeconfig to point to master's IP
    # ------------------------------------------------------------------
    - name: Update API server address in vagrant kubeconfig
      replace:
        path: /home/vagrant/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'

    # ------------------------------------------------------------------
    # 3. Verify kubectl access
    # ------------------------------------------------------------------
    - name: Verify kubectl works from devops (vagrant)
      become_user: vagrant
      command: kubectl get nodes
      register: kubectl_output
      ignore_errors: yes

    - name: Display kubectl output
      debug:
        msg: "{{ kubectl_output.stdout_lines }}"
      when: kubectl_output.rc == 0

- name: Copy kubeconfig to NFS for Jenkins pod
  hosts: masters
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 4. Set up kubectl config in NFS Jenkins directory
    # ------------------------------------------------------------------
    - name: Create .kube directory in NFS Jenkins home
      file:
        path: /srv/nfs/jenkins/.kube
        state: directory
        owner: "1000"
        group: "1000"
        mode: '0755'

    - name: Write kubeconfig to NFS Jenkins home
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /srv/nfs/jenkins/.kube/config
        remote_src: yes
        owner: "1000"
        group: "1000"
        mode: '0600'

    - name: Update API server address in Jenkins kubeconfig
      replace:
        path: /srv/nfs/jenkins/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'

    - name: Display completion message
      debug:
        msg: |
          ============================================
          kubectl configured for:
          - vagrant@devops: /home/vagrant/.kube/config
          - Jenkins pod (NFS): /srv/nfs/jenkins/.kube/config
          ============================================
```

---

## 9. Playbook 8: install-jenkins.yml

File: [ansible/playbooks/install-jenkins.yml](ansible/playbooks/install-jenkins.yml)

Purpose: Install Docker and kubectl on the devops machine. Jenkins itself runs in Kubernetes.

Runs on: devops.

Key parts:
- Installs Java 17.
- Installs Docker and adds vagrant to docker group.
- Installs kubectl.
- Configures Docker to trust Nexus HTTP registry.

```yaml
---
# ==============================================================================
# Playbook: install-jenkins.yml
# Purpose: Install Docker & kubectl on the DevOps machine
# Run: ansible-playbook playbooks/install-jenkins.yml
# ==============================================================================
# NOTE: Jenkins is NO LONGER installed here. Jenkins now runs as a Kubernetes
# pod on the worker nodes. This playbook only installs Docker (for Nexus and
# manual image builds) and kubectl (for cluster management).
# ==============================================================================

- name: Install Docker and kubectl on DevOps machine
  hosts: devops
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Install Java 17 (may still be useful for tools)
    # ------------------------------------------------------------------
    - name: Install Java 17 JDK # note for me : upgrade for JDK 21 for long term support
      apt:
        name: openjdk-17-jdk
        state: present
        update_cache: yes

    # ------------------------------------------------------------------
    # 2. Install Docker on DevOps (for building images & running Nexus)
    # ------------------------------------------------------------------
    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        state: present
        filename: docker

    - name: Install Docker
      apt:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
        state: present
        update_cache: yes

    - name: Start Docker service
      systemd:
        name: docker
        state: started
        enabled: yes

    # ------------------------------------------------------------------
    # 3. Add vagrant user to docker group
    # ------------------------------------------------------------------
    - name: Add vagrant user to docker group
      user:
        name: vagrant
        groups: docker
        append: yes

    # ------------------------------------------------------------------
    # 4. Install kubectl on DevOps machine
    # ------------------------------------------------------------------
    - name: Download kubectl binary
      get_url:
        url: "https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl"
        dest: /usr/local/bin/kubectl
        mode: '0755'

    # ------------------------------------------------------------------
    # 5. Configure Docker to use Nexus as insecure registry
    # ------------------------------------------------------------------
    - name: Create Docker daemon.json for insecure registry
      copy:
        dest: /etc/docker/daemon.json
        content: |
          {
            "insecure-registries": ["192.168.56.20:8082"]
          }
      notify: restart docker

    # ------------------------------------------------------------------
    # 6. Display completion message
    # ------------------------------------------------------------------
    - name: Display setup information
      debug:
        msg: |
          ============================================
          DevOps machine setup complete!
          - Docker installed and configured
          - kubectl installed
          - Insecure registry: 192.168.56.20:8082
          ============================================
          NOTE: Jenkins is NOT installed here.
          Jenkins runs as a Kubernetes pod.
          Access Jenkins at: http://<worker-ip>:32000
          ============================================

  handlers:
    - name: restart docker
      systemd:
        name: docker
        state: restarted
```

---

## 10. Playbook 9: install-gitea.yml

File: [ansible/playbooks/install-gitea.yml](ansible/playbooks/install-gitea.yml)

Purpose: Install Gitea on the devops server as a systemd service.

Runs on: devops_servers.

Key parts:
- Creates git user and Gitea directories.
- Downloads the Gitea binary and systemd service file.
- Enables and starts the service.

```yaml
---
- name: Install Gitea natively on DevOps Machine
  hosts: devops_servers
  become: yes
  vars:
    gitea_version: "1.21.7"
  tasks:
    - name: Install required packages (git)
      apt:
        name: git
        state: present
        update_cache: yes

    - name: Create git user for Gitea
      user:
        name: git
        system: yes
        shell: /bin/bash
        comment: "Git Version Control"
        create_home: yes
        home: /home/git

    - name: Create Gitea directories
      file:
        path: "{{ item }}"
        state: directory
        owner: git
        group: git
        mode: '0750'
      with_items:
        - /var/lib/gitea
        - /var/lib/gitea/custom
        - /var/lib/gitea/data
        - /var/lib/gitea/data/lfs
        - /var/log/gitea

    - name: Create /etc/gitea directory
      file:
        path: /etc/gitea
        state: directory
        owner: root
        group: git
        mode: '0770'

    - name: Download Gitea binary
      get_url:
        url: "https://dl.gitea.com/gitea/{{ gitea_version }}/gitea-{{ gitea_version }}-linux-amd64"
        dest: /usr/local/bin/gitea
        mode: '0755'

    - name: Download Gitea systemd service file
      get_url:
        url: "https://raw.githubusercontent.com/go-gitea/gitea/main/contrib/systemd/gitea.service"
        dest: /etc/systemd/system/gitea.service

    - name: Ensure Gitea service starts on boot and is running
      systemd:
        name: gitea
        enabled: yes
        state: started
        daemon_reload: yes
```

---

## 11. Playbook 10: install-nexus.yml

File: [ansible/playbooks/install-nexus.yml](ansible/playbooks/install-nexus.yml)

Purpose: Install Nexus Repository Manager as a Docker container.

Runs on: devops.

Key parts:
- Ensures system clock is synced.
- Installs Docker SDK for Ansible.
- Creates NFS-backed data directory.
- Runs Nexus container on ports 8081/8082.
- Waits for readiness and prints credentials.

```yaml
---
# ==============================================================================
# Playbook: install-nexus.yml
# Purpose: Install Nexus Repository Manager as Docker container on DevOps machine
# Run: ansible-playbook playbooks/install-nexus.yml
# ==============================================================================

- name: Install Nexus Repository on DevOps machine
  hosts: devops
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 0a. Sync system clock (fix certificate validation errors)
    # ------------------------------------------------------------------
    - name: Install NTP tools
      apt:
        name:
          - chrony
          - ntpdate
        state: present
        update_cache: no
      ignore_errors: yes

    - name: Synchronize system clock
      command: ntpdate -u pool.ntp.org
      ignore_errors: yes

    - name: Set timezone to UTC
      command: timedatectl set-timezone UTC
      ignore_errors: yes

    # ------------------------------------------------------------------
    # 0. Wait for any existing apt operations to complete
    # ------------------------------------------------------------------
    - name: Wait for apt lock to be released
      shell: while sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 1; done
      timeout: 300

    # ------------------------------------------------------------------
    # 1. Install docker Python module (required for Ansible docker modules)
    # ------------------------------------------------------------------
    - name: Install pip3
      apt:
        name: python3-pip
        state: present
        update_cache: yes

    - name: Install Docker SDK for Python
      pip:
        name: docker
        state: present

    # ------------------------------------------------------------------
    # 2. Create Nexus data directory
    # ------------------------------------------------------------------
    - name: Create Nexus data directory
      file:
        path: /opt/nexus-data
        state: directory
        owner: "200"
        group: "200"
        mode: '0755'

    # ------------------------------------------------------------------
    # 3. Pull and run Nexus container
    # ------------------------------------------------------------------
    - name: Pull Nexus Docker image
      docker_image:
        name: sonatype/nexus3
        tag: latest
        source: pull

    - name: Run Nexus container
      docker_container:
        name: nexus
        image: sonatype/nexus3:latest
        state: started
        restart_policy: always
        ports:
          - "8081:8081"    # Nexus Web UI
          - "8082:8082"    # Docker Registry (hosted)
        volumes:
          - "/opt/nexus-data:/nexus-data"
        env:
          INSTALL4J_ADD_VM_PARAMS: "-Xms512m -Xmx512m -XX:MaxDirectMemorySize=512m"

    # ------------------------------------------------------------------
    # 3. Wait for Nexus to be ready
    # ------------------------------------------------------------------
    - name: Wait for Nexus to start (may take 2-3 minutes)
      uri:
        url: http://localhost:8081/service/rest/v1/status
        method: GET
        status_code: 200
      register: nexus_status
      until: nexus_status.status == 200
      retries: 30
      delay: 10

    # ------------------------------------------------------------------
    # 4. Get Nexus admin password
    # ------------------------------------------------------------------
    - name: Get Nexus initial admin password
      command: docker exec nexus cat /nexus-data/admin.password
      register: nexus_password
      ignore_errors: yes

    - name: Display Nexus access information
      debug:
        msg: |
          ============================================
          Nexus Repository Manager is running!
          Web UI:          http://192.168.56.20:8081
          Docker Registry: http://192.168.56.20:8082
          Username:        admin
          Password:        {{ nexus_password.stdout | default('Check /opt/nexus-data/admin.password') }}
          ============================================
          
          IMPORTANT: After first login, you must:
          1. Change the admin password
          2. Create a Docker (hosted) repository:
             - Go to Settings > Repositories > Create Repository
             - Select "docker (hosted)"
             - Name: docker-hosted
             - HTTP port: 8082
             - Enable "Allow anonymous docker pull"
             - Click "Create repository"
          ============================================
```

---

## 12. Playbook 11: setup-nfs-server.yml

File: [ansible/playbooks/setup-nfs-server.yml](ansible/playbooks/setup-nfs-server.yml)

Purpose: Configure NFS server on k8s-master for Jenkins and shared data.

Runs on: masters.

Key parts:
- Installs NFS server packages.
- Creates /srv/nfs/jenkins and /srv/nfs/data.
- Writes /etc/exports and restarts NFS.
- Verifies exports.

```yaml
---
# ==============================================================================
# Playbook: setup-nfs-server.yml
# Purpose: Install and configure NFS server on k8s-master
# Run: ansible-playbook playbooks/setup-nfs-server.yml
# ==============================================================================
# Creates two NFS exports:
#   /srv/nfs/jenkins  - Jenkins home directory (persistent storage)
#   /srv/nfs/data     - General purpose shared storage
# ==============================================================================

- name: Setup NFS Server on Kubernetes Master
  hosts: masters
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Install NFS server packages
    # ------------------------------------------------------------------
    - name: Install NFS server packages
      apt:
        name:
          - nfs-kernel-server
          - nfs-common
        state: present
        update_cache: yes

    # ------------------------------------------------------------------
    # 2. Create NFS export directories
    # ------------------------------------------------------------------
    - name: Create Jenkins NFS directory
      file:
        path: /srv/nfs/jenkins
        state: directory
        owner: "1000"
        group: "1000"
        mode: '0755'
        recurse: yes

    - name: Create general data NFS directory
      file:
        path: /srv/nfs/data
        state: directory
        owner: nobody
        group: nogroup
        mode: '0777'
        recurse: yes

    # ------------------------------------------------------------------
    # 3. Configure NFS exports
    # ------------------------------------------------------------------
    - name: Configure NFS exports
      copy:
        dest: /etc/exports
        content: |
          # NFS Exports for Kubernetes Cluster
          # Jenkins home directory - accessible by all nodes in the subnet
          /srv/nfs/jenkins  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
          # General purpose shared data
          /srv/nfs/data     192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
      notify: restart nfs

    # ------------------------------------------------------------------
    # 4. Export the NFS shares
    # ------------------------------------------------------------------
    - name: Export NFS shares
      command: exportfs -rav
      changed_when: true

    # ------------------------------------------------------------------
    # 5. Start and enable NFS server
    # ------------------------------------------------------------------
    - name: Start and enable NFS server
      systemd:
        name: nfs-kernel-server
        state: started
        enabled: yes

    # ------------------------------------------------------------------
    # 6. Verify exports
    # ------------------------------------------------------------------
    - name: Verify NFS exports
      command: showmount -e localhost
      register: nfs_exports

    - name: Display NFS exports
      debug:
        msg: |
          ============================================
          NFS Server configured on k8s-master!
          Exports:
          {{ nfs_exports.stdout }}
          ============================================
          Clients can mount:
            mount -t nfs 192.168.56.10:/srv/nfs/jenkins /mnt
            mount -t nfs 192.168.56.10:/srv/nfs/data /mnt
          ============================================

  handlers:
    - name: restart nfs
      systemd:
        name: nfs-kernel-server
        state: restarted
```

---

## 13. Playbook 12: setup-nfs-postgres.yml

File: [ansible/playbooks/setup-nfs-postgres.yml](ansible/playbooks/setup-nfs-postgres.yml)

Purpose: Add /srv/nfs/postgres export for Postgres PVCs.

Runs on: masters.

Key parts:
- Creates /srv/nfs/postgres with UID 70.
- Adds export line to /etc/exports.
- Re-exports and verifies.

```yaml
---
# ==============================================================================
# Playbook: setup-nfs-postgres.yml
# Purpose: Create PostgreSQL NFS directory and add to NFS exports on k8s-master
# Run: ansible-playbook playbooks/setup-nfs-postgres.yml
# ==============================================================================
# Adds /srv/nfs/postgres to NFS exports so PostgreSQL pods in the fullstack
# namespace can persist data across pod restarts via PV/PVC.
# ==============================================================================

- name: Setup NFS directory for PostgreSQL on Kubernetes Master
  hosts: masters
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Create PostgreSQL NFS directory
    # ------------------------------------------------------------------
    - name: Create PostgreSQL NFS directory
      file:
        path: /srv/nfs/postgres
        state: directory
        owner: "70"        # PostgreSQL runs as UID 70 in postgres:15-alpine
        group: "70"
        mode: '0700'
        recurse: yes

    # ------------------------------------------------------------------
    # 2. Add PostgreSQL export to /etc/exports (idempotent)
    # ------------------------------------------------------------------
    - name: Check if PostgreSQL export already exists
      command: grep -q '/srv/nfs/postgres' /etc/exports
      register: export_check
      ignore_errors: yes
      changed_when: false

    - name: Add PostgreSQL NFS export
      lineinfile:
        path: /etc/exports
        line: "/srv/nfs/postgres  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)"
        state: present
      when: export_check.rc != 0
      notify: restart nfs

    # ------------------------------------------------------------------
    # 3. Re-export all NFS shares
    # ------------------------------------------------------------------
    - name: Export NFS shares
      command: exportfs -rav
      changed_when: true

    # ------------------------------------------------------------------
    # 4. Verify exports
    # ------------------------------------------------------------------
    - name: Verify NFS exports
      command: showmount -e localhost
      register: nfs_exports

    - name: Display NFS exports
      debug:
        msg: |
          ============================================
          PostgreSQL NFS directory configured!
          Exports:
          {{ nfs_exports.stdout }}
          ============================================
          New mount point available:
            mount -t nfs 192.168.56.10:/srv/nfs/postgres /mnt
          ============================================

  handlers:
    - name: restart nfs
      systemd:
        name: nfs-kernel-server
        state: restarted
```

---

## 14. Playbook 13: setup-nfs-clients.yml

File: [ansible/playbooks/setup-nfs-clients.yml](ansible/playbooks/setup-nfs-clients.yml)

Purpose: Install NFS client packages on workers and devops.

Runs on: workers and devops_servers.

Key parts:
- Installs nfs-common.
- Tests showmount to master.

```yaml
---
# ==============================================================================
# Playbook: setup-nfs-clients.yml
# Purpose: Install NFS client on worker nodes and DevOps machine
# Run: ansible-playbook playbooks/setup-nfs-clients.yml
# ==============================================================================
# Workers need NFS client so Kubernetes can mount NFS PersistentVolumes.
# DevOps needs it for optional manual mounting.
# ==============================================================================

- name: Setup NFS Clients on Worker Nodes and DevOps
  hosts: workers:devops_servers
  become: yes
  tasks:

    # ------------------------------------------------------------------
    # 1. Install NFS client packages
    # ------------------------------------------------------------------
    - name: Install NFS client packages
      apt:
        name:
          - nfs-common
        state: present
        update_cache: yes

    # ------------------------------------------------------------------
    # 2. Test NFS connectivity to master
    # ------------------------------------------------------------------
    - name: Test NFS server reachability
      command: showmount -e 192.168.56.10
      register: nfs_test
      ignore_errors: yes

    - name: Display NFS test results
      debug:
        msg: |
          NFS server exports visible from {{ inventory_hostname }}:
          {{ nfs_test.stdout | default('Could not reach NFS server') }}
      when: nfs_test is defined
```

---

## 15. Kubernetes Manifests Overview

The manifests under [kubernetes](kubernetes) define workloads, services, namespaces, RBAC, and storage. Each section below explains one manifest file.

---

## 16. Manifest 1: deployment.yml

File: [kubernetes/deployment.yml](kubernetes/deployment.yml)

Purpose: Deploy the sample hello-devops app with 2 replicas from Nexus.

Key parts:
- Deployment with replica count, labels, and selectors.
- Container image pulled from Nexus and resource limits.
- imagePullSecrets for registry auth.

```yaml
---
# ==============================================================================
# Kubernetes Deployment - Sample Application
# Deploys 2 replicas from Nexus private Docker registry
# ==============================================================================

apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-devops
  labels:
    app: hello-devops
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hello-devops
  template:
    metadata:
      labels:
        app: hello-devops
    spec:
      containers:
        - name: hello-devops
          image: 192.168.56.20:8082/hello-devops:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              memory: "64Mi"
              cpu: "100m"
            limits:
              memory: "128Mi"
              cpu: "250m"
      imagePullSecrets:
        - name: nexus-registry-secret
```

---

## 17. Manifest 2: service.yml

File: [kubernetes/service.yml](kubernetes/service.yml)

Purpose: Expose hello-devops via NodePort 30080.

Key parts:
- NodePort service targets pods with app=hello-devops.

```yaml
---
# ==============================================================================
# Kubernetes Service - Expose app via NodePort
# Access at: http://<any-node-ip>:30080
# ==============================================================================

apiVersion: v1
kind: Service
metadata:
  name: hello-devops-service
  labels:
    app: hello-devops
spec:
  type: NodePort
  selector:
    app: hello-devops
  ports:
    - protocol: TCP
      port: 3000          # Internal cluster port
      targetPort: 3000     # Container port
      nodePort: 30080      # External access port
```

---

## 18. Manifest 3: nexus-secret.yml

File: [kubernetes/nexus-secret.yml](kubernetes/nexus-secret.yml)

Purpose: Template showing how to create a Docker registry secret for Nexus.

Key parts:
- Contains instructions to create the secret via kubectl.
- Example structure for kubernetes.io/dockerconfigjson.

```yaml
---
# ==============================================================================
# Kubernetes Secret - Docker Registry Credentials for Nexus
# ==============================================================================
# 
# DO NOT apply this file directly. Instead, create the secret using kubectl:
#
#   kubectl create secret docker-registry nexus-registry-secret \
#     --docker-server=192.168.56.20:8082 \
#     --docker-username=admin \
#     --docker-password=YOUR_NEXUS_PASSWORD \
#     --docker-email=admin@example.com
#
# This file is a reference template showing the expected structure.
# ==============================================================================

apiVersion: v1
kind: Secret
metadata:
  name: nexus-registry-secret
type: kubernetes.io/dockerconfigjson
data:
  # Base64-encoded Docker config JSON
  # Replace with actual value generated by kubectl create secret command
  .dockerconfigjson: <BASE64_ENCODED_DOCKER_CONFIG>
```

---

## 19. Manifest 4: gitea-external-service.yml

File: [kubernetes/gitea/gitea-external-service.yml](kubernetes/gitea/gitea-external-service.yml)

Purpose: Provide a Kubernetes DNS entry for Gitea running on the devops VM.

Key parts:
- Creates gitea namespace.
- Creates a Service without selector.
- Creates Endpoints that point to 192.168.56.20.

```yaml
# ==============================================================================
# Gitea External Service
# Purpose: Create a Kubernetes DNS entry for Gitea running on the DevOps machine
# This allows pods to reach Gitea via:
#   http://gitea.gitea.svc.cluster.local:3000
# instead of using the raw IP 192.168.56.20
# ==============================================================================

apiVersion: v1
kind: Namespace
metadata:
  name: gitea

---

# Service without a selector - we manually define the Endpoints below
apiVersion: v1
kind: Service
metadata:
  name: gitea
  namespace: gitea
spec:
  ports:
    - name: http
      port: 3000
      targetPort: 3000
      protocol: TCP

---

# Manual Endpoints pointing to the real DevOps machine IP
apiVersion: v1
kind: Endpoints
metadata:
  name: gitea
  namespace: gitea
subsets:
  - addresses:
      - ip: 192.168.56.20
    ports:
      - name: http
        port: 3000
        protocol: TCP
```

---

## 20. Manifest 5: jenkins/namespace.yml

File: [kubernetes/jenkins/namespace.yml](kubernetes/jenkins/namespace.yml)

Purpose: Create a dedicated namespace for Jenkins.

```yaml
---
# ==============================================================================
# Jenkins Namespace
# Isolates all Jenkins resources in a dedicated namespace
# ==============================================================================

apiVersion: v1
kind: Namespace
metadata:
  name: jenkins
  labels:
    app: jenkins
    purpose: ci-cd
```

---

## 21. Manifest 6: jenkins/deployment.yml

File: [kubernetes/jenkins/deployment.yml](kubernetes/jenkins/deployment.yml)

Purpose: Run Jenkins controller with a DinD sidecar and NFS-backed storage.

Key parts:
- Node affinity avoids scheduling on control-plane.
- Init container installs docker and kubectl into a shared volume.
- Jenkins container uses DOCKER_HOST to talk to DinD.
- DinD sidecar runs privileged and stores /var/lib/docker in emptyDir.
- Jenkins home uses a PVC backed by NFS.

```yaml
---
# ==============================================================================
# Jenkins Deployment with Docker-in-Docker (DinD) Sidecar
# Runs Jenkins controller as a pod on worker nodes
# ==============================================================================
# Architecture:
#   - Jenkins container: CI/CD controller (UI + pipeline execution)
#   - DinD sidecar: Docker daemon for building/pushing images
#   - NFS volume: Persistent Jenkins home directory on k8s-master
# ==============================================================================

apiVersion: apps/v1
kind: Deployment
metadata:
  name: jenkins
  namespace: jenkins
  labels:
    app: jenkins
spec:
  replicas: 1
  selector:
    matchLabels:
      app: jenkins
  template:
    metadata:
      labels:
        app: jenkins
    spec:
      serviceAccountName: jenkins

      # Schedule on worker nodes only (not master)
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node-role.kubernetes.io/control-plane
                    operator: DoesNotExist

      # ============================================================
      # Init Container: Copy Docker CLI into shared volume
      # so Jenkins container can run docker commands against DinD
      # ============================================================
      initContainers:
        - name: install-docker-cli
          image: docker:latest
          command:
            - sh
            - -c
            - |
              cp /usr/local/bin/docker /docker-bin/docker
              wget -qO /docker-bin/kubectl https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl
              chmod +x /docker-bin/kubectl
          volumeMounts:
            - name: docker-bin
              mountPath: /docker-bin

      containers:
        # ============================================================
        # Jenkins Controller Container
        # ============================================================
        - name: jenkins
          image: jenkins/jenkins:lts-jdk17
          ports:
            - name: http
              containerPort: 8080
            - name: agent
              containerPort: 50000
          env:
            # Tell Jenkins to use the DinD sidecar for Docker
            - name: DOCKER_HOST
              value: "tcp://localhost:2375"
            # Java memory settings (conservative for 2GB worker)
            - name: JAVA_OPTS
              value: "-Xms256m -Xmx512m"
          volumeMounts:
            - name: jenkins-home
              mountPath: /var/jenkins_home
            - name: docker-bin
              mountPath: /usr/local/bin/docker
              subPath: docker
            - name: docker-bin
              mountPath: /usr/local/bin/kubectl
              subPath: kubectl
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          # Liveness probe - Jenkins takes time to start
          livenessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 120
            periodSeconds: 30
            timeoutSeconds: 10
            failureThreshold: 5
          # Readiness probe
          readinessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 90
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3

        # ============================================================
        # Docker-in-Docker (DinD) Sidecar Container
        # Provides a Docker daemon for Jenkins to build images
        # ============================================================
        - name: dind
          image: docker:dind
          command: ["dockerd-entrypoint.sh"]
          args:
            - "--insecure-registry"
            - "192.168.56.20:8082"
          securityContext:
            privileged: true
          env:
            # Disable TLS for simplicity (internal pod communication)
            - name: DOCKER_TLS_CERTDIR
              value: ""
          volumeMounts:
            - name: docker-storage
              mountPath: /var/lib/docker
          resources:
            requests:
              memory: "256Mi"
              cpu: "200m"
            limits:
              memory: "512Mi"
              cpu: "500m"

      volumes:
        # Jenkins home directory - NFS backed for persistence
        - name: jenkins-home
          persistentVolumeClaim:
            claimName: jenkins-pvc
        # Docker storage for DinD (ephemeral, lost on pod restart)
        - name: docker-storage
          emptyDir: {}
        # Shared volume for Docker CLI binary (populated by init container)
        - name: docker-bin
          emptyDir: {}
```

---

## 22. Manifest 7: jenkins/service.yml

File: [kubernetes/jenkins/service.yml](kubernetes/jenkins/service.yml)

Purpose: Expose Jenkins UI and agent ports via NodePort.

```yaml
---
# ==============================================================================
# Jenkins Service - NodePort
# Exposes Jenkins Web UI and Agent communication ports
# ==============================================================================
# Access from browser:
#   http://192.168.56.11:32000  (via k8s-worker1)
#   http://192.168.56.12:32000  (via k8s-worker2)
# ==============================================================================

apiVersion: v1
kind: Service
metadata:
  name: jenkins-service
  namespace: jenkins
  labels:
    app: jenkins
spec:
  type: NodePort
  selector:
    app: jenkins
  ports:
    # Jenkins Web UI
    - name: http
      protocol: TCP
      port: 8080
      targetPort: 8080
      nodePort: 32000
    # Jenkins Agent communication
    - name: agent
      protocol: TCP
      port: 50000
      targetPort: 50000
      nodePort: 32001
```

---

## 23. Manifest 8: jenkins/rbac.yml

File: [kubernetes/jenkins/rbac.yml](kubernetes/jenkins/rbac.yml)

Purpose: Grant Jenkins permissions to manage deployments, pods, services, and more.

```yaml
---
# ==============================================================================
# Jenkins RBAC - ServiceAccount, ClusterRole, ClusterRoleBinding
# Grants Jenkins pod permissions to manage K8s resources
# ==============================================================================

# 1. ServiceAccount for Jenkins
apiVersion: v1
kind: ServiceAccount
metadata:
  name: jenkins
  namespace: jenkins
  labels:
    app: jenkins

---
# 2. ClusterRole with required permissions
# Jenkins needs to manage deployments, services, pods, secrets
# across all namespaces (to deploy apps to 'default' namespace)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: jenkins-cluster-role
  labels:
    app: jenkins
rules:
  # Pod management (for Jenkins agents and app pods)
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Service management
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Deployment management
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Secret management (for registry credentials)
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # ConfigMap management
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Namespace listing
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "watch"]
  # Events (for debugging deployments)
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
  # PersistentVolumeClaims
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Nodes (for kubectl get nodes)
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]

---
# 3. ClusterRoleBinding - bind the role to the service account
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: jenkins-cluster-role-binding
  labels:
    app: jenkins
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: jenkins-cluster-role
subjects:
  - kind: ServiceAccount
    name: jenkins
    namespace: jenkins
```

---

## 24. Manifest 9: jenkins/nfs-pv-pvc.yml

File: [kubernetes/jenkins/nfs-pv-pvc.yml](kubernetes/jenkins/nfs-pv-pvc.yml)

Purpose: Provide NFS-backed storage for Jenkins home.

```yaml
---
# ==============================================================================
# Jenkins NFS PersistentVolume and PersistentVolumeClaim
# Provides persistent storage for Jenkins home directory via NFS on k8s-master
# ==============================================================================

# 1. PersistentVolume - backed by NFS on k8s-master
apiVersion: v1
kind: PersistentVolume
metadata:
  name: jenkins-pv
  labels:
    app: jenkins
    type: nfs
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/jenkins

---
# 2. PersistentVolumeClaim - used by Jenkins Deployment
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: jenkins-pvc
  namespace: jenkins
  labels:
    app: jenkins
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  selector:
    matchLabels:
      type: nfs
```

---

## 25. Manifest 10: fullstack/namespace.yml

File: [kubernetes/fullstack/namespace.yml](kubernetes/fullstack/namespace.yml)

Purpose: Create the fullstack namespace with pod security labels.

```yaml
---
# ==============================================================================
# Kubernetes Namespace - fullstack
# Isolates all Task Manager resources from other workloads
# ==============================================================================

apiVersion: v1
kind: Namespace
metadata:
  name: fullstack
  labels:
    app: task-manager
    project: fullstack
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/warn: baseline
    pod-security.kubernetes.io/audit: baseline
```

---

## 26. Manifest 11: fullstack/backend-deployment.yml

File: [kubernetes/fullstack/backend-deployment.yml](kubernetes/fullstack/backend-deployment.yml)

Purpose: Deploy the backend API with environment variables and probes.

Key parts:
- Two replicas and health probes.
- Uses Nexus image and imagePullSecrets.
- Uses service account for least privilege.

```yaml
---
# ==============================================================================
# Backend Deployment - fullstack namespace
# Express.js API, 2 replicas, pulls image from Nexus registry
# ==============================================================================

apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: fullstack
  labels:
    app: backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: backend
          image: 192.168.56.20:8082/fullstack-backend:latest
          ports:
            - containerPort: 5000
          env:
            - name: PG_HOST
              value: "postgres-service"
            - name: PG_PORT
              value: "5432"
            - name: PG_DB
              value: "formdb"
            - name: PG_USER
              value: "formuser"
            - name: PG_PASSWORD
              value: "formpassword"
            - name: PORT
              value: "5000"
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "200m"
          livenessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 45
            periodSeconds: 20
            timeoutSeconds: 5
          readinessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
      imagePullSecrets:
        - name: nexus-registry-secret
```

---

## 27. Manifest 12: fullstack/backend-service.yml

File: [kubernetes/fullstack/backend-service.yml](kubernetes/fullstack/backend-service.yml)

Purpose: Internal ClusterIP service for backend.

```yaml
---
# ==============================================================================
# Backend Service - ClusterIP (internal only)
# Accessed by the frontend Nginx reverse proxy at backend-service:5000
# ==============================================================================

apiVersion: v1
kind: Service
metadata:
  name: backend-service
  namespace: fullstack
  labels:
    app: backend
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - protocol: TCP
      port: 5000
      targetPort: 5000
```

---

## 28. Manifest 13: fullstack/frontend-deployment.yml

File: [kubernetes/fullstack/frontend-deployment.yml](kubernetes/fullstack/frontend-deployment.yml)

Purpose: Deploy the frontend Nginx app with probes.

```yaml
---
# ==============================================================================
# Frontend Deployment - fullstack namespace
# Nginx serving static files + reverse proxy, 2 replicas from Nexus
# ==============================================================================

apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: fullstack
  labels:
    app: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: frontend
          image: 192.168.56.20:8082/fullstack-frontend:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "32Mi"
              cpu: "25m"
            limits:
              memory: "64Mi"
              cpu: "100m"
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
      imagePullSecrets:
        - name: nexus-registry-secret
```

---

## 29. Manifest 14: fullstack/frontend-service.yml

File: [kubernetes/fullstack/frontend-service.yml](kubernetes/fullstack/frontend-service.yml)

Purpose: Expose frontend via NodePort 30090.

```yaml
---
# ==============================================================================
# Frontend Service - NodePort (public entry point)
# Access the Task Manager UI at: http://<any-node-ip>:30090
# ==============================================================================

apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  namespace: fullstack
  labels:
    app: frontend
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
    - protocol: TCP
      port: 80            # Internal cluster port
      targetPort: 80       # Container port
      nodePort: 30090      # External access port
```

---

## 30. Manifest 15: fullstack/postgres-deployment.yml

File: [kubernetes/fullstack/postgres-deployment.yml](kubernetes/fullstack/postgres-deployment.yml)

Purpose: Run PostgreSQL with NFS-backed persistent storage.

```yaml
---
# ==============================================================================
# PostgreSQL Deployment - fullstack namespace
# Single replica with NFS-backed persistent storage
# Credentials stored in environment variables (use K8s Secret in production)
# ==============================================================================

apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: fullstack
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: "formdb"
            - name: POSTGRES_USER
              value: "formuser"
            - name: POSTGRES_PASSWORD
              value: "formpassword"
          volumeMounts:
            - name: pg-storage
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "300m"
      volumes:
        - name: pg-storage
          persistentVolumeClaim:
            claimName: postgres-pvc
```

---

## 31. Manifest 16: fullstack/postgres-service.yml

File: [kubernetes/fullstack/postgres-service.yml](kubernetes/fullstack/postgres-service.yml)

Purpose: Internal ClusterIP service for Postgres.

```yaml
---
# ==============================================================================
# PostgreSQL Service - ClusterIP (internal only)
# Accessible within the cluster at postgres-service:5432
# ==============================================================================

apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: fullstack
  labels:
    app: postgres
spec:
  type: ClusterIP
  selector:
    app: postgres
  ports:
    - protocol: TCP
      port: 5432
      targetPort: 5432
```

---

## 32. Manifest 17: fullstack/postgres-nfs-pv-pvc.yml

File: [kubernetes/fullstack/postgres-nfs-pv-pvc.yml](kubernetes/fullstack/postgres-nfs-pv-pvc.yml)

Purpose: NFS-backed PV and PVC for Postgres data.

```yaml
---
# ==============================================================================
# PostgreSQL NFS PersistentVolume and PersistentVolumeClaim
# Provides persistent storage for PostgreSQL data via NFS on k8s-master
# ==============================================================================

# 1. PersistentVolume - NFS-backed on k8s-master
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgres-pv
  labels:
    app: postgres
    type: nfs
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/postgres

---
# 2. PersistentVolumeClaim - used by PostgreSQL Deployment
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: fullstack
  labels:
    app: postgres
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  selector:
    matchLabels:
      type: nfs
```

---

## 33. Manifest 18: fullstack/security-network-policies.yml

File: [kubernetes/fullstack/security-network-policies.yml](kubernetes/fullstack/security-network-policies.yml)

Purpose: Enforce least-privilege network traffic in the fullstack namespace.

Key parts:
- Default deny all ingress and egress.
- Allow DNS egress to kube-system.
- Allow frontend to backend, backend to postgres.

```yaml
---
# ==============================================================================
# Network Policies for fullstack namespace
# Limits communication between pods to ONLY what is necessary
# ==============================================================================

# 1. Default Deny All Policy
# Blocks all ingress and egress traffic by default in this namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: fullstack
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
# 2. Allow DNS Resolution (Essential for Egress)
# Allows pods to talk to CoreDNS to resolve service names
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: fullstack
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
# 3. Frontend Policy
# Ingress: Allow all external traffic
# Egress: Allow traffic to Backend on port 5000
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - {} # Allow from everywhere (NodePort access)
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: backend
      ports:
        - protocol: TCP
          port: 5000
---
# 4. Backend Policy
# Ingress: Allow traffic ONLY from Frontend on port 5000
# Egress: Allow traffic to Postgres on port 5432
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
    - Egress
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
---
# 5. Postgres Policy
# Ingress: Allow traffic ONLY from Backend on port 5432
# Egress: Deny all (Database doesn't need to initiate external requests)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: backend
      ports:
        - protocol: TCP
          port: 5432
```

---

## 34. Manifest 19: fullstack/security-rbac.yml

File: [kubernetes/fullstack/security-rbac.yml](kubernetes/fullstack/security-rbac.yml)

Purpose: Create least-privilege RBAC for the fullstack app.

```yaml
---
# ==============================================================================
# RBAC for fullstack namespace
# Limits the permissions of the application pods
# ==============================================================================

# 1. Create a dedicated ServiceAccount (instead of using 'default')
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fullstack-app-sa
  namespace: fullstack
---
# 2. Create a Role with minimal read-only permissions
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: fullstack-app-role
  namespace: fullstack
rules:
  - apiGroups: [""]
    resources: ["pods", "endpoints", "services"]
    verbs: ["get", "list", "watch"]
---
# 3. Bind the Role to the ServiceAccount
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: fullstack-app-rolebinding
  namespace: fullstack
subjects:
  - kind: ServiceAccount
    name: fullstack-app-sa
    namespace: fullstack
roleRef:
  kind: Role
  name: fullstack-app-role
  apiGroup: rbac.authorization.k8s.io
```

### [ansible/playbooks/install-kubernetes.yml](ansible/playbooks/install-kubernetes.yml)

Bloc "Create keyrings directory": cree le dossier pour les cles APT.

Bloc "Download Kubernetes GPG key": installe la cle de signature des paquets Kubernetes.

Bloc "Add Kubernetes APT repository": ajoute le depot Kubernetes stable.

Bloc "Update apt cache": met a jour le cache APT.

Bloc "Install Kubernetes packages": installe kubelet, kubeadm et kubectl.

Bloc "Hold Kubernetes packages at current version": bloque les versions pour eviter les mises a jour automatiques.

Bloc "Enable and start kubelet": demarre et active kubelet.

```yaml
- name: Install Kubernetes components
  hosts: k8s_cluster
  become: yes
  vars:
    kube_version: "1.29"
  tasks:
    - name: Create keyrings directory
      file:
        path: /etc/apt/keyrings
        state: directory
        mode: '0755'

    - name: Download Kubernetes GPG key
      shell: |
        curl -fsSL https://pkgs.k8s.io/core:/stable:/v{{ kube_version }}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
      args:
        creates: /etc/apt/keyrings/kubernetes-apt-keyring.gpg

    - name: Add Kubernetes APT repository
      apt_repository:
        repo: "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v{{ kube_version }}/deb/ /"
        state: present
        filename: kubernetes

    - name: Update apt cache
      apt:
        update_cache: yes

    - name: Install Kubernetes packages
      apt:
        name:
          - kubelet
          - kubeadm
          - kubectl
        state: present

    - name: Hold Kubernetes packages at current version
      dpkg_selections:
        name: "{{ item }}"
        selection: hold
      loop:
        - kubelet
        - kubeadm
        - kubectl

    - name: Enable and start kubelet
      systemd:
        name: kubelet
        enabled: yes
        state: started
```

### [ansible/playbooks/init-master.yml](ansible/playbooks/init-master.yml)

Bloc "Check if kubeadm has already been initialized": verifie si le control plane est deja initialise.

Bloc "Initialize Kubernetes cluster with kubeadm": lance le bootstrap kubeadm.

Bloc "Create .kube directory for vagrant user": prepare le dossier kubeconfig pour vagrant.

Bloc "Copy admin.conf to vagrant user kubeconfig": donne l acces kubectl a vagrant.

Bloc "Create .kube directory for root": prepare le dossier kubeconfig pour root.

Bloc "Copy admin.conf to root kubeconfig": donne l acces kubectl a root.

Bloc "Download Calico manifest": telecharge le manifest Calico.

Bloc "Apply Calico CNI": applique Calico dans le cluster.

Bloc "Generate kubeadm join command": genere la commande pour joindre les workers.

Bloc "Save join command to file": enregistre la commande de join.

Bloc "Store join command as fact": expose la commande comme fact Ansible.

```yaml
- name: Initialize Kubernetes Master Node
  hosts: masters
  become: yes
  tasks:
    - name: Check if kubeadm has already been initialized
      stat:
        path: /etc/kubernetes/admin.conf
      register: kubeadm_init_check

    - name: Initialize Kubernetes cluster with kubeadm
      command: >
        kubeadm init
        --apiserver-advertise-address=192.168.56.10
        --pod-network-cidr=192.168.0.0/16
        --node-name=k8s-master
      when: not kubeadm_init_check.stat.exists
      register: kubeadm_output

    - name: Create .kube directory for vagrant user
      file:
        path: /home/vagrant/.kube
        state: directory
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Copy admin.conf to vagrant user kubeconfig
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /home/vagrant/.kube/config
        remote_src: yes
        owner: vagrant
        group: vagrant
        mode: '0644'

    - name: Create .kube directory for root
      file:
        path: /root/.kube
        state: directory
        mode: '0755'

    - name: Copy admin.conf to root kubeconfig
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /root/.kube/config
        remote_src: yes
        mode: '0644'

    - name: Download Calico manifest
      get_url:
        url: https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml
        dest: /home/vagrant/calico.yaml
        owner: vagrant
        group: vagrant

    - name: Apply Calico CNI
      become_user: vagrant
      command: kubectl apply -f /home/vagrant/calico.yaml
      environment:
        KUBECONFIG: /home/vagrant/.kube/config

    - name: Generate kubeadm join command
      command: kubeadm token create --print-join-command
      register: join_command

    - name: Save join command to file
      copy:
        content: "{{ join_command.stdout }}"
        dest: /home/vagrant/join-command.sh
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Store join command as fact
      set_fact:
        kubernetes_join_command: "{{ join_command.stdout }}"
```

### [ansible/playbooks/join-workers.yml](ansible/playbooks/join-workers.yml)

Bloc "Get join command": genere la commande de join depuis le master.

Bloc "Set join command fact": expose la commande aux workers.

Bloc "Check if node is already part of a cluster": verifie si le worker est deja joint.

Bloc "Join node to Kubernetes cluster": joint le worker si besoin.

Bloc "Ensure kubelet is running": demarre et active kubelet sur les workers.

```yaml
- name: Get join command from master
  hosts: masters
  become: yes
  tasks:
    - name: Get join command
      command: kubeadm token create --print-join-command
      register: join_command_raw

    - name: Set join command fact
      set_fact:
        join_command: "{{ join_command_raw.stdout }}"

- name: Join worker nodes to the cluster
  hosts: workers
  become: yes
  tasks:
    - name: Check if node is already part of a cluster
      stat:
        path: /etc/kubernetes/kubelet.conf
      register: kubelet_conf

    - name: Join node to Kubernetes cluster
      command: "{{ hostvars['k8s-master']['join_command'] }}"
      when: not kubelet_conf.stat.exists

    - name: Ensure kubelet is running
      systemd:
        name: kubelet
        state: started
        enabled: yes
```

### [ansible/playbooks/configure-insecure-registry.yml](ansible/playbooks/configure-insecure-registry.yml)

Bloc "Remove old NEXUS INSECURE REGISTRY block": nettoie l ancienne configuration containerd.

Bloc "Remove orphaned grpc.v1.cri registry section header": supprime l en-tete obsolete.

Bloc "Ensure correct single-path config_path": force l usage du dossier certs.d.

Bloc "Create containerd certs.d directory for Nexus": cree le dossier du registre.

Bloc "Write hosts.toml for Nexus HTTP registry": ecrit la config d acces registry.

Bloc "Create containerd certs.d directory for Nexus Alias IP": duplication de dossier (meme chemin).

Bloc "Write hosts.toml for Nexus HTTP registry Alias IP": duplication de hosts.toml (meme chemin).

Bloc "Check effective config_path in containerd": verifie le parametre effectif.

Bloc "Show effective config_path": affiche le resultat.

Bloc "Restart containerd": redemarre containerd.

Bloc "Wait for containerd to stabilize": attend la stabilisation.

Bloc "Verify containerd is active": verifie le statut.

Bloc "Test image pull from Nexus": teste un pull d image.

Bloc "Display results": affiche les tests.

```yaml
- name: Configure Insecure Registry on K8s Nodes
  hosts: k8s_cluster
  become: yes
  tasks:
    - name: Remove old NEXUS INSECURE REGISTRY block from config.toml
      blockinfile:
        path: /etc/containerd/config.toml
        marker: "# {mark} NEXUS INSECURE REGISTRY"
        state: absent

    - name: Remove orphaned grpc.v1.cri registry section header
      lineinfile:
        path: /etc/containerd/config.toml
        regexp: '^\[plugins\."io\.containerd\.grpc\.v1\.cri"\.registry\]'
        state: absent

    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = ['"'"'].*['"'"']'
        replace: 'config_path = "/etc/containerd/certs.d"'

    - name: Create containerd certs.d directory for Nexus
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'
        recurse: yes

    - name: Write hosts.toml for Nexus HTTP registry
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
        mode: '0644'

    - name: Create containerd certs.d directory for Nexus Alias IP
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'
        recurse: yes

    - name: Write hosts.toml for Nexus HTTP registry Alias IP
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
        mode: '0644'

    - name: Check effective config_path in containerd
      shell: containerd config dump 2>/dev/null | grep 'config_path' | grep 'certs.d' | head -1
      register: config_dump_check
      changed_when: false
      ignore_errors: yes

    - name: Show effective config_path
      debug:
        msg: "Effective config_path: {{ config_dump_check.stdout | default('NOT FOUND -- config may need regeneration') }}"

    - name: Restart containerd
      systemd:
        name: containerd
        state: restarted

    - name: Wait for containerd to stabilize
      pause:
        seconds: 10

    - name: Verify containerd is active
      shell: systemctl is-active containerd
      register: containerd_active
      changed_when: false

    - name: Test image pull from Nexus
      shell: |
        crictl --image-endpoint unix:///run/containerd/containerd.sock pull 192.168.56.20:8082/fullstack-backend:latest 2>&1
      register: pull_test
      ignore_errors: yes
      timeout: 30

    - name: Display results
      debug:
        msg: |
          containerd: {{ containerd_active.stdout }}
          config_path: {{ config_dump_check.stdout | default('NOT FOUND') }}
          Pull test: {{ 'SUCCESS' if pull_test.rc == 0 else pull_test.stderr | default(pull_test.stdout | default('FAILED')) }}
```

### [ansible/playbooks/configure-kubectl-devops.yml](ansible/playbooks/configure-kubectl-devops.yml)

Bloc "Read kubeconfig from master": recupere admin.conf depuis le master.

Bloc "Set kubeconfig fact": decode et stocke la config.

Bloc "Create .kube directory for vagrant user": cree le dossier kubeconfig.

Bloc "Write kubeconfig for vagrant user": copie la config pour vagrant.

Bloc "Update API server address in vagrant kubeconfig": pointe vers IP du master.

Bloc "Verify kubectl works from devops": teste l acces kubectl.

Bloc "Display kubectl output": affiche le resultat si OK.

Bloc "Create .kube directory in NFS Jenkins home": prepare le dossier pour Jenkins.

Bloc "Write kubeconfig to NFS Jenkins home": copie admin.conf dans NFS.

Bloc "Update API server address in Jenkins kubeconfig": pointe vers IP du master.

Bloc "Display completion message": resume la configuration.

```yaml
- name: Fetch kubeconfig from master
  hosts: masters
  become: yes
  tasks:
    - name: Read kubeconfig from master
      slurp:
        src: /etc/kubernetes/admin.conf
      register: kubeconfig_content

    - name: Set kubeconfig fact
      set_fact:
        kubeconfig_data: "{{ kubeconfig_content.content | b64decode }}"

- name: Configure kubectl on DevOps machine and NFS
  hosts: devops
  become: yes
  tasks:
    - name: Create .kube directory for vagrant user
      file:
        path: /home/vagrant/.kube
        state: directory
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Write kubeconfig for vagrant user
      copy:
        content: "{{ hostvars['k8s-master']['kubeconfig_data'] }}"
        dest: /home/vagrant/.kube/config
        owner: vagrant
        group: vagrant
        mode: '0600'

    - name: Update API server address in vagrant kubeconfig
      replace:
        path: /home/vagrant/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'

    - name: Verify kubectl works from devops (vagrant)
      become_user: vagrant
      command: kubectl get nodes
      register: kubectl_output
      ignore_errors: yes

    - name: Display kubectl output
      debug:
        msg: "{{ kubectl_output.stdout_lines }}"
      when: kubectl_output.rc == 0

- name: Copy kubeconfig to NFS for Jenkins pod
  hosts: masters
  become: yes
  tasks:
    - name: Create .kube directory in NFS Jenkins home
      file:
        path: /srv/nfs/jenkins/.kube
        state: directory
        owner: "1000"
        group: "1000"
        mode: '0755'

    - name: Write kubeconfig to NFS Jenkins home
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /srv/nfs/jenkins/.kube/config
        remote_src: yes
        owner: "1000"
        group: "1000"
        mode: '0600'

    - name: Update API server address in Jenkins kubeconfig
      replace:
        path: /srv/nfs/jenkins/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'

    - name: Display completion message
      debug:
        msg: |
          ============================================
          kubectl configured for:
          - vagrant@devops: /home/vagrant/.kube/config
          - Jenkins pod (NFS): /srv/nfs/jenkins/.kube/config
          ============================================
```

### [ansible/playbooks/install-jenkins.yml](ansible/playbooks/install-jenkins.yml)

Bloc "Install Java 17 JDK": installe Java requis pour certains outils.

Bloc "Add Docker GPG key": ajoute la cle du depot Docker.

Bloc "Add Docker repository": ajoute le depot Docker.

Bloc "Install Docker": installe Docker et containerd.

Bloc "Start Docker service": active et demarre Docker.

Bloc "Add vagrant user to docker group": autorise Docker sans sudo.

Bloc "Download kubectl binary": installe kubectl sur la machine DevOps.

Bloc "Create Docker daemon.json for insecure registry": configure le registre Nexus en insecure.

Bloc "Display setup information": affiche un resume.

Bloc "restart docker" (handler): redemarre Docker apres changement de config.

```yaml
- name: Install Docker and kubectl on DevOps machine
  hosts: devops
  become: yes
  tasks:
    - name: Install Java 17 JDK # note for me : upgrade for JDK 21 for long term support
      apt:
        name: openjdk-17-jdk
        state: present
        update_cache: yes

    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        state: present
        filename: docker

    - name: Install Docker
      apt:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
        state: present
        update_cache: yes

    - name: Start Docker service
      systemd:
        name: docker
        state: started
        enabled: yes

    - name: Add vagrant user to docker group
      user:
        name: vagrant
        groups: docker
        append: yes

    - name: Download kubectl binary
      get_url:
        url: "https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl"
        dest: /usr/local/bin/kubectl
        mode: '0755'

    - name: Create Docker daemon.json for insecure registry
      copy:
        dest: /etc/docker/daemon.json
        content: |
          {
            "insecure-registries": ["192.168.56.20:8082"]
          }
      notify: restart docker

    - name: Display setup information
      debug:
        msg: |
          ============================================
          DevOps machine setup complete!
          - Docker installed and configured
          - kubectl installed
          - Insecure registry: 192.168.56.20:8082
          ============================================
          NOTE: Jenkins is NOT installed here.
          Jenkins runs as a Kubernetes pod.
          Access Jenkins at: http://<worker-ip>:32000
          ============================================

  handlers:
    - name: restart docker
      systemd:
        name: docker
        state: restarted
```

### [ansible/playbooks/install-gitea.yml](ansible/playbooks/install-gitea.yml)

Bloc "Install required packages (git)": installe Git.

Bloc "Create git user for Gitea": cree l utilisateur systeme git.

Bloc "Create Gitea directories": cree les dossiers de donnees et logs.

Bloc "Create /etc/gitea directory": cree le dossier de configuration.

Bloc "Download Gitea binary": telecharge le binaire Gitea.

Bloc "Download Gitea systemd service file": telecharge l unite systemd.

Bloc "Ensure Gitea service starts on boot and is running": active et demarre Gitea.

```yaml
- name: Install Gitea natively on DevOps Machine
  hosts: devops_servers
  become: yes
  vars:
    gitea_version: "1.21.7"
  tasks:
    - name: Install required packages (git)
      apt:
        name: git
        state: present
        update_cache: yes

    - name: Create git user for Gitea
      user:
        name: git
        system: yes
        shell: /bin/bash
        comment: "Git Version Control"
        create_home: yes
        home: /home/git

    - name: Create Gitea directories
      file:
        path: "{{ item }}"
        state: directory
        owner: git
        group: git
        mode: '0750'
      with_items:
        - /var/lib/gitea
        - /var/lib/gitea/custom
        - /var/lib/gitea/data
        - /var/lib/gitea/data/lfs
        - /var/log/gitea

    - name: Create /etc/gitea directory
      file:
        path: /etc/gitea
        state: directory
        owner: root
        group: git
        mode: '0770'

    - name: Download Gitea binary
      get_url:
        url: "https://dl.gitea.com/gitea/{{ gitea_version }}/gitea-{{ gitea_version }}-linux-amd64"
        dest: /usr/local/bin/gitea
        mode: '0755'

    - name: Download Gitea systemd service file
      get_url:
        url: "https://raw.githubusercontent.com/go-gitea/gitea/main/contrib/systemd/gitea.service"
        dest: /etc/systemd/system/gitea.service

    - name: Ensure Gitea service starts on boot and is running
      systemd:
        name: gitea
        enabled: yes
        state: started
        daemon_reload: yes
```

### [ansible/playbooks/install-nexus.yml](ansible/playbooks/install-nexus.yml)

Bloc "Install NTP tools": installe les outils de synchro horaire.

Bloc "Synchronize system clock": force la mise a l heure.

Bloc "Set timezone to UTC": fixe le fuseau horaire.

Bloc "Wait for apt lock": attend la fin des verrous APT.

Bloc "Install pip3": installe pip.

Bloc "Install Docker SDK for Python": installe le SDK docker pour Ansible.

Bloc "Create Nexus data directory": prepare le volume persistant.

Bloc "Pull Nexus Docker image": telecharge l image Nexus.

Bloc "Run Nexus container": demarre Nexus en conteneur.

Bloc "Wait for Nexus to start": attend la disponibilite.

Bloc "Get Nexus initial admin password": lit le mot de passe initial.

Bloc "Display Nexus access information": affiche les infos d acces.

```yaml
- name: Install Nexus Repository on DevOps machine
  hosts: devops
  become: yes
  tasks:
    - name: Install NTP tools
      apt:
        name:
          - chrony
          - ntpdate
        state: present
        update_cache: no
      ignore_errors: yes

    - name: Synchronize system clock
      command: ntpdate -u pool.ntp.org
      ignore_errors: yes

    - name: Set timezone to UTC
      command: timedatectl set-timezone UTC
      ignore_errors: yes

    - name: Wait for apt lock to be released
      shell: while sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 1; done
      timeout: 300

    - name: Install pip3
      apt:
        name: python3-pip
        state: present
        update_cache: yes

    - name: Install Docker SDK for Python
      pip:
        name: docker
        state: present

    - name: Create Nexus data directory
      file:
        path: /opt/nexus-data
        state: directory
        owner: "200"
        group: "200"
        mode: '0755'

    - name: Pull Nexus Docker image
      docker_image:
        name: sonatype/nexus3
        tag: latest
        source: pull

    - name: Run Nexus container
      docker_container:
        name: nexus
        image: sonatype/nexus3:latest
        state: started
        restart_policy: always
        ports:
          - "8081:8081"
          - "8082:8082"
        volumes:
          - "/opt/nexus-data:/nexus-data"
        env:
          INSTALL4J_ADD_VM_PARAMS: "-Xms512m -Xmx512m -XX:MaxDirectMemorySize=512m"

    - name: Wait for Nexus to start (may take 2-3 minutes)
      uri:
        url: http://localhost:8081/service/rest/v1/status
        method: GET
        status_code: 200
      register: nexus_status
      until: nexus_status.status == 200
      retries: 30
      delay: 10

    - name: Get Nexus initial admin password
      command: docker exec nexus cat /nexus-data/admin.password
      register: nexus_password
      ignore_errors: yes

    - name: Display Nexus access information
      debug:
        msg: |
          ============================================
          Nexus Repository Manager is running!
          Web UI:          http://192.168.56.20:8081
          Docker Registry: http://192.168.56.20:8082
          Username:        admin
          Password:        {{ nexus_password.stdout | default('Check /opt/nexus-data/admin.password') }}
          ============================================
```

### [ansible/playbooks/setup-nfs-server.yml](ansible/playbooks/setup-nfs-server.yml)

Bloc "Install NFS server packages": installe le serveur NFS.

Bloc "Create Jenkins NFS directory": cree le partage Jenkins.

Bloc "Create general data NFS directory": cree un partage general.

Bloc "Configure NFS exports": ecrit /etc/exports.

Bloc "Export NFS shares": applique les exports.

Bloc "Start and enable NFS server": demarre le service NFS.

Bloc "Verify NFS exports": verifie les exports.

Bloc "Display NFS exports": affiche le resume.

Bloc "restart nfs" (handler): redemarre NFS si besoin.

```yaml
- name: Setup NFS Server on Kubernetes Master
  hosts: masters
  become: yes
  tasks:
    - name: Install NFS server packages
      apt:
        name:
          - nfs-kernel-server
          - nfs-common
        state: present
        update_cache: yes

    - name: Create Jenkins NFS directory
      file:
        path: /srv/nfs/jenkins
        state: directory
        owner: "1000"
        group: "1000"
        mode: '0755'
        recurse: yes

    - name: Create general data NFS directory
      file:
        path: /srv/nfs/data
        state: directory
        owner: nobody
        group: nogroup
        mode: '0777'
        recurse: yes

    - name: Configure NFS exports
      copy:
        dest: /etc/exports
        content: |
          # NFS Exports for Kubernetes Cluster
          # Jenkins home directory - accessible by all nodes in the subnet
          /srv/nfs/jenkins  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
          # General purpose shared data
          /srv/nfs/data     192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
      notify: restart nfs

    - name: Export NFS shares
      command: exportfs -rav
      changed_when: true

    - name: Start and enable NFS server
      systemd:
        name: nfs-kernel-server
        state: started
        enabled: yes

    - name: Verify NFS exports
      command: showmount -e localhost
      register: nfs_exports

    - name: Display NFS exports
      debug:
        msg: |
          ============================================
          NFS Server configured on k8s-master!
          Exports:
          {{ nfs_exports.stdout }}
          ============================================
          Clients can mount:
            mount -t nfs 192.168.56.10:/srv/nfs/jenkins /mnt
            mount -t nfs 192.168.56.10:/srv/nfs/data /mnt
          ============================================

  handlers:
    - name: restart nfs
      systemd:
        name: nfs-kernel-server
        state: restarted
```

### [ansible/playbooks/setup-nfs-postgres.yml](ansible/playbooks/setup-nfs-postgres.yml)

Bloc "Create PostgreSQL NFS directory": cree le partage Postgres.

Bloc "Check if PostgreSQL export already exists": verifie l export.

Bloc "Add PostgreSQL NFS export": ajoute l export si absent.

Bloc "Export NFS shares": applique les exports.

Bloc "Verify NFS exports": verifie l export.

Bloc "Display NFS exports": affiche le resume.

Bloc "restart nfs" (handler): redemarre NFS si besoin.

```yaml
- name: Setup NFS directory for PostgreSQL on Kubernetes Master
  hosts: masters
  become: yes
  tasks:
    - name: Create PostgreSQL NFS directory
      file:
        path: /srv/nfs/postgres
        state: directory
        owner: "70"
        group: "70"
        mode: '0700'
        recurse: yes

    - name: Check if PostgreSQL export already exists
      command: grep -q '/srv/nfs/postgres' /etc/exports
      register: export_check
      ignore_errors: yes
      changed_when: false

    - name: Add PostgreSQL NFS export
      lineinfile:
        path: /etc/exports
        line: "/srv/nfs/postgres  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)"
        state: present
      when: export_check.rc != 0
      notify: restart nfs

    - name: Export NFS shares
      command: exportfs -rav
      changed_when: true

    - name: Verify NFS exports
      command: showmount -e localhost
      register: nfs_exports

    - name: Display NFS exports
      debug:
        msg: |
          ============================================
          PostgreSQL NFS directory configured!
          Exports:
          {{ nfs_exports.stdout }}
          ============================================
          New mount point available:
            mount -t nfs 192.168.56.10:/srv/nfs/postgres /mnt
          ============================================

  handlers:
    - name: restart nfs
      systemd:
        name: nfs-kernel-server
        state: restarted
```

### [ansible/playbooks/setup-nfs-clients.yml](ansible/playbooks/setup-nfs-clients.yml)

Bloc "Install NFS client packages": installe le client NFS.

Bloc "Test NFS server reachability": teste l acces aux exports.

Bloc "Display NFS test results": affiche le resultat.

```yaml
- name: Setup NFS Clients on Worker Nodes and DevOps
  hosts: workers:devops_servers
  become: yes
  tasks:
    - name: Install NFS client packages
      apt:
        name:
          - nfs-common
        state: present
        update_cache: yes

    - name: Test NFS server reachability
      command: showmount -e 192.168.56.10
      register: nfs_test
      ignore_errors: yes

    - name: Display NFS test results
      debug:
        msg: |
          NFS server exports visible from {{ inventory_hostname }}:
          {{ nfs_test.stdout | default('Could not reach NFS server') }}
      when: nfs_test is defined
```

## Kubernetes manifests

### [kubernetes/deployment.yml](kubernetes/deployment.yml)

Bloc Deployment "hello-devops": deploie deux replicas depuis le registre Nexus avec des limites de ressources et un secret de pull.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-devops
  labels:
    app: hello-devops
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hello-devops
  template:
    metadata:
      labels:
        app: hello-devops
    spec:
      containers:
        - name: hello-devops
          image: 192.168.56.20:8082/hello-devops:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              memory: "64Mi"
              cpu: "100m"
            limits:
              memory: "128Mi"
              cpu: "250m"
      imagePullSecrets:
        - name: nexus-registry-secret
```

### [kubernetes/service.yml](kubernetes/service.yml)

Bloc Service "hello-devops-service": expose l application via NodePort 30080.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: hello-devops-service
  labels:
    app: hello-devops
spec:
  type: NodePort
  selector:
    app: hello-devops
  ports:
    - protocol: TCP
      port: 3000
      targetPort: 3000
      nodePort: 30080
```

### [kubernetes/nexus-secret.yml](kubernetes/nexus-secret.yml)

Bloc Secret "nexus-registry-secret": modele de secret pour l auth du registre Docker.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: nexus-registry-secret
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <BASE64_ENCODED_DOCKER_CONFIG>
```

### [kubernetes/gitea/gitea-external-service.yml](kubernetes/gitea/gitea-external-service.yml)

Bloc Namespace "gitea": cree un espace dedie.

Bloc Service "gitea": cree un service sans selector.

Bloc Endpoints "gitea": pointe vers l IP de la machine DevOps.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: gitea

---

apiVersion: v1
kind: Service
metadata:
  name: gitea
  namespace: gitea
spec:
  ports:
    - name: http
      port: 3000
      targetPort: 3000
      protocol: TCP

---

apiVersion: v1
kind: Endpoints
metadata:
  name: gitea
  namespace: gitea
subsets:
  - addresses:
      - ip: 192.168.56.20
    ports:
      - name: http
        port: 3000
        protocol: TCP
```

### [kubernetes/jenkins/namespace.yml](kubernetes/jenkins/namespace.yml)

Bloc Namespace "jenkins": isole les ressources Jenkins.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: jenkins
  labels:
    app: jenkins
    purpose: ci-cd
```

### [kubernetes/jenkins/deployment.yml](kubernetes/jenkins/deployment.yml)

Bloc Deployment "jenkins": deploie Jenkins avec un sidecar DinD et un PVC NFS.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jenkins
  namespace: jenkins
  labels:
    app: jenkins
spec:
  replicas: 1
  selector:
    matchLabels:
      app: jenkins
  template:
    metadata:
      labels:
        app: jenkins
    spec:
      serviceAccountName: jenkins
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node-role.kubernetes.io/control-plane
                    operator: DoesNotExist
      initContainers:
        - name: install-docker-cli
          image: docker:latest
          command:
            - sh
            - -c
            - |
              cp /usr/local/bin/docker /docker-bin/docker
              wget -qO /docker-bin/kubectl https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl
              chmod +x /docker-bin/kubectl
          volumeMounts:
            - name: docker-bin
              mountPath: /docker-bin
      containers:
        - name: jenkins
          image: jenkins/jenkins:lts-jdk17
          ports:
            - name: http
              containerPort: 8080
            - name: agent
              containerPort: 50000
          env:
            - name: DOCKER_HOST
              value: "tcp://localhost:2375"
            - name: JAVA_OPTS
              value: "-Xms256m -Xmx512m"
          volumeMounts:
            - name: jenkins-home
              mountPath: /var/jenkins_home
            - name: docker-bin
              mountPath: /usr/local/bin/docker
              subPath: docker
            - name: docker-bin
              mountPath: /usr/local/bin/kubectl
              subPath: kubectl
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          livenessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 120
            periodSeconds: 30
            timeoutSeconds: 10
            failureThreshold: 5
          readinessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 90
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
        - name: dind
          image: docker:dind
          command: ["dockerd-entrypoint.sh"]
          args:
            - "--insecure-registry"
            - "192.168.56.20:8082"
          securityContext:
            privileged: true
          env:
            - name: DOCKER_TLS_CERTDIR
              value: ""
          volumeMounts:
            - name: docker-storage
              mountPath: /var/lib/docker
          resources:
            requests:
              memory: "256Mi"
              cpu: "200m"
            limits:
              memory: "512Mi"
              cpu: "500m"
      volumes:
        - name: jenkins-home
          persistentVolumeClaim:
            claimName: jenkins-pvc
        - name: docker-storage
          emptyDir: {}
        - name: docker-bin
          emptyDir: {}
```

### [kubernetes/jenkins/service.yml](kubernetes/jenkins/service.yml)

Bloc Service "jenkins-service": expose Jenkins en NodePort.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: jenkins-service
  namespace: jenkins
  labels:
    app: jenkins
spec:
  type: NodePort
  selector:
    app: jenkins
  ports:
    - name: http
      protocol: TCP
      port: 8080
      targetPort: 8080
      nodePort: 32000
    - name: agent
      protocol: TCP
      port: 50000
      targetPort: 50000
      nodePort: 32001
```

### [kubernetes/jenkins/rbac.yml](kubernetes/jenkins/rbac.yml)

Bloc ServiceAccount "jenkins": identite de service pour Jenkins.

Bloc ClusterRole "jenkins-cluster-role": permissions cluster pour deployer et gerer les ressources.

Bloc ClusterRoleBinding "jenkins-cluster-role-binding": lie le role au service account.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: jenkins
  namespace: jenkins
  labels:
    app: jenkins

---

apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: jenkins-cluster-role
  labels:
    app: jenkins
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]

---

apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: jenkins-cluster-role-binding
  labels:
    app: jenkins
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: jenkins-cluster-role
subjects:
  - kind: ServiceAccount
    name: jenkins
    namespace: jenkins
```

### [kubernetes/jenkins/nfs-pv-pvc.yml](kubernetes/jenkins/nfs-pv-pvc.yml)

Bloc PersistentVolume "jenkins-pv": volume NFS pour les donnees Jenkins.

Bloc PersistentVolumeClaim "jenkins-pvc": claim utilise par le Deployment Jenkins.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: jenkins-pv
  labels:
    app: jenkins
    type: nfs
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/jenkins

---

apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: jenkins-pvc
  namespace: jenkins
  labels:
    app: jenkins
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  selector:
    matchLabels:
      type: nfs
```

### [kubernetes/fullstack/namespace.yml](kubernetes/fullstack/namespace.yml)

Bloc Namespace "fullstack": isole l application fullstack et applique les labels de securite.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: fullstack
  labels:
    app: task-manager
    project: fullstack
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/warn: baseline
    pod-security.kubernetes.io/audit: baseline
```

### [kubernetes/fullstack/backend-deployment.yml](kubernetes/fullstack/backend-deployment.yml)

Bloc Deployment "backend": deploie l API avec variables Postgres, probes et secret registry.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: fullstack
  labels:
    app: backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: backend
          image: 192.168.56.20:8082/fullstack-backend:latest
          ports:
            - containerPort: 5000
          env:
            - name: PG_HOST
              value: "postgres-service"
            - name: PG_PORT
              value: "5432"
            - name: PG_DB
              value: "formdb"
            - name: PG_USER
              value: "formuser"
            - name: PG_PASSWORD
              value: "formpassword"
            - name: PORT
              value: "5000"
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "200m"
          livenessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 45
            periodSeconds: 20
            timeoutSeconds: 5
          readinessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
      imagePullSecrets:
        - name: nexus-registry-secret
```

### [kubernetes/fullstack/backend-service.yml](kubernetes/fullstack/backend-service.yml)

Bloc Service "backend-service": expose l API en ClusterIP interne.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-service
  namespace: fullstack
  labels:
    app: backend
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - protocol: TCP
      port: 5000
      targetPort: 5000
```

### [kubernetes/fullstack/frontend-deployment.yml](kubernetes/fullstack/frontend-deployment.yml)

Bloc Deployment "frontend": deploie le front Nginx avec probes et secret registry.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: fullstack
  labels:
    app: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: frontend
          image: 192.168.56.20:8082/fullstack-frontend:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "32Mi"
              cpu: "25m"
            limits:
              memory: "64Mi"
              cpu: "100m"
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
      imagePullSecrets:
        - name: nexus-registry-secret
```

### [kubernetes/fullstack/frontend-service.yml](kubernetes/fullstack/frontend-service.yml)

Bloc Service "frontend-service": expose le front en NodePort 30090.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  namespace: fullstack
  labels:
    app: frontend
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
      nodePort: 30090
```

### [kubernetes/fullstack/postgres-deployment.yml](kubernetes/fullstack/postgres-deployment.yml)

Bloc Deployment "postgres": deploie Postgres avec stockage NFS.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: fullstack
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: "formdb"
            - name: POSTGRES_USER
              value: "formuser"
            - name: POSTGRES_PASSWORD
              value: "formpassword"
          volumeMounts:
            - name: pg-storage
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "300m"
      volumes:
        - name: pg-storage
          persistentVolumeClaim:
            claimName: postgres-pvc
```

### [kubernetes/fullstack/postgres-service.yml](kubernetes/fullstack/postgres-service.yml)

Bloc Service "postgres-service": expose Postgres en ClusterIP interne.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: fullstack
  labels:
    app: postgres
spec:
  type: ClusterIP
  selector:
    app: postgres
  ports:
    - protocol: TCP
      port: 5432
      targetPort: 5432
```

### [kubernetes/fullstack/postgres-nfs-pv-pvc.yml](kubernetes/fullstack/postgres-nfs-pv-pvc.yml)

Bloc PersistentVolume "postgres-pv": volume NFS pour Postgres.

Bloc PersistentVolumeClaim "postgres-pvc": claim utilise par le Deployment Postgres.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgres-pv
  labels:
    app: postgres
    type: nfs
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/postgres

---

apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: fullstack
  labels:
    app: postgres
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  selector:
    matchLabels:
      type: nfs
```

### [kubernetes/fullstack/security-network-policies.yml](kubernetes/fullstack/security-network-policies.yml)

Bloc NetworkPolicy "default-deny-all": bloque tout trafic par defaut.

Bloc NetworkPolicy "allow-dns-egress": autorise l acces DNS vers kube-system.

Bloc NetworkPolicy "frontend-network-policy": autorise l entree publique et la sortie vers le backend.

Bloc NetworkPolicy "backend-network-policy": autorise le front a appeler le backend et le backend a appeler Postgres.

Bloc NetworkPolicy "postgres-network-policy": autorise uniquement le backend vers Postgres.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: fullstack
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: fullstack
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Ingress
    - Egress
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

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
    - Egress
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

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: backend
      ports:
        - protocol: TCP
          port: 5432
```

### [kubernetes/fullstack/security-rbac.yml](kubernetes/fullstack/security-rbac.yml)

Bloc ServiceAccount "fullstack-app-sa": compte de service de l application.

Bloc Role "fullstack-app-role": permissions minimales en lecture.

Bloc RoleBinding "fullstack-app-rolebinding": lie le role au service account.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fullstack-app-sa
  namespace: fullstack

---

apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: fullstack-app-role
  namespace: fullstack
rules:
  - apiGroups: [""]
    resources: ["pods", "endpoints", "services"]
    verbs: ["get", "list", "watch"]

---

apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: fullstack-app-rolebinding
  namespace: fullstack
subjects:
  - kind: ServiceAccount
    name: fullstack-app-sa
    namespace: fullstack
roleRef:
  kind: Role
  name: fullstack-app-role
  apiGroup: rbac.authorization.k8s.io
```
# Guide: Ansible Playbooks et Manifests Kubernetes (Descriptions par bloc)

Ce guide donne une description par bloc (taches Ansible, ressources Kubernetes) et conserve le YAML sans commentaires ligne par ligne.

## Ansible playbooks

### [ansible/playbooks/common.yml](ansible/playbooks/common.yml)

Bloc "Add cluster hosts to /etc/hosts": ajoute les entrees d hote pour resoudre les noms des noeuds dans le cluster.

Bloc "Disable swap immediately": desactive le swap en cours, condition requise par Kubernetes.

Bloc "Remove swap entry from /etc/fstab": supprime la configuration du swap pour rester desactive apres reboot.

Bloc "Load kernel modules for containerd": charge les modules kernel necessaires au reseau des conteneurs.

Bloc "Ensure kernel modules load on boot": rend persistants les modules kernel au demarrage.

Bloc "Set sysctl params for Kubernetes": applique les parametres sysctl pour le bridged networking et le routage.

Bloc "Update apt cache": met a jour le cache APT.

Bloc "Install prerequisite packages": installe les paquets de base pour les actions suivantes.

```yaml
- name: Common setup for all Kubernetes nodes
  hosts: k8s_cluster
  become: yes
  tasks:
    - name: Add cluster hosts to /etc/hosts
      lineinfile:
        path: /etc/hosts
        line: "{{ item }}"
        state: present
      loop:
        - "192.168.56.10 k8s-master"
        - "192.168.56.11 k8s-worker1"
        - "192.168.56.12 k8s-worker2"
        - "192.168.56.20 devops"

    - name: Disable swap immediately
      command: swapoff -a
      changed_when: false

    - name: Remove swap entry from /etc/fstab
      lineinfile:
        path: /etc/fstab
        regexp: '.*swap.*'
        state: absent

    - name: Load kernel modules for containerd
      modprobe:
        name: "{{ item }}"
        state: present
      loop:
        - overlay
        - br_netfilter

    - name: Ensure kernel modules load on boot
      copy:
        dest: /etc/modules-load.d/k8s.conf
        content: |
          overlay
          br_netfilter

    - name: Set sysctl params for Kubernetes
      sysctl:
        name: "{{ item.key }}"
        value: "{{ item.value }}"
        sysctl_file: /etc/sysctl.d/k8s.conf
        reload: yes
      loop:
        - { key: "net.bridge.bridge-nf-call-iptables",  value: "1" }
        - { key: "net.bridge.bridge-nf-call-ip6tables", value: "1" }
        - { key: "net.ipv4.ip_forward",                 value: "1" }

    - name: Update apt cache
      apt:
        update_cache: yes
        cache_valid_time: 3600

    - name: Install prerequisite packages
      apt:
        name:
          - apt-transport-https
          - ca-certificates
          - curl
          - gnupg
          - lsb-release
          - software-properties-common
        state: present
```

### [ansible/playbooks/install-containerd.yml](ansible/playbooks/install-containerd.yml)

Bloc "Create keyrings directory": prepare le dossier des cles APT.

Bloc "Add Docker GPG key": ajoute la cle GPG du depot Docker.

Bloc "Add Docker repository": enregistre le depot Docker pour containerd.

Bloc "Update apt cache": rafraichit le cache APT.

Bloc "Install containerd.io": installe le runtime containerd.

Bloc "Create containerd config directory": cree le dossier de configuration.

Bloc "Remove old containerd config": supprime l ancienne configuration pour repartir propre.

Bloc "Generate fresh default containerd config": genere une configuration par defaut.

Bloc "Set SystemdCgroup to true": aligne le driver cgroup avec kubelet.

Bloc "Ensure correct single-path config_path": force le chemin certs.d.

Bloc "Create Nexus registry certs directory": cree le dossier du registre Nexus.

Bloc "Create Nexus registry hosts.toml config": configure l acces au registre HTTP.

Bloc "Restart containerd": redemarre containerd pour appliquer les changements.

```yaml
- name: Install and configure containerd
  hosts: k8s_cluster
  become: yes
  tasks:
    - name: Create keyrings directory
      file:
        path: /etc/apt/keyrings
        state: directory
        mode: '0755'

    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        state: present
        filename: docker

    - name: Update apt cache
      apt:
        update_cache: yes

    - name: Install containerd.io
      apt:
        name: containerd.io
        state: present

    - name: Create containerd config directory
      file:
        path: /etc/containerd
        state: directory

    - name: Remove old containerd config
      file:
        path: /etc/containerd/config.toml
        state: absent

    - name: Generate fresh default containerd config
      shell: containerd config default > /etc/containerd/config.toml

    - name: Set SystemdCgroup to true in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'SystemdCgroup = false'
        replace: 'SystemdCgroup = true'

    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = ['"'"'].*['"'"']'
        replace: 'config_path = "/etc/containerd/certs.d"'

    - name: Create Nexus registry certs directory
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'

    - name: Create Nexus registry hosts.toml config
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true

    - name: Restart containerd
      systemd:
        name: containerd
        state: restarted
        daemon_reload: yes
        enabled: yes
```

### [ansible/playbooks/install-kubernetes.yml](ansible/playbooks/install-kubernetes.yml)

Bloc "Create keyrings directory": cree le dossier pour les cles APT.

Bloc "Download Kubernetes GPG key": installe la cle de signature des paquets Kubernetes.

Bloc "Add Kubernetes APT repository": ajoute le depot Kubernetes stable.

Bloc "Update apt cache": met a jour le cache APT.

Bloc "Install Kubernetes packages": installe kubelet, kubeadm et kubectl.

Bloc "Hold Kubernetes packages at current version": bloque les versions pour eviter les mises a jour automatiques.

Bloc "Enable and start kubelet": demarre et active kubelet.

```yaml
- name: Install Kubernetes components
  hosts: k8s_cluster
  become: yes
  vars:
    kube_version: "1.29"
  tasks:
    - name: Create keyrings directory
      file:
        path: /etc/apt/keyrings
        state: directory
        mode: '0755'

    - name: Download Kubernetes GPG key
      shell: |
        curl -fsSL https://pkgs.k8s.io/core:/stable:/v{{ kube_version }}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
      args:
        creates: /etc/apt/keyrings/kubernetes-apt-keyring.gpg

    - name: Add Kubernetes APT repository
      apt_repository:
        repo: "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v{{ kube_version }}/deb/ /"
        state: present
        filename: kubernetes

    - name: Update apt cache
      apt:
        update_cache: yes

    - name: Install Kubernetes packages
      apt:
        name:
          - kubelet
          - kubeadm
          - kubectl
        state: present

    - name: Hold Kubernetes packages at current version
      dpkg_selections:
        name: "{{ item }}"
        selection: hold
      loop:
        - kubelet
        - kubeadm
        - kubectl

    - name: Enable and start kubelet
      systemd:
        name: kubelet
        enabled: yes
        state: started
```

### [ansible/playbooks/init-master.yml](ansible/playbooks/init-master.yml)

Bloc "Check if kubeadm has already been initialized": verifie si le control plane est deja initialise.

Bloc "Initialize Kubernetes cluster with kubeadm": lance le bootstrap kubeadm.

Bloc "Create .kube directory for vagrant user": prepare le dossier kubeconfig pour vagrant.

Bloc "Copy admin.conf to vagrant user kubeconfig": donne l acces kubectl a vagrant.

Bloc "Create .kube directory for root": prepare le dossier kubeconfig pour root.

Bloc "Copy admin.conf to root kubeconfig": donne l acces kubectl a root.

Bloc "Download Calico manifest": telecharge le manifest Calico.

Bloc "Apply Calico CNI": applique Calico dans le cluster.

Bloc "Generate kubeadm join command": genere la commande pour joindre les workers.

Bloc "Save join command to file": enregistre la commande de join.

Bloc "Store join command as fact": expose la commande comme fact Ansible.

```yaml
- name: Initialize Kubernetes Master Node
  hosts: masters
  become: yes
  tasks:
    - name: Check if kubeadm has already been initialized
      stat:
        path: /etc/kubernetes/admin.conf
      register: kubeadm_init_check

    - name: Initialize Kubernetes cluster with kubeadm
      command: >
        kubeadm init
        --apiserver-advertise-address=192.168.56.10
        --pod-network-cidr=192.168.0.0/16
        --node-name=k8s-master
      when: not kubeadm_init_check.stat.exists
      register: kubeadm_output

    - name: Create .kube directory for vagrant user
      file:
        path: /home/vagrant/.kube
        state: directory
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Copy admin.conf to vagrant user kubeconfig
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /home/vagrant/.kube/config
        remote_src: yes
        owner: vagrant
        group: vagrant
        mode: '0644'

    - name: Create .kube directory for root
      file:
        path: /root/.kube
        state: directory
        mode: '0755'

    - name: Copy admin.conf to root kubeconfig
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /root/.kube/config
        remote_src: yes
        mode: '0644'

    - name: Download Calico manifest
      get_url:
        url: https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml
        dest: /home/vagrant/calico.yaml
        owner: vagrant
        group: vagrant

    - name: Apply Calico CNI
      become_user: vagrant
      command: kubectl apply -f /home/vagrant/calico.yaml
      environment:
        KUBECONFIG: /home/vagrant/.kube/config

    - name: Generate kubeadm join command
      command: kubeadm token create --print-join-command
      register: join_command

    - name: Save join command to file
      copy:
        content: "{{ join_command.stdout }}"
        dest: /home/vagrant/join-command.sh
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Store join command as fact
      set_fact:
        kubernetes_join_command: "{{ join_command.stdout }}"
```

### [ansible/playbooks/join-workers.yml](ansible/playbooks/join-workers.yml)

Bloc "Get join command": genere la commande de join depuis le master.

Bloc "Set join command fact": expose la commande aux workers.

Bloc "Check if node is already part of a cluster": verifie si le worker est deja joint.

Bloc "Join node to Kubernetes cluster": joint le worker si besoin.

Bloc "Ensure kubelet is running": demarre et active kubelet sur les workers.

```yaml
- name: Get join command from master
  hosts: masters
  become: yes
  tasks:
    - name: Get join command
      command: kubeadm token create --print-join-command
      register: join_command_raw

    - name: Set join command fact
      set_fact:
        join_command: "{{ join_command_raw.stdout }}"

- name: Join worker nodes to the cluster
  hosts: workers
  become: yes
  tasks:
    - name: Check if node is already part of a cluster
      stat:
        path: /etc/kubernetes/kubelet.conf
      register: kubelet_conf

    - name: Join node to Kubernetes cluster
      command: "{{ hostvars['k8s-master']['join_command'] }}"
      when: not kubelet_conf.stat.exists

    - name: Ensure kubelet is running
      systemd:
        name: kubelet
        state: started
        enabled: yes
```

### [ansible/playbooks/configure-insecure-registry.yml](ansible/playbooks/configure-insecure-registry.yml)

Bloc "Remove old NEXUS INSECURE REGISTRY block": nettoie l ancienne configuration containerd.

Bloc "Remove orphaned grpc.v1.cri registry section header": supprime l en-tete obsolete.

Bloc "Ensure correct single-path config_path": force l usage du dossier certs.d.

Bloc "Create containerd certs.d directory for Nexus": cree le dossier du registre.

Bloc "Write hosts.toml for Nexus HTTP registry": ecrit la config d acces registry.

Bloc "Create containerd certs.d directory for Nexus Alias IP": duplication de dossier (meme chemin).

Bloc "Write hosts.toml for Nexus HTTP registry Alias IP": duplication de hosts.toml (meme chemin).

Bloc "Check effective config_path in containerd": verifie le parametre effectif.

Bloc "Show effective config_path": affiche le resultat.

Bloc "Restart containerd": redemarre containerd.

Bloc "Wait for containerd to stabilize": attend la stabilisation.

Bloc "Verify containerd is active": verifie le statut.

Bloc "Test image pull from Nexus": teste un pull d image.

Bloc "Display results": affiche les tests.

```yaml
- name: Configure Insecure Registry on K8s Nodes
  hosts: k8s_cluster
  become: yes
  tasks:
    - name: Remove old NEXUS INSECURE REGISTRY block from config.toml
      blockinfile:
        path: /etc/containerd/config.toml
        marker: "# {mark} NEXUS INSECURE REGISTRY"
        state: absent

    - name: Remove orphaned grpc.v1.cri registry section header
      lineinfile:
        path: /etc/containerd/config.toml
        regexp: '^\[plugins\."io\.containerd\.grpc\.v1\.cri"\.registry\]'
        state: absent

    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = ['"'"'].*['"'"']'
        replace: 'config_path = "/etc/containerd/certs.d"'

    - name: Create containerd certs.d directory for Nexus
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'
        recurse: yes

    - name: Write hosts.toml for Nexus HTTP registry
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
        mode: '0644'

    - name: Create containerd certs.d directory for Nexus Alias IP
      file:
        path: /etc/containerd/certs.d/192.168.56.20:8082
        state: directory
        mode: '0755'
        recurse: yes

    - name: Write hosts.toml for Nexus HTTP registry Alias IP
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
        mode: '0644'

    - name: Check effective config_path in containerd
      shell: containerd config dump 2>/dev/null | grep 'config_path' | grep 'certs.d' | head -1
      register: config_dump_check
      changed_when: false
      ignore_errors: yes

    - name: Show effective config_path
      debug:
        msg: "Effective config_path: {{ config_dump_check.stdout | default('NOT FOUND -- config may need regeneration') }}"

    - name: Restart containerd
      systemd:
        name: containerd
        state: restarted

    - name: Wait for containerd to stabilize
      pause:
        seconds: 10

    - name: Verify containerd is active
      shell: systemctl is-active containerd
      register: containerd_active
      changed_when: false

    - name: Test image pull from Nexus
      shell: |
        crictl --image-endpoint unix:///run/containerd/containerd.sock pull 192.168.56.20:8082/fullstack-backend:latest 2>&1
      register: pull_test
      ignore_errors: yes
      timeout: 30

    - name: Display results
      debug:
        msg: |
          containerd: {{ containerd_active.stdout }}
          config_path: {{ config_dump_check.stdout | default('NOT FOUND') }}
          Pull test: {{ 'SUCCESS' if pull_test.rc == 0 else pull_test.stderr | default(pull_test.stdout | default('FAILED')) }}
```

### [ansible/playbooks/configure-kubectl-devops.yml](ansible/playbooks/configure-kubectl-devops.yml)

Bloc "Read kubeconfig from master": recupere admin.conf depuis le master.

Bloc "Set kubeconfig fact": decode et stocke la config.

Bloc "Create .kube directory for vagrant user": cree le dossier kubeconfig.

Bloc "Write kubeconfig for vagrant user": copie la config pour vagrant.

Bloc "Update API server address in vagrant kubeconfig": pointe vers IP du master.

Bloc "Verify kubectl works from devops": teste l acces kubectl.

Bloc "Display kubectl output": affiche le resultat si OK.

Bloc "Create .kube directory in NFS Jenkins home": prepare le dossier pour Jenkins.

Bloc "Write kubeconfig to NFS Jenkins home": copie admin.conf dans NFS.

Bloc "Update API server address in Jenkins kubeconfig": pointe vers IP du master.

Bloc "Display completion message": resume la configuration.

```yaml
- name: Fetch kubeconfig from master
  hosts: masters
  become: yes
  tasks:
    - name: Read kubeconfig from master
      slurp:
        src: /etc/kubernetes/admin.conf
      register: kubeconfig_content

    - name: Set kubeconfig fact
      set_fact:
        kubeconfig_data: "{{ kubeconfig_content.content | b64decode }}"

- name: Configure kubectl on DevOps machine and NFS
  hosts: devops
  become: yes
  tasks:
    - name: Create .kube directory for vagrant user
      file:
        path: /home/vagrant/.kube
        state: directory
        owner: vagrant
        group: vagrant
        mode: '0755'

    - name: Write kubeconfig for vagrant user
      copy:
        content: "{{ hostvars['k8s-master']['kubeconfig_data'] }}"
        dest: /home/vagrant/.kube/config
        owner: vagrant
        group: vagrant
        mode: '0600'

    - name: Update API server address in vagrant kubeconfig
      replace:
        path: /home/vagrant/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'

    - name: Verify kubectl works from devops (vagrant)
      become_user: vagrant
      command: kubectl get nodes
      register: kubectl_output
      ignore_errors: yes

    - name: Display kubectl output
      debug:
        msg: "{{ kubectl_output.stdout_lines }}"
      when: kubectl_output.rc == 0

- name: Copy kubeconfig to NFS for Jenkins pod
  hosts: masters
  become: yes
  tasks:
    - name: Create .kube directory in NFS Jenkins home
      file:
        path: /srv/nfs/jenkins/.kube
        state: directory
        owner: "1000"
        group: "1000"
        mode: '0755'

    - name: Write kubeconfig to NFS Jenkins home
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /srv/nfs/jenkins/.kube/config
        remote_src: yes
        owner: "1000"
        group: "1000"
        mode: '0600'

    - name: Update API server address in Jenkins kubeconfig
      replace:
        path: /srv/nfs/jenkins/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'

    - name: Display completion message
      debug:
        msg: |
          ============================================
          kubectl configured for:
          - vagrant@devops: /home/vagrant/.kube/config
          - Jenkins pod (NFS): /srv/nfs/jenkins/.kube/config
          ============================================
```

### [ansible/playbooks/install-jenkins.yml](ansible/playbooks/install-jenkins.yml)

Bloc "Install Java 17 JDK": installe Java requis pour certains outils.

Bloc "Add Docker GPG key": ajoute la cle du depot Docker.

Bloc "Add Docker repository": ajoute le depot Docker.

Bloc "Install Docker": installe Docker et containerd.

Bloc "Start Docker service": active et demarre Docker.

Bloc "Add vagrant user to docker group": autorise Docker sans sudo.

Bloc "Download kubectl binary": installe kubectl sur la machine DevOps.

Bloc "Create Docker daemon.json for insecure registry": configure le registre Nexus en insecure.

Bloc "Display setup information": affiche un resume.

Bloc "restart docker" (handler): redemarre Docker apres changement de config.

```yaml
- name: Install Docker and kubectl on DevOps machine
  hosts: devops
  become: yes
  tasks:
    - name: Install Java 17 JDK # note for me : upgrade for JDK 21 for long term support
      apt:
        name: openjdk-17-jdk
        state: present
        update_cache: yes

    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        state: present
        filename: docker

    - name: Install Docker
      apt:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
        state: present
        update_cache: yes

    - name: Start Docker service
      systemd:
        name: docker
        state: started
        enabled: yes

    - name: Add vagrant user to docker group
      user:
        name: vagrant
        groups: docker
        append: yes

    - name: Download kubectl binary
      get_url:
        url: "https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl"
        dest: /usr/local/bin/kubectl
        mode: '0755'

    - name: Create Docker daemon.json for insecure registry
      copy:
        dest: /etc/docker/daemon.json
        content: |
          {
            "insecure-registries": ["192.168.56.20:8082"]
          }
      notify: restart docker

    - name: Display setup information
      debug:
        msg: |
          ============================================
          DevOps machine setup complete!
          - Docker installed and configured
          - kubectl installed
          - Insecure registry: 192.168.56.20:8082
          ============================================
          NOTE: Jenkins is NOT installed here.
          Jenkins runs as a Kubernetes pod.
          Access Jenkins at: http://<worker-ip>:32000
          ============================================

  handlers:
    - name: restart docker
      systemd:
        name: docker
        state: restarted
```

### [ansible/playbooks/install-gitea.yml](ansible/playbooks/install-gitea.yml)

Bloc "Install required packages (git)": installe Git.

Bloc "Create git user for Gitea": cree l utilisateur systeme git.

Bloc "Create Gitea directories": cree les dossiers de donnees et logs.

Bloc "Create /etc/gitea directory": cree le dossier de configuration.

Bloc "Download Gitea binary": telecharge le binaire Gitea.

Bloc "Download Gitea systemd service file": telecharge l unite systemd.

Bloc "Ensure Gitea service starts on boot and is running": active et demarre Gitea.

```yaml
- name: Install Gitea natively on DevOps Machine
  hosts: devops_servers
  become: yes
  vars:
    gitea_version: "1.21.7"
  tasks:
    - name: Install required packages (git)
      apt:
        name: git
        state: present
        update_cache: yes

    - name: Create git user for Gitea
      user:
        name: git
        system: yes
        shell: /bin/bash
        comment: "Git Version Control"
        create_home: yes
        home: /home/git

    - name: Create Gitea directories
      file:
        path: "{{ item }}"
        state: directory
        owner: git
        group: git
        mode: '0750'
      with_items:
        - /var/lib/gitea
        - /var/lib/gitea/custom
        - /var/lib/gitea/data
        - /var/lib/gitea/data/lfs
        - /var/log/gitea

    - name: Create /etc/gitea directory
      file:
        path: /etc/gitea
        state: directory
        owner: root
        group: git
        mode: '0770'

    - name: Download Gitea binary
      get_url:
        url: "https://dl.gitea.com/gitea/{{ gitea_version }}/gitea-{{ gitea_version }}-linux-amd64"
        dest: /usr/local/bin/gitea
        mode: '0755'

    - name: Download Gitea systemd service file
      get_url:
        url: "https://raw.githubusercontent.com/go-gitea/gitea/main/contrib/systemd/gitea.service"
        dest: /etc/systemd/system/gitea.service

    - name: Ensure Gitea service starts on boot and is running
      systemd:
        name: gitea
        enabled: yes
        state: started
        daemon_reload: yes
```

### [ansible/playbooks/install-nexus.yml](ansible/playbooks/install-nexus.yml)

Bloc "Install NTP tools": installe les outils de synchro horaire.

Bloc "Synchronize system clock": force la mise a l heure.

Bloc "Set timezone to UTC": fixe le fuseau horaire.

Bloc "Wait for apt lock": attend la fin des verrous APT.

Bloc "Install pip3": installe pip.

Bloc "Install Docker SDK for Python": installe le SDK docker pour Ansible.

Bloc "Create Nexus data directory": prepare le volume persistant.

Bloc "Pull Nexus Docker image": telecharge l image Nexus.

Bloc "Run Nexus container": demarre Nexus en conteneur.

Bloc "Wait for Nexus to start": attend la disponibilite.

Bloc "Get Nexus initial admin password": lit le mot de passe initial.

Bloc "Display Nexus access information": affiche les infos d acces.

```yaml
- name: Install Nexus Repository on DevOps machine
  hosts: devops
  become: yes
  tasks:
    - name: Install NTP tools
      apt:
        name:
          - chrony
          - ntpdate
        state: present
        update_cache: no
      ignore_errors: yes

    - name: Synchronize system clock
      command: ntpdate -u pool.ntp.org
      ignore_errors: yes

    - name: Set timezone to UTC
      command: timedatectl set-timezone UTC
      ignore_errors: yes

    - name: Wait for apt lock to be released
      shell: while sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 1; done
      timeout: 300

    - name: Install pip3
      apt:
        name: python3-pip
        state: present
        update_cache: yes

    - name: Install Docker SDK for Python
      pip:
        name: docker
        state: present

    - name: Create Nexus data directory
      file:
        path: /opt/nexus-data
        state: directory
        owner: "200"
        group: "200"
        mode: '0755'

    - name: Pull Nexus Docker image
      docker_image:
        name: sonatype/nexus3
        tag: latest
        source: pull

    - name: Run Nexus container
      docker_container:
        name: nexus
        image: sonatype/nexus3:latest
        state: started
        restart_policy: always
        ports:
          - "8081:8081"
          - "8082:8082"
        volumes:
          - "/opt/nexus-data:/nexus-data"
        env:
          INSTALL4J_ADD_VM_PARAMS: "-Xms512m -Xmx512m -XX:MaxDirectMemorySize=512m"

    - name: Wait for Nexus to start (may take 2-3 minutes)
      uri:
        url: http://localhost:8081/service/rest/v1/status
        method: GET
        status_code: 200
      register: nexus_status
      until: nexus_status.status == 200
      retries: 30
      delay: 10

    - name: Get Nexus initial admin password
      command: docker exec nexus cat /nexus-data/admin.password
      register: nexus_password
      ignore_errors: yes

    - name: Display Nexus access information
      debug:
        msg: |
          ============================================
          Nexus Repository Manager is running!
          Web UI:          http://192.168.56.20:8081
          Docker Registry: http://192.168.56.20:8082
          Username:        admin
          Password:        {{ nexus_password.stdout | default('Check /opt/nexus-data/admin.password') }}
          ============================================
```

### [ansible/playbooks/setup-nfs-server.yml](ansible/playbooks/setup-nfs-server.yml)

Bloc "Install NFS server packages": installe le serveur NFS.

Bloc "Create Jenkins NFS directory": cree le partage Jenkins.

Bloc "Create general data NFS directory": cree un partage general.

Bloc "Configure NFS exports": ecrit /etc/exports.

Bloc "Export NFS shares": applique les exports.

Bloc "Start and enable NFS server": demarre le service NFS.

Bloc "Verify NFS exports": verifie les exports.

Bloc "Display NFS exports": affiche le resume.

Bloc "restart nfs" (handler): redemarre NFS si besoin.

```yaml
- name: Setup NFS Server on Kubernetes Master
  hosts: masters
  become: yes
  tasks:
    - name: Install NFS server packages
      apt:
        name:
          - nfs-kernel-server
          - nfs-common
        state: present
        update_cache: yes

    - name: Create Jenkins NFS directory
      file:
        path: /srv/nfs/jenkins
        state: directory
        owner: "1000"
        group: "1000"
        mode: '0755'
        recurse: yes

    - name: Create general data NFS directory
      file:
        path: /srv/nfs/data
        state: directory
        owner: nobody
        group: nogroup
        mode: '0777'
        recurse: yes

    - name: Configure NFS exports
      copy:
        dest: /etc/exports
        content: |
          # NFS Exports for Kubernetes Cluster
          # Jenkins home directory - accessible by all nodes in the subnet
          /srv/nfs/jenkins  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
          # General purpose shared data
          /srv/nfs/data     192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
      notify: restart nfs

    - name: Export NFS shares
      command: exportfs -rav
      changed_when: true

    - name: Start and enable NFS server
      systemd:
        name: nfs-kernel-server
        state: started
        enabled: yes

    - name: Verify NFS exports
      command: showmount -e localhost
      register: nfs_exports

    - name: Display NFS exports
      debug:
        msg: |
          ============================================
          NFS Server configured on k8s-master!
          Exports:
          {{ nfs_exports.stdout }}
          ============================================
          Clients can mount:
            mount -t nfs 192.168.56.10:/srv/nfs/jenkins /mnt
            mount -t nfs 192.168.56.10:/srv/nfs/data /mnt
          ============================================

  handlers:
    - name: restart nfs
      systemd:
        name: nfs-kernel-server
        state: restarted
```

### [ansible/playbooks/setup-nfs-postgres.yml](ansible/playbooks/setup-nfs-postgres.yml)

Bloc "Create PostgreSQL NFS directory": cree le partage Postgres.

Bloc "Check if PostgreSQL export already exists": verifie l export.

Bloc "Add PostgreSQL NFS export": ajoute l export si absent.

Bloc "Export NFS shares": applique les exports.

Bloc "Verify NFS exports": verifie l export.

Bloc "Display NFS exports": affiche le resume.

Bloc "restart nfs" (handler): redemarre NFS si besoin.

```yaml
- name: Setup NFS directory for PostgreSQL on Kubernetes Master
  hosts: masters
  become: yes
  tasks:
    - name: Create PostgreSQL NFS directory
      file:
        path: /srv/nfs/postgres
        state: directory
        owner: "70"
        group: "70"
        mode: '0700'
        recurse: yes

    - name: Check if PostgreSQL export already exists
      command: grep -q '/srv/nfs/postgres' /etc/exports
      register: export_check
      ignore_errors: yes
      changed_when: false

    - name: Add PostgreSQL NFS export
      lineinfile:
        path: /etc/exports
        line: "/srv/nfs/postgres  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)"
        state: present
      when: export_check.rc != 0
      notify: restart nfs

    - name: Export NFS shares
      command: exportfs -rav
      changed_when: true

    - name: Verify NFS exports
      command: showmount -e localhost
      register: nfs_exports

    - name: Display NFS exports
      debug:
        msg: |
          ============================================
          PostgreSQL NFS directory configured!
          Exports:
          {{ nfs_exports.stdout }}
          ============================================
          New mount point available:
            mount -t nfs 192.168.56.10:/srv/nfs/postgres /mnt
          ============================================

  handlers:
    - name: restart nfs
      systemd:
        name: nfs-kernel-server
        state: restarted
```

### [ansible/playbooks/setup-nfs-clients.yml](ansible/playbooks/setup-nfs-clients.yml)

Bloc "Install NFS client packages": installe le client NFS.

Bloc "Test NFS server reachability": teste l acces aux exports.

Bloc "Display NFS test results": affiche le resultat.

```yaml
- name: Setup NFS Clients on Worker Nodes and DevOps
  hosts: workers:devops_servers
  become: yes
  tasks:
    - name: Install NFS client packages
      apt:
        name:
          - nfs-common
        state: present
        update_cache: yes

    - name: Test NFS server reachability
      command: showmount -e 192.168.56.10
      register: nfs_test
      ignore_errors: yes

    - name: Display NFS test results
      debug:
        msg: |
          NFS server exports visible from {{ inventory_hostname }}:
          {{ nfs_test.stdout | default('Could not reach NFS server') }}
      when: nfs_test is defined
```

## Kubernetes manifests

### [kubernetes/deployment.yml](kubernetes/deployment.yml)

Bloc Deployment "hello-devops": deploie deux replicas depuis le registre Nexus avec des limites de ressources et un secret de pull.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hello-devops
  labels:
    app: hello-devops
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hello-devops
  template:
    metadata:
      labels:
        app: hello-devops
    spec:
      containers:
        - name: hello-devops
          image: 192.168.56.20:8082/hello-devops:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              memory: "64Mi"
              cpu: "100m"
            limits:
              memory: "128Mi"
              cpu: "250m"
      imagePullSecrets:
        - name: nexus-registry-secret
```

### [kubernetes/service.yml](kubernetes/service.yml)

Bloc Service "hello-devops-service": expose l application via NodePort 30080.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: hello-devops-service
  labels:
    app: hello-devops
spec:
  type: NodePort
  selector:
    app: hello-devops
  ports:
    - protocol: TCP
      port: 3000
      targetPort: 3000
      nodePort: 30080
```

### [kubernetes/nexus-secret.yml](kubernetes/nexus-secret.yml)

Bloc Secret "nexus-registry-secret": modele de secret pour l auth du registre Docker.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: nexus-registry-secret
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: <BASE64_ENCODED_DOCKER_CONFIG>
```

### [kubernetes/gitea/gitea-external-service.yml](kubernetes/gitea/gitea-external-service.yml)

Bloc Namespace "gitea": cree un espace dedie.

Bloc Service "gitea": cree un service sans selector.

Bloc Endpoints "gitea": pointe vers l IP de la machine DevOps.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: gitea

---

apiVersion: v1
kind: Service
metadata:
  name: gitea
  namespace: gitea
spec:
  ports:
    - name: http
      port: 3000
      targetPort: 3000
      protocol: TCP

---

apiVersion: v1
kind: Endpoints
metadata:
  name: gitea
  namespace: gitea
subsets:
  - addresses:
      - ip: 192.168.56.20
    ports:
      - name: http
        port: 3000
        protocol: TCP
```

### [kubernetes/jenkins/namespace.yml](kubernetes/jenkins/namespace.yml)

Bloc Namespace "jenkins": isole les ressources Jenkins.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: jenkins
  labels:
    app: jenkins
    purpose: ci-cd
```

### [kubernetes/jenkins/deployment.yml](kubernetes/jenkins/deployment.yml)

Bloc Deployment "jenkins": deploie Jenkins avec un sidecar DinD et un PVC NFS.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jenkins
  namespace: jenkins
  labels:
    app: jenkins
spec:
  replicas: 1
  selector:
    matchLabels:
      app: jenkins
  template:
    metadata:
      labels:
        app: jenkins
    spec:
      serviceAccountName: jenkins
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node-role.kubernetes.io/control-plane
                    operator: DoesNotExist
      initContainers:
        - name: install-docker-cli
          image: docker:latest
          command:
            - sh
            - -c
            - |
              cp /usr/local/bin/docker /docker-bin/docker
              wget -qO /docker-bin/kubectl https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl
              chmod +x /docker-bin/kubectl
          volumeMounts:
            - name: docker-bin
              mountPath: /docker-bin
      containers:
        - name: jenkins
          image: jenkins/jenkins:lts-jdk17
          ports:
            - name: http
              containerPort: 8080
            - name: agent
              containerPort: 50000
          env:
            - name: DOCKER_HOST
              value: "tcp://localhost:2375"
            - name: JAVA_OPTS
              value: "-Xms256m -Xmx512m"
          volumeMounts:
            - name: jenkins-home
              mountPath: /var/jenkins_home
            - name: docker-bin
              mountPath: /usr/local/bin/docker
              subPath: docker
            - name: docker-bin
              mountPath: /usr/local/bin/kubectl
              subPath: kubectl
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          livenessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 120
            periodSeconds: 30
            timeoutSeconds: 10
            failureThreshold: 5
          readinessProbe:
            httpGet:
              path: /login
              port: 8080
            initialDelaySeconds: 90
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
        - name: dind
          image: docker:dind
          command: ["dockerd-entrypoint.sh"]
          args:
            - "--insecure-registry"
            - "192.168.56.20:8082"
          securityContext:
            privileged: true
          env:
            - name: DOCKER_TLS_CERTDIR
              value: ""
          volumeMounts:
            - name: docker-storage
              mountPath: /var/lib/docker
          resources:
            requests:
              memory: "256Mi"
              cpu: "200m"
            limits:
              memory: "512Mi"
              cpu: "500m"
      volumes:
        - name: jenkins-home
          persistentVolumeClaim:
            claimName: jenkins-pvc
        - name: docker-storage
          emptyDir: {}
        - name: docker-bin
          emptyDir: {}
```

### [kubernetes/jenkins/service.yml](kubernetes/jenkins/service.yml)

Bloc Service "jenkins-service": expose Jenkins en NodePort.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: jenkins-service
  namespace: jenkins
  labels:
    app: jenkins
spec:
  type: NodePort
  selector:
    app: jenkins
  ports:
    - name: http
      protocol: TCP
      port: 8080
      targetPort: 8080
      nodePort: 32000
    - name: agent
      protocol: TCP
      port: 50000
      targetPort: 50000
      nodePort: 32001
```

### [kubernetes/jenkins/rbac.yml](kubernetes/jenkins/rbac.yml)

Bloc ServiceAccount "jenkins": identite de service pour Jenkins.

Bloc ClusterRole "jenkins-cluster-role": permissions cluster pour deployer et gerer les ressources.

Bloc ClusterRoleBinding "jenkins-cluster-role-binding": lie le role au service account.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: jenkins
  namespace: jenkins
  labels:
    app: jenkins

---

apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: jenkins-cluster-role
  labels:
    app: jenkins
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]

---

apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: jenkins-cluster-role-binding
  labels:
    app: jenkins
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: jenkins-cluster-role
subjects:
  - kind: ServiceAccount
    name: jenkins
    namespace: jenkins
```

### [kubernetes/jenkins/nfs-pv-pvc.yml](kubernetes/jenkins/nfs-pv-pvc.yml)

Bloc PersistentVolume "jenkins-pv": volume NFS pour les donnees Jenkins.

Bloc PersistentVolumeClaim "jenkins-pvc": claim utilise par le Deployment Jenkins.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: jenkins-pv
  labels:
    app: jenkins
    type: nfs
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/jenkins

---

apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: jenkins-pvc
  namespace: jenkins
  labels:
    app: jenkins
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  selector:
    matchLabels:
      type: nfs
```

### [kubernetes/fullstack/namespace.yml](kubernetes/fullstack/namespace.yml)

Bloc Namespace "fullstack": isole l application fullstack et applique les labels de securite.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: fullstack
  labels:
    app: task-manager
    project: fullstack
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/warn: baseline
    pod-security.kubernetes.io/audit: baseline
```

### [kubernetes/fullstack/backend-deployment.yml](kubernetes/fullstack/backend-deployment.yml)

Bloc Deployment "backend": deploie l API avec variables Postgres, probes et secret registry.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: fullstack
  labels:
    app: backend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: backend
          image: 192.168.56.20:8082/fullstack-backend:latest
          ports:
            - containerPort: 5000
          env:
            - name: PG_HOST
              value: "postgres-service"
            - name: PG_PORT
              value: "5432"
            - name: PG_DB
              value: "formdb"
            - name: PG_USER
              value: "formuser"
            - name: PG_PASSWORD
              value: "formpassword"
            - name: PORT
              value: "5000"
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "200m"
          livenessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 45
            periodSeconds: 20
            timeoutSeconds: 5
          readinessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
      imagePullSecrets:
        - name: nexus-registry-secret
```

### [kubernetes/fullstack/backend-service.yml](kubernetes/fullstack/backend-service.yml)

Bloc Service "backend-service": expose l API en ClusterIP interne.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-service
  namespace: fullstack
  labels:
    app: backend
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - protocol: TCP
      port: 5000
      targetPort: 5000
```

### [kubernetes/fullstack/frontend-deployment.yml](kubernetes/fullstack/frontend-deployment.yml)

Bloc Deployment "frontend": deploie le front Nginx avec probes et secret registry.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: fullstack
  labels:
    app: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: frontend
          image: 192.168.56.20:8082/fullstack-frontend:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "32Mi"
              cpu: "25m"
            limits:
              memory: "64Mi"
              cpu: "100m"
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
      imagePullSecrets:
        - name: nexus-registry-secret
```

### [kubernetes/fullstack/frontend-service.yml](kubernetes/fullstack/frontend-service.yml)

Bloc Service "frontend-service": expose le front en NodePort 30090.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  namespace: fullstack
  labels:
    app: frontend
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
    - protocol: TCP
      port: 80
      targetPort: 80
      nodePort: 30090
```

### [kubernetes/fullstack/postgres-deployment.yml](kubernetes/fullstack/postgres-deployment.yml)

Bloc Deployment "postgres": deploie Postgres avec stockage NFS.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: fullstack
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      serviceAccountName: fullstack-app-sa
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: "formdb"
            - name: POSTGRES_USER
              value: "formuser"
            - name: POSTGRES_PASSWORD
              value: "formpassword"
          volumeMounts:
            - name: pg-storage
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "300m"
      volumes:
        - name: pg-storage
          persistentVolumeClaim:
            claimName: postgres-pvc
```

### [kubernetes/fullstack/postgres-service.yml](kubernetes/fullstack/postgres-service.yml)

Bloc Service "postgres-service": expose Postgres en ClusterIP interne.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: fullstack
  labels:
    app: postgres
spec:
  type: ClusterIP
  selector:
    app: postgres
  ports:
    - protocol: TCP
      port: 5432
      targetPort: 5432
```

### [kubernetes/fullstack/postgres-nfs-pv-pvc.yml](kubernetes/fullstack/postgres-nfs-pv-pvc.yml)

Bloc PersistentVolume "postgres-pv": volume NFS pour Postgres.

Bloc PersistentVolumeClaim "postgres-pvc": claim utilise par le Deployment Postgres.

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgres-pv
  labels:
    app: postgres
    type: nfs
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/postgres

---

apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: fullstack
  labels:
    app: postgres
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  selector:
    matchLabels:
      type: nfs
```

### [kubernetes/fullstack/security-network-policies.yml](kubernetes/fullstack/security-network-policies.yml)

Bloc NetworkPolicy "default-deny-all": bloque tout trafic par defaut.

Bloc NetworkPolicy "allow-dns-egress": autorise l acces DNS vers kube-system.

Bloc NetworkPolicy "frontend-network-policy": autorise l entree publique et la sortie vers le backend.

Bloc NetworkPolicy "backend-network-policy": autorise le front a appeler le backend et le backend a appeler Postgres.

Bloc NetworkPolicy "postgres-network-policy": autorise uniquement le backend vers Postgres.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: fullstack
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: fullstack
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Ingress
    - Egress
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

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: backend
  policyTypes:
    - Ingress
    - Egress
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

---

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-network-policy
  namespace: fullstack
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: backend
      ports:
        - protocol: TCP
          port: 5432
```

### [kubernetes/fullstack/security-rbac.yml](kubernetes/fullstack/security-rbac.yml)

Bloc ServiceAccount "fullstack-app-sa": compte de service de l application.

Bloc Role "fullstack-app-role": permissions minimales en lecture.

Bloc RoleBinding "fullstack-app-rolebinding": lie le role au service account.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fullstack-app-sa
  namespace: fullstack

---

apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: fullstack-app-role
  namespace: fullstack
rules:
  - apiGroups: [""]
    resources: ["pods", "endpoints", "services"]
    verbs: ["get", "list", "watch"]

---

apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: fullstack-app-rolebinding
  namespace: fullstack
subjects:
  - kind: ServiceAccount
    name: fullstack-app-sa
    namespace: fullstack
roleRef:
  kind: Role
  name: fullstack-app-role
  apiGroup: rbac.authorization.k8s.io
```
