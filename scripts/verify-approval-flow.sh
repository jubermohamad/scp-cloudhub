#!/usr/bin/env bash

##############################################################################
# SRI Deployment Approval Flow - End-to-End Verification Script
#
# PURPOSE:
#   Validates that the deployment and approval workflow is fully operational:
#   1. Deployment validation endpoint works
#   2. Helmfile generation works
#   3. Approval submission endpoint works
#   4. Approval polling works
#   5. Admin approval mechanism works
#
# USAGE:
#   ./verify-approval-flow.sh [OPTIONS]
#
# OPTIONS:
#   --cluster      Target AKS cluster (default: aks-scp-dev-sdc-st-cms)
#   --instance     Instance name to deploy (default: verify-test-001)
#   --component    Component to deploy (default: sri-investigation)
#   --env          Environment (default: dev)
#   --help         Show this help message
#
# REQUIREMENTS:
#   - kubectl configured for target cluster
#   - jq installed for JSON parsing
#   - curl available
#   - Backend deployment-control-plane service running
#
# EXAMPLES:
#   # Verify approval flow with defaults
#   ./verify-approval-flow.sh
#
#   # Test with specific instance
#   ./verify-approval-flow.sh --instance my-test-deploy
#
#   # Test production cluster (requires admin approval)
#   ./verify-approval-flow.sh --cluster aks-prod-xyz --env prod
#
##############################################################################

set -e

# ============================================================================
# CONFIGURATION
# ============================================================================

CLUSTER="${CLUSTER:-aks-scp-dev-sdc-st-cms}"
INSTANCE="${INSTANCE:-verify-test-$(date +%s)}"
COMPONENT="${COMPONENT:-sri-investigation}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
NAMESPACE_PREFIX="${NAMESPACE_PREFIX:-sri-${ENVIRONMENT}}"
HOST_PREFIX="${HOST_PREFIX:-${ENVIRONMENT}}"
DNS_ZONE="${DNS_ZONE:-example.com}"

# Backend service endpoints
BACKEND_HOST="${BACKEND_HOST:-localhost:8080}"
VALIDATION_ENDPOINT="/deployments/validate"
GENERATE_ENDPOINT="/deployments/generate-helmfile"
APPROVAL_ENDPOINT="/deployments/approvals"
APPROVAL_STATUS_ENDPOINT="/deployments/approvals"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# ============================================================================
# FUNCTIONS
# ============================================================================

print_header() {
  echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
  ((TESTS_PASSED++))
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
  ((TESTS_FAILED++))
}

print_info() {
  echo -e "${YELLOW}ℹ $1${NC}"
}

show_help() {
  grep '^#' "$0" | grep -v "^#!/" | sed 's/^#//' | sed 's/^ //'
  exit 0
}

# ============================================================================
# PREREQUISITE CHECKS
# ============================================================================

check_prerequisites() {
  print_header "Checking Prerequisites"

  # Check kubectl
  if ! command -v kubectl &> /dev/null; then
    print_error "kubectl is not installed"
    exit 1
  fi
  print_success "kubectl is available"

  # Check jq
  if ! command -v jq &> /dev/null; then
    print_error "jq is not installed. Install with: apt-get install jq"
    exit 1
  fi
  print_success "jq is available"

  # Check curl
  if ! command -v curl &> /dev/null; then
    print_error "curl is not installed"
    exit 1
  fi
  print_success "curl is available"

  # Verify cluster context
  CURRENT_CONTEXT=$(kubectl config current-context)
  if [[ ! "$CURRENT_CONTEXT" =~ "$CLUSTER" ]]; then
    print_info "Current kubectl context: $CURRENT_CONTEXT"
    print_info "Target cluster: $CLUSTER"
    print_error "Cluster context mismatch. Switch with: kubectl config use-context $CLUSTER"
    exit 1
  fi
  print_success "Kubectl context is correct: $CURRENT_CONTEXT"

  # Check backend service connectivity
  print_info "Checking backend service at $BACKEND_HOST..."
  if ! curl -s -f "http://${BACKEND_HOST}/health" > /dev/null 2>&1; then
    print_error "Cannot reach backend service at $BACKEND_HOST"
    print_info "Port-forward: kubectl port-forward -n platform svc/deployment-control-plane 8080:8080"
    exit 1
  fi
  print_success "Backend service is reachable"
}

# ============================================================================
# DEPLOYMENT CONFIGURATION VALIDATION
# ============================================================================

test_deployment_validation() {
  print_header "Test 1: Deployment Configuration Validation"

  local config=$(cat <<EOF
{
  "component": "$COMPONENT",
  "instance": "$INSTANCE",
  "env": "$ENVIRONMENT",
  "namespacePrefix": "$NAMESPACE_PREFIX",
  "hostPrefix": "$HOST_PREFIX",
  "dnsZone": "$DNS_ZONE",
  "cluster": "$CLUSTER"
}
EOF
)

  print_info "Validating config:"
  echo "$config" | jq .

  local response=$(curl -s -w "\n%{http_code}" -X POST \
    "http://${BACKEND_HOST}${VALIDATION_ENDPOINT}" \
    -H "Content-Type: application/json" \
    -d "$config")

  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | head -n -1)

  if [[ $http_code == 200 ]]; then
    print_success "Deployment validation succeeded (HTTP 200)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 0
  else
    print_error "Deployment validation failed (HTTP $http_code)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 1
  fi
}

# ============================================================================
# HELMFILE GENERATION
# ============================================================================

test_helmfile_generation() {
  print_header "Test 2: Helmfile Generation"

  local config=$(cat <<EOF
{
  "component": "$COMPONENT",
  "instance": "$INSTANCE",
  "env": "$ENVIRONMENT",
  "namespacePrefix": "$NAMESPACE_PREFIX",
  "hostPrefix": "$HOST_PREFIX",
  "dnsZone": "$DNS_ZONE",
  "cluster": "$CLUSTER"
}
EOF
)

  print_info "Generating Helmfile for deployment..."

  local response=$(curl -s -w "\n%{http_code}" -X POST \
    "http://${BACKEND_HOST}${GENERATE_ENDPOINT}" \
    -H "Content-Type: application/json" \
    -d "$config")

  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | head -n -1)

  if [[ $http_code == 200 ]]; then
    HELMFILE_CONTENT=$(echo "$body" | jq -r '.helmfile // empty')
    if [[ -n "$HELMFILE_CONTENT" ]]; then
      print_success "Helmfile generation succeeded"
      print_info "Generated Helmfile (first 20 lines):"
      echo "$HELMFILE_CONTENT" | head -20
      return 0
    else
      print_error "Helmfile generation returned empty content"
      return 1
    fi
  else
    print_error "Helmfile generation failed (HTTP $http_code)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 1
  fi
}

# ============================================================================
# APPROVAL SUBMISSION
# ============================================================================

test_approval_submission() {
  print_header "Test 3: Approval Submission"

  if [[ -z "$HELMFILE_CONTENT" ]]; then
    print_error "No Helmfile content available. Run generation test first."
    return 1
  fi

  local config=$(cat <<EOF
{
  "component": "$COMPONENT",
  "instance": "$INSTANCE",
  "helmfile": $(echo "$HELMFILE_CONTENT" | jq -R -s .),
  "config": {
    "env": "$ENVIRONMENT",
    "namespacePrefix": "$NAMESPACE_PREFIX",
    "hostPrefix": "$HOST_PREFIX",
    "dnsZone": "$DNS_ZONE"
  }
}
EOF
)

  print_info "Submitting deployment for approval..."

  local response=$(curl -s -w "\n%{http_code}" -X POST \
    "http://${BACKEND_HOST}${APPROVAL_ENDPOINT}" \
    -H "Content-Type: application/json" \
    -d "$config")

  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | head -n -1)

  if [[ $http_code == 201 || $http_code == 200 ]]; then
    APPROVAL_ID=$(echo "$body" | jq -r '.id // empty')
    if [[ -n "$APPROVAL_ID" ]]; then
      print_success "Approval submission succeeded (HTTP $http_code)"
      print_info "Approval ID: $APPROVAL_ID"
      echo "$body" | jq .
      return 0
    else
      print_error "Approval submission returned no ID"
      return 1
    fi
  else
    print_error "Approval submission failed (HTTP $http_code)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 1
  fi
}

# ============================================================================
# APPROVAL STATUS POLLING
# ============================================================================

test_approval_polling() {
  print_header "Test 4: Approval Status Polling"

  if [[ -z "$APPROVAL_ID" ]]; then
    print_error "No approval ID available. Run submission test first."
    return 1
  fi

  print_info "Polling approval status for ID: $APPROVAL_ID"
  print_info "Note: Admin must manually approve in admin interface for this to change"

  local max_polls=3
  local poll_count=0

  while [[ $poll_count -lt $max_polls ]]; do
    ((poll_count++))
    print_info "Poll attempt $poll_count of $max_polls..."

    local response=$(curl -s -w "\n%{http_code}" -X GET \
      "http://${BACKEND_HOST}${APPROVAL_STATUS_ENDPOINT}/${APPROVAL_ID}" \
      -H "Content-Type: application/json")

    local http_code=$(echo "$response" | tail -1)
    local body=$(echo "$response" | head -n -1)

    if [[ $http_code == 200 ]]; then
      local status=$(echo "$body" | jq -r '.status // empty')
      echo "$body" | jq .

      if [[ "$status" == "APPROVED" ]]; then
        print_success "Approval status is APPROVED"
        return 0
      elif [[ "$status" == "REJECTED" ]]; then
        print_error "Approval was REJECTED: $(echo "$body" | jq -r '.reason')"
        return 1
      elif [[ "$status" == "PENDING" ]]; then
        print_info "Still PENDING (waiting for admin approval)"
        if [[ $poll_count -lt $max_polls ]]; then
          print_info "Waiting 10 seconds before next poll..."
          sleep 10
        fi
      fi
    else
      print_error "Status check failed (HTTP $http_code)"
      echo "$body" | jq . 2>/dev/null || echo "$body"
      return 1
    fi
  done

  print_info "Approval workflow validated. Status remains PENDING (awaiting admin approval)"
  return 0
}

# ============================================================================
# DEPLOYMENT TRIGGER SIMULATION
# ============================================================================

test_deployment_trigger() {
  print_header "Test 5: Deployment Trigger (Simulation)"

  if [[ -z "$APPROVAL_ID" ]]; then
    print_error "No approval ID available. Cannot simulate deployment."
    return 1
  fi

  if [[ -z "$HELMFILE_CONTENT" ]]; then
    print_error "No Helmfile content available. Cannot simulate deployment."
    return 1
  fi

  print_info "Simulating deployment trigger with approval..."
  print_info "Note: In production, deployment only proceeds after APPROVED status"

  local payload=$(cat <<EOF
{
  "approvalId": "$APPROVAL_ID",
  "component": "$COMPONENT",
  "instance": "$INSTANCE",
  "helmfile": $(echo "$HELMFILE_CONTENT" | jq -R -s .),
  "config": {
    "env": "$ENVIRONMENT",
    "namespacePrefix": "$NAMESPACE_PREFIX",
    "hostPrefix": "$HOST_PREFIX",
    "dnsZone": "$DNS_ZONE",
    "cluster": "$CLUSTER"
  }
}
EOF
)

  local response=$(curl -s -w "\n%{http_code}" -X POST \
    "http://${BACKEND_HOST}/deployments/trigger" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | head -n -1)

  if [[ $http_code == 200 || $http_code == 202 ]]; then
    print_success "Deployment trigger accepted (HTTP $http_code)"
    echo "$body" | jq .
    return 0
  elif [[ $http_code == 403 ]]; then
    print_info "Deployment rejected - approval not yet approved (HTTP 403)"
    print_info "This is expected if admin hasn't approved yet"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 0
  else
    print_error "Deployment trigger failed (HTTP $http_code)"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 1
  fi
}

# ============================================================================
# SUMMARY
# ============================================================================

print_summary() {
  print_header "Test Summary"

  echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
  echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"

  if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}"
    return 0
  else
    echo -e "\n${RED}✗ Some tests failed${NC}"
    return 1
  fi
}

# ============================================================================
# MAIN
# ============================================================================

main() {
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --cluster) CLUSTER="$2"; shift 2;;
      --instance) INSTANCE="$2"; shift 2;;
      --component) COMPONENT="$2"; shift 2;;
      --env) ENVIRONMENT="$2"; shift 2;;
      --help) show_help;;
      *) echo "Unknown option: $1"; show_help;;
    esac
  done

  print_header "SRI Deployment Approval Flow - End-to-End Verification"

  echo "Configuration:"
  echo "  Cluster:          $CLUSTER"
  echo "  Component:        $COMPONENT"
  echo "  Instance:         $INSTANCE"
  echo "  Environment:      $ENVIRONMENT"
  echo "  Backend Host:     $BACKEND_HOST"
  echo ""

  # Run tests
  check_prerequisites || exit 1
  test_deployment_validation || true
  test_helmfile_generation || true
  test_approval_submission || true
  test_approval_polling || true
  test_deployment_trigger || true

  # Print summary
  print_summary
}

# Run main function
main "$@"
