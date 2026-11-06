const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(root, "template.yaml"), "utf8");
const deploy = fs.readFileSync(path.join(root, "deploy.sh"), "utf8");

test("committed template.yaml matches the build", () => {
  execFileSync(process.execPath, ["scripts/build.js", "--check"], { cwd: root, stdio: "pipe" });
});

test("template stays under CloudFormation's direct upload limit", () => {
  assert.ok(Buffer.byteLength(template) < 51200, `template.yaml is ${Buffer.byteLength(template)} bytes`);
});

test("template keeps at least 1 KB of deployment headroom", () => {
  const bytes = Buffer.byteLength(template);
  assert.ok(bytes <= 51200 - 1024, `template.yaml is ${bytes} bytes (${51200 - bytes} bytes headroom)`);
});

test("template embeds the handler and leaves no placeholder", () => {
  assert.match(template, /ZipFile: \|/);
  assert.ok(template.includes("exports.handler"));
  assert.ok(template.includes("createHandler"));
  assert.ok(!template.includes("__GATEWAY_CODE__"));
});

test("template provisions the expected AWS resources", () => {
  for (const resource of [
    "AWS::Lambda::Function",
    "AWS::ApiGateway::RestApi",
    "AWS::ApiGateway::UsagePlan",
    "AWS::ApiGateway::Stage",
    "AWS::DynamoDB::Table",
    "AWS::SQS::Queue",
    "AWS::SecretsManager::Secret",
    "AWS::Lambda::EventSourceMapping",
    "AWS::EC2::NatGateway",
    "AWS::EC2::EIP",
    "AWS::EC2::VPC"
  ]) {
    assert.ok(template.includes(resource), `missing ${resource}`);
  }
});

test("vendor routes require an API key; portal and health stay open", () => {
  const proxy = template.slice(template.indexOf("ProxyAny:"), template.indexOf("ApiDeployment:"));
  assert.match(proxy, /ApiKeyRequired: true/);
  assert.match(proxy, /HttpMethod: ANY/);
  const open = template.slice(template.indexOf("PortalGet:"), template.indexOf("ProxyAny:"));
  assert.ok(!open.includes("ApiKeyRequired"));
});

test("secrets have no defaults and invite codes are per role", () => {
  const params = template.slice(template.indexOf("Parameters:"), template.indexOf("Resources:"));
  assert.match(params, /MeridianPassword:[\s\S]*?NoEcho: true/);
  for (const name of ["TitleInviteCode", "BrokerInviteCode", "AppraisalInviteCode"]) {
    assert.match(params, new RegExp(`${name}:[\\s\\S]*?NoEcho: true[\\s\\S]*?MinLength: 24`));
  }
  assert.ok(!params.includes("AdminPortalToken"));
  assert.ok(!/MeridianPassword:[\s\S]{0,80}Default:/.test(params));
  assert.ok(!params.includes("ADMIN_TOKEN"));
});

test("write pipeline is FIFO with retries and a dead-letter queue", () => {
  assert.match(template, /FifoQueue: true/);
  assert.match(template, /RedrivePolicy:/);
  assert.match(template, /maxReceiveCount: 5/);
  assert.match(template, /FunctionResponseTypes:\n {8}- ReportBatchItemFailures/);
  assert.match(template, /MaximumConcurrency: 5/);
});

test("lambda runs in a private subnet with a static egress IP", () => {
  assert.match(template, /VpcConfig:/);
  assert.match(template, /PrivateSubnet/);
  assert.match(template, /NatGatewayId: !Ref NatGateway/);
  assert.match(template, /StaticEgressIp:[\s\S]*?!Ref NatEip/);
  assert.match(template, /MERIDIAN_SECRET_ARN/);
  assert.match(template, /MERIDIAN_BASE_URL/);
});

test("invite codes are wired into the Lambda environment, not the client", () => {
  assert.match(template, /INVITE_TITLE: !Ref TitleInviteCode/);
  assert.match(template, /INVITE_BROKER: !Ref BrokerInviteCode/);
  assert.match(template, /INVITE_APPRAISAL: !Ref AppraisalInviteCode/);
});

test("deploy.sh is executable and points at this repository's template", () => {
  const stat = fs.statSync(path.join(root, "deploy.sh"));
  assert.ok(stat.mode & 0o111, "deploy.sh must be executable");
  assert.match(deploy, /Spuds0588\/MeridianLink-Mortgage-API-Passthrough-Middleware-Gateway\/main\/template\.yaml/);
  assert.match(deploy, /aws cloudformation deploy/);
  assert.match(deploy, /--capabilities CAPABILITY_IAM/);
  assert.match(deploy, /TitleInviteCode="\$TITLE_INVITE_CODE"/);
  assert.match(deploy, /openssl rand -hex 24/);
  assert.match(deploy, /StaticEgressIp/);
});

test("CI verifies tests and template sync on Node 20 and 24", () => {
  const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /node-version: \[20, 24\]/);
  assert.match(ci, /npm test/);
  assert.match(ci, /scripts\/build\.js --check/);
});
