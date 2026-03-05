# -*- mode: ruby -*-
# vi: set ft=ruby :

# ==============================================================================
# DevOps & Kubernetes Cluster - Vagrantfile
# ==============================================================================
# VMs:
#   k8s-master  -> 192.168.56.10 (Control Plane)
#   k8s-worker1 -> 192.168.56.11 (Worker)
#   k8s-worker2 -> 192.168.56.12 (Worker)
#   devops      -> 192.168.56.20 (Jenkins + Nexus + Ansible)
# ==============================================================================

# Shared /etc/hosts entries for all VMs
$setup_hosts = <<-SCRIPT
cat >> /etc/hosts <<EOF
192.168.56.10 k8s-master
192.168.56.11 k8s-worker1
192.168.56.12 k8s-worker2
192.168.56.20 devops
EOF
SCRIPT

# Enable password authentication on all K8s nodes so SSH key distribution works
$enable_password_auth = <<-SCRIPT
# Enable password authentication in SSH
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication yes/' /etc/ssh/sshd_config

# Also check sshd_config.d/ for overrides (Ubuntu 22.04 uses drop-in files)
if [ -d /etc/ssh/sshd_config.d ]; then
  for f in /etc/ssh/sshd_config.d/*.conf; do
    if [ -f "$f" ]; then
      sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' "$f"
    fi
  done
fi

# Set vagrant user password to "vagrant" (in case it's not set)
echo 'vagrant:vagrant' | chpasswd

# Restart SSH service to apply changes
systemctl restart sshd
SCRIPT

# Setup script for devops: copy ansible config to home dir to avoid world-writable issue
$setup_ansible_env = <<-SCRIPT
# Copy ansible directory to vagrant home to avoid world-writable /vagrant issue
cp -r /vagrant/ansible /home/vagrant/ansible 2>/dev/null || true
chown -R vagrant:vagrant /home/vagrant/ansible 2>/dev/null || true

# Add environment variable and alias for convenience
cat >> /home/vagrant/.bashrc <<'BASHEOF'

# Ansible configuration
export ANSIBLE_CONFIG=/home/vagrant/ansible/ansible.cfg
alias sync-ansible='cp -r /vagrant/ansible /home/vagrant/ansible && chown -R vagrant:vagrant /home/vagrant/ansible && echo "Ansible files synced!"'
alias run-playbook='cd /home/vagrant/ansible && ansible-playbook'
BASHEOF
SCRIPT

Vagrant.configure("2") do |config|

  config.vm.box = "ubuntu/jammy64"

  # Disable default synced folder for performance
  config.vm.synced_folder ".", "/vagrant", disabled: false

  # ========================= KUBERNETES MASTER =========================
  config.vm.define "k8s-master" do |master|
    master.vm.hostname = "k8s-master"
    master.vm.network "private_network", ip: "192.168.56.10"

    master.vm.provider "virtualbox" do |vb|
      vb.name   = "k8s-master"
      vb.memory = 2048
      vb.cpus   = 2
    end

    master.vm.provision "shell", inline: $setup_hosts
    master.vm.provision "shell", inline: $enable_password_auth
    master.vm.provision "shell", inline: <<-SHELL
      apt-get update -y
      apt-get install -y python3 python3-apt
    SHELL
  end

  # ========================= KUBERNETES WORKER 1 =========================
  config.vm.define "k8s-worker1" do |worker|
    worker.vm.hostname = "k8s-worker1"
    worker.vm.network "private_network", ip: "192.168.56.11"

    worker.vm.provider "virtualbox" do |vb|
      vb.name   = "k8s-worker1"
      vb.memory = 2048
      vb.cpus   = 2
    end

    worker.vm.provision "shell", inline: $setup_hosts
    worker.vm.provision "shell", inline: $enable_password_auth
    worker.vm.provision "shell", inline: <<-SHELL
      apt-get update -y
      apt-get install -y python3 python3-apt
    SHELL
  end

  # ========================= KUBERNETES WORKER 2 =========================
  config.vm.define "k8s-worker2" do |worker|
    worker.vm.hostname = "k8s-worker2"
    worker.vm.network "private_network", ip: "192.168.56.12"

    worker.vm.provider "virtualbox" do |vb|
      vb.name   = "k8s-worker2"
      vb.memory = 2048
      vb.cpus   = 2
    end

    worker.vm.provision "shell", inline: $setup_hosts
    worker.vm.provision "shell", inline: $enable_password_auth
    worker.vm.provision "shell", inline: <<-SHELL
      apt-get update -y
      apt-get install -y python3 python3-apt
    SHELL
  end

  # ========================= DEVOPS MACHINE =========================
  config.vm.define "devops" do |devops|
    devops.vm.hostname = "devops"
    devops.vm.network "private_network", ip: "192.168.56.20"

    devops.vm.provider "virtualbox" do |vb|
      vb.name   = "devops"
      vb.memory = 3072
      vb.cpus   = 2
    end

    devops.vm.provision "shell", inline: $setup_hosts
    devops.vm.provision "shell", inline: <<-SHELL
      apt-get update -y
      apt-get install -y python3 python3-pip ansible sshpass
    SHELL
    devops.vm.provision "shell", inline: $setup_ansible_env
  end

end