# Security Policy

## Report a Vulnerability

If you have found a security vulnerability in these n8n nodes, please report via email to
[opensource-security@deepset.ai](mailto:opensource-security@deepset.ai).

In your message, please include:

1. Reproducible steps to trigger the vulnerability.
2. An explanation of what makes you think there is a vulnerability.
3. Any information you may have on active exploitations of the vulnerability (zero-day).
4. An explanation of why you believe the vulnerability is not out of scope. See the Out of Scope
   section below.

We encourage reports that are meaningful, high-impact, and reviewed by a human before submission.
Fully automated or AI-generated reports submitted without human review and validation are unlikely
to meet this bar and risk being declined.

## Out of Scope

These packages are n8n community nodes that run inside your own n8n instance, under credentials you
configure, against a Haystack Enterprise Platform workspace you already have access to.
Vulnerabilities that require an attacker to already control the n8n instance, its credentials, or
the workflow definitions are out of scope. Issues in n8n itself should be reported to n8n, and
issues in the Haystack Enterprise Platform API to deepset via the address above.

The following area has been deliberately scoped out below and we ask that you read it carefully
before submitting.

### Running Services and Managing Resources on the Platform

The nodes act on the Haystack Enterprise Platform on behalf of the user whose credentials are
configured in n8n. The nodes connect to _services_, the stable entities users interact with on the
platform; each service runs at least one pipeline under the hood. For example, the Haystack
Enterprise AI node queries services, and the pipelines behind them can contain the user's own code.
The nodes can also create, read, update and delete resources such as files, indexes and search
sessions in the user's workspace.

**Running user-authored services and modifying one's own resources is the intended behavior.** The
security responsibility lies with the operator: services and the inputs passed to them must be
treated as code, reviewed accordingly, and never built from untrusted or user-controlled input
without review. API keys should be scoped to what the workflow needs. Reports that demonstrate, for
example, code execution through a service the operator chose to run, or changes to resources the
credentials are authorized to modify, are out of scope.

---

If you are uncertain whether a finding falls within scope, feel free to reach out before submitting
a full report.

## Vulnerability Response

We aim to review your report within 5 business days where we do a preliminary analysis to confirm
that the vulnerability is plausible. Otherwise, we'll decline the report.

We won't disclose any information you share with us but we'll use it to get the issue fixed or to
coordinate a vendor response, as needed.

We'll keep you updated of the status of the issue.

Our goal is to disclose bugs as soon as possible once a user mitigation is available. Once we get a
good understanding of the vulnerability, we'll set a disclosure date after consulting the author of
the report and the maintainers of the deepset n8n nodes.
