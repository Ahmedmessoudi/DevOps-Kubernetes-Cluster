# 📚 DevOps & Kubernetes Project — Complete Code Explanation Guide

> **This document explains every file in the project, how the VMs connect to each other,
> and what each line of Ansible/YAML code does. Aimed at beginner-to-intermediate learners.**

---

## Table of Contents

1. [How the VMs Connect to Each Other](#1-how-the-vms-connect-to-each-other)
2. [Vagrantfile Explained](#2-vagrantfile-explained)
3. [Ansible Configuration](#3-ansible-configuration)
4. [Playbook 1: common.yml](#4-playbook-1-commonyml)
5. [Playbook 2: install-containerd.yml](#5-playbook-2-install-containerdyml)
6. [Playbook 3: install-kubernetes.yml](#6-playbook-3-install-kubernetesyml)
7. [Playbook 4: init-master.yml](#7-playbook-4-init-masteryml)
8. [Playbook 5: join-workers.yml](#8-playbook-5-join-workersyml)
9. [Playbook 6: install-jenkins.yml](#9-playbook-6-install-jenkinsyml)
10. [Playbook 7: install-nexus.yml](#10-playbook-7-install-nexusyml)
11. [Playbook 8: configure-kubectl-devops.yml](#11-playbook-8-configure-kubectl-devopsyml)
12. [Kubernetes YAML Files](#12-kubernetes-yaml-files)
13. [Jenkinsfile (CI/CD Pipeline)](#13-jenkinsfile-cicd-pipeline)
14. [Sample Application](#14-sample-application)
15. [Complete Execution Flow Summary](#15-complete-execution-flow-summary)

---

## 1. How the VMs Connect to Each Other

### The Network Architecture

All 4 virtual machines are connected through a **VirtualBox private network** (also called host-only network). Think of it as a virtual Ethernet switch that connects all VMs together:

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Virtual Network Switch                             │
│                  Subnet: 192.168.56.0/24                           │
│                                                                     │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐      │
│   │k8s-master│   │k8s-worker│   │k8s-worker│   │  devops  │      │
│   │ .56.10   │   │  1       │   │  2       │   │  .56.20  │      │
│   │          │   │ .56.11   │   │ .56.12   │   │          │      │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘      │
│        │              │              │              │              │
│   ─────┴──────────────┴──────────────┴──────────────┴──────────── │
└─────────────────────────────────────────────────────────────────────┘
```

**Every VM can reach every other VM** using these IP addresses. For example:
- From devops, you can do: `ping 192.168.56.10` to reach the master
- From worker1, you can do: `ping 192.168.56.12` to reach worker2

### Name Resolution with /etc/hosts

Instead of remembering IP addresses, we add entries to `/etc/hosts` on each VM:

```
192.168.56.10  k8s-master
192.168.56.11  k8s-worker1
192.168.56.12  k8s-worker2
192.168.56.20  devops
```

After this, `ping k8s-master` works the same as `ping 192.168.56.10`.

### SSH Key Authentication

Ansible needs to connect from the **devops machine** to the other 3 VMs **without typing a password** every time. This is done using SSH key pairs:

```
                         SSH (passwordless)
devops ──────────────────────────────────────→ k8s-master
       ──────────────────────────────────────→ k8s-worker1
       ──────────────────────────────────────→ k8s-worker2
```

**How it works:**
1. On devops, we generate a key pair: a **private key** (stays on devops) and a **public key**
2. We copy the **public key** to each node's `~/.ssh/authorized_keys` file
3. Now when devops connects via SSH, the node checks if the key matches → access granted without password

This is what `scripts/setup-ssh-keys.sh` does automatically.

### Communication Ports

```
                    Port 6443 (Kubernetes API)
k8s-master ←──────────────────────────────── k8s-worker1, k8s-worker2, devops
                    Port 10250 (kubelet)
k8s-master ──────────────────────────────→ workers

                    Port 8080 (Jenkins Web UI)
devops ←──────────────────────────────────── Your Browser

                    Port 8081 (Nexus Web UI)
devops ←──────────────────────────────────── Your Browser

                    Port 8082 (Docker Registry)
devops ←──────────────────────────────────── All VMs (push/pull images)

                    Port 30080 (App NodePort)
workers ←─────────────────────────────────── Your Browser
```

---

## 2. Vagrantfile Explained

The Vagrantfile is a Ruby script that tells Vagrant how to create and configure VMs.

```ruby
Vagrant.configure("2") do |config|       # "2" = Vagrant config version 2

  config.vm.box = "ubuntu/jammy64"       # Base OS image: Ubuntu 22.04 LTS (Jammy)
                                          # Downloaded from Vagrant Cloud on first run
```

**The `$setup_hosts` variable** is a shell script embedded in the Vagrantfile:
```ruby
$setup_hosts = <<-SCRIPT               # Multi-line shell script stored in a variable
cat >> /etc/hosts <<EOF                 # Append these lines to /etc/hosts
192.168.56.10 k8s-master               # So "k8s-master" resolves to this IP
192.168.56.11 k8s-worker1
192.168.56.12 k8s-worker2
192.168.56.20 devops
EOF
SCRIPT
```

**Each VM block follows the same pattern:**
```ruby
config.vm.define "k8s-master" do |master|    # Define a VM named "k8s-master"
  master.vm.hostname = "k8s-master"          # Set the VM's hostname
  master.vm.network "private_network",       # Add a network interface on
    ip: "192.168.56.10"                      # this static IP

  master.vm.provider "virtualbox" do |vb|    # VirtualBox-specific settings:
    vb.name   = "k8s-master"                 #   Name shown in VirtualBox GUI
    vb.memory = 2048                         #   RAM in MB (2 GB)
    vb.cpus   = 2                            #   Number of CPU cores
  end

  master.vm.provision "shell",               # Run a shell script after boot:
    inline: $setup_hosts                     #   Add /etc/hosts entries

  master.vm.provision "shell", inline: <<-SHELL
    apt-get update -y                        # Update package lists
    apt-get install -y python3 python3-apt   # Install Python (required by Ansible)
  SHELL
end
```

**The DevOps VM is different** because it also installs Ansible:
```ruby
devops.vm.provider "virtualbox" do |vb|
  vb.memory = 3072                           # 3 GB RAM (more because it runs Jenkins + Nexus)
  vb.cpus   = 2
end

# Pre-installs Ansible so we can run playbooks from this VM
apt-get install -y python3 python3-pip ansible sshpass
```

---

## 3. Ansible Configuration

### `ansible.cfg` — How Ansible Behaves

```ini
[defaults]
inventory = inventory/hosts.ini     # Where to find the list of servers
remote_user = vagrant               # SSH username to use on remote machines
host_key_checking = False           # Don't ask "Are you sure?" for new SSH connections
timeout = 30                        # SSH connection timeout in seconds
forks = 10                          # How many servers to configure simultaneously
retry_files_enabled = False         # Don't create .retry files on failure

[privilege_escalation]
become = True                       # Use sudo on remote machines (default)
become_method = sudo                # Method to escalate privileges
become_user = root                  # Become this user
become_ask_pass = False             # Don't ask for sudo password
```

### `inventory/hosts.ini` — The Server List

An Ansible **inventory** tells Ansible which machines exist and how to reach them:

```ini
[masters]                                    # GROUP called "masters"
k8s-master ansible_host=192.168.56.10       # 1 host in this group

[workers]                                    # GROUP called "workers"
k8s-worker1 ansible_host=192.168.56.11      # 2 hosts in this group
k8s-worker2 ansible_host=192.168.56.12

[devops]                                     # GROUP called "devops"
devops ansible_host=192.168.56.20           # 1 host in this group

[k8s_cluster:children]                       # META-GROUP containing other groups
masters                                      # = k8s-master
workers                                      # + k8s-worker1 + k8s-worker2
                                             # Total: 3 hosts

[all:vars]                                   # Variables for ALL hosts
ansible_user=vagrant                         # SSH as "vagrant" user
ansible_ssh_private_key_file=~/.ssh/id_rsa   # Use this SSH private key
ansible_python_interpreter=/usr/bin/python3  # Python path on remote machines
```

**How groups work in playbooks:**
- `hosts: masters` → runs on `k8s-master` only (1 machine)
- `hosts: workers` → runs on `k8s-worker1` and `k8s-worker2` (2 machines)
- `hosts: k8s_cluster` → runs on all 3 K8s nodes
- `hosts: devops` → runs on `devops` only (1 machine)

---

## 4. Playbook 1: `common.yml`

**Purpose:** Prepare all Kubernetes nodes with the prerequisites that K8s needs to work.

**Runs on:** `k8s_cluster` = master + worker1 + worker2

```yaml
---                                          # YAML document start marker
- name: Common setup for all Kubernetes nodes  # Human-readable play name
  hosts: k8s_cluster                          # Target: all 3 K8s nodes
  become: yes                                 # Use sudo for all tasks
  tasks:                                      # List of tasks to execute:
```

### Task 1: Add /etc/hosts entries

```yaml
    - name: Add cluster hosts to /etc/hosts
      lineinfile:                          # Ansible module that manages single lines in a file
        path: /etc/hosts                   # File to modify
        line: "{{ item }}"                 # The line to add ({{ }} = variable interpolation)
        state: present                     # Ensure the line EXISTS (add if missing)
      loop:                                # Repeat this task for each item:
        - "192.168.56.10 k8s-master"       # item 1
        - "192.168.56.11 k8s-worker1"      # item 2
        - "192.168.56.12 k8s-worker2"      # item 3
        - "192.168.56.20 devops"           # item 4
```

**`lineinfile`** is smart: it only adds the line if it doesn't already exist. Running this twice won't create duplicates.

### Task 2: Disable swap

```yaml
    - name: Disable swap immediately
      command: swapoff -a                  # Run this shell command
      changed_when: false                  # Don't report as "changed" (cosmetic)
```

**WHY:** Kubernetes requires swap to be OFF. If swap is on, the kubelet service refuses to start. Swap is when Linux uses disk space as extra RAM — Kubernetes needs predictable memory performance, so it forbids this.

```yaml
    - name: Remove swap entry from /etc/fstab
      lineinfile:
        path: /etc/fstab                   # File that defines what mounts at boot
        regexp: '.*swap.*'                 # Find any line containing "swap"
        state: absent                      # DELETE that line
```

This ensures swap stays off after a reboot.

### Task 3: Load kernel modules

```yaml
    - name: Load kernel modules for containerd
      modprobe:                            # Ansible module to load Linux kernel modules
        name: "{{ item }}"
        state: present                     # Ensure the module IS loaded
      loop:
        - overlay                          # Needed for container filesystem layers (OverlayFS)
        - br_netfilter                     # Needed for bridge network traffic to pass through iptables
```

**WHY `overlay`:** Containers use a layered filesystem. When you pull an image with 5 layers, OverlayFS stacks them efficiently without copying files.

**WHY `br_netfilter`:** Kubernetes creates virtual network bridges. Without this module, network traffic crossing a bridge bypasses iptables rules, breaking Kubernetes Services and Network Policies.

```yaml
    - name: Ensure kernel modules load on boot
      copy:                                # Ansible module to create/copy files
        dest: /etc/modules-load.d/k8s.conf # File to create
        content: |                         # File contents (| = multi-line string):
          overlay
          br_netfilter
```

Files in `/etc/modules-load.d/` are read at boot to load kernel modules automatically.

### Task 4: Sysctl parameters

```yaml
    - name: Set sysctl params for Kubernetes
      sysctl:                              # Ansible module for kernel parameters
        name: "{{ item.key }}"             # Parameter name
        value: "{{ item.value }}"          # Parameter value
        sysctl_file: /etc/sysctl.d/k8s.conf  # Save to this file (persists after reboot)
        reload: yes                        # Apply immediately (sysctl -p)
      loop:
        - { key: "net.bridge.bridge-nf-call-iptables",  value: "1" }
        - { key: "net.bridge.bridge-nf-call-ip6tables", value: "1" }
        - { key: "net.ipv4.ip_forward",                 value: "1" }
```

| Parameter | What it does |
|---|---|
| `bridge-nf-call-iptables = 1` | Bridge traffic goes through iptables (IPv4). Required for K8s Services. |
| `bridge-nf-call-ip6tables = 1` | Same for IPv6. |
| `ip_forward = 1` | Allows a machine to forward packets between network interfaces. Essential for routing pod traffic between nodes. |

### Task 5: Install common packages

```yaml
    - name: Update apt cache
      apt:
        update_cache: yes                  # Run: apt-get update
        cache_valid_time: 3600             # Skip if cache is less than 1 hour old

    - name: Install prerequisite packages
      apt:
        name:                              # List of packages to install:
          - apt-transport-https            # Allow apt to use HTTPS repos
          - ca-certificates                # SSL certificates
          - curl                           # Download tool
          - gnupg                          # GPG for verifying package signatures
          - lsb-release                    # Linux Standard Base info
          - software-properties-common     # add-apt-repository command
        state: present                     # Ensure they ARE installed
```

---

## 5. Playbook 2: `install-containerd.yml`

**Purpose:** Install containerd (the container runtime) on all K8s nodes.

**What is containerd?** It's the software that actually runs containers. When Kubernetes says "start a container", it tells containerd to do it. (Docker used to do this, but modern K8s uses containerd directly.)

```yaml
    # Add Docker's signing key — proves packages haven't been tampered with
    - name: Add Docker GPG key
      apt_key:
        url: https://download.docker.com/linux/ubuntu/gpg
        state: present

    # Add Docker's package repository — containerd is distributed through it
    - name: Add Docker repository
      apt_repository:
        repo: "deb [arch=amd64] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
        # {{ ansible_distribution_release }} = "jammy" (auto-detected by Ansible)
        state: present
        filename: docker                   # Creates /etc/apt/sources.list.d/docker.list

    # Install containerd
    - name: Install containerd.io
      apt:
        name: containerd.io
        state: present
```

### The Critical Configuration

```yaml
    # Generate the default config file
    - name: Generate default containerd config
      shell: containerd config default > /etc/containerd/config.toml
      args:
        creates: /etc/containerd/config.toml  # Only run if file doesn't exist yet

    # Change cgroup driver to systemd
    - name: Set SystemdCgroup to true in containerd config
      replace:                             # Find-and-replace in a file
        path: /etc/containerd/config.toml
        regexp: 'SystemdCgroup = false'    # Find this text
        replace: 'SystemdCgroup = true'    # Replace with this
```

**WHY SystemdCgroup = true?**

Linux uses "cgroups" (control groups) to limit CPU/memory per process. There are two cgroup drivers: `cgroupfs` and `systemd`. Kubernetes defaults to `systemd`. If containerd uses `cgroupfs` while kubelet uses `systemd`, they fight over resources and **kubelet crashes**. They MUST use the same driver.

### Nexus Insecure Registry Config

```yaml
    - name: Add insecure registry config for Nexus
      blockinfile:                         # Add a block of text to a file
        path: /etc/containerd/config.toml
        marker: "# {mark} NEXUS REGISTRY CONFIG"  # Markers to identify this block
        insertafter: EOF                   # Add at end of file
        block: |
          [plugins."io.containerd.grpc.v1.cri".registry.mirrors."192.168.56.20:8082"]
            endpoint = ["http://192.168.56.20:8082"]
          [plugins."io.containerd.grpc.v1.cri".registry.configs."192.168.56.20:8082".tls]
            insecure_skip_verify = true
```

**WHY:** By default, containerd only pulls images from HTTPS registries. Our Nexus runs on plain HTTP (port 8082). This config tells containerd: "it's OK to use HTTP for 192.168.56.20:8082".

Without this, `kubectl apply` would fail with `ImagePullBackOff` because the workers can't pull from Nexus.

---

## 6. Playbook 3: `install-kubernetes.yml`

**Purpose:** Install the 3 Kubernetes tools on all K8s nodes.

**The 3 tools:**
| Tool | What it does | Where it runs |
|---|---|---|
| `kubeadm` | Bootstrap tool — initializes the cluster, generates certificates, creates join tokens | Used mainly on master |
| `kubelet` | The "agent" — runs on EVERY node, watches for pod assignments, starts/stops containers | All nodes (as a service) |
| `kubectl` | CLI tool — lets you interact with the cluster (`kubectl get pods`, `kubectl apply`, etc.) | Master + DevOps |

```yaml
  vars:
    kube_version: "1.29"                   # Pin to version 1.29
```

```yaml
    # Download the GPG key for the Kubernetes package repository
    - name: Download Kubernetes GPG key
      shell: |
        curl -fsSL https://pkgs.k8s.io/core:/stable:/v{{ kube_version }}/deb/Release.key \
          | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
      args:
        creates: /etc/apt/keyrings/kubernetes-apt-keyring.gpg
        # "creates" = skip this task if the file already exists (idempotent)
```

```yaml
    # Install the packages
    - name: Install Kubernetes packages
      apt:
        name:
          - kubelet
          - kubeadm
          - kubectl
        state: present

    # IMPORTANT: "hold" = prevent automatic upgrades
    - name: Hold Kubernetes packages at current version
      dpkg_selections:
        name: "{{ item }}"
        selection: hold                    # Like "apt-mark hold"
      loop:
        - kubelet
        - kubeadm
        - kubectl
```

**WHY hold?** Kubernetes requires all nodes to run the same version. If `apt upgrade` accidentally updates kubelet on one node but not others, the cluster can break. Holding prevents this.

---

## 7. Playbook 4: `init-master.yml`

**Purpose:** Initialize the Kubernetes cluster on the master node. This is THE most important playbook.

**Runs on:** `masters` only (k8s-master)

### The Main Command

```yaml
    - name: Initialize Kubernetes cluster with kubeadm
      command: >
        kubeadm init
        --apiserver-advertise-address=192.168.56.10
        --pod-network-cidr=192.168.0.0/16
        --node-name=k8s-master
      when: not kubeadm_init_check.stat.exists  # Only if not already initialized
```

**Breaking down the flags:**

| Flag | Value | Why |
|---|---|---|
| `--apiserver-advertise-address` | `192.168.56.10` | The IP that the API server listens on. Must be the private network IP so workers can reach it. Without this, it might bind to the NAT interface (10.0.2.15) which workers can't reach. |
| `--pod-network-cidr` | `192.168.0.0/16` | The IP range for pods. Calico's default is 192.168.0.0/16. Each node gets a subnet (e.g., node1 = 192.168.1.0/24, node2 = 192.168.2.0/24). |
| `--node-name` | `k8s-master` | Explicitly set the node name instead of using the hostname. |

**What `kubeadm init` does internally:**
1. Generates TLS certificates for secure communication
2. Starts the API server, controller-manager, scheduler as static pods
3. Creates the etcd database (stores all cluster state)
4. Generates a join token for workers
5. Writes `/etc/kubernetes/admin.conf` (the kubeconfig file)

### Setting Up kubeconfig

```yaml
    - name: Create .kube directory for vagrant user
      file:
        path: /home/vagrant/.kube
        state: directory
        owner: vagrant
        group: vagrant

    - name: Copy admin.conf to vagrant user kubeconfig
      copy:
        src: /etc/kubernetes/admin.conf    # Source file (on the remote machine)
        dest: /home/vagrant/.kube/config   # Destination
        remote_src: yes                    # Both src and dest are on the REMOTE machine
        owner: vagrant
        group: vagrant
```

**WHY:** `kubectl` looks for `~/.kube/config` to know:
- WHERE is the API server? (https://192.168.56.10:6443)
- WHAT credentials to use? (certificates)

Without this, every `kubectl` command would need `--kubeconfig /etc/kubernetes/admin.conf`.

### Installing Calico CNI

```yaml
    - name: Download Calico manifest
      get_url:
        url: https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml
        dest: /home/vagrant/calico.yaml

    - name: Apply Calico CNI
      become_user: vagrant                 # Run as vagrant (not root) because kubeconfig is in vagrant's home
      command: kubectl apply -f /home/vagrant/calico.yaml
```

**WHY Calico?** Kubernetes by itself doesn't provide pod networking. Pods on different nodes can't communicate without a CNI (Container Network Interface) plugin. Calico:
- Creates a virtual network overlay across all nodes
- Assigns IPs from the pod-network-cidr to each pod
- Routes traffic between pods on different nodes using BGP or VXLAN

```
Without Calico:                           With Calico:
Pod A (worker1) ──X── Pod B (worker2)     Pod A (worker1) ──✓── Pod B (worker2)
  No route between them!                    Calico routes traffic automatically
```

### Generate Join Command

```yaml
    - name: Generate kubeadm join command
      command: kubeadm token create --print-join-command
      register: join_command               # Store the output in a variable called "join_command"
```

The output looks like:
```
kubeadm join 192.168.56.10:6443 --token abcdef.0123456789abcdef --discovery-token-ca-cert-hash sha256:abc123...
```

This contains:
- **The API server address** (192.168.56.10:6443)
- **A token** (temporary password, expires in 24 hours)
- **A CA cert hash** (fingerprint to verify the master's identity)

---

## 8. Playbook 5: `join-workers.yml`

**Purpose:** Join both worker nodes to the cluster. This is a **two-play playbook**.

### Play 1: Get the join command from master

```yaml
- name: Get join command from master
  hosts: masters                           # Run ONLY on k8s-master
  become: yes
  tasks:
    - name: Get join command
      command: kubeadm token create --print-join-command
      register: join_command_raw           # Save output in "join_command_raw"

    - name: Set join command fact
      set_fact:                            # Save as an Ansible "fact" (persistent variable)
        join_command: "{{ join_command_raw.stdout }}"
```

**`set_fact`** is important because `register` variables are only accessible within the same play. `set_fact` makes the variable accessible from OTHER plays via `hostvars`.

### Play 2: Run join on workers

```yaml
- name: Join worker nodes to the cluster
  hosts: workers                           # Run on BOTH workers simultaneously
  become: yes
  tasks:
    - name: Check if node is already part of a cluster
      stat:
        path: /etc/kubernetes/kubelet.conf # This file exists only after joining
      register: kubelet_conf

    - name: Join node to Kubernetes cluster
      command: "{{ hostvars['k8s-master']['join_command'] }}"
      # hostvars['k8s-master'] = access variables from k8s-master host
      # ['join_command']       = get the join_command fact we set in Play 1
      when: not kubelet_conf.stat.exists   # Only if not already joined
```

**`hostvars` explained:** Ansible keeps variables for each host separately. `hostvars['k8s-master']['join_command']` means "get the `join_command` variable that belongs to `k8s-master`". This is how data flows between plays that target different hosts.

**What `kubeadm join` does on a worker:**
1. Contacts the API server at 192.168.56.10:6443
2. Verifies the master's identity using the CA cert hash
3. Downloads cluster certificates
4. Starts kubelet, which registers this node with the master
5. The node appears in `kubectl get nodes`

---

## 9. Playbook 6: `install-jenkins.yml`

**Purpose:** Install Jenkins (CI/CD server) on the devops machine.

**Runs on:** `devops` only

### Key Tasks Explained

```yaml
    # Jenkins requires Java to run
    - name: Install Java 17 JDK
      apt:
        name: openjdk-17-jdk

    # Jenkins is not in Ubuntu's default repos — add their official repo
    - name: Add Jenkins GPG key
      apt_key:
        url: https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key

    - name: Add Jenkins repository
      apt_repository:
        repo: "deb https://pkg.jenkins.io/debian-stable binary/"

    - name: Install Jenkins
      apt:
        name: jenkins
```

### Why Docker is Installed on DevOps

```yaml
    - name: Install Docker
      apt:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io
```

Jenkins needs Docker to **build Docker images** (`docker build`) and **push them to Nexus** (`docker push`). Without Docker on the devops machine, the CI/CD pipeline can't create container images.

### Adding Jenkins to Docker Group

```yaml
    - name: Add jenkins user to docker group
      user:
        name: jenkins                      # The user Jenkins service runs as
        groups: docker                     # Add to the "docker" group
        append: yes                        # Don't remove from other groups
```

**WHY:** By default, only `root` can run Docker commands. The Jenkins service runs as the `jenkins` user. Adding `jenkins` to the `docker` group lets Jenkins run `docker build` and `docker push` without `sudo`.

### Installing kubectl on DevOps

```yaml
    - name: Download kubectl binary
      get_url:
        url: "https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl"
        dest: /usr/local/bin/kubectl
        mode: '0755'                       # Make it executable
```

Jenkins needs `kubectl` to deploy applications to the Kubernetes cluster. The pipeline's last stage runs `kubectl apply -f deployment.yml`.

### Insecure Registry for Docker

```yaml
    - name: Create Docker daemon.json for insecure registry
      copy:
        dest: /etc/docker/daemon.json
        content: |
          {
            "insecure-registries": ["192.168.56.20:8082"]
          }
```

Same concept as with containerd — Docker needs to know that `192.168.56.20:8082` (Nexus) uses HTTP, not HTTPS.

---

## 10. Playbook 7: `install-nexus.yml`

**Purpose:** Install Nexus Repository Manager as a Docker container.

**What is Nexus?** It's a repository manager. We use it as a **private Docker registry** — a place to store our Docker images (like a private Docker Hub).

```yaml
    # Create a persistent storage directory
    - name: Create Nexus data directory
      file:
        path: /opt/nexus-data
        state: directory
        owner: "200"                       # Nexus runs as user ID 200 inside the container
        group: "200"

    # Run Nexus as a Docker container
    - name: Run Nexus container
      docker_container:                    # Ansible module for Docker containers
        name: nexus                        # Container name
        image: sonatype/nexus3:latest      # Official Nexus 3 image
        state: started
        restart_policy: always             # Auto-restart if it crashes or on reboot
        ports:
          - "8081:8081"                    # Nexus Web UI
          - "8082:8082"                    # Docker Registry port
        volumes:
          - "/opt/nexus-data:/nexus-data"  # Persist data outside the container
        env:
          INSTALL4J_ADD_VM_PARAMS: "-Xms512m -Xmx512m -XX:MaxDirectMemorySize=512m"
          # Limit Java memory to 512MB (Nexus is a Java app, can be memory-hungry)
```

**Volumes explained:** If we don't mount `/opt/nexus-data`, all Nexus data (repositories, users, images) would be lost when the container restarts. The volume maps the container's `/nexus-data` directory to the host's `/opt/nexus-data`.

### Waiting for Nexus to Start

```yaml
    - name: Wait for Nexus to start (may take 2-3 minutes)
      uri:                                 # Ansible module to make HTTP requests
        url: http://localhost:8081/service/rest/v1/status
        method: GET
        status_code: 200                   # Expected response code
      register: nexus_status
      until: nexus_status.status == 200    # Keep trying until we get 200
      retries: 30                          # Try up to 30 times
      delay: 10                            # Wait 10 seconds between retries
```

Nexus takes 2-3 minutes to start up. This task polls the health endpoint every 10 seconds until Nexus responds with HTTP 200 (OK).

---

## 11. Playbook 8: `configure-kubectl-devops.yml`

**Purpose:** Copy the Kubernetes access credentials from the master to the devops machine, so Jenkins can deploy to K8s.

### Play 1: Read kubeconfig from master

```yaml
    - name: Read kubeconfig from master
      slurp:                               # Ansible module to read a file and base64-encode it
        src: /etc/kubernetes/admin.conf
      register: kubeconfig_content

    - name: Set kubeconfig fact
      set_fact:
        kubeconfig_data: "{{ kubeconfig_content.content | b64decode }}"
        # kubeconfig_content.content is base64-encoded
        # | b64decode is a Jinja2 filter that decodes it back to plain text
```

**`slurp` explained:** Ansible can't directly copy a file between two remote machines. `slurp` reads the file content into memory, and then in Play 2 we write it on the devops machine.

### Play 2: Write kubeconfig on devops

```yaml
    # For the vagrant user (manual kubectl commands)
    - name: Write kubeconfig for vagrant user
      copy:
        content: "{{ hostvars['k8s-master']['kubeconfig_data'] }}"
        dest: /home/vagrant/.kube/config

    # For the jenkins user (CI/CD pipeline)
    - name: Write kubeconfig for jenkins user
      copy:
        content: "{{ hostvars['k8s-master']['kubeconfig_data'] }}"
        dest: /var/lib/jenkins/.kube/config
```

### Fix the API Server Address

```yaml
    - name: Update API server address in vagrant kubeconfig
      replace:
        path: /home/vagrant/.kube/config
        regexp: 'server: https://[^:]+:6443'      # Find the API server line
        replace: 'server: https://192.168.56.10:6443'  # Set to master's private IP
```

**WHY:** The kubeconfig generated by `kubeadm init` might contain the master's internal IP (like `10.0.2.15` — the Vagrant NAT interface). The devops machine can't reach that IP. We replace it with `192.168.56.10` (the private network IP that devops CAN reach).

---

## 12. Kubernetes YAML Files

### `deployment.yml` — What to Run

```yaml
apiVersion: apps/v1                        # Kubernetes API version
kind: Deployment                           # Resource type: Deployment
                                           # (manages a set of identical pods)
metadata:
  name: hello-devops                       # Name of this deployment
  labels:
    app: hello-devops                      # Label for identification

spec:
  replicas: 2                              # Run 2 copies of the pod (for high availability)
  selector:
    matchLabels:
      app: hello-devops                    # This deployment manages pods with this label

  template:                                # Template for the pods:
    metadata:
      labels:
        app: hello-devops                  # Label applied to each pod
    spec:
      containers:
        - name: hello-devops
          image: 192.168.56.20:8082/hello-devops:latest
          #       ↑ Nexus registry    ↑ image name   ↑ tag
          ports:
            - containerPort: 3000          # The app listens on port 3000
          resources:
            requests:                      # Minimum resources guaranteed:
              memory: "64Mi"               #   64 MB RAM
              cpu: "100m"                  #   0.1 CPU core (100 millicores)
            limits:                        # Maximum resources allowed:
              memory: "128Mi"              #   128 MB RAM
              cpu: "250m"                  #   0.25 CPU core

      imagePullSecrets:
        - name: nexus-registry-secret      # Kubernetes uses this secret to log into Nexus
```

**How the replica count works:**
```
Deployment (replicas: 2)
├── Pod 1: hello-devops-abc12  → runs on k8s-worker1
└── Pod 2: hello-devops-def34  → runs on k8s-worker2
```

Kubernetes automatically distributes pods across available worker nodes.

### `service.yml` — How to Access the App

```yaml
apiVersion: v1
kind: Service                              # A Service provides a stable endpoint for pods
metadata:
  name: hello-devops-service

spec:
  type: NodePort                           # Expose the service on every node's IP
  selector:
    app: hello-devops                      # Route traffic to pods with this label
  ports:
    - protocol: TCP
      port: 3000                           # The Service's internal port
      targetPort: 3000                     # Forward to this port on the pod
      nodePort: 30080                      # The external port on each node's IP
```

**NodePort explained:**
```
Browser → http://192.168.56.11:30080 → Service → Pod 1 or Pod 2
Browser → http://192.168.56.12:30080 → Service → Pod 1 or Pod 2
                                          ↑
                                   Load balances between pods
```

You can access the app through ANY node's IP on port 30080.

---

## 13. Jenkinsfile (CI/CD Pipeline)

The Jenkinsfile defines a **6-stage pipeline** that automates building and deploying the app:

```
Stage 1: Checkout       Pull code from Git
    ↓
Stage 2: Install        npm install (Node.js dependencies)
    ↓
Stage 3: Test           npm test (run unit tests)
    ↓
Stage 4: Build Image    docker build → creates container image
    ↓
Stage 5: Push to Nexus  docker push → uploads image to Nexus registry
    ↓
Stage 6: Deploy to K8s  kubectl apply → deploys to Kubernetes cluster
```

### Environment Variables

```groovy
environment {
    NEXUS_REGISTRY = "192.168.56.20:8082"       // Nexus Docker registry address
    IMAGE_NAME     = "hello-devops"              // Image name
    IMAGE_TAG      = "${BUILD_NUMBER}"           // Tag = Jenkins build number (1, 2, 3...)
    FULL_IMAGE     = "${NEXUS_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
    // Example: "192.168.56.20:8082/hello-devops:5"

    KUBE_CONFIG    = "/var/lib/jenkins/.kube/config"  // Path to kubeconfig
    NEXUS_CREDS    = credentials('nexus-docker-credentials')
    // ↑ Reads the username/password stored in Jenkins Credentials Manager
    // Creates: NEXUS_CREDS_USR (username) and NEXUS_CREDS_PSW (password)
}
```

### Deploy Stage

```groovy
stage('Deploy to Kubernetes') {
    steps {
        sh """
            export KUBECONFIG=${KUBE_CONFIG}

            # Try to update existing deployment's image:
            kubectl set image deployment/hello-devops \
                hello-devops=${FULL_IMAGE} \
                --record || \
            # If deployment doesn't exist yet, create it:
            kubectl apply -f kubernetes/deployment.yml

            kubectl apply -f kubernetes/service.yml

            # Wait for pods to be ready (max 120 seconds):
            kubectl rollout status deployment/hello-devops --timeout=120s
        """
    }
}
```

---

## 14. Sample Application

### `app.js` — Express.js Web Server

```javascript
const express = require('express');        // Import Express framework
const app = express();
const PORT = process.env.PORT || 3000;     // Use env var or default to 3000

app.get('/', (req, res) => {               // Handle GET requests to "/"
  res.json({
    message: 'Hello DevOps!',
    hostname: require('os').hostname(),    // Shows pod name in Kubernetes
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, '0.0.0.0', () => {        // Listen on all interfaces
  console.log(`App running on port ${PORT}`);
});
```

### `Dockerfile` — Build the Container Image

```dockerfile
FROM node:18-alpine AS builder            # Stage 1: Use Node.js 18 on Alpine Linux
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production              # Install ONLY prod dependencies (faster, no dev deps)

FROM node:18-alpine                        # Stage 2: Fresh, clean image
WORKDIR /app
RUN addgroup -g 1001 -S appgroup && \      # Create non-root user (security best practice)
    adduser -S appuser -u 1001 -G appgroup
COPY --from=builder /app/node_modules ./node_modules  # Copy deps from stage 1
COPY app.js ./
USER appuser                              # Run as non-root
EXPOSE 3000
CMD ["node", "app.js"]                    # Start the app
```

**Why multi-stage?** Stage 1 installs dependencies (which downloads extra tools). Stage 2 starts clean and only copies what's needed. Result: smaller, more secure image.

---

## 15. Complete Execution Flow Summary

```
STEP 1: vagrant up
    Creates 4 VMs on private network 192.168.56.0/24
    Each VM gets Ubuntu 22.04, /etc/hosts entries, and Python

STEP 2: setup-ssh-keys.sh (on devops)
    Generates SSH key pair on devops
    Copies public key to master, worker1, worker2
    Now devops can SSH to all nodes without password

STEP 3: ansible-playbook common.yml
    On master, worker1, worker2:
    → disable swap, load kernel modules, set sysctl params

STEP 4: ansible-playbook install-containerd.yml
    On master, worker1, worker2:
    → install containerd, configure systemd cgroups + Nexus registry

STEP 5: ansible-playbook install-kubernetes.yml
    On master, worker1, worker2:
    → install kubeadm, kubelet, kubectl v1.29

STEP 6: ansible-playbook init-master.yml
    On master ONLY:
    → kubeadm init, setup kubeconfig, install Calico, generate join token

STEP 7: ansible-playbook join-workers.yml
    Read join command from master → run on worker1 and worker2
    → Both workers register with the master

STEP 8: ansible-playbook install-jenkins.yml
    On devops ONLY:
    → install Java, Jenkins, Docker, kubectl

STEP 9: ansible-playbook install-nexus.yml
    On devops ONLY:
    → run Nexus as Docker container (ports 8081, 8082)

STEP 10: ansible-playbook configure-kubectl-devops.yml
    Copy kubeconfig from master → devops
    → Jenkins can now run kubectl commands against the cluster

RESULT:
    ✅ 3-node Kubernetes cluster fully operational
    ✅ Jenkins CI/CD server ready
    ✅ Nexus private Docker registry ready
    ✅ Pipeline can build → push → deploy automatically
```

---

*Document prepared for the DevOps & Kubernetes Cluster Project.*
*Last updated: March 2026*
