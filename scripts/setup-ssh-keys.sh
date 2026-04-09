#!/bin/bash
# ==============================================================================
# SSH Key Setup Script
# Run this script FROM the DevOps machine to distribute SSH keys to all nodes
# ==============================================================================

set -e

echo "============================================"
echo "  SSH Key Distribution Script"
echo "============================================"

NODES=("192.168.56.10" "192.168.56.11" "192.168.56.12")
HOSTNAMES=("k8s-master" "k8s-worker1" "k8s-worker2")
USER="vagrant"
PASSWORD="vagrant"

# Step 1: Generate SSH key pair (if not exists)
if [ ! -f ~/.ssh/id_rsa ]; then
    echo "[1/4] Generating SSH key pair..."
    ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N "" -C "devops@cluster"
    echo "  SSH key pair generated"
else
    echo "[1/4] SSH key pair already exists, skipping..."
fi

# Step 2: Install sshpass if not present
if ! command -v sshpass &> /dev/null; then
    echo "[2/4] Installing sshpass..."
    sudo apt-get update -y && sudo apt-get install -y sshpass
else
    echo "[2/4] sshpass already installed, skipping..."
fi

# Step 3: Copy SSH key to all nodes
echo "[3/4] Distributing SSH key to cluster nodes..."
for i in "${!NODES[@]}"; do
    IP="${NODES[$i]}"
    HOSTNAME="${HOSTNAMES[$i]}"
    echo "  Copying key to ${HOSTNAME} (${IP})..."
    sshpass -p "${PASSWORD}" ssh-copy-id -o StrictHostKeyChecking=no -o PubkeyAuthentication=no ${USER}@${IP} 2>&1
    if [ $? -eq 0 ]; then
        echo "  ${HOSTNAME} done"
    else
        echo "  FAILED for ${HOSTNAME}. Trying alternative method..."
        # Alternative: manually append the key
        cat ~/.ssh/id_rsa.pub | sshpass -p "${PASSWORD}" ssh -o StrictHostKeyChecking=no -o PubkeyAuthentication=no ${USER}@${IP} "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
        echo "  ${HOSTNAME} done (alternative method)"
    fi
done

# Step 4: Test connectivity
echo ""
echo "[4/4] Testing SSH connectivity..."
ALL_OK=true
for i in "${!NODES[@]}"; do
    IP="${NODES[$i]}"
    HOSTNAME="${HOSTNAMES[$i]}"
    RESULT=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${USER}@${IP} "hostname" 2>/dev/null)
    if [ "$RESULT" = "$HOSTNAME" ]; then
        echo "  ${HOSTNAME}: OK"
    else
        echo "  ${HOSTNAME}: FAILED"
        ALL_OK=false
    fi
done

echo ""
echo "============================================"
if [ "$ALL_OK" = true ]; then
    echo "  All SSH connections successful!"
else
    echo "  Some connections failed. See above."
fi
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Sync ansible files:  sync-ansible"
echo "  2. Go to ansible dir:   cd ~/ansible"
echo "  3. Test ansible:        ansible all -m ping"
echo "============================================"
