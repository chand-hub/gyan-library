# VIDHYA LIBRARY Security Specification

## 1. Data Invariants
1. **Identity Integrity**: No user may create or mutate a document claiming a `uid`, `studentUid`, or `actorUid` different from `request.auth.uid` (unless performed by an authenticated Admin/Manager/Staff with verified privileges).
2. **Role Escalation Prevention**: Users registering or updating `/users/{userId}` cannot self-assign `role: 'admin'`, `'manager'`, or `'staff'`. Role escalation requires an existing Admin updating `/user_roles/{userId}` or `/admins/{userId}`.
3. **PII Isolation**: Student PII (`mobile`, `email`, `fatherName`, `address`, `emergencyContact`, `idDocumentUrl`) in `/students/{studentId}` and `/users/{userId}` is never publicly readable and never readable by other students. Public `/seats/{seatId}` stores only non-PII `seatCode`, `zone`, `status`, and `assignedStudentCode`.
4. **Financial Integrity**: Verified payments (`status: 'verified'`) cannot be forged by students on creation or update; students may only create `pending` payment intents or have payments verified by Admin/Staff/verified server signature. `isDemo` flags prevent demo records from mixing with live revenue totals.
5. **Seat Exclusivity**: A seat marked `occupied` or `maintenance` cannot be double-booked by a student; seat status transitions and assignments validate target seat existence and authorized state.
6. **Audit Trail Immutability**: `/audit_logs/{logId}` documents are append-only (`allow update, delete: if false`).
7. **Temporal Integrity**: `createdAt` and `updatedAt` timestamps on protected writes use `request.time` (`serverTimestamp()`), and `createdAt` is immutable after creation.

## 2. Adversarial Test Matrix ("Dirty Dozen" Payloads)
1. **Shadow Role Escalation**: Unprivileged student creates `/users/{uid}` with `role: "admin"` -> `PERMISSION_DENIED`.
2. **Ghost Field Injection**: Student updates `/students/{id}` with extra field `isVerified: true` or `membershipStatus: "active"` -> `PERMISSION_DENIED`.
3. **Cross-Tenant PII Read**: Student A calls `get()` on Student B's `/students/{studentBId}` -> `PERMISSION_DENIED`.
4. **Unverified Email Spoof**: User with `email: "educationrevolution90@gmail.com"` and `email_verified: false` attempts admin write -> `PERMISSION_DENIED`.
5. **Blanket List Scraping**: Student queries `/students` without `where('uid', '==', auth.uid)` -> `PERMISSION_DENIED`.
6. **Self-Verified Payment Forgery**: Student creates `/payments/{id}` with `status: "verified"` -> `PERMISSION_DENIED`.
7. **Terminal Status Mutation**: Student modifies a `verified` payment or `returned` book issue -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Write to `/seats/{1500_char_id}` -> `PERMISSION_DENIED` via `isValidId()`.
9. **Resource Exhaustion String**: Create `/enquiries/{id}` with 50KB `message` -> `PERMISSION_DENIED` via `.size()` limit.
10. **Audit Log Tampering**: Staff or student attempts `update()` or `delete()` on `/audit_logs/{id}` -> `PERMISSION_DENIED`.
11. **Unauthorized Seat Force-Release**: Student A updates `/seats/{seatId}` assigned to Student B -> `PERMISSION_DENIED`.
12. **Immortal Timestamp Tampering**: Client updates `/students/{id}` changing `createdAt` -> `PERMISSION_DENIED`.
