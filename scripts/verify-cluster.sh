#!/bin/bash
# ==============================================================================
# Cluster Verification Script
# Run this script from the MASTER node or DevOps machine (with kubectl configured)
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================"
echo "  Kubernetes Cluster Verification"
echo "============================================"
echo ""

# ------------------------------------------------------------------
# 1. Check node status
# ------------------------------------------------------------------
echo -e "${YELLOW}[1/8] Checking node status...${NC}"
kubectl get nodes -o wide
echo ""

NODE_COUNT=$(kubectl get nodes --no-headers | wc -l)
READY_COUNT=$(kubectl get nodes --no-headers | grep -c "Ready")
if [ "$READY_COUNT" -eq 3 ]; then
    echo -e "${GREEN}✅ All 3 nodes are Ready${NC}"
else
    echo -e "${RED}❌ Expected 3 Ready nodes, found ${READY_COUNT}${NC}"
fi
echo ""

# ------------------------------------------------------------------
# 2. Check system pods
# ------------------------------------------------------------------
echo -e "${YELLOW}[2/8] Checking kube-system pods...${NC}"
kubectl get pods -n kube-system
echo ""

# ------------------------------------------------------------------
# 3. Check Calico pods
# ------------------------------------------------------------------
echo -e "${YELLOW}[3/8] Checking Calico CNI pods...${NC}"
CALICO_PODS=$(kubectl get pods -n kube-system -l k8s-app=calico-node --no-headers 2>/dev/null | wc -l)
if [ "$CALICO_PODS" -ge 3 ]; then
    echo -e "${GREEN}✅ Calico is running on all nodes (${CALICO_PODS} pods)${NC}"
else
    echo -e "${RED}❌ Expected 3 Calico pods, found ${CALICO_PODS}${NC}"
fi
echo ""

# ------------------------------------------------------------------
# 4. Check cluster info
# ------------------------------------------------------------------
echo -e "${YELLOW}[4/8] Cluster info...${NC}"
kubectl cluster-info
echo ""

# ------------------------------------------------------------------
# 5. Check component status
# ------------------------------------------------------------------
echo -e "${YELLOW}[5/8] Component status...${NC}"
kubectl get componentstatuses 2>/dev/null || echo "Component statuses not available (normal in newer K8s versions)"
echo ""

# ------------------------------------------------------------------
# 6. Check namespaces
# ------------------------------------------------------------------
echo -e "${YELLOW}[6/8] Namespaces...${NC}"
kubectl get namespaces
echo ""

# ------------------------------------------------------------------
# 7. Test pod deployment
# ------------------------------------------------------------------
echo -e "${YELLOW}[7/8] Testing pod deployment with nginx...${NC}"
kubectl run test-nginx --image=nginx --restart=Never --port=80 2>/dev/null || true
sleep 5
kubectl get pod test-nginx
echo ""

# Clean up test pod
kubectl delete pod test-nginx --ignore-not-found=true 2>/dev/null
echo -e "${GREEN}✅ Test pod cleanup done${NC}"
echo ""

# ------------------------------------------------------------------
# 8. Check application deployment (if exists)
# ------------------------------------------------------------------
echo -e "${YELLOW}[8/8] Checking hello-devops application...${NC}"
if kubectl get deployment hello-devops &>/dev/null; then
    echo -e "${GREEN}✅ hello-devops deployment found${NC}"
    kubectl get deployment hello-devops
    kubectl get pods -l app=hello-devops
    kubectl get svc hello-devops-service
    
    # Test the service
    NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    echo ""
    echo "Try accessing the app:"
    echo "  curl http://${NODE_IP}:30080"
else
    echo "hello-devops deployment not found (deploy it with: kubectl apply -f /vagrant/kubernetes/)"
fi
echo ""

echo "============================================"
echo "  Verification Complete!"
echo "============================================"
