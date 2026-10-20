# QA Report — ALMTech ERP feature branch

## Release reference

- Feature branch: `codex/almtech-financial-features`
- Latest feature commit: `88c3c8ec9b95a1d94dd118ed512f452dcef1fe38`
- Browser evidence was recorded against `32fe88ae987d129d4c51e2a82c1c02d92bfc1deb`. The later `88c3c8e` commit changes tests only.

## Verified automated tests

- Backend suite: **360 passed**.
- Frontend suite: **43 passed**.
- `git diff --check`: **passed**.

## Browser workflow evidence

Saved evidence: `/tmp/almtech-release-ui-evidence-20261020/results.json`. It records all seven feature groups and Admin, Sales, and Stock permission checks as **PASS**, using synthetic records and an ephemeral MongoDB Memory Server. It reports no browser errors or workflow failures. This evidence is outside the repository and is not a repeatable test script.

The live ExchangeRate-API provider check is **BLOCKED / NOT TESTED** because no API key was configured. The browser run verified that the missing-rate state blocks a payable correction with HTTP 503 and leaves the original PKR payable unchanged. It did not verify a real GBP/PKR quote or successful provider-backed conversion.

## Known limitations and unverified deployment behavior

- GBP sales invoices, GBP expenses, GBP purchase receiving, and cross-currency payment settlement are unsupported. Payments must use the payable's original currency. Historical records without a currency remain PKR. Customer balances and general reports remain PKR-only.
- Backend `npm run build` removes and recreates `backend/public` from the frontend build. It was not run for this review. Confirm the deployment path contains no required manually added files before relying on this build behavior.
- No production data was accessed or changed. No merge, push, or deployment was performed. Live provider behavior and deployment behavior remain unverified.
