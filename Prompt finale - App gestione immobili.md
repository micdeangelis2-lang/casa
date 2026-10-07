# Prompt: Personal web app for managing real estate in Italy

## 0. How you must work (read first)

You are a senior full-stack engineer and product architect. Build a modular web app that lets a single owner organise, monitor and share the complete documentation and obligations of real estate located in Italy.

Work in two stages and **do not skip the stop between them**:

1. **Stage A: Architecture proposal.** Before writing application code, deliver a written proposal containing: chosen stack with justification, data model (entities, relations, key constraints), rules-engine design, module breakdown, security and privacy design, storage and backup design, notification design, testing strategy and an incremental delivery plan. Then **stop and wait for explicit approval**.
2. **Stage B: Implementation.** After approval, build in small vertical increments. Each increment must run, be tested and be demonstrable before the next starts.

General rules:

- The business requirements below are fixed. Technical choices (framework, database, storage, auth, notification provider) are **yours to propose** in Stage A, with alternatives and trade-offs. Do not couple the domain logic to one vendor: put database, file storage, authentication, email and scheduling behind interfaces (ports/adapters) so providers can be swapped.
- The only hard technical constraint is that the app must be **deployable on Vercel**.
- If something is ambiguous and blocking, ask. If it is not blocking, choose a sensible default, record it in a `DECISIONS.md` file and move on.
- Never invent Italian legal, tax or administrative facts. Where the app needs such content, it is **data** with a source, an effective period and a verification status (see section 5), never hard-coded logic.
- Reuse before writing: search the codebase for an existing function or module before adding a new one. When you replace something, delete the old version. Mark temporary files `[TEMPORARY]` and remove them before finishing an increment.

## 1. Goal

The app helps the owner build, maintain and selectively share a complete **dossier** for each property or ancillary asset, so that any professional the owner chooses to involve can understand the situation quickly. It also tracks obligations and deadlines across all normative levels.

The app **organises, reminds, compares and prepares**. It does not give legal, tax or technical opinions (see section 12).

## 2. Users and access model

- **Single user: the owner.** One authenticated account, no self-registration, no multi-tenancy, no billing.
- Professionals and offices are **contacts in a directory**, not users. They have no login.
- Sharing with third parties happens only through **selective export packages** (section 10), which the owner sends manually.
- Authentication is still mandatory because the app is publicly reachable and stores sensitive documents. Propose a strong option (passkeys or equivalent with a second factor) in Stage A.
- Keep a thin authorisation layer so that adding roles later does not require redesigning the data model, but do not build multi-user features now.

## 3. Property scope

Support at least:

- Primary and secondary residences.
- Apartments and buildings within a condominium.
- Detached houses.
- Garages, boxes, parking spaces, cellars and other ancillary assets.
- Properties let, or intended to be let.
- Properties used, where permitted, for hospitality or accommodation business.
- Ownership regimes: sole ownership, co-ownership (with quotas), usufruct and bare ownership.

Ancillary assets (garage, box, parking space, cellar) are **autonomous assets** that can be linked to one or more properties. Each has its own documents, taxes, condominium shares, maintenance, access, risks, insurance and deadlines.

Do **not** assume fiscal or civil-law "pertinenza" status automatically. Store the *declared* link, the documents that support it and an optional professional validation.

## 4. Territorial and normative layering

Every rule, deadline, checklist item, office and form belongs to exactly one of these levels, and the UI must always show which:

1. Italian national law.
2. Regional law and procedures.
3. Municipal regulations and obligations.
4. The individual condominium's rules and resolutions.
5. Contracts, insurance policies and engagements tied to a single property.

### Geographic configuration (per property)

Country (default Italy), region, province or metropolitan city, municipality, optional locality or hamlet, municipality cadastral code, competent offices with contact details, institutional portals and online services.

**Seed data for the owner**: Piano di Sorrento, Meta, Campania. These must be ordinary database records created by a seed script. **No municipality or region may appear in application logic.** Adding any other Italian municipality must be possible from the UI without code changes.

## 5. Rules engine and dynamic checklists

The app must **not** assume every document is always mandatory. It generates checklists from a versioned rule set evaluated against the property's attributes: location, asset type, use, ownership regime, presence of condominium, letting, hospitality activity and technical characteristics.

Requirements:

- Rules are data: condition, outcome (checklist item, deadline, warning), level (section 4), territory, valid-from/valid-to, version, source reference and **verification status** (`draft`, `to_verify`, `verified_by_owner`, `validated_by_professional`).
- No future date, rate or deadline is embedded as an immutable value. Every rule is versioned by year, territory, property type and owner situation.
- Rules can be created, edited, cloned and deactivated from the UI, with a history of changes.
- Ship a **small illustrative seed rule set** to prove the mechanism (for example documents typically expected for a condominium apartment, and one municipal-level example). Flag all seed rules as `to_verify`; the owner and a professional are responsible for confirming real content.
- Checklist evaluation must be explainable: for each item the UI shows which rule produced it and why.

## 6. Property dossier

Each property or ancillary asset has its own dossier with these categories:

- Title, provenance and rights in rem.
- Cadastre.
- Planning and building.
- Habitability and intended use.
- Condominium.
- Systems, energy and safety.
- Taxes and returns.
- Utilities and contracts.
- Insurance.
- Maintenance, works and warranties.
- Lettings and occupants.
- Hospitality filings (when applicable).
- Disputes, claims and formal communications.

Every dossier entry has one status: `present`, `missing`, `requested`, `to_verify`, `expired`, `superseded`, `not_applicable` or `validated_by_professional`. Show a per-dossier completeness summary that counts statuses and **does not** claim compliance.

## 7. Document management

Metadata for each document:

- Associated property or ancillary asset (one or more).
- Category and subcategory.
- Title and description.
- Issuer (authority, professional or other party).
- Issue date and validity period.
- Version and superseded document.
- Verification status (same vocabulary as section 5).
- Confidentiality level.
- Sharing history: which packages included it and when (replaces "authorised parties", since there are no other users).
- Linked deadlines.
- Links to other documents or procedures.

Capabilities: upload (PDF, images, common office formats), versioning, full-text search where feasible (OCR as an optional, replaceable component), filters, preview, export, duplicate detection (for example by content hash) and change history.

Files must be stored privately; access only through short-lived signed URLs or authenticated streaming. Never expose public file URLs.

## 8. Deadlines (scadenziario)

Cover national, regional, municipal, condominium, contractual, fiscal, insurance, technical, letting and hospitality deadlines.

Each deadline has: title, description, legal/regulatory/contractual/condominium basis, territorial level, property, responsible party (owner or a directory contact), date or calculation rule, recurrence, priority, consequences of delay, required documents, notice lead times, execution status, **proof of fulfilment** and, if relevant, the professional to involve.

Closing a deadline may require proof (receipt, payment confirmation, protocol number, bank transfer, minutes, certificate). Distinguish clearly between **completed by owner**, **automatically verified** and **validated by a professional**.

Views: calendar, list, per-property, per-category, overdue and upcoming.

## 9. Functional modules

All modules have equal priority. Decide the build order yourself in Stage A, but each module must be coherent and usable when delivered.

### 9.1 Property and ancillary-asset registry
Core entities from sections 3 and 4, ownership quotas and rights, cadastral data fields (sheet, parcel, sub-unit, category, income) as plain structured fields.

### 9.2 Dossier and checklists
Sections 5 and 6.

### 9.3 Documents
Section 7.

### 9.4 Deadlines and notifications
Section 8 plus section 11.

### 9.5 Condominium
- Condominium and administrator records.
- Regulations and millesimal tables.
- Accounting years, budgets, final accounts and allocations.
- Ordinary and extraordinary instalments.
- Convocations, meetings, proxies, minutes and resolutions.
- Works, funds, quotes and progress statements.
- Claims, disputes, reports and communications.
- Contracts and certifications of common areas.

Help the owner **prepare for meetings** (agenda review, documents to read, questions to raise) and **follow up on resolutions** (tracking decisions, linked deadlines and expenses). Never provide a definitive legal interpretation of a resolution.

### 9.6 Taxes and payments
Track taxes, levies and dues per property and per year, due dates, amounts paid, payment proofs and returns. Amounts and rates are entered or imported as data; the app does not compute definitive tax liability. Provide a clear "ask your tax adviser" hand-off.

### 9.7 Maintenance and works
Interventions, quotes, contractors, invoices, progress, warranties, recurring inspections, and linked documents and deadlines.

### 9.8 Insurance and claims
Policies, coverages, renewals, premiums, claims, loss adjusters and communications.

### 9.9 Optional lettings and hospitality modules
Separate, optional modules, enabled **only after the owner selects the actual type**:

- Ordinary residential letting.
- Transitional letting.
- Student letting, where applicable.
- Short-term or tourist letting.
- Regulated accommodation facilities (regional discipline).

Requirements, identification codes, communications, tourist tax and statistical reporting are **configurable per territory** and updatable over time (same rule mechanism as section 5). Include tenant/occupant records, contract terms and registration data, deposits, rent schedule, and linked deadlines.

### 9.10 Directory of professionals and suppliers
Condominium administrator, lawyer, accountant or tax adviser, notary, surveyor/architect/engineer, systems or fire-safety technician, insurer and loss adjuster, real-estate agent, property manager or hospitality operator, and municipal, regional and state offices.

For each matter the owner can assign one or more contacts, request documents, record opinions and mark each check as **informational** or **formally validated**.

## 10. Selective sharing without accounts

The owner can generate a **document package** for a chosen recipient type (administrator, technician, lawyer, notary, accountant, insurer, tenant, manager) by selecting properties, categories, documents and a confidentiality ceiling.

- Output: a ZIP with a generated index (PDF or HTML) and a manifest; the owner sends it manually.
- Optionally support an expiring, revocable, view-only link if Stage A shows it is safe and simple. If included, links must be unguessable, time-limited, revocable and logged.
- Every package is recorded in a sharing log (recipient, content, date, confidentiality ceiling).
- Warn before including documents above the chosen confidentiality level.

## 11. Notifications, audit, export and backup

- **Notifications**: in-app plus at least one external channel (email or push) chosen in Stage A. Per-deadline lead times, snooze and escalation of overdue items.
- **Audit log**: append-only record of who changed what and when for documents, rules, deadlines, dossier statuses, sharing and settings. Rule and checklist changes must be traceable.
- **Export**: full structured export (JSON/CSV for data, original files for documents) so the owner is never locked in.
- **Backup**: automated, restorable backups of data and files, with a documented and **tested** restore procedure. Prefer EU storage regions.

## 12. Assistance limits (must be visible in the product)

The app must **never** automatically state that a property is compliant, that a tax is not due, that a resolution is invalid, or that an activity may be started.

When a decision requires interpretation, an inspection, a sworn declaration (asseverazione), a signature, or access to official registers, the app must say so and direct the owner to the competent professional. Wording in the UI must be neutral ("not found in the uploaded documents", "to be verified by a professional") rather than conclusive.

## 13. Non-functional requirements

- **Language**: user interface fully in **Italian**. Source code, identifiers, comments, commit messages and technical docs in English. Externalise all UI strings so another language can be added later, but do not build multilingual features now.
- **Privacy and security**: the data includes personal and sensitive documents. Apply GDPR principles: data minimisation, encryption in transit and at rest, EU data residency where possible, least-privilege secrets management, input validation, safe file handling (type/size checks, malware-scan hook), rate limiting, secure headers, and no secrets in the repository or client bundle. Do not store credentials for SPID, Entratel or other official portals.
- **Integrations**: do not scrape official portals. Provide **deep links** and manual-entry or file-import fields for cadastral extracts, receipts and similar documents. Any future API integration must sit behind an adapter.
- **UX**: responsive (phone and desktop), accessible (WCAG 2.2 AA target), fast on large document lists, clear empty states, printable dossier summaries.
- **Quality**: automated tests for the rules engine, deadline calculation, status transitions, sharing packages and permissions; end-to-end tests for the critical flows; CI that runs lint, type-check and tests.
- **Deployment**: Vercel-compatible; document environment variables, migrations and the release procedure. Respect serverless limits (request size, execution time) in the design of uploads, OCR, exports and scheduled jobs.

## 14. Out of scope

- Multi-user, multi-tenant or SaaS features, public registration, billing.
- Professional logins or collaborative editing.
- Legal, tax or technical advice; automatic compliance verdicts; tax computation presented as definitive.
- Automated access to official registers or filing on behalf of the owner.

## 15. Deliverables and acceptance

**Stage A deliverable**: the architecture proposal described in section 0, plus a list of assumptions and open questions.

**Stage B, definition of done per increment**:

- Code runs locally and on a Vercel preview.
- Tests pass in CI.
- Seed data creates the owner's initial territory records (Piano di Sorrento, Meta, Campania) with no territory-specific logic in code.
- A reviewer can add a new municipality, a new rule and a new property entirely from the UI.
- The audit log records every mutation made in the demonstration.
- A selective package can be generated for at least one recipient type and appears in the sharing log.
- A backup can be taken and restored.
- `README.md`, `DECISIONS.md` and a codebase register (modules, utilities, patterns, temporary files, known issues) are up to date.

**Final acceptance**: all modules in section 9 are available, the limits in section 12 are visible in the UI, and no territory, tax rate or deadline date is hard-coded.
