# Loan ownership binding: plan and blocker

Status: designed, not implemented. Blocked by the CloudFormation template budget, not by
an open design question. See "Why this is not code yet" at the end.

## What Encompass changed, and what carries over

Encompass replaced a shared template-persona token with a per-key bound vendor user, so
Encompass itself decides which loans a key can reach. MeridianLink needs the same outcome
by a different mechanism, because it has no impersonation token exchange.

The outcome, restated for this repo: a key is bound to one MeridianLink user, every vendor
call authenticates as that user, and a loan id belonging to a different company returns
`404` rather than masked data.

## Why MeridianLink is actually the easier target

This repo already calls `AuthService.asmx` `GetUserAuthTicket`, and that ticket is a
**per-user** session. Today the gateway authenticates one shared credential for the whole
deployment, so every tenant's ticket belongs to the same MeridianLink user. Binding a key
to its own user means requesting that user's ticket instead, and then MeridianLink's own
loan visibility applies to reads, fee writes, documents, and conditions alike.

The parts that already help:

- `EDocsService.asmx` calls are made with the same ticket, so document access inherits the
  binding instead of needing a second authorization path.
- Condition submission is a MISMO `<CONDITIONS>` write on the loan, so it inherits the same
  visibility rule.
- Reads already have no server-side loan cache, so there is no cross-tenant cache to fix.

## Planned shape

1. Tenant row gains `meridianUserId` (the broker's own MeridianLink login) and a
   `binding` snapshot recorded at enrollment, matching Encompass's shape.
2. Enrollment requires that login. Verification needs a MeridianLink call that reports "who
   am I" for a ticket. `AuthService.asmx` returns a ticket but this repo has no confirmed
   profile/identity operation, so this step is the open vendor question.
3. Ticket cache moves from one shared credential to per-user, exactly as Encompass moved
   from per-persona to per-user.
4. The persona masking in `src/mask.js` stays: `TPO_BROKER` / `TITLE_VENDOR` / `AMC_VENDOR`
   still decide *fields*. Binding decides *which loans*, which is a different axis. Both
   must hold.
5. A loan-scoped ownership guard is deferred for the same reason as Encompass: the MISMO
   payload in this repo carries no loan-to-organization field, so there is nothing honest
   to compare against yet.

## Open vendor questions

- Which MeridianLink operation confirms the identity behind a ticket, so enrollment can
  prove the login instead of trusting the form?
- Can one deployment hold per-user tickets for many users, or does MeridianLink scope
  tickets to the credential that created them?
- Does the EDocs SOAP service honor the same user's loan visibility as the MISMO read
  path, or does it use a service-level identity? If it is service-level, documents would
  need a gateway-side ownership check even after the read path is bound.

## Why this is not code yet

The inline Lambda bundle is generated into `template.yaml`, and `test/template.test.js`
requires at least 1 KB of headroom under CloudFormation's 51,200-byte direct-upload limit.
Current state:

```
template.yaml        50,135 bytes
limit                51,200 bytes
reserved headroom     1,024 bytes  (enforced by test)
free bytes                 41
```

41 bytes cannot hold enrollment verification, a per-user ticket cache, or the tests for
them. Deleting the template guard or trimming documented portal features to buy room would
be defeating the check rather than fixing the cause.

The honest prerequisite is the architecture change Encompass already made: build an S3
hosted template (and pass `--s3-bucket`) so the inline bundle stops competing with the
51,200-byte cap. That is a separate, reviewable change, and it unblocks this feature for
both MeridianLink and BytePro at once.
