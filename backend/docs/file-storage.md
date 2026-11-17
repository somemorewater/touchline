# File storage and evidence

`uploaded_files` stores file metadata, a SHA-256 digest and an opaque storage key. `evidence_files` links a stored file to exactly one disciplinary case or dispute. Binary content is written through a configurable `StorageAdapter`; metadata and the evidence link are committed in PostgreSQL.

## Storage abstraction

`src/storage/index.ts` defines:

```ts
interface StorageAdapter {
  readonly provider: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
```

The shipped adapter is `LocalStorageAdapter` (`provider = 'local'`), rooted at `FILE_STORAGE_DIR`. Only this adapter is implemented. The interface is intentionally small so an S3-compatible adapter can be added later without changing evidence metadata or routes. `uploaded_files.storage_provider` is currently constrained to `local`.

Storage keys are generated server-side as `evidence/<uuid>`. The local adapter accepts only `^[a-z0-9]+/[a-f0-9-]{36}$`, resolves the path, re-checks that it stays inside the root, creates directories with mode `0700` and writes files with `wx`/`0600`. Client paths, separators, traversal segments and extensions are never used as keys.

## Upload

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/disciplinary-cases/:id/evidence` | Attach evidence to a case |
| POST | `/api/v1/disputes/:id/evidence` | Attach evidence to a dispute |
| GET | `/api/v1/disciplinary-cases/:id/evidence` | List active evidence |
| GET | `/api/v1/disputes/:id/evidence` | List active evidence |
| DELETE | `/api/v1/disciplinary-cases/:id/evidence/:evidenceId?reason=` | Remove evidence |
| DELETE | `/api/v1/disputes/:id/evidence/:evidenceId?reason=` | Remove evidence |
| GET | `/api/v1/files/:id` | Authorized metadata |
| GET | `/api/v1/files/:id/content` | Authorized private content |

Uploads are raw binary bodies, not multipart form data:

```http
POST /api/v1/disputes/<id>/evidence
Authorization: Bearer <token>
Content-Type: image/png
X-File-Name: proof.png

<binary body>
```

`X-File-Name` and `Content-Type` are required. The body limit is `FILE_MAX_BYTES` (default 5 MiB, maximum 25 MB).

## Validation

`validateEvidenceFile` runs before storage:

1. Body is non-empty and within `FILE_MAX_BYTES`.
2. Filename is 1–255 characters, equals its basename, has no `..`, control characters or `\/:*?"<>|`, and matches `^[A-Za-z0-9][A-Za-z0-9 ._()-]*$`.
3. Declared MIME type is allowlisted: `image/png`, `image/jpeg`, `application/pdf`, `text/plain`.
4. Extension matches the MIME type: `.png`, `.jpg`/`.jpeg`, `.pdf`, `.txt`.
5. Content is sniffed: PNG/JPEG/PDF signatures, or valid UTF-8 text without NUL bytes.

A declared MIME type alone is never trusted. Filename-only uploads, fake content and path traversal are rejected with `400`.

## Access control

- Upload/listing requires visibility of the case or dispute. Case evidence additionally requires case review/management authority.
- Dispute evidence requires `files.read` and visibility of the dispute; a submitter or captain of the referenced team can attach while the dispute is not closed.
- `GET /files/:id` and `/content` require `files.read` and resolve the linked case/dispute. Unauthorized or unrelated callers receive `404`; content is served with `X-Content-Type-Options: nosniff` and an attachment disposition.
- `files.read` is held by captains and officials; `files.manage` is held by competition administrators. Only a case manager, dispute manager, or the dispute evidence uploader (while the dispute is not closed) may remove evidence.
- Private files are never exposed through public routes.

## Removal and history

Removal is archival, not deletion:

- `evidence_files.removed_at`, `removed_by` and `removal_reason` are set.
- `uploaded_files.archived_at` is set.
- `file.evidence_removed` is written to `audit_logs` with the competition/season scope.

Removed evidence disappears from lists and cannot be downloaded again. Upload writes `file.evidence_uploaded` with name, type, size and digest. If the database transaction fails after a binary write, the adapter removes the orphaned object.

## Configuration and limitations

| Variable | Default | Notes |
|---|---|---|
| `FILE_STORAGE_DIR` | `./var/uploads` | Local storage root; must be writable |
| `FILE_MAX_BYTES` | `5242880` | 1 byte – 25 MB |

- Only local filesystem storage is implemented. There is no S3 adapter, signed URL, virus scanner, image transformation or CDN integration.
- The local adapter assumes a single host or a shared volume. Multi-instance deployments need a shared object store before evidence uploads are safe across instances.
- The API never exposes the storage key or absolute path.
