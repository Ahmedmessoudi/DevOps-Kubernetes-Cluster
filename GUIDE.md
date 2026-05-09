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
9. [Playbook 6: configure-insecure-registry.yml](#9-playbook-6-configure-insecure-registryyml)
10. [Playbook 7: configure-kubectl-devops.yml](#10-playbook-7-configure-kubectl-devopsyml)
11. [Playbook 8: install-jenkins.yml](#11-playbook-8-install-jenkinsyml)
12. [Playbook 9: install-gitea.yml](#12-playbook-9-install-giteayml)
13. [Playbook 10: install-nexus.yml](#13-playbook-10-install-nexusyml)
14. [Playbook 11: setup-nfs-server.yml](#14-playbook-11-setup-nfs-serveryml)
15. [Playbook 12: setup-nfs-postgres.yml](#15-playbook-12-setup-nfs-postgresyml)
16. [Playbook 13: setup-nfs-clients.yml](#16-playbook-13-setup-nfs-clientsyml)
17. [Kubernetes YAML Files](#17-kubernetes-yaml-files)
18. [Jenkinsfile (CI/CD Pipeline)](#18-jenkinsfile-cicd-pipeline)
19. [Jenkinsfile.fullstack (Fullstack Pipeline)](#19-jenkinsfilefullstack-fullstack-pipeline)
20. [Deep Dives (Line-by-Line)](#20-deep-dives-line-by-line)
21. [Sample Application](#21-sample-application)
22. [Complete Execution Flow Summary](#22-complete-execution-flow-summary)

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

                    Port 32000 (Jenkins Web UI)
workers ←─────────────────────────────────── Your Browser

                    Port 32001 (Jenkins Agent)
workers ←─────────────────────────────────── Jenkins agents

                    Port 3000 (Gitea Web UI)
devops ←──────────────────────────────────── Your Browser

                    Port 8081 (Nexus Web UI)
devops ←──────────────────────────────────── Your Browser

                    Port 8082 (Docker Registry)
devops ←──────────────────────────────────── All VMs (push/pull images)

                    Port 30080 (Sample App NodePort)
workers ←─────────────────────────────────── Your Browser

                    Port 30090 (Fullstack Frontend NodePort)
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

### Nexus Registry via hosts.toml (Modern containerd)

```yaml
    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = [''"].*[''"]'
        replace: 'config_path = "/etc/containerd/certs.d"'

    - name: Create Nexus registry hosts.toml config
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
```

**WHY:** containerd now prefers `hosts.toml` under `/etc/containerd/certs.d`. This keeps `config.toml` clean and avoids deprecated `grpc.v1.cri` registry blocks. Without this, image pulls from Nexus (HTTP) fail with `ImagePullBackOff`.

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

## 9. Playbook 6: `configure-insecure-registry.yml`

**Purpose:** Clean up deprecated containerd registry config and configure the Nexus HTTP registry using `hosts.toml`.

**Runs on:** `k8s_cluster` (master + workers)

### Remove old registry config (containerd v2.x compatibility)

```yaml
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
```

**WHY:** containerd v2 treats the old `grpc.v1.cri` registry config as deprecated. Removing it prevents config parsing errors.

### Use hosts.toml via config_path

```yaml
    - name: Ensure correct single-path config_path in containerd config
      replace:
        path: /etc/containerd/config.toml
        regexp: 'config_path = [''"].*[''"]'
        replace: 'config_path = "/etc/containerd/certs.d"'

    - name: Write hosts.toml for Nexus HTTP registry
      copy:
        dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
        content: |
          server = "http://192.168.56.20:8082"

          [host."http://192.168.56.20:8082"]
            capabilities = ["pull", "resolve", "push"]
            skip_verify = true
```

**WHY:** `hosts.toml` is the modern, safe way to configure HTTP registries without corrupting `config.toml`.

### Restart and verify

```yaml
    - name: Restart containerd
      systemd:
        name: containerd
        state: restarted

    - name: Test image pull from Nexus
      shell: |
        crictl --image-endpoint unix:///run/containerd/containerd.sock pull 192.168.56.20:8082/fullstack-backend:latest 2>&1
```

---

## 10. Playbook 7: `configure-kubectl-devops.yml`

**Purpose:** Copy kubeconfig from master to the devops machine and to NFS for the Jenkins pod.

### Play 1: Read kubeconfig from master

```yaml
    - name: Read kubeconfig from master
      slurp:
        src: /etc/kubernetes/admin.conf
      register: kubeconfig_content

    - name: Set kubeconfig fact
      set_fact:
        kubeconfig_data: "{{ kubeconfig_content.content | b64decode }}"
```

### Play 2: Write kubeconfig on devops and fix API server IP

```yaml
    - name: Write kubeconfig for vagrant user
      copy:
        content: "{{ hostvars['k8s-master']['kubeconfig_data'] }}"
        dest: /home/vagrant/.kube/config

    - name: Update API server address in vagrant kubeconfig
      replace:
        path: /home/vagrant/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'
```

### Play 3: Copy kubeconfig to NFS for Jenkins pod

```yaml
    - name: Write kubeconfig to NFS Jenkins home
      copy:
        src: /etc/kubernetes/admin.conf
        dest: /srv/nfs/jenkins/.kube/config
        remote_src: yes

    - name: Update API server address in Jenkins kubeconfig
      replace:
        path: /srv/nfs/jenkins/.kube/config
        regexp: 'server: https://[^:]+:6443'
        replace: 'server: https://192.168.56.10:6443'
```

**WHY:** Jenkins runs as a Kubernetes pod and mounts `/srv/nfs/jenkins` as its home. Putting the kubeconfig there allows pipelines to call `kubectl` directly from the pod.

---

## 11. Playbook 8: `install-jenkins.yml`

**Purpose:** Install Docker and kubectl on the devops machine. **Jenkins itself now runs inside Kubernetes.**

**Note:** This playbook no longer installs the Jenkins package on the VM.

```yaml
    - name: Install Java 17 JDK
      apt:
        name: openjdk-17-jdk

    - name: Install Docker
      apt:
        name:
          - docker-ce
          - docker-ce-cli
          - containerd.io

    - name: Add vagrant user to docker group
      user:
        name: vagrant
        groups: docker
        append: yes

    - name: Download kubectl binary
      get_url:
        url: "https://dl.k8s.io/release/v1.29.0/bin/linux/amd64/kubectl"
        dest: /usr/local/bin/kubectl

    - name: Create Docker daemon.json for insecure registry
      copy:
        dest: /etc/docker/daemon.json
        content: |
          {
            "insecure-registries": ["192.168.56.20:8082"]
          }
```

**WHY:** DevOps still needs Docker to build images locally and run Nexus, and kubectl for manual cluster operations.

---

## 12. Playbook 9: `install-gitea.yml`

**Purpose:** Install Gitea natively on the devops machine as a systemd service.

```yaml
    - name: Create git user for Gitea
      user:
        name: git
        system: yes

    - name: Download Gitea binary
      get_url:
        url: "https://dl.gitea.com/gitea/{{ gitea_version }}/gitea-{{ gitea_version }}-linux-amd64"
        dest: /usr/local/bin/gitea

    - name: Download Gitea systemd service file
      get_url:
        url: "https://raw.githubusercontent.com/go-gitea/gitea/main/contrib/systemd/gitea.service"
        dest: /etc/systemd/system/gitea.service

    - name: Ensure Gitea service starts on boot and is running
      systemd:
        name: gitea
        enabled: yes
        state: started
```

**WHY:** Running Gitea directly on the devops VM keeps Git storage outside the Kubernetes cluster while still allowing in-cluster access via a Service/Endpoints object.

---

## 13. Playbook 10: `install-nexus.yml`

**Purpose:** Install Nexus Repository Manager as a Docker container on devops.

### Time sync and Docker SDK

```yaml
    - name: Synchronize system clock
      command: ntpdate -u pool.ntp.org

    - name: Install Docker SDK for Python
      pip:
        name: docker
```

**WHY:** Nexus can fail TLS checks if the VM clock is off; Ansible Docker modules require the Docker SDK.

### Run Nexus

```yaml
    - name: Create Nexus data directory
      file:
        path: /opt/nexus-data
        owner: "200"
        group: "200"

    - name: Run Nexus container
      docker_container:
        name: nexus
        image: sonatype/nexus3:latest
        ports:
          - "8081:8081"
          - "8082:8082"
        volumes:
          - "/opt/nexus-data:/nexus-data"
```

**WHY:** `/opt/nexus-data` persists all repositories and credentials.

---

## 14. Playbook 11: `setup-nfs-server.yml`

**Purpose:** Create NFS exports for Jenkins and shared data on the master.

```yaml
    - name: Create Jenkins NFS directory
      file:
        path: /srv/nfs/jenkins
        owner: "1000"
        group: "1000"

    - name: Configure NFS exports
      copy:
        dest: /etc/exports
        content: |
          /srv/nfs/jenkins  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
          /srv/nfs/data     192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)
```

**WHY:** Jenkins runs in a pod, so its home directory must persist outside the container.

---

## 15. Playbook 12: `setup-nfs-postgres.yml`

**Purpose:** Add `/srv/nfs/postgres` export for PostgreSQL persistent storage.

```yaml
    - name: Create PostgreSQL NFS directory
      file:
        path: /srv/nfs/postgres
        owner: "70"
        group: "70"
        mode: '0700'

    - name: Add PostgreSQL NFS export
      lineinfile:
        path: /etc/exports
        line: "/srv/nfs/postgres  192.168.56.0/24(rw,sync,no_subtree_check,no_root_squash)"
```

**WHY:** The PostgreSQL pod uses an NFS-backed PersistentVolume to keep data across restarts.

---

## 16. Playbook 13: `setup-nfs-clients.yml`

**Purpose:** Install NFS client tools on worker nodes and devops.

```yaml
    - name: Install NFS client packages
      apt:
        name:
          - nfs-common

    - name: Test NFS server reachability
      command: showmount -e 192.168.56.10
```

**WHY:** Workers must be able to mount NFS volumes for Jenkins and PostgreSQL PVs.

---

## 17. Kubernetes YAML Files

### Registry Secret (Nexus)

**File:** `kubernetes/nexus-secret.yml`

This file is a **template only**. The real secret is created with `kubectl`:

```yaml
# kubectl create secret docker-registry nexus-registry-secret \
#   --docker-server=192.168.56.20:8082 \
#   --docker-username=admin \
#   --docker-password=YOUR_NEXUS_PASSWORD \
#   --docker-email=admin@example.com
```

Pods use `imagePullSecrets: nexus-registry-secret` to pull images from Nexus.

---

### Sample App: hello-devops

**Files:** `kubernetes/deployment.yml`, `kubernetes/service.yml`

```yaml
kind: Deployment
spec:
  replicas: 2
  template:
    spec:
      containers:
        - image: 192.168.56.20:8082/hello-devops:latest
      imagePullSecrets:
        - name: nexus-registry-secret
```

```yaml
kind: Service
spec:
  type: NodePort
  ports:
    - port: 3000
      targetPort: 3000
      nodePort: 30080
```

**Result:** `http://<worker-ip>:30080` routes to 2 replicas.

---

### Gitea External Service

**File:** `kubernetes/gitea/gitea-external-service.yml`

```yaml
kind: Service
spec:
  ports:
    - port: 3000
---
kind: Endpoints
subsets:
  - addresses:
      - ip: 192.168.56.20
    ports:
      - port: 3000
```

**WHY:** Pods can reach Gitea using `http://gitea.gitea.svc.cluster.local:3000` even though Gitea runs outside the cluster.

---

### Jenkins (Runs Inside Kubernetes)

**Files:**
- `kubernetes/jenkins/namespace.yml`
- `kubernetes/jenkins/deployment.yml`
- `kubernetes/jenkins/service.yml`
- `kubernetes/jenkins/rbac.yml`
- `kubernetes/jenkins/nfs-pv-pvc.yml`

**Key ideas:**
- Jenkins controller runs as a pod with a **DinD sidecar**.
- NFS-backed PVC persists `/var/jenkins_home`.
- Node affinity avoids scheduling on the control-plane.
- Service exposes ports `32000` (UI) and `32001` (agents).

```yaml
kind: Deployment
spec:
  template:
    spec:
      serviceAccountName: jenkins
      initContainers:
        - name: install-docker-cli
          image: docker:latest
      containers:
        - name: jenkins
          image: jenkins/jenkins:lts-jdk17
        - name: dind
          image: docker:dind
          securityContext:
            privileged: true
```

```yaml
kind: Service
spec:
  type: NodePort
  ports:
    - port: 8080
      nodePort: 32000
    - port: 50000
      nodePort: 32001
```

---

### Fullstack App (Task Manager)

**Namespace:** `kubernetes/fullstack/namespace.yml`

```yaml
kind: Namespace
metadata:
  name: fullstack
  labels:
    pod-security.kubernetes.io/enforce: baseline
```

**Backend:** `kubernetes/fullstack/backend-deployment.yml`

```yaml
containers:
  - image: 192.168.56.20:8082/fullstack-backend:latest
    env:
      - name: PG_HOST
        value: "postgres-service"
    livenessProbe:
      httpGet:
        path: /health
        port: 5000
```

**Frontend:** `kubernetes/fullstack/frontend-deployment.yml`

```yaml
containers:
  - image: 192.168.56.20:8082/fullstack-frontend:latest
imagePullSecrets:
  - name: nexus-registry-secret
```

**PostgreSQL + Storage:**
- `kubernetes/fullstack/postgres-deployment.yml`
- `kubernetes/fullstack/postgres-service.yml`
- `kubernetes/fullstack/postgres-nfs-pv-pvc.yml`

```yaml
kind: PersistentVolume
spec:
  nfs:
    server: 192.168.56.10
    path: /srv/nfs/postgres
```

**Network Policies:** `kubernetes/fullstack/security-network-policies.yml`

```yaml
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**RBAC:** `kubernetes/fullstack/security-rbac.yml`

```yaml
kind: Role
rules:
  - resources: ["pods", "endpoints", "services"]
    verbs: ["get", "list", "watch"]
```

---

## 18. Jenkinsfile (CI/CD Pipeline)

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

    KUBECONFIG     = "/var/jenkins_home/.kube/config"  // Path to kubeconfig (NFS-backed Jenkins home)
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
            export KUBECONFIG=${KUBECONFIG}

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

## 19. Jenkinsfile.fullstack (Fullstack Pipeline)

The Jenkinsfile.fullstack defines a **5-stage pipeline** for the Task Manager app:

```
Stage 1: Checkout        Pull source code from Gitea
    ↓
Stage 2: Build Backend   docker build backend image
    ↓
Stage 3: Build Frontend  docker build frontend image
    ↓
Stage 4: Push Images     docker push both images to Nexus
    ↓
Stage 5: Deploy          kubectl apply fullstack manifests
```

### Key Environment Variables

```groovy
environment {
    NEXUS_REGISTRY  = "192.168.56.20:8082"
    BACKEND_IMAGE   = "fullstack-backend"
    FRONTEND_IMAGE  = "fullstack-frontend"
    IMAGE_TAG       = "${BUILD_NUMBER}"

    BACKEND_FULL    = "${NEXUS_REGISTRY}/${BACKEND_IMAGE}:${IMAGE_TAG}"
    FRONTEND_FULL   = "${NEXUS_REGISTRY}/${FRONTEND_IMAGE}:${IMAGE_TAG}"

    KUBECONFIG      = "/var/jenkins_home/.kube/config"
    DOCKER_HOST     = "tcp://localhost:2375"
    NEXUS_CREDS     = credentials('nexus-docker-credentials')
}
```

### Deploy Stage (What it applies)

```groovy
stage('Deploy to Kubernetes') {
  steps {
    sh """
      kubectl apply -f kubernetes/fullstack/namespace.yml
      kubectl apply -f kubernetes/fullstack/security-rbac.yml
      kubectl apply -f kubernetes/fullstack/security-network-policies.yml

      kubectl apply -f kubernetes/fullstack/postgres-nfs-pv-pvc.yml
      kubectl apply -f kubernetes/fullstack/postgres-deployment.yml
      kubectl apply -f kubernetes/fullstack/postgres-service.yml

      kubectl apply -f kubernetes/fullstack/backend-deployment.yml
      kubectl apply -f kubernetes/fullstack/backend-service.yml

      kubectl apply -f kubernetes/fullstack/frontend-deployment.yml
      kubectl apply -f kubernetes/fullstack/frontend-service.yml
    """
  }
}
```

**WHY:** The pipeline enforces the correct order: namespace → security → storage → database → backend → frontend.

---

## 20. Deep Dives (Line-by-Line)

### A) Playbook: `configure-insecure-registry.yml`

```yaml
- name: Remove old NEXUS INSECURE REGISTRY block from config.toml
  blockinfile:
    path: /etc/containerd/config.toml
    marker: "# {mark} NEXUS INSECURE REGISTRY"
    state: absent
```

**WHY:** Cleans legacy config that breaks containerd v2.x parsing.

```yaml
- name: Ensure correct single-path config_path in containerd config
  replace:
    path: /etc/containerd/config.toml
    regexp: 'config_path = [''"].*[''"]'
    replace: 'config_path = "/etc/containerd/certs.d"'
```

**WHY:** Forces containerd to load registry configs from `/etc/containerd/certs.d`.

```yaml
- name: Write hosts.toml for Nexus HTTP registry
  copy:
    dest: /etc/containerd/certs.d/192.168.56.20:8082/hosts.toml
    content: |
      server = "http://192.168.56.20:8082"

      [host."http://192.168.56.20:8082"]
        capabilities = ["pull", "resolve", "push"]
        skip_verify = true
```

**WHY:** Declares that Nexus is HTTP (not HTTPS) and enables pull/push for images.

```yaml
- name: Restart containerd
  systemd:
    name: containerd
    state: restarted
```

**WHY:** Reloads containerd to pick up the new registry config.

---

### B) Manifest: `kubernetes/jenkins/deployment.yml`

```yaml
spec:
  template:
    spec:
      serviceAccountName: jenkins
```

**WHY:** Jenkins needs RBAC permissions defined in `kubernetes/jenkins/rbac.yml`.

```yaml
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node-role.kubernetes.io/control-plane
                    operator: DoesNotExist
```

**WHY:** Prevents scheduling the Jenkins pod on the control-plane node.

```yaml
      initContainers:
        - name: install-docker-cli
          image: docker:latest
          command: ["sh", "-c", "cp /usr/local/bin/docker /docker-bin/docker"]
```

**WHY:** Copies the Docker CLI into a shared volume so Jenkins can use it.

```yaml
      containers:
        - name: jenkins
          env:
            - name: DOCKER_HOST
              value: "tcp://localhost:2375"
```

**WHY:** Tells Jenkins to use the DinD sidecar as its Docker daemon.

```yaml
        - name: dind
          image: docker:dind
          securityContext:
            privileged: true
```

**WHY:** DinD requires privileged mode to run a Docker daemon inside the pod.

---

## 21. Sample Application

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

## 22. Complete Execution Flow Summary

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
  → install containerd, set systemd cgroup driver, configure registry path

STEP 5: ansible-playbook install-kubernetes.yml
  On master, worker1, worker2:
  → install kubeadm, kubelet, kubectl v1.29

STEP 6: ansible-playbook init-master.yml
  On master ONLY:
  → kubeadm init, setup kubeconfig, install Calico, generate join token

STEP 7: ansible-playbook join-workers.yml
  Read join command from master → run on worker1 and worker2
  → Both workers register with the master

STEP 8: ansible-playbook configure-insecure-registry.yml
  On master, worker1, worker2:
  → remove deprecated config and set hosts.toml for Nexus HTTP registry

STEP 9: ansible-playbook setup-nfs-server.yml
  On master ONLY:
  → create NFS exports for Jenkins and shared data

STEP 10: ansible-playbook setup-nfs-postgres.yml
  On master ONLY:
  → add /srv/nfs/postgres export for database storage

STEP 11: ansible-playbook setup-nfs-clients.yml
  On workers + devops:
  → install NFS clients and verify mounts

STEP 12: ansible-playbook install-nexus.yml
  On devops ONLY:
  → run Nexus as Docker container (ports 8081, 8082)

STEP 13: ansible-playbook install-gitea.yml
  On devops ONLY:
  → run Gitea as systemd service (port 3000)

STEP 14: ansible-playbook install-jenkins.yml
  On devops ONLY:
  → install Docker + kubectl for DevOps tooling (Jenkins runs in K8s)

STEP 15: ansible-playbook configure-kubectl-devops.yml
  Copy kubeconfig from master → devops + NFS Jenkins home
  → Jenkins pod can run kubectl commands

STEP 16: kubectl apply -f kubernetes/...
  → deploy Jenkins, Gitea external service, sample app, and fullstack stack

RESULT:
  ✅ 3-node Kubernetes cluster fully operational
  ✅ Jenkins running in Kubernetes with DinD
  ✅ Nexus private Docker registry ready
  ✅ Gitea reachable inside cluster via Service/Endpoints
  ✅ Fullstack app deployed with RBAC + NetworkPolicies
```

---
