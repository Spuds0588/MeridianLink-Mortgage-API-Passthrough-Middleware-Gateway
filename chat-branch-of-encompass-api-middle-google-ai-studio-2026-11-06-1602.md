# Branch of Encompass API Middle | Google AI Studio

> Exported from https://aistudio.google.com/prompts/1DNYQahXtzfKVIxMHHK_L4Y7TfYvJYfQy on 2026-11-06 16:02 · AI Studio · 22 messages

## Assistant

**Defining the Persona**

I'm solidifying the persona: an expert dev partnering with the PM. I'm taking a critical, feedback-driven stance, unafraid to challenge assumptions. Equal exchange is key, and YAGNI will guide me. I'm aiming for a productive, collaborative dynamic where I provide constructive pushback when needed.

**Refining the Approach**

I'm now zeroing in on the architecture within the context of the Encompass API documentation. I'm focusing on one-liner solutions where practical, including console logging patterns. When I generate code, I'll provide full files. My core focus is the middleware/gateway in AWS or Cloudflare. I'm considering multi-tenant API keys, OAuth impersonation, concurrency limits, async writes via SQS, read queue throttling, and webhook fan-out. I'm noting the API Gateway, DynamoDB (config, tokens, mappings, webhooks), SQS and Lambda (write & read queues).

**Analyzing the Trade-Offs**

I'm wrestling with a synchronous vs. asynchronous read dilemma. The documentation implies using SQS for reads, throttled to 10 concurrent executions, yet the external clients need synchronous HTTP responses. Using SQS for reads would be problematic, as HTTP APIs are not equipped to handle such a workflow easily. On the other hand, bypassing SQS and executing Lambda-to-Encompass directly will encounter a concurrency limit. This is a crucial area to address, as this will lead to latency. I will need to devise the best method.

**Addressing Concurrency Issues**

I'm now leaning toward returning 429 or 503 errors from the gateway when concurrency limits are exceeded, recognizing this shifts the burden but avoids a vendor break. A semaphore is looking essential, not an SQS read queue for synchronous requests.

**Optimizing Token Handling**

I've identified a major flaw: the plan to hit the Encompass OAuth endpoint on every request. This is completely unsustainable due to rate limits and latency. I must cache impersonated tokens per subject_user_id, using DynamoDB or ElastiCache/DAX, as a necessity to improve performance and prevent issues.

**Analyzing File Lock Behavior**

I'm now thinking about the impact of Encompass's file locking in write operations, and the overall issue of write idempotency. The responses indicate a 202 "Accepted" return, which is important to consider in the architecture.

**Examining Concurrency & Retries**

I'm now deeply concerned about file locking. I see that Encompass write operations with 202 responses introduce potential out-of-order writes. The idea of SQS retries becomes problematic if the order is not guaranteed. I'll need a FIFO queue with Message Group ID, specifically using the loan_id. Moreover, I'm now questioning data consistency with potential field-level clobbering by delayed PATCH operations. There is also no way to check the status of a specific job via any documented Encompass API.

\n\n
**Defining Subscription Lookup**

I've also realized I need a mechanism to map Loan GUIDs to active third-party tenants during the creation or import of loans, and also through config synchronization. This is the problem in Hole 4.

**Addressing Subscription Issues**

I'm now grappling with new challenges: ensuring the middleware knows when loans created internally need external vendor involvement. I'm considering Encompass custom fields or milestone event listeners for this, and also how to handle a "hydration storm" of multiple webhooks firing simultaneously, which can cause significant read request bottlenecks, requiring deduplication or debouncing. Furthermore, the issue of Master Client ID and Secret storage in DynamoDB is a serious security risk.

**Evaluating Security and Abstraction**

I'm now focusing on critical security aspects, specifically secure storage for Master Client ID and Secret, opting for AWS Secrets Manager or SSM Parameter Store with KMS encryption. I'm also challenging the "1-click" reality of Encompass integration, given its dependency on Developer Connect, OAuth configurations, and IP whitelisting. Finally, I'm analyzing the "Hole 6" conundrum, choosing between AWS and Cloudflare to satisfy the YAGNI principle.

---

## Assistant

**Considering the Data Strategy**

I'm currently evaluating the implications of a functional loan data copy and subsequent data synchronization to optimize for both read and write performance within the third-party API context. I'm focusing on whether this approach can effectively queue writes and create the impression of immediate data updates. I'm starting to build a basic outline.

**Analyzing the Architectural Shift**

I'm now deeply concerned about the proposed architectural shift. The initial appeal of a stateful cache is undeniable, especially for optimizing read/write performance in this third-party API context. However, a deeper dive into the Encompass calculation engine, business rules, and field triggers reveals a significant risk of data inconsistency. My analysis is starting to suggest this approach is a trap, despite the initial appeal.

**Evaluating the Complexity**

I'm now fully aware that Encompass is far more than a simple database. Modifying a single field triggers extensive code execution and calculations, immediately invalidating any local data copy. I'm seeing this as a critical problem for data consistency. I'm now fully immersed in the implications of this shift, including the nightmare of two-way synchronization and the sheer volume of data involved. The 15,000+ fields are causing me pause.

**Assessing the Scaling Problems**

I'm now grappling with the scaling and compliance implications. A full loan JSON can be massive (8-20MB!), making DynamoDB seem unsuitable without chunking. The transition into a System of Record poses significant compliance challenges involving Personally Identifiable Information and Non-Public Personal Information (NPI), which in turn, massively increases the scope of the project, completely violating the YAGNI principle. I'm now realizing that what seemed a simple gateway, will become a multi-million dollar microservice.

**Rejecting the Premise Outright**

I've come to a firm conclusion: this is a major misstep. A deep dive shows that Encompass operates as a calculation engine, not a basic CRUD database. Attempting a local copy is fundamentally flawed. Encompass's calculations, the DynamoDB limitations, simultaneous edits, and the compliance nightmare are all dealbreakers. My immediate focus is on a pragmatic alternative by leveraging Encompass's field-level filtering for partial loan reads.

---

## Assistant

**No. Absolutely do not do this.**

Taking on a "functional copy" and building a data-sync engine turns a lean, 1-click passthrough gateway into a multi-million dollar distributed data synchronization nightmare. It directly violates YAGNI and creates four massive problems you will spend the next two years trying to solve:

---

### 1. Encompass is a Business Logic Engine, Not a Database

This is the biggest trap with Encompass.

### 2. The 400 KB DynamoDB Wall vs. The 10 MB Encompass Loan

### 3. Master-Master Conflict & Data Loss

### 4. Regulatory & Compliance Explosion (GLBA / SOC2)

---

### What We Should Do Instead (The Lean Architecture)

Mortgage APIs are inherently eventual-consistency systems. Third parties already expect asynchronous operations for complex files. You don't need to fake a synchronous database to give them a modern developer experience.

Here is how we get fast reads and reliable writes without storing a single loan:

```
[Vendor]
   │
   ├─► GET /loans/{id}?fields=11,12,1109 ──► [In-Memory Cache (TTL: 30s)] ──► Encompass (Field Filtered)
   │                                           └─ Fast (150ms)
   │
   └─► PATCH /loans/{id} ────────────────► [SQS FIFO] ──► [Worker] ──► Encompass
                                               │
                                       Returns 202 Accepted + Job ID
```

Stick to the passthrough model. It keeps the gateway stateless, serverless, cheap, and out of compliance trouble.

Do we agree to keep it stateless and optimize via **field-level querying** and **short-lived read caching**?

---

## Assistant

**Considering Deployment Speed**

I'm now focused on achieving a near "1-click deployment" experience for this stateless passthrough approach. My current question revolves around whether an automated deployment, perhaps via a single-line script, is feasible. This should reduce friction and increase adoption.

**Analyzing Onboarding Friction**

I'm now diving into the user experience, specifically regarding API key retrieval. I'm trying to decide between light server-side rendering or an embeddable widget that can display the key. The goal is to make the partner onboarding and key management experience as fast as possible, ideally, just 1 minute. I want to generate the full code files and keep the solution to one line when appropriate.

**Evaluating Deployment Automation**

I've been weighing the pros and cons of different deployment approaches. The CloudFormation Quick-Create stack seems like the closest thing to a true "1-click" experience. The 1-line CLI script is another viable solution. We need to consider how to prompt users for their credentials in either case. The best solution must require as little effort as possible. I'm taking a hard look at the "pushback" realities like AWS account setup.

**Prioritizing User Convenience**

I'm now thinking about how to provide the **CloudFormation Quick-Create URL** as the primary deployment option, along with a terminal command fallback. This offers a balance between ease and flexibility. It seems the "1-click" cloudformation option will be far more convenient, while the 1 line script will offer a path for customization.

I'm also considering the best solution for API key generation. While the PM's suggestion of an embeddable widget is tempting, I'm concerned about the security implications of exposing an API key generation screen and its security. I'm worried it opens attack vectors such as clickjacking. Plus, the complexity of a full-fledged OAuth/DevPortal embed widget is pushing me away.

**Refining Onboarding UI**

I'm now zeroing in on a lightweight server-side rendered (SSR) solution using a Lambda function. I envision a simple API Gateway endpoint returning HTML, Tailwind CDN, and PicoCSS. The user would enter tenant details and generate credentials, which are then displayed securely with a copy button and a curl example. Embedding via &lt;iframe> is possible, but I think a standalone link generated from CloudFormation is safer and cleaner, avoiding potential security issues.

**Optimizing Installer Options**

I'm now prioritizing two deployment options: the **AWS CloudFormation Quick-Create URL**, which allows for 1-click browser deployment, and a single npx deploy-encompass-gateway or bash one-liner. The CloudFormation approach will highlight the returned gateway URLs for the Admin Portal and Webhook Receiver. For key provisioning, I'm leaning heavily towards a light SSR via a single Lambda, which delivers an admin portal with zero dependencies. This provides a secure and user-friendly experience, avoiding iframe vulnerabilities and providing copyable curl examples.

---

## Assistant

We can get this down to **true 1-click deployment** and a **zero-friction key distribution system**, but we need to do it without falling into security and iframe traps.

Here is how we accomplish both, followed by where I am going to push back on your embed idea, and the exact code to make it work.

---

### 1. The Deployment: CloudFormation "Quick-Create" (True 1-Click)

Forget running bash scripts in a terminal—most mortgage lender IT admins don't have AWS CLI configured locally, and npm/npx scripts will get blocked by corporate endpoint security.

The standard for AWS 1-click is a **CloudFormation Quick-Create Link**.
You host our SAM/CloudFormation template on a public S3 bucket and give the lender a link:

```
https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=https://s3.amazonaws.com/your-bucket/encompass-gateway.yaml&stackName=EncompassGateway
```

**The Lender Experience:**

Deployment time: **under 3 minutes, zero terminal commands.**

---

### 2. Pushback on the "Embed/iFrame" Idea

You asked: “Can we do some light server-side rendering or something so they can use an embed or alike with a url source and id?”

**Do not put API key issuance in an embeddable iframe.**

### The Leaner, 1-Minute Solution: "Single-Lambda SSR Portal"

Instead of an embed, API Gateway serves a **lightweight, zero-dependency, server-side rendered HTML page** directly out of a single Lambda.

---

### Implementation: The Standalone Admin & Key Generation Lambda

Here is the complete, full-file implementation of the SSR Portal Handler (admin_portal.js). It handles both serving the clean web interface and handling the POST request to issue the API key via AWS API Gateway and DynamoDB.

```
/**
 * File: admin_portal.js
 * Description: Lightweight SSR Admin Portal for Encompass Gateway.
 * Issues scoped API keys and tenant mappings with zero frontend build dependencies.
 */

const { APIGatewayClient, CreateApiKeyCommand, CreateUsagePlanKeyCommand } = require("@aws-sdk/client-api-gateway");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const apiGateway = new APIGatewayClient({});
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const USAGE_PLAN_ID = process.env.USAGE_PLAN_ID;
const TENANT_TABLE = process.env.TENANT_TABLE;

// Utility for clean, traceable logging
const log = (level, action, details) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, action, ...details }));
};

exports.handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.rawPath;

  log("INFO", "PORTAL_REQUEST_RECEIVED", { method, path });

  try {
    // 1. POST: Generate Key and Save Mapping
    if (method === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        log("WARN", "PAYLOAD_PARSE_FAILED", { rawBody: event.body });
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Invalid JSON" }) };
      }

      const { tenantName, encompassUserId } = body;

      if (!tenantName || !encompassUserId) {
        log("WARN", "VALIDATION_FAILED", { body });
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing required fields" }) };
      }

      log("INFO", "PROVISIONING_PARTNER_KEY", { tenantName, encompassUserId });

      // Step A: Create API Key in API Gateway
      const apiKeyResponse = await apiGateway.send(new CreateApiKeyCommand({
        name: `tenant-${tenantName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        enabled: true,
        generateDistinctId: true,
        description: `Encompass gateway key for ${tenantName} mapped to ${encompassUserId}`
      }));

      // Step B: Associate Key with Gateway Usage Plan
      await apiGateway.send(new CreateUsagePlanKeyCommand({
        keyId: apiKeyResponse.id,
        keyType: "API_KEY",
        usagePlanId: USAGE_PLAN_ID
      }));

      // Step C: Save Tenant Mapping to DynamoDB
      await ddbDoc.send(new PutCommand({
        TableName: TENANT_TABLE,
        Item: {
          apiKeyId: apiKeyResponse.id,
          apiKeySecret: apiKeyResponse.value, // Used for verification / lookup
          tenantName,
          encompassUserId,
          createdAt: new Date().toISOString(),
          status: "ACTIVE"
        }
      }));

      log("INFO", "PARTNER_PROVISIONED_SUCCESSFULLY", {
        tenantName,
        apiKeyId: apiKeyResponse.id,
        encompassUserId
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Tenant provisioned successfully",
          apiKey: apiKeyResponse.value,
          tenantName,
          encompassUserId
        })
      };
    }

    // 2. GET: Serve Clean HTML Portal
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderHTML()
    };

  } catch (error) {
    log("ERROR", "PORTAL_INTERNAL_ERROR", { message: error.message, stack: error.stack });
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html" },
      body: `<h3>Internal Server Error</h3><pre>${error.message}</pre>`
    };
  }
};

function renderHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Encompass Gateway Management</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-6">
  <div class="max-w-xl w-full bg-slate-800 border border-slate-700 rounded-xl p-8 shadow-2xl">
    <div class="mb-6 border-b border-slate-700 pb-4">
      <h1 class="text-2xl font-bold tracking-tight text-white">Encompass API Gateway</h1>
      <p class="text-sm text-slate-400 mt-1">Generate self-serve API credentials with persona mapping.</p>
    </div>

    <!-- Generation Form -->
    <div id="form-container" class="space-y-4">
      <div>
        <label class="block text-xs uppercase font-semibold text-slate-400 mb-1">Partner / Vendor Name</label>
        <input id="tenantName" type="text" placeholder="e.g. First American Title"
          class="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500">
      </div>
      <div>
        <label class="block text-xs uppercase font-semibold text-slate-400 mb-1">Encompass Impersonation User ID</label>
        <input id="encompassUserId" type="text" placeholder="e.g. api_title_vendor"
          class="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500">
        <p class="text-xs text-slate-500 mt-1">Requests using this key will inherit this Encompass user's Persona/Access limits.</p>
      </div>
      <button onclick="generateKey()" id="btn-submit"
        class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg transition-all">
        Provision API Access
      </button>
    </div>

    <!-- Success Result Box (Hidden by default) -->
    <div id="result-box" class="hidden mt-6 bg-slate-950 border border-emerald-500/30 rounded-lg p-5">
      <div class="flex items-center space-x-2 text-emerald-400 mb-3">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
        <span class="font-semibold text-sm">Key Provisioned Successfully</span>
      </div>
      <p class="text-xs text-slate-400 mb-2">Copy this key now. It will not be shown again.</p>
      <div class="flex items-center space-x-2 mb-4">
        <input id="out-key" readonly class="w-full bg-slate-900 border border-slate-700 text-yellow-300 font-mono text-sm px-3 py-2 rounded">
        <button onclick="copyKey()" class="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded text-xs font-semibold">Copy</button>
      </div>

      <label class="block text-xs uppercase font-semibold text-slate-400 mb-1">Partner Verification cURL</label>
      <pre id="out-curl" class="bg-slate-900 p-3 rounded font-mono text-xs text-slate-300 overflow-x-auto"></pre>

      <button onclick="resetForm()" class="mt-4 text-xs text-slate-400 hover:text-white underline">Provision another partner</button>
    </div>
  </div>

  <script>
    async function generateKey() {
      const btn = document.getElementById('btn-submit');
      const tenantName = document.getElementById('tenantName').value.trim();
      const encompassUserId = document.getElementById('encompassUserId').value.trim();

      if (!tenantName || !encompassUserId) {
        alert('Please fill out all fields.');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Provisioning...';

      try {
        const res = await fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantName, encompassUserId })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create key');

        document.getElementById('form-container').classList.add('hidden');
        document.getElementById('result-box').classList.remove('hidden');
        document.getElementById('out-key').value = data.apiKey;

        const gatewayOrigin = window.location.origin;
        document.getElementById('out-curl').innerText =
          'curl -X GET "' + gatewayOrigin + '/v1/loans/SOME_LOAN_GUID?fields=11,12,1109" \\\\n' +
          '  -H "x-api-key: ' + data.apiKey + '"';

      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Provision API Access';
      }
    }

    function copyKey() {
      const copyText = document.getElementById("out-key");
      copyText.select();
      navigator.clipboard.writeText(copyText.value);
      alert("API Key copied to clipboard");
    }

    function resetForm() {
      document.getElementById('tenantName').value = '';
      document.getElementById('encompassUserId').value = '';
      document.getElementById('result-box').classList.add('hidden');
      document.getElementById('form-container').classList.remove('hidden');
    }
  </script>
</body>
</html>`;
}
```

---

### Why This Is the Best Way Forward

Are you good with this portal approach? If so, next we'll build the core **Passthrough Router Lambda** (handling the token cache and field-filtered proxying to Encompass).

---

## Assistant

# Master Dev Document: Encompass API Passthrough & Middleware Gateway

---

## Part 1: Product Requirements Document (PRD)

### 1. Executive Summary

Lenders using ICE Mortgage Technology’s Encompass platform face friction onboarding external third-party systems (title companies, appraisal management companies, brokerages, and verification vendors). Encompass enforces strict instance-wide rate limits (typically 30 concurrent API calls), requires manual Super Admin intervention to provision API keys, lacks native external API key scoping, and frequently throws File Lock errors (423 Locked) during concurrent record edits.

This product is a **zero-vendor-footprint, open-source, serverless middleware gateway**. It deploys directly into the lender's AWS account in 60 seconds via a single-line script run inside AWS CloudShell or direct CloudFormation upload. The gateway abstracts Encompass authentication via OAuth 2.0 Persona Token Impersonation, enforces field-level read filtering to keep responses sub-second, cushions Encompass from write spikes using an SQS FIFO queue with exponential backoff, and provides a built-in, zero-dependency SSR Admin Portal to generate scoped API keys.

---

### 2. Architecture Principles & Constraints

---

### 3. Target Audience

---

### 4. Detailed System Requirements

---

### 5. API Specification

#### External API Endpoints (Vendor-Facing)

```
{
  "id": "guid-uuid-1234",
  "fields": {
    "11": "123 Main St",
    "12": "Irvine",
    "14": "CA",
    "1109": 450000.00
  },
  "_cached": false
}
```

```
{
  "fields": {
    "CX.TITLE.STATUS": "Received",
    "CX.TITLE.FEE": 1250.00
  }
}
```

```
{
  "status": "ACCEPTED",
  "jobId": "job-abc-123-xyz",
  "loanId": "guid-uuid-1234",
  "statusUrl": "/v1/jobs/job-abc-123-xyz"
}
```

```
{
  "jobId": "job-abc-123-xyz",
  "loanId": "guid-uuid-1234",
  "status": "COMPLETED", // PENDING | RETRYING | COMPLETED | FAILED
  "attempts": 2,
  "updatedAt": "2026-11-06T15:00:00Z",
  "error": null
}
```

#### Internal / Administrative Endpoints

---

## Part 2: Implementation Guide & Architecture

### 1. System Architecture Diagram

```
[EXTERNAL PARTNERS]
                                       │
                                ( x-api-key )
                                       ▼
                         [ AMAZON API GATEWAY REST API ]
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
   GET /portal (SSR)           GET /v1/loans/{id}         PATCH /v1/loans/{id}
   POST /portal (Provision)    (Synchronous Read)         (Async Enqueue)
            │                          │                          │
            ▼                          ▼                          ▼
   ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
   │  Admin Portal   │        │   Read Proxy    │        │  Write Enqueue  │
   │  Lambda Handler │        │  Lambda Handler │        │  Lambda Handler │
   └────────┬────────┘        └────────┬────────┘        └────────┬────────┘
            │                          │                          │
            ├────────────┐             │                          ▼
            ▼            ▼             │                ┌──────────────────┐
     [DynamoDB:   [API Gateway         │                │  SQS FIFO Queue  │
      Tenants]     Usage Plan]         │                │(GroupID=LoanId)  │
                                       │                └─────────┬────────┘
                                       │                          │
                                       │                          ▼
                                       │                 ┌─────────────────┐
                                       │                 │  Write Worker   │
                                       │                 │  Lambda Handler │
                                       │                 │ (Max Concurrency│
                                       │                 │     Limit=10)   │
                                       │                 └────────┬────────┘
                                       │                          │
                                       ▼                          ▼
                         ┌───────────────────────────────────────────────┐
                         │          TOKEN CACHE & CLIENT ENGINE          │
                         │   1. Check DynamoDB for valid token by user   │
                         │   2. If expired: Call Secrets Manager ->      │
                         │      Exchange Master for Scoped Persona Token │
                         │   3. Cache token in DynamoDB (TTL = 30m)      │
                         └──────────────────────┬────────────────────────┘
                                                │
                                                ▼
                                   [ICE ENCOMPASS API HOST]
                                  https://api.elliemae.com
```

---

### 2. AWS Component Specifications

#### A. Amazon API Gateway (REST API)

#### B. AWS Secrets Manager

#### C. Amazon DynamoDB Tables

#### D. Amazon SQS FIFO Queue

#### E. AWS Lambda Functions (Inline Bundling via CFN ZipFile)

---

### 3. Core Logic & Execution Flows

#### Flow 1: Scoped Token Generation & DynamoDB Cache

```
Caller (Internal Lambda Engine)
  │
  ├─► Check DynamoDB: `EncompassGatewayTokens` for PK: `encompassUserId`
  │     │
  │     ├─► [Cache Hit: Token valid for > 5 min] ──► Return cached token immediately.
  │     │
  │     └─► [Cache Miss or Expirable]
  │           │
  │           ├─► Retrieve Master Client ID & Secret from AWS Secrets Manager
  │           │
  │           ├─► Call Encompass API: POST https://api.elliemae.com/oauth2/v1/token
  │           │   Headers: Content-Type: application/x-www-form-urlencoded
  │           │   Body:
  │           │     grant_type=urn:ietf:params:oauth:grant-type:token-exchange
  │           │     &client_id=[MASTER_CLIENT_ID]
  │           │     &client_secret=[MASTER_CLIENT_SECRET]
  │           │     &subject_token_type=urn:ietf:params:oauth:token-type:access_token
  │           │     &subject_user_id=[ENCOMPASS_USER_ID]
  │           │
  │           ├─► Store returned token in DynamoDB `EncompassGatewayTokens`:
  │           │   {
  │           │     "encompassUserId": "api_title_vendor",
  │           │     "accessToken": "...",
  │           │     "expiresAt": (CurrentEpoch + response.expires_in - 300)
  │           │   }
  │           │
  │           └─► Return new scoped token.
```

#### Flow 2: Synchronous Read with Projection Filtering

#### Flow 3: Asynchronous FIFO Write Pipeline & File Lock Retries

---

## Part 3: Developer Task List

### Phase 1: Core Infrastructure & Distribution Packaging

### Phase 2: Token Management & Encompass Impersonation Engine

### Phase 3: Synchronous Read Passthrough

### Phase 4: SQS FIFO Write Pipeline & Job Engine

### Phase 5: Self-Serve SSR Admin Portal

### Phase 6: Integration Testing & Verification

---

## Part 4: AGENTS.md (AI Agent & Developer Operating Manual)

### 1. Operating Philosophy

### 2. Standardized Logging Schema

All Lambda handlers **must** output structured JSON to console.log. This enables unified CloudWatch log filtering and immediate troubleshooting when inspecting production issues.

```
// Standard Logging Schema
const log = (level, action, details = {}) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,              // "INFO" | "WARN" | "ERROR"
    action,             // e.g. "TOKEN_EXCHANGE_SUCCESS", "FILE_LOCK_BACKOFF"
    ...details
  }));
};
```

#### Mandatory Log Events:

---

### 3. Complete Reference Implementation: Core Passthrough Handler (read_proxy.js)

Below is the canonical implementation of the synchronous read router, illustrating the logging standard, token caching, and field-projection handling.

```
/**
 * File: read_proxy.js
 * Description: Synchronous, field-filtered read passthrough for Encompass loans.
 * Runtime: Node.js 20.x (Zero external dependencies).
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsManager = new SecretsManagerClient({});

const SECRET_ARN = process.env.ENCOMPASS_SECRET_ARN;
const TENANT_TABLE = process.env.TENANT_TABLE;
const TOKEN_TABLE = process.env.TOKEN_TABLE;
const ENCOMPASS_BASE_URL = "https://api.elliemae.com";

const log = (level, action, details = {}) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, action, ...details }));
};

// Cached Secrets Manager credentials in Lambda memory across invocations
let cachedCredentials = null;

async function getEncompassCredentials() {
  if (cachedCredentials) return cachedCredentials;
  log("INFO", "FETCHING_MASTER_SECRETS");
  const res = await secretsManager.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  cachedCredentials = JSON.parse(res.SecretString);
  return cachedCredentials;
}

async function getScopedToken(encompassUserId) {
  const now = Math.floor(Date.now() / 1000);

  // 1. Check DynamoDB Cache
  const tokenRecord = await ddb.send(new GetCommand({
    TableName: TOKEN_TABLE,
    Key: { encompassUserId }
  }));

  if (tokenRecord.Item && tokenRecord.Item.expiresAt > (now + 300)) {
    log("INFO", "TOKEN_CACHE_HIT", { encompassUserId });
    return tokenRecord.Item.accessToken;
  }

  log("INFO", "TOKEN_EXCHANGE_REQUEST", { encompassUserId });
  const credentials = await getEncompassCredentials();

  // 2. Perform OAuth Token Exchange
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_user_id: encompassUserId
  });

  const response = await fetch(`${ENCOMPASS_BASE_URL}/oauth2/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    log("ERROR", "TOKEN_EXCHANGE_FAILED", { status: response.status, errorText });
    throw new Error(`Encompass auth failure: ${response.status}`);
  }

  const tokenData = await response.json();
  const expiresAt = now + (tokenData.expires_in || 1800);

  // 3. Cache Token
  await ddb.send(new PutCommand({
    TableName: TOKEN_TABLE,
    Item: {
      encompassUserId,
      accessToken: tokenData.access_token,
      expiresAt
    }
  }));

  log("INFO", "TOKEN_EXCHANGE_SUCCESS", { encompassUserId, expiresAt });
  return tokenData.access_token;
}

exports.handler = async (event) => {
  const requestId = event.requestContext?.requestId;
  const loanId = event.pathParameters?.id;
  const apiKeyId = event.requestContext?.identity?.apiKeyId;
  const fields = event.queryStringParameters?.fields || "11,12,14,1109"; // Default minimal set

  log("INFO", "READ_REQUEST_RECEIVED", { requestId, loanId, apiKeyId, fields });

  try {
    if (!loanId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing loanId in path" }) };
    }

    // 1. Resolve Tenant Persona Mapping
    const tenantRecord = await ddb.send(new GetCommand({
      TableName: TENANT_TABLE,
      Key: { apiKeyId }
    }));

    if (!tenantRecord.Item || !tenantRecord.Item.encompassUserId) {
      log("WARN", "TENANT_MAPPING_NOT_FOUND", { apiKeyId });
      return { statusCode: 403, body: JSON.stringify({ error: "Unauthorized tenant mapping" }) };
    }

    const encompassUserId = tenantRecord.Item.encompassUserId;

    // 2. Fetch Cached or Impersonated Token
    const accessToken = await getScopedToken(encompassUserId);

    // 3. Forward Field-Filtered Request to Encompass
    const targetUrl = `${ENCOMPASS_BASE_URL}/encompass/v1/loans/${loanId}?entities=fields&fields=${encodeURIComponent(fields)}`;
    const startTime = Date.now();

    const encompassResponse = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    const durationMs = Date.now() - startTime;
    const responseBody = await encompassResponse.text();

    log("INFO", "ENCOMPASS_READ_COMPLETE", {
      loanId,
      status: encompassResponse.status,
      durationMs
    });

    return {
      statusCode: encompassResponse.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30" // 30s Client Caching
      },
      body: responseBody
    };

  } catch (error) {
    log("ERROR", "READ_HANDLER_EXCEPTION", { message: error.message, stack: error.stack });
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal Gateway Error", details: error.message })
    };
  }
};
```

---

### 4. Verification & Testing Procedures

When a bug or behavior issue is reported:

---

## Assistant

**Defining API Access**

I'm focusing on what lending and vendor partners can do with their API tokens after our system goes live. I'm considering their specific roles: mortgage brokerages and title companies, and identifying their likely API interactions within our newly designed system. I am working on the permissions and methods available to each partner type.

**Analyzing Partner Capabilities**

I've been examining the capabilities of different personas, specifically brokerages and wholesale lending partners, within the Encompass context. I'm identifying their typical workflows: submitting loans, managing pricing, and tracking progress. I'm focusing on the types of API interactions each role requires, particularly for reading loan data and asynchronous updates. I've begun to break down their interactions with key features such as job status tracking.

**Clarifying Broker API Access**

I'm now zeroing in on a specific broker's API access. I've mapped a sample broker user to their Encompass persona, and the implications of this mapping are significant. They can only see loans they originated. Via API, they can track milestones, update loan data (like borrower details), check condition statuses, and even get event-driven notifications. I'm focusing on the GET and PATCH methods, and the specific fields required.

**Defining Vendor Interactions**

I'm now outlining what title and closing vendors need from our API. I am focused on the "Title / Settlement" persona in Encompass and have mapped the api_title_vendor user to that role. This persona will have access only to closing/title/property/settlement data, like specific sections of the Closing Disclosure and custom fields. Importantly, I'm identifying restrictions: no access to borrower's sensitive information. I am clarifying that vendors can, via API, collaborate on fees and provide status updates.

**Outlining Vendor Access**

I'm now detailing specific API interactions for title vendors. I am focusing on two key actions: retrieving essential property and closing data via GET requests (e.g., address, dates, amounts) and receiving webhook notifications for critical events like CD generation and milestone changes. I'm noting the simplicity of the gateway code, as Encompass manages all the complexities of permissions and access rules. This new system allows engineering teams to automate integrations quickly with straightforward GET and PATCH calls.

---

## Assistant

Because the gateway uses **Encompass Persona Token Impersonation**, both partners call the exact same API endpoints (GET /v1/loans/{id} and PATCH /v1/loans/{id}), but **Encompass gives them completely different worlds of data and permissions** based on the Encompass User ID mapped to their key.

Here is exactly what each partner can do, what fields they touch, and what Encompass natively blocks them from seeing.

---

### 1. The Lending Partner (Mortgage Broker / TPO Wholesale)

**Mapped Encompass User:** api_broker_abc
**Assigned Persona:** TPO Broker / External Originator
**Encompass Folder/Org Scope:** Restricted exclusively to loans originated under Brokerage ABC’s Organization ID.

#### What they can do with their API Key:

---

### 2. The Vendor Partner (Title & Settlement Company)

**Mapped Encompass User:** api_title_vendor
**Assigned Persona:** Title / Settlement Agent
**Encompass Field Scope:** Restricted strictly to Title/Closing/Property fields and Custom CX.TITLE.* fields.

#### What they can do with their API Key:

---

### Why This Architecture Wins for Lender IT

---

## Assistant

**Clarifying the Goal**

I'm focusing on distilling the user's request. It seems they want a simplified architectural explanation, suitable for someone with some server experience, but presented in a way that’s easily grasped. I'm aiming for a balance between detail and accessibility.

**Defining the Persona**

I've got a clearer picture of the intended audience: a product manager or technical thinker with intermediate server experience. The goal is now to communicate directly and clearly, without jargon, but also without talking down to them. The mental model needs to be crisp and professional.

**Refining the Architecture**

I've had to throw out some initial ideas. The SQS approach for /loans is out, due to vendor concerns, and an iFrame is a security risk. External S3 buckets for Lambda code also won't work. The plan is now to use API Gateway and Usage Plans for authentication and throttling, a single SSR Lambda for admin tasks, and Secrets Manager with DynamoDB for secure key management and token caching.

**Outlining the System**

I'm now detailing the system's endpoints. Reads will be direct and synchronous, fetching specific fields from Encompass using a cached token. Writes will be asynchronous using an SQS FIFO queue with a worker Lambda, handling retries for locked files. A DynamoDB table will provide job status, and deployment will be a single-line script, eliminating S3 buckets.

---

## Assistant

Here is the mental model.

Think of **Encompass** like a high-security, fragile bank vault built in the 1990s:

**Your gateway is the high-tech, bulletproof reception lobby you built right outside the vault.** Vendors never step foot in the vault; they only talk to the reception desk.

Here are the 5 moving parts that make this work:

---

### 1. The Reception Desk & Guest Badges (API Gateway + Admin Portal)

### 2. The Disguise Closet (OAuth Token Impersonation + DynamoDB Cache)

### 3. The Express Lane: Reading Data (Synchronous GET)

### 4. The Shock Absorber: Writing Data (Asynchronous SQS FIFO Queue)

### 5. The "No-Server" Deployment (GitHub Pages + CloudShell)

---

### The TL;DR Summary

```
[Vendor]
   │
   ├── (GET Read) ──► Fast Passthrough ──► Grabs 3 fields ──────► Instant Response (150ms)
   │
   └── (PATCH Write) ─► SQS FIFO Queue ──► Retries on Locks ────► Returns 202 "We got it"
                            │
                      (Only 10 at a time)
                            ▼
                   [ Encompass Instance ] (Completely protected, never overwhelmed)
```

---

## Assistant

**Considering Integration Approaches**

I'm currently focused on how best to structure the information for external vendors. I'm exploring offering a key that links field IDs to names and explanations, as per the user's initial prompt. This aims to streamline integration by providing clear context around those numeric identifiers, and other methods of data identification, to the vendors. I'm thinking about the various ways to offer this key, and what level of detail it should have.

**Analyzing Field Identifiers**

I'm now diving into the specifics of Encompass field IDs. The numerical IDs are cryptic, so I'm thinking a dictionary or mapping endpoint might be essential. It could be a simple GET /v1/fields or friendly aliases. I'm also considering documentation on GitHub Pages. Logging is another key consideration. It seems Encompass's audit log can handle the vendor impersonation, which is good. CloudWatch already logs HTTP requests, so audit trails seem well covered.

**Clarifying Key Storage**

I've clarified the key storage mechanism. It's serverless, using AWS API Gateway's native key store and DynamoDB. There's no traditional server running. The API keys live in the managed AWS key store, with metadata linking API key IDs to Encompass user IDs stored in a DynamoDB table.

**Describing Request Flow**

I'm now detailing the precise API request handling. The process starts with API Gateway's rapid key verification. Then, Lambda fetches the api_title_vendor from DynamoDB using the API key ID. I've also readdressed logging: Encompass records audit events from the impersonated user. Alongside this, CloudWatch monitors everything, from API Gateway's perspective, providing complete technical logging.

---

## Assistant

Here are direct answers to all three questions: where the keys live, how logging actually works, and how vendors know what those cryptic Encompass field numbers mean.

---

### 1. "Where are we storing the middleware keys? Is there a server?"

**There is no server.** You are not paying for or managing an EC2 instance, Docker container, or Linux box running 24/7.

The keys live inside two managed, serverless AWS services:

---

### 2. "Do we need logging, or does that happen in Encompass?"

**Both, but for completely different reasons.** You get two distinct audit trails automatically:

#### A. The Legal & Compliance Log (Inside Encompass)

Because we use **Token Impersonation**, Encompass treats the request as if a human logged in under that user account.

#### B. The Technical Diagnostic Log (Inside AWS CloudWatch)

Every time a vendor makes a call, your Lambda handlers output structured JSON into AWS CloudWatch (AWS's built-in log viewer):

If a vendor says "Your API is broken," the lender IT admin opens CloudWatch, filters by tenantName: "First American Title", and immediately sees if Encompass rejected the payload or if the vendor passed bad data.

---

### 3. "Do we need to offer field IDs with names/explanations?"

**Yes, because native Encompass field IDs are complete gibberish to an external developer.**

To a vendor:

#### The Trap to Avoid:

Do **not** try to build a custom translator in the gateway that maps every Encompass field to friendly names (e.g., writing code that translates loanAmount ↔ 1109). Encompass has **over 15,000 fields**, plus unlimited custom fields (CX.*). If you hardcode a dictionary in the middleware, you will spend your entire life updating field mappings whenever a lender changes a custom field.

#### The Lean Solution (YAGNI):

We solve this in two simple ways:

This keeps the gateway code tiny, relies on Encompass as the source of truth, and gives external developers the exact documentation they need to build their payloads.

---

## Assistant

**Clarifying Question Scope**

I'm currently focused on dissecting the initial question, specifically the ambiguity around "admin." My goal is to determine if the reference pertains to the vendor/broker admin or the lender's Encompass admin, or both. This clarity is paramount for establishing a correct framework for subsequent considerations.

**Addressing Security Concerns**

I'm now grappling with the security implications. My previous model included the lender admin generating an API key. Now, it seems I need a method where vendors can't simply create keys mapped to high-level Encompass access without proper authorization. I'm exploring invite links or one-time registration tokens generated by the lender, which seems much more secure than unauthenticated key creation.

**Refining Registration Options**

I'm now comparing self-registration models. While self-registration with a default persona initially seems appealing, domain-based matching presents authorization challenges. The two-step approval flow, where an admin approves access, feels more robust. But wait...the original PRD! It seems the project's intent was always a 2-step setup where the admin has to be involved. Can we rethink that?

**Exploring Setup Flexibility**

I'm now focusing on streamlining the initial setup after the Encompass installation. I'm considering standard role templates that can be configured once, such as "Title Vendor," "Mortgage Broker," and "Appraisal AMC," each mapping to specific Encompass users. My current concern revolves around securely providing access to these roles. I'm exploring shareable vendor invite links or onboarding secrets, and evaluating if self-registration with a "Partner Code" or "Lender Onboarding Key" is feasible. The goal is to minimize Encompass admin involvement after the initial setup. I also need to evaluate if Encompass has documentation for those key-value pairs.

**Clarifying Key Generation**

I'm now zeroing in on the specifics of key generation. I need to pinpoint exactly who's creating the keys – is it the vendor, the broker, or the lender's Encompass admin? Understanding this is crucial to isolating and removing the problematic party from the process. This dissection has become the focal point of my mental exercise.

**Isolating the Key Origin**

I've made a breakthrough. It seems the Encompass admin is entirely out of the day-to-day key setup. That shifts the focus: how do we prevent unauthorized key generation? If an unauthenticated vendor could just get a key, how do we block an anonymous hacker or, for example, a rival title vendor, from using the system to impersonate a broker? The plan is for the Encompass admin to predefine three persona templates: title, broker, and AMC. Now, how does the system enable vendors to self-onboard without needing an admin? This brings me to considering the "single reusable onboarding secret" approach.

**Exploring Self-Onboarding Options**

I'm now contemplating streamlined vendor onboarding. The automated webhook approach seems promising: trigger key generation directly from the lender's system when a vendor is marked as active. This reduces admin involvement drastically. However, the question of whether Encompass provides a public source of key-value pairs remains unanswered. I am curious if Encompass has a public page with the key-value pairs documented. It is unclear if that is documented and accessible, given that documentation is massive and partially gated.

---

## Assistant

### 1. Who Generates the Key? (How to Actually Get the Encompass Admin Out of the Loop)

You caught a major workflow detail. If an unauthenticated vendor walks up to a public /portal link, types "I'm Acme Title", and selects api_title_vendor, you have a security problem: anyone who discovers that URL could generate an active API key into the lender's Encompass system.

However, **we can get the Encompass Admin completely out of the day-to-day onboarding loop** with a **1-Time Template + Role-Based Invite Link** model:

```
[Encompass Admin]
       │
   (Does this ONCE at deployment, then leaves forever)
       ▼
Sets up 3 Generic Service Accounts in Encompass:
  ├── api_title_template      (Persona: Title / Settlement only)
  ├── api_broker_template     (Persona: TPO External Originator)
  └── api_appraisal_template  (Persona: AMC / Appraisal only)
```

#### How the Vendor Self-Serves (Zero Admin Intervention):

**Result:** The Encompass Admin never logs in. The vendor's dev team gets their own credentials in 30 seconds.

---

### 2. "Does Encompass have a public page with those field IDs?"

The short answer: **Not in a format your vendors can easily use.**

Here is the unvarnished truth about ICE Mortgage Technology's documentation and how we solve it:

#### The Problem with ICE's Public Docs:

#### How We Solve It (Zero Manual Documenting for You):

Instead of you or the admin manually building a dictionary, we handle this in two automated ways:

#### A. A 1-Page "Top 40 Fields" Cheat Sheet on Your GitHub Pages Site

On your GitHub Pages repo, we publish a clean, copy-paste table of the **universal standard fields** that title and broker partners actually care about:

(This covers 90% of basic third-party integrations right out of the box).

#### B. The Dynamic Schema Passthrough Route: GET /v1/fields

For everything else—including the lender's custom CX.* fields—we point the gateway at Encompass’s native **Field Schema API** (/encompass/v3/schemas/loan/fields)[[2](https://www.google.com/url?sa=E&q=https%3A%2F%2Fvertexaisearch.cloud.google.com%2Fgrounding-api-redirect%2FAUZIYQFkAO_mULowWyQK8aPc10Ujgmo9nFvQ992w2h5f0iS7Wo0c5WAh7_TrzpPb579HQuLw5XJLNqpABIB3DIU5yeQpYrMk2CPRwSVwh7xOkCPgHRFpTt5qbhEiN2CJBvN8cIgpKLvQobr2ViC86ZN4ceyGeXtE2ekjubtr4c-_psAUFLd79ektaLOwE0nDy-8Gmqy-xFvVaQ0zhDRHdyis)].

If a vendor wants to know what a field does, they hit your gateway:

```
GET /v1/fields?ids=11,646,CX.TITLE.STATUS
```

The gateway queries Encompass on the fly and returns:

```
{
  "11": { "description": "Subject Property Address", "type": "STRING" },
  "646": { "description": "Title - Lender Title Insurance", "type": "DECIMAL" },
  "CX.TITLE.STATUS": { "description": "Custom Title Milestone Status", "type": "STRING" }
}
```

No spreadsheets to maintain, no asking the Encompass admin to write documentation, and external developers get exact field definitions directly from the source of truth.

---

## Assistant

**Exploring Potential Integrations**

I'm currently focused on expanding the API gateway's applicability beyond the Encompass system. My thoughts are revolving around identifying other loan origination systems ripe for integration, particularly those known for causing significant headaches for lenders. Calyx Point is top-of-mind, but I'm also digging into the market for other potential targets that would benefit from streamlined API access.

**Considering API Key Implementation**

I'm now contemplating how to empower users directly. The goal is enabling loan origination system integration quickly, and I'm examining if user-managed API keys could accelerate that. Specifically, I'm thinking about the Calyx Point integration challenges. It's a Windows-based system that can't be readily integrated through a modern API gateway. My focus is on determining what integration methods would be useful, since Calyx Point is a desktop, legacy application.

**Analyzing Legacy LOS Systems**

I'm now diving deeper into the specific challenges of legacy Loan Origination Systems. The idea of implementing a Windows agent for systems lacking modern APIs, like Calyx Point, feels like a maintenance nightmare. I'm prioritizing identifying other systems with similar "pain in the ass" qualities: high market share, awful APIs, and a desperate need for integration with other vendors. My classification system starts with categorizing the mortgage ecosystem. Black Knight/ICE Empower is a target because its legacy nature creates integration headaches.

**Prioritizing Integration Targets**

I'm now zeroing in on specific LOS targets, expanding beyond origination. MeridianLink and OpenClose stand out due to their legacy interfaces and certification challenges. I'm also starting to look at servicing platforms. MSP's IBM Mainframe-based architecture presents a particularly intriguing challenge and potential opportunity for modernization. The focus now is on how to integrate the existing APIs or build new ones atop the servicing platform.

**Categorizing Ecosystem Elements**

I'm now expanding my target list and categorizing key players in the mortgage ecosystem. My analysis includes FICS, a significant player among mid-sized institutions and regional banks, notorious for its Windows-based, on-prem SQL Server. I'm also including Sagent (formerly Fiserv LoanServ), a heavy servicing platform with integration challenges. The focus now is on documenting and understanding the pain points for each.

**Refining Target Criteria**

I'm now assessing potential targets against a refined set of criteria. The Encompass model's success hinges on a cloud-accessible, though flawed, API, high third-party demand, and the value of a serverless wrapper. Calyx Point is off the table due to its desktop nature, and the focus is now on MeridianLink and its legacy APIs, vendor certification friction, and cost barriers. FIS is now on the radar.

**Evaluating Integration Needs**

I'm now focusing on specific pain points and potential solutions. Jack Henry's JXchange, a SOAP/XML relic, is a prime target for modernizing into a JSON REST API with self-serve keys. Servicing platforms like FICS and Sagent, with their reliance on batch jobs, are also high on the list. OpenClose and BytePro are of interest too, given their clunky REST APIs. Calyx Point is officially off the table. I'm prioritizing these candidates based on integration complexity and market impact.

---

## Assistant

**Assessing the Expansion**

I'm currently evaluating the implications of extending the gateway model to MeridianLink. The user anticipates a straightforward port. I need to determine if there are any anticipated challenges or modifications required for this transition. My focus is on thoroughly understanding the scope of work.

**Scrutinizing MeridianLink Integration**

I've moved on to analyzing MeridianLink's architecture and APIs in detail. I'm focusing on their services for consumer and mortgage loans, and account opening. The authentication is currently a roadblock, as there's no OAuth 2.0 Token Exchange available. I need to understand if the SOAP/XML or RESTful API approach presents challenges to the proposed model.

**Analyzing Authentication & Payloads**

I'm now deep-diving into the authentication and data payload differences. It appears MeridianLink predominantly uses API Keys, credentials with basic auth, or OAuth 2.0 client credentials with scoped roles. The use of dynamic persona impersonation like in Encompass (subject_user_id) is not their standard. I've discovered they rely on MISMO XML, custom XML, or proprietary JSON wrapping XML, and that their field IDs differ drastically from Encompass.

**Pinpointing Critical Differences**

I've hit a wall. MeridianLink enforces IP whitelisting and imposes API quotas, like Encompass, but their business model involves vendor integration fees. Optimistic concurrency exists in their web-based consumer applications, but not the same desktop locking as Encompass. The biggest challenge: they lack native OAuth persona impersonation, and that's not a small issue.

**Addressing Persona Filtering**

I'm now grappling with persona filtering. While Encompass handled it, MeridianLink has a single API Service Account per institution, not dynamic impersonation via token exchange. This presents challenges. I'm exploring either gateway-level filtering, separate service accounts per vendor type, or relying on MeridianLink's application roles. The implications are significant.

**Evaluating the Costs**

I'm now fully immersed in the ramifications of IP whitelisting. The need for a VPC, private subnets, and a NAT Gateway due to MeridianLink's IP restrictions is significant. The estimated $32/month AWS cost increase and deployment complexity add another layer of consideration. Also, my focus shifts to data format differences; I need to address the need for JSON-to-XML transformations when dealing with MISMO XML and custom XML formats used by MeridianLink's APIs.

**Defining the Roadblocks**

I've got a clearer picture: it's not a simple port. I need to make sure the user knows that there are four major hurdles: the lack of OAuth token impersonation in MeridianLink, the IP whitelisting challenge, the distinction between Consumer and Mortgage products, and the need to handle MISMO XML. However, the API Gateway key issuance and rate-limiting, SQS FIFO buffering, and single-file inline CloudFormation deployment are reusable.

---

## Assistant

27.8s

---

## Assistant

**Considering IP Whitelisting**

I'm currently focused on supporting static IP whitelisting, a key requirement for MeridianLink Mortgage environments. This necessitates careful planning for our cloud implementation.

**Prioritizing Deployment Friction**

My latest thinking centers on simplifying the deployment process. We're aiming for a CloudFormation-based solution creating a minimal VPC with public and private subnets, including an Elastic IP and NAT Gateway. The goal is to provide a single static EgressElasticIP output for easy integration into the lender's firewall. I've decided to prioritize MeridianLink Mortgage, focusing on its specific mortgage workflows, with integration via MISMO XML &lt;-> JSON conversion using the user's approach, potentially integrating a lightweight MISMO JSON translator into the Lambda.

**Evaluating Network Topology**

I'm now deep-diving into the network topology implications. The goal is a static outbound IP for MeridianLink Mortgage, focusing on static IP whitelisting. This necessitates a VPC with public/private subnets, internet gateway and a NAT gateway to achieve a single Elastic IP. The CloudFormation approach should deploy it automatically.

**Analyzing Access Control**

I'm now assessing authentication and authorization, specifically RBAC in our context without token impersonation. The aim is to handle vendor data scoping effectively. I'm combining the two potential options, leveraging the MeridianLink Mortgage's flexibility in managing API users or role profiles while reinforcing a strict field and container allowlist within the Lambda function. This approach ensures appropriate data access based on the tenant's registered persona and corresponding schema restrictions.

**Implementing Secure Data Handling**

I'm now implementing secure data handling strategies. I am integrating multiple MeridianLink profile credentials within Secrets Manager, defaulting to stringent gateway-level MISMO JSON container redaction to prevent sensitive NPI from reaching the wire. This approach will ensure data privacy and security. The plan is to create a secure, reliable pipeline.

**Designing the Data Flow**

I'm now designing the data flow. The API receives MISMO XML, flattens it to clean JSON, and sends the transformed data to the vendor. We're using an SQS FIFO queue with MessageGroupId = LoanId, returning a 202 Accepted and jobId. MeridianLink Mortgage uses record locking during editing, and we'll handle optimistic lock contention with backoff retries. Finally, I'm drafting the response, highlighting the automated Static IP architecture through CloudFormation and addressing data scoping via Gateway Schema Masking (Allowlists).

---

## Assistant

Focusing on **MeridianLink Mortgage** and solving the **MISMO XML abstraction** hits a massive pain point.

Most vendors actively avoid integrating directly with MeridianLink Mortgage specifically because they don't want to hire engineers to write custom MISMO 3.4 XML parsers or deal with the bureaucratic firewall setup.

Since we are committing to **supporting IP Whitelisting** and **abstracting MISMO XML into clean JSON**, here is how we re-engineer the gateway to keep it 1-click and low-friction, along with the technical decisions we need to lock down.

---

### 1. The IP Whitelist Solution: "Zero-Config" VPC & Static Egress IP

Lenders cannot be asked to manually configure VPC routing tables, subnets, or Elastic IPs. That kills the 1-click promise.

**How we solve it in the single template.yaml:**
CloudFormation automatically provisions:

**The Lender IT Experience:**
When the lender runs deploy.sh in AWS CloudShell, the terminal script completes and prints:

```
====================================================
             DEPLOYMENT SUCCESSFUL!
====================================================
AdminPortalUrl:        https://abc.execute-api.us-east-1.amazonaws.com/prod/portal
GatewayStaticEgressIP: 54.210.88.14
====================================================

NEXT STEP FOR LENDER IT:
Email MeridianLink Support or add to your ML Firewall:
"Please whitelist outbound static IP: 54.210.88.14 for our API integration."
```

---

### 2. Solving Data Scoping Without "Token Impersonation"

Because MeridianLink Mortgage lacks Encompass's dynamic persona impersonation (subject_user_id), **our gateway must become the data firewall.**

Instead of trusting MeridianLink to filter fields, the gateway enforces **Persona-Based MISMO Schema Masking**:

```
[MeridianLink Mortgage]
         │ (Returns Full 5,000-line MISMO 3.4 XML)
         ▼
[Gateway Lambda + mismo.js parser]
         │
         ├─► If Caller = "TITLE_VENDOR"
         │     └─► Strip: Borrower SSN, Credit Score, Income, Bank Assets
         │     └─► Keep:  Property, Loan Amount, TRID Fee Containers (Section C & E)
         │
         ├─► If Caller = "TPO_BROKER"
         │     └─► Strip: Internal Margin, Secondary Desk Adjustments, Other Org Loans
         │     └─► Keep:  1003 Data, Milestones, Conditions, Rate Lock Status
         │
         ▼
[Clean, Redacted JSON to Vendor]
```

**Why this is huge:** The lender’s InfoSec and Compliance teams will love this. Even if a third party tries to query raw borrower credit data, the gateway intercepts the MISMO response and shreds the sensitive tags before emitting the JSON payload.

---

### 3. The Developer Experience: Bypassing MISMO 3.4 Hell

Instead of forcing title vendors and brokers to construct complex XML structures like:

```
<!-- What MeridianLink expects (MISMO 3.4) -->
<MESSAGE MISMOVersionID="3.4">
  <DEAL_SETS>
    <DEAL_SET>
      <DEALS>
        <DEAL>
          <LOANS>
            <LOAN>
              <FEE_DETAIL>
                <FEE>
                  <FeeType>TitleLenderCoveragePremium</FeeType>
                  <FeeActualPaymentAmount>1250.00</FeeActualPaymentAmount>
...
```

The vendor simply calls your gateway with modern, predictable JSON:

#### A. The Vendor Reads a Loan:

```
GET /v1/loans/ML-998822
```

**Gateway returns:**

```
{
  "loanId": "ML-998822",
  "milestone": "Underwriting",
  "property": {
    "street": "123 Main St",
    "city": "Irvine",
    "state": "CA",
    "zip": "92618"
  },
  "terms": {
    "loanAmount": 450000.00,
    "noteRate": 6.875,
    "closingDate": "2026-11-20"
  },
  "fees": [
    { "type": "TitleLenderCoveragePremium", "amount": 1250.00, "paidTo": "First American" }
  ]
}
```

#### B. The Vendor Writes a Title Fee:

```
PATCH /v1/loans/ML-998822/fees
{
  "fees": [
    { "type": "TitleLenderCoveragePremium", "amount": 1350.00 },
    { "type": "SettlementClosingFee", "amount": 600.00 }
  ]
}
```

**Gateway behavior:**

---

### Implementation Plan for the MeridianLink Mortgage Gateway

We will structure this repository identically to the Encompass model for consistency:

Shall we generate the complete **MeridianLink Mortgage PRD and CloudFormation architecture** next?

---

## You

Perfect - write up the master dev doc like we had before (prd, implimentation guide, dev task list, agents.md) and your response should be the contents of this master dev doc (in markdown).

---

## Assistant

**Initiating the Analysis**

I'm currently breaking down the request: the core goal is to generate the comprehensive Master Dev Document for the MeridianLink Mortgage API Passthrough & Middleware Gateway, specifically in Markdown format. I am focused on the document's structure and the crucial sections that need to be in place.

**Defining the Structure**

I've outlined the document's essential parts: the PRD, implementation guide & architecture, the development task list, and AGENTS.md. Key architectural decisions are solidified. We're targeting MeridianLink Mortgage and ensuring stateless passthrough with IP whitelisting. A gateway schema masking approach resolves token impersonation, and a MISMO translator module handles XML-JSON conversion.

**Refining the Workflow**

I'm now zeroing in on the specifics: I will implement asynchronous, FIFO writes with PATCH /v1/loans/{id} which will return a 202 Accepted along with a job_id. SQS FIFO will buffer the requests with exponential backoff. I'm also planning for job status tracking via DynamoDB and an admin onboarding portal. The goal is a completely GitHub-hosted and -deployed solution, with secrets securely managed and standardized logging.

**Defining Log & Doc Elements**

I'm now focusing on the logging strategy: I will use structured JSON logs with defined levels, actions, and metadata, keeping it concise. Also, I am breaking down the Master Dev Document, and creating its components in modular fashion for practicality. I am working on the PRD section, starting with its executive summary, problem statement, core objectives, architecture principles, target audience, system requirements and API specifications.

**Detailing the Implementation**

I'm now fully immersed in the implementation specifics. I will integrate Static IP Egress and VPC Network Topology with zero-config NAT Gateway. Next, I'm working on the Persona-Based Schema Masking Engine, allowing for both allowlisting and denylisting for Title, Broker, and AMC fields. I'm also ensuring the Inline MISMO 3.4 XML &lt;-> JSON Translator (mismo_translator.js) will function correctly. Finally, I'm defining the SQS FIFO Write Pipeline with Record Lock Retries.

---

## Assistant

# Master Dev Document: MeridianLink Mortgage API Passthrough & Middleware Gateway

---

## Part 1: Product Requirements Document (PRD)

### 1. Executive Summary

Lenders and credit unions using MeridianLink Mortgage face steep barriers when onboarding external integration partners (title and settlement companies, independent mortgage brokers, and appraisal management companies). MeridianLink Mortgage relies heavily on complex MISMO 3.4 XML transactions, enforces rigid IP whitelisting on enterprise instances, lacks native persona-based OAuth token impersonation, and charges hefty partner certification tolls that stall third-party innovation.

This product is an **open-source, zero-vendor-footprint serverless middleware gateway** deployed directly into the lender's AWS account in under two minutes via a single command in AWS CloudShell. It provisions a dedicated static egress IP for firewall whitelisting, abstracts verbose MISMO 3.4 XML into clean, predictable JSON REST endpoints, enforces gateway-level persona schema masking (protecting borrower NPI without relying on native user impersonation), and absorbs write contention using an AWS SQS FIFO queue with exponential backoff.

---

### 2. Problem Statement & Market Context

---

### 3. Core Objectives & Non-Goals

---

### 4. Architecture Principles & Constraints

---

### 5. Target Audience & Personas

---

### 6. System Requirements Matrix

---

### 7. API Specifications

#### External Endpoints (Vendor-Facing)

```
{
  "loanId": "ML-998822",
  "milestone": "Underwriting",
  "property": {
    "street": "123 Main St",
    "city": "Irvine",
    "state": "CA",
    "postalCode": "92618"
  },
  "terms": {
    "loanAmount": 450000.00,
    "noteRate": 6.875,
    "estimatedClosingDate": "2026-11-20"
  },
  "fees": [
    {
      "feeType": "TitleLenderCoveragePremium",
      "amount": 1250.00,
      "paidTo": "First American Title"
    }
  ]
}
```

(Note: Borrower SSN, Credit Score, and Income containers are automatically stripped by the gateway for this persona).

```
{
  "fees": [
    {
      "feeType": "TitleLenderCoveragePremium",
      "amount": 1350.00,
      "paidTo": "First American Title"
    },
    {
      "feeType": "SettlementClosingFee",
      "amount": 650.00,
      "paidTo": "First American Title"
    }
  ]
}
```

```
{
  "status": "ACCEPTED",
  "jobId": "job-meridian-4455",
  "loanId": "ML-998822",
  "statusUrl": "/v1/jobs/job-meridian-4455"
}
```

```
{
  "jobId": "job-meridian-4455",
  "loanId": "ML-998822",
  "status": "COMPLETED", // PENDING | RETRYING | COMPLETED | FAILED
  "attempts": 1,
  "updatedAt": "2026-11-06T15:30:00Z",
  "error": null
}
```

#### Internal Endpoints

---

## Part 2: Implementation Guide & Architecture

### 1. Architecture Topology

```
[EXTERNAL PARTNERS]
                                       │
                                ( x-api-key )
                                       ▼
                         [ AMAZON API GATEWAY REST API ]
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
   GET /v1/loans/{id}                                    PATCH /v1/loans/{id}/*
   (Synchronous Read)                                    (Asynchronous Write)
            │                                                     │
            ▼                                                     ▼
   ┌─────────────────┐                                   ┌─────────────────┐
   │   Read Handler  │                                   │ Enqueue Handler │
   │  Lambda (VPC)   │                                   │     Lambda      │
   └────────┬────────┘                                   └────────┬────────┘
            │                                                     │
            │                                                     ▼
            │                                            ┌──────────────────┐
            │                                            │  SQS FIFO Queue  │
            │                                            │(GroupId=LoanId)  │
            │                                            └────────┬─────────┘
            │                                                     │
            │                                                     ▼
            │                                            ┌──────────────────┐
            │                                            │  Worker Handler  │
            │                                            │   Lambda (VPC)   │
            │                                            └────────┬─────────┘
            │                                                     │
            └──────────────────────────┬──────────────────────────┘
                                       │
                        (Outbound Private Route: 0.0.0.0/0)
                                       │
                                       ▼
                           ┌───────────────────────┐
                           │   AWS NAT GATEWAY     │
                           │ (Attached Static EIP) │
                           └───────────┬───────────┘
                                       │
                             (Static Public IP)
                                       │
                                       ▼
                       [ MERIDIANLINK MORTGAGE API ]
                       (Firewall Whitelist Passed)
```

---

### 2. Static IP Egress & VPC Network Topology

To satisfy MeridianLink's IP whitelisting without manual network configuration, the CloudFormation template defines:

---

### 3. Persona-Based Schema Masking Engine

Because MeridianLink lacks dynamic token impersonation, the gateway Lambda handles schema isolation via an **Allowlist Masking Strategy**.

When MISMO 3.4 XML is parsed into intermediate JSON, the masking engine applies a strict structural filter before returning the response:

```
// Persona Filtering Matrix
const SCHEMA_ALLOWLISTS = {
  TITLE_VENDOR: [
    "loanId",
    "milestone",
    "property.street",
    "property.city",
    "property.state",
    "property.postalCode",
    "terms.loanAmount",
    "terms.noteRate",
    "terms.estimatedClosingDate",
    "fees"
  ],
  TPO_BROKER: [
    "loanId",
    "milestone",
    "property",
    "terms",
    "borrower.name",
    "borrower.email",
    "conditions",
    "lockStatus"
  ],
  AMC_VENDOR: [
    "loanId",
    "milestone",
    "property",
    "property.legalDescription",
    "appraisalContact",
    "terms.loanType"
  ]
};
```

Any JSON path not explicitly declared in the caller's role allowlist is recursively pruned. Sensitive containers (TaxpayerIdentifier, CreditScore, AssetSummary) are never transmitted to unauthorized partners.

---

### 4. Inline MISMO 3.4 XML &lt;-> JSON Translator (mismo_translator.js)

The gateway utilizes an inline, zero-dependency parser to map between MISMO 3.4 XML and vendor JSON:

#### JSON to MISMO 3.4 Transformation (Fee Update Example):

```
function jsonToMismoFees(loanId, feeArray) {
  const feeXmlElements = feeArray.map(fee => `
    <FEE>
      <FEE_DETAIL>
        <FeeType>${escapeXml(fee.feeType)}</FeeType>
        <FeeActualPaymentAmount>${Number(fee.amount).toFixed(2)}</FeeActualPaymentAmount>
        <FeePaidToName>${escapeXml(fee.paidTo || '')}</FeePaidToName>
      </FEE_DETAIL>
    </FEE>
  `).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE MISMOVersionID="3.4" xmlns="http://www.mismo.org/residential/2009/schemas">
  <DEAL_SETS>
    <DEAL_SET>
      <DEALS>
        <DEAL>
          <LOANS>
            <LOAN>
              <LOAN_IDENTIFIERS>
                <LOAN_IDENTIFIER>
                  <LoanIdentifier>${escapeXml(loanId)}</LoanIdentifier>
                </LOAN_IDENTIFIER>
              </LOAN_IDENTIFIERS>
              <FEES>
                ${feeXmlElements}
              </FEES>
            </LOAN>
          </LOANS>
        </DEAL>
      </DEALS>
    </DEAL_SET>
  </DEAL_SETS>
</MESSAGE>`;
}
```

---

### 5. SQS FIFO Write Pipeline & Concurrency Shock Absorber

---

## Part 3: Developer Task List

### Phase 1: Networking & Core Infrastructure

### Phase 2: Translation & Schema Masking Engines

### Phase 3: Synchronous Read Handler

### Phase 4: SQS FIFO Write Pipeline & Resiliency

### Phase 5: Zero-Dependency SSR Admin Portal

### Phase 6: Packaging, Distribution & Verification

---

## Part 4: AGENTS.md (Operating Manual for AI Agents & Developers)

### 1. Operating Philosophy

---

### 2. Standardized JSON Logging Schema

All Lambda handlers must output machine-readable, structured JSON using the schema below:

```
const log = (level, action, details = {}) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    system: "MeridianLinkGateway",
    level,      // "INFO" | "WARN" | "ERROR"
    action,     // e.g. "MISMO_TRANSLATION_SUCCESS", "RECORD_LOCK_BACKOFF"
    ...details
  }));
};
```

#### Key Action Identifiers:

---

### 3. Canonical Handler Implementation: read_proxy.js

Below is the complete implementation of the read handler demonstrating VPC execution, Secrets Manager caching, MISMO-to-JSON parsing, and persona schema masking.

```
/**
 * File: read_proxy.js
 * Description: Synchronous read passthrough for MeridianLink Mortgage.
 * Translates MISMO 3.4 XML to clean JSON and enforces persona schema masking.
 * Runtime: Node.js 20.x (Zero external dependencies).
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsManager = new SecretsManagerClient({});

const SECRET_ARN = process.env.MERIDIAN_SECRET_ARN;
const TENANT_TABLE = process.env.TENANT_TABLE;

const log = (level, action, details = {}) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), system: "MeridianLinkGateway", level, action, ...details }));
};

let cachedSecret = null;

async function getCredentials() {
  if (cachedSecret) return cachedSecret;
  log("INFO", "FETCHING_CREDENTIALS_FROM_SECRETS_MANAGER");
  const res = await secretsManager.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  cachedSecret = JSON.parse(res.SecretString);
  return cachedSecret;
}

// Minimal, zero-dependency XML value extractor
function extractXmlTag(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? match[1].trim() : null;
}

// Lightweight MISMO 3.4 XML to Normalized JSON Parser
function parseMismoLoanXml(xml) {
  return {
    loanId: extractXmlTag(xml, "LoanIdentifier") || "UNKNOWN",
    milestone: extractXmlTag(xml, "CurrentMilestoneName") || "Processing",
    property: {
      street: extractXmlTag(xml, "AddressLineText"),
      city: extractXmlTag(xml, "CityName"),
      state: extractXmlTag(xml, "StateCode"),
      postalCode: extractXmlTag(xml, "PostalCode")
    },
    terms: {
      loanAmount: parseFloat(extractXmlTag(xml, "LoanAmount") || "0"),
      noteRate: parseFloat(extractXmlTag(xml, "NoteRatePercent") || "0"),
      estimatedClosingDate: extractXmlTag(xml, "EstimatedClosingDate")
    },
    borrower: {
      name: extractXmlTag(xml, "FullName"),
      taxpayerIdentifier: extractXmlTag(xml, "TaxpayerIdentifier"), // Sensitive SSN
      creditScore: extractXmlTag(xml, "CreditScoreValue")           // Sensitive NPI
    },
    fees: []
  };
}

// Gateway Persona Schema Masking Filter
function applyPersonaMask(loanData, role) {
  const sanitized = {
    loanId: loanData.loanId,
    milestone: loanData.milestone,
    property: loanData.property
  };

  if (role === "TITLE_VENDOR") {
    sanitized.terms = {
      loanAmount: loanData.terms.loanAmount,
      noteRate: loanData.terms.noteRate,
      estimatedClosingDate: loanData.terms.estimatedClosingDate
    };
    sanitized.fees = loanData.fees;
    // Explicitly exclude loanData.borrower (SSN, Credit Score, Income)
  } else if (role === "TPO_BROKER") {
    sanitized.terms = loanData.terms;
    sanitized.borrower = {
      name: loanData.borrower.name
      // Exclude taxpayerIdentifier and creditScore
    };
    sanitized.fees = loanData.fees;
  } else if (role === "AMC_VENDOR") {
    sanitized.terms = {
      loanAmount: loanData.terms.loanAmount
    };
  }

  log("INFO", "SCHEMA_MASKING_APPLIED", { role, loanId: loanData.loanId });
  return sanitized;
}

exports.handler = async (event) => {
  const requestId = event.requestContext?.requestId;
  const loanId = event.pathParameters?.id;
  const apiKeyId = event.requestContext?.identity?.apiKeyId;

  log("INFO", "READ_REQUEST_RECEIVED", { requestId, loanId, apiKeyId });

  try {
    if (!loanId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing loanId path parameter" }) };
    }

    // 1. Resolve Tenant Mapping and Assigned Role
    const tenantRecord = await ddb.send(new GetCommand({
      TableName: TENANT_TABLE,
      Key: { apiKeyId }
    }));

    if (!tenantRecord.Item) {
      log("WARN", "TENANT_NOT_FOUND", { apiKeyId });
      return { statusCode: 403, body: JSON.stringify({ error: "Unauthorized API key" }) };
    }

    const tenantRole = tenantRecord.Item.role || "TITLE_VENDOR";
    const credentials = await getCredentials();

    // 2. Query MeridianLink Mortgage via Static NAT Egress
    const targetUrl = `${credentials.baseUrl}/api/mismo/v3_4/loans/${encodeURIComponent(loanId)}`;
    const startTime = Date.now();

    log("INFO", "EGRESS_IP_DISPATCH", { targetUrl });

    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
        "Accept": "application/xml"
      }
    });

    const durationMs = Date.now() - startTime;
    const rawXml = await response.text();

    log("INFO", "MERIDIANLINK_RESPONSE_RECEIVED", { status: response.status, durationMs });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Upstream MeridianLink error", status: response.status })
      };
    }

    // 3. Translate MISMO 3.4 XML to Normalized JSON
    const parsedData = parseMismoLoanXml(rawXml);

    // 4. Apply Schema Masking Based on Role
    const maskedResponse = applyPersonaMask(parsedData, tenantRole);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=15"
      },
      body: JSON.stringify(maskedResponse)
    };

  } catch (error) {
    log("ERROR", "READ_HANDLER_EXCEPTION", { message: error.message, stack: error.stack });
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal Gateway Error", details: error.message })
    };
  }
};
```

---

### 4. Canonical CloudShell Deployment Script: deploy.sh

```
#!/usr/bin/env bash
# File: deploy.sh
# Description: 1-line deployment script for MeridianLink Mortgage Gateway.
# Automatically creates VPC, NAT Gateway, EIP, and returns static whitelist IP.

set -euo pipefail

STACK_NAME="MeridianLink-Mortgage-Gateway"
GITHUB_RAW_URL="https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/template.yaml"

echo "===================================================="
echo "    MeridianLink Mortgage API Gateway Setup         "
echo "===================================================="

if ! command -v aws &> /dev/null; then
  echo "[ERROR] AWS CLI not detected. Run inside AWS CloudShell."
  exit 1
fi

echo -e "\n[1/3] Enter MeridianLink Mortgage Credentials..."
read -rp "Enter MeridianLink Base API URL: " ML_BASE_URL
read -rp "Enter MeridianLink API Username: " ML_USERNAME
read -rsp "Enter MeridianLink API Password: " ML_PASSWORD
echo ""

TMP_TEMPLATE=$(mktemp /tmp/ml-gateway-XXXXXX.yaml)
trap 'rm -f "$TMP_TEMPLATE"' EXIT

echo -e "\n[2/3] Fetching CloudFormation template from GitHub..."
curl -sSL "$GITHUB_RAW_URL" -o "$TMP_TEMPLATE"

echo -e "\n[3/3] Deploying CloudFormation Stack (Provisions VPC + NAT Gateway)..."
echo "Note: Allocating Elastic IP and building NAT Gateway takes ~2 minutes..."

aws cloudformation deploy \
  --template-file "$TMP_TEMPLATE" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      MeridianBaseUrl="$ML_BASE_URL" \
      MeridianUsername="$ML_USERNAME" \
      MeridianPassword="$ML_PASSWORD"

echo -e "\n===================================================="
echo "             DEPLOYMENT SUCCESSFUL!                 "
echo "===================================================="

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[*].[OutputKey, OutputValue]" \
  --output table

echo -e "\nACTION REQUIRED: Provide the GatewayStaticEgressIP shown above to MeridianLink Support to whitelist your gateway."
```
