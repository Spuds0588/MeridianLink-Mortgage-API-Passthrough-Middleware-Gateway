#!/usr/bin/env bash
# One-line deployment for the MeridianLink Mortgage API Passthrough Gateway.
#
# Run inside AWS CloudShell (no local tooling needed) or any shell with an
# authenticated AWS CLI v2:
#
#   bash <(curl -sSL https://raw.githubusercontent.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/main/deploy.sh)
#
# Optional environment overrides:
#   STACK_NAME, AWS_REGION, MERIDIAN_BASE_URL, MERIDIAN_USERNAME,
#   MERIDIAN_PASSWORD, TITLE_INVITE_CODE, BROKER_INVITE_CODE,
#   APPRAISAL_INVITE_CODE, TEMPLATE_URL

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

STACK_NAME="${STACK_NAME:-MeridianLink-Mortgage-Gateway}"
TEMPLATE_URL="${TEMPLATE_URL:-https://raw.githubusercontent.com/Spuds0588/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway/main/template.yaml}"

say() { printf '%b\n' "$1"; }

say "${BLUE}====================================================${NC}"
say "${BLUE}   MeridianLink Mortgage API Gateway Setup           ${NC}"
say "${BLUE}====================================================${NC}"

command -v aws >/dev/null 2>&1 || { say "${RED}[ERROR] AWS CLI not found. Run this in AWS CloudShell.${NC}"; exit 1; }
command -v curl >/dev/null 2>&1 || { say "${RED}[ERROR] curl not found.${NC}"; exit 1; }
command -v openssl >/dev/null 2>&1 || { say "${RED}[ERROR] openssl not found; set invite codes manually.${NC}"; exit 1; }

say "\n${YELLOW}[1/4] Verifying AWS credentials...${NC}"
CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null || true)"
if [ -z "$CALLER_ARN" ]; then
  say "${RED}[ERROR] No active AWS session. Open AWS CloudShell or configure the CLI.${NC}"
  exit 1
fi
say "${GREEN}Deploying as ${CALLER_ARN}${NC}"

say "\n${YELLOW}[2/4] MeridianLink API configuration...${NC}"
MERIDIAN_BASE_URL="${MERIDIAN_BASE_URL:-}"
MERIDIAN_USERNAME="${MERIDIAN_USERNAME:-}"
MERIDIAN_PASSWORD="${MERIDIAN_PASSWORD:-}"

[ -n "$MERIDIAN_BASE_URL" ] || read -rp "MeridianLink Mortgage API base URL: " MERIDIAN_BASE_URL
[ -n "$MERIDIAN_USERNAME" ] || read -rp "MeridianLink API username: " MERIDIAN_USERNAME
if [ -z "$MERIDIAN_PASSWORD" ]; then
  read -rsp "MeridianLink API password: " MERIDIAN_PASSWORD
  echo
fi

if [ -z "$MERIDIAN_BASE_URL" ] || [ -z "$MERIDIAN_USERNAME" ] || [ -z "$MERIDIAN_PASSWORD" ]; then
  say "${RED}[ERROR] Base URL, username, and password are all required.${NC}"
  exit 1
fi

# Role-scoped invite codes: one link cannot mint a key for another persona.
TITLE_INVITE_CODE="${TITLE_INVITE_CODE:-$(openssl rand -hex 24)}"
BROKER_INVITE_CODE="${BROKER_INVITE_CODE:-$(openssl rand -hex 24)}"
APPRAISAL_INVITE_CODE="${APPRAISAL_INVITE_CODE:-$(openssl rand -hex 24)}"

say "\n${YELLOW}[3/4] Fetching latest template...${NC}"
TMP_TEMPLATE="$(mktemp "${TMPDIR:-/tmp}/meridian-gateway-XXXXXX.yaml")"
trap 'rm -f "$TMP_TEMPLATE"' EXIT

if ! curl -fsSL "$TEMPLATE_URL" -o "$TMP_TEMPLATE"; then
  say "${RED}[ERROR] Could not download ${TEMPLATE_URL}${NC}"
  exit 1
fi

TEMPLATE_BYTES="$(wc -c < "$TMP_TEMPLATE" | tr -d ' ')"
if [ "$TEMPLATE_BYTES" -gt 51200 ]; then
  say "${RED}[ERROR] Template is ${TEMPLATE_BYTES} bytes; CloudFormation's direct upload limit is 51200.${NC}"
  exit 1
fi
say "${GREEN}Template OK (${TEMPLATE_BYTES} bytes)${NC}"

say "\n${YELLOW}[4/4] Deploying stack ${STACK_NAME}...${NC}"
say "${BLUE}This provisions VPC + NAT + static EIP, API Gateway, Lambda, SQS FIFO, DynamoDB, and Secrets Manager.${NC}"
say "${BLUE}NAT gateway provisioning usually takes 2-3 minutes.${NC}"

REGION_ARGS=()
if [ -n "${AWS_REGION:-}" ]; then
  REGION_ARGS=(--region "$AWS_REGION")
fi

aws cloudformation deploy \
  "${REGION_ARGS[@]}" \
  --template-file "$TMP_TEMPLATE" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    MeridianBaseUrl="$MERIDIAN_BASE_URL" \
    MeridianUsername="$MERIDIAN_USERNAME" \
    MeridianPassword="$MERIDIAN_PASSWORD" \
    TitleInviteCode="$TITLE_INVITE_CODE" \
    BrokerInviteCode="$BROKER_INVITE_CODE" \
    AppraisalInviteCode="$APPRAISAL_INVITE_CODE"

say "\n${GREEN}====================================================${NC}"
say "${GREEN}             DEPLOYMENT SUCCESSFUL                  ${NC}"
say "${GREEN}====================================================${NC}"

aws cloudformation describe-stacks \
  "${REGION_ARGS[@]}" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs" \
  --output table

output() {
  aws cloudformation describe-stacks "${REGION_ARGS[@]}" --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

PORTAL_URL="$(output AdminPortalUrl)"
EGRESS_IP="$(output StaticEgressIp)"

say "\n${YELLOW}Portal:${NC}          ${GREEN}${PORTAL_URL}${NC}"
say "${YELLOW}Title invite:${NC}     ${GREEN}${PORTAL_URL}?role=title&code=${TITLE_INVITE_CODE}${NC}"
say "${YELLOW}Broker invite:${NC}    ${GREEN}${PORTAL_URL}?role=broker&code=${BROKER_INVITE_CODE}${NC}"
say "${YELLOW}Appraisal invite:${NC} ${GREEN}${PORTAL_URL}?role=appraisal&code=${APPRAISAL_INVITE_CODE}${NC}"
say ""
say "${RED}ACTION REQUIRED: ask MeridianLink support to whitelist static egress IP ${EGRESS_IP}.${NC}"
say "${RED}Invite links are bearer secrets. Share each role's link only with that role's partners, and reuse the same codes on stack updates.${NC}"
