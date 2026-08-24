# Design Portal Plan

## Goal

Build a separate client/designer portal that works with the current ERP without breaking any live ERP flows, data, or deployments.

## Non-negotiables

- Do not modify the live ERP routes or UI unless a change is explicitly approved.
- Keep the new portal isolated as a separate project/service.
- Use API-based integration only.
- Protect client and designer contact details with masking and server-side filtering.
- Preserve backwards compatibility for all current ERP users.

## Phase 1 — Discovery and boundaries

- Map the current ERP entry points, public routes, auth middleware, and shared utilities.
- Identify what can be reused safely and what must remain isolated.
- Define the portal roles: client, designer, admin.

## Phase 2 — Architecture

- Create a separate portal project/service in deployment.
- Use a separate database for portal data.
- Keep the ERP as the source of truth only where needed through controlled APIs.
- Define the portal URL structure for client and designer access.

## Phase 3 — Core workflow

- Client registration from a portal link.
- Client profile creation or linking if already present.
- Design request submission with uploads and details.
- Admin review and assignment.
- Public queue option for designers with safe claim locking.
- Final approval and archive to the client file.

## Phase 4 — Communication safety

- Mask phone numbers, emails, and other contact data in UI rendering.
- Detect contact-sharing attempts in messages.
- Enforce message filtering on the backend before storage or delivery.
- Add audit logging for flagged interactions.

## Phase 5 — Incremental delivery

- Build backend APIs first.
- Add portal UI second.
- Add filtering and masking third.
- Add claim/assignment concurrency protection next.
- Deploy only after smoke testing the isolated service.

## Phase 6 — Verification

- Confirm the ERP still works unchanged.
- Confirm portal login, request submission, assignment, and approval flows.
- Confirm masking works for messages and profile data.
- Confirm the portal can be rolled back without affecting the ERP.

## Notes

- Keep portal files in a separate folder or separate repository/service, not inside the ERP runtime code paths.
- If future separation is needed, the API boundary should make that move easy.
