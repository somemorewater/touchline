import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../database/client.js';
import {
  auditLogs,
  evidenceFiles,
  uploadedFiles,
} from '../../database/schema/index.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { env } from '../../config/env.js';
import type { AuthContext } from '../../security/context.js';
import { hasPermission } from '../../security/context.js';
import { PERMISSIONS } from '../../security/permissions.js';
import { storage } from '../../storage/index.js';
import {
  canManageCase,
  canReviewCase,
  loadCaseScope,
} from '../disciplinary/access.js';
import {
  canManageDispute,
  canReviewDispute,
  loadDisputeScope,
} from '../disputes/access.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface EvidenceTarget {
  kind: 'case' | 'dispute';
  id: string;
  competitionId: string;
  seasonId: string | null;
}

interface FileTypeRule {
  contentType: string;
  extensions: string[];
  matches: (buffer: Buffer) => boolean;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_SIGNATURE = Buffer.from('%PDF-');

function isText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

const FILE_TYPES: FileTypeRule[] = [
  {
    contentType: 'image/png',
    extensions: ['.png'],
    matches: (buffer) => buffer.subarray(0, 8).equals(PNG_SIGNATURE),
  },
  {
    contentType: 'image/jpeg',
    extensions: ['.jpg', '.jpeg'],
    matches: (buffer) => buffer.subarray(0, 3).equals(JPEG_SIGNATURE),
  },
  {
    contentType: 'application/pdf',
    extensions: ['.pdf'],
    matches: (buffer) => buffer.subarray(0, 5).equals(PDF_SIGNATURE),
  },
  {
    contentType: 'text/plain',
    extensions: ['.txt'],
    matches: isText,
  },
];

export function allowedContentTypes(): string[] {
  return FILE_TYPES.map((rule) => rule.contentType);
}

/**
 * Validate client metadata against server-side content sniffing and a strict
 * filename policy. Client MIME types alone are never trusted.
 */
export function validateEvidenceFile(
  fileName: string,
  declaredContentType: string,
  buffer: Buffer,
): { originalName: string; contentType: string } {
  if (buffer.length === 0) throw badRequest('The uploaded file is empty.');
  if (buffer.length > env.FILE_MAX_BYTES) {
    throw badRequest(`Files may not exceed ${env.FILE_MAX_BYTES} bytes.`);
  }

  const originalName = fileName.trim();
  if (!originalName || originalName.length > 255) {
    throw badRequest('The file name must be between 1 and 255 characters.');
  }
  if (basename(originalName) !== originalName) {
    throw badRequest('The file name must not contain a path.');
  }
  if (
    originalName.includes('..') ||
    /[\u0000-\u001f\u007f\\/:*?"<>|]/.test(originalName) ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/.test(originalName)
  ) {
    throw badRequest('The file name contains unsupported characters.');
  }

  const extension = extname(originalName).toLowerCase();
  const normalizedType = declaredContentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const rule = FILE_TYPES.find((candidate) => candidate.contentType === normalizedType);
  if (!rule) throw badRequest('This file type is not allowed.');
  if (!rule.extensions.includes(extension)) {
    throw badRequest('The file extension does not match the declared content type.');
  }
  if (!rule.matches(buffer)) {
    throw badRequest('The file content does not match the declared content type.');
  }
  return { originalName, contentType: rule.contentType };
}

async function targetForCase(auth: AuthContext, caseId: string): Promise<EvidenceTarget> {
  const scope = await loadCaseScope(caseId);
  if (!canManageCase(auth, scope) && !canReviewCase(auth, scope)) {
    throw notFound('Disciplinary case not found.');
  }
  return {
    kind: 'case',
    id: caseId,
    competitionId: scope.competition.id,
    seasonId: scope.case.seasonId,
  };
}

async function targetForDispute(auth: AuthContext, disputeId: string): Promise<EvidenceTarget> {
  const scope = await loadDisputeScope(disputeId);
  const canView =
    canManageDispute(auth, scope) ||
    canReviewDispute(auth, scope) ||
    scope.dispute.submittedBy === auth.userId;
  if (!canView) throw notFound('Dispute not found.');
  if (!hasPermission(auth, PERMISSIONS.filesRead)) {
    throw forbidden('Evidence access requires the files.read permission.');
  }
  return {
    kind: 'dispute',
    id: disputeId,
    competitionId: scope.competition.id,
    seasonId: scope.dispute.seasonId,
  };
}

async function targetForCaseDownload(auth: AuthContext, caseId: string): Promise<EvidenceTarget> {
  const scope = await loadCaseScope(caseId);
  if (!canManageCase(auth, scope) && !canReviewCase(auth, scope)) {
    throw notFound('Disciplinary case not found.');
  }
  return {
    kind: 'case',
    id: caseId,
    competitionId: scope.competition.id,
    seasonId: scope.case.seasonId,
  };
}

export async function uploadEvidence(
  auth: AuthContext,
  target: { kind: 'case' | 'dispute'; id: string },
  fileName: string,
  contentType: string,
  buffer: Buffer,
) {
  const resolved =
    target.kind === 'case'
      ? await targetForCase(auth, target.id)
      : await targetForDispute(auth, target.id);
  const file = validateEvidenceFile(fileName, contentType, buffer);

  const key = `evidence/${randomUUID()}`;
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  await storage().put(key, buffer);

  try {
    return await db.transaction(async (tx) => {
      const [uploaded] = await tx
        .insert(uploadedFiles)
        .values({
          storageKey: key,
          storageProvider: storage().provider,
          originalName: file.originalName,
          contentType: file.contentType,
          sizeBytes: buffer.length,
          sha256,
          isPrivate: true,
          uploadedBy: auth.userId,
        })
        .returning();
      if (!uploaded) throw new Error('Uploaded file insert did not return a row.');

      const [evidence] = await tx
        .insert(evidenceFiles)
        .values({
          fileId: uploaded.id,
          caseId: target.kind === 'case' ? target.id : null,
          disputeId: target.kind === 'dispute' ? target.id : null,
          attachedBy: auth.userId,
        })
        .returning();
      if (!evidence) throw new Error('Evidence insert did not return a row.');

      await tx.insert(auditLogs).values({
        actorUserId: auth.userId,
        competitionId: resolved.competitionId,
        seasonId: resolved.seasonId,
        action: 'file.evidence_uploaded',
        entityType: target.kind === 'case' ? 'disciplinary_case' : 'dispute',
        entityId: target.id,
        before: null,
        after: {
          evidenceId: evidence.id,
          fileId: uploaded.id,
          originalName: uploaded.originalName,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          sha256,
        },
        reason: null,
      });

      return sanitizeEvidence(evidence, uploaded);
    });
  } catch (error) {
    await storage().remove(key).catch(() => undefined);
    throw error;
  }
}

export function sanitizeEvidence(
  evidence: typeof evidenceFiles.$inferSelect,
  file: typeof uploadedFiles.$inferSelect,
) {
  return {
    id: evidence.id,
    fileId: file.id,
    caseId: evidence.caseId,
    disputeId: evidence.disputeId,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    uploadedBy: file.uploadedBy,
    attachedBy: evidence.attachedBy,
    createdAt: evidence.createdAt,
    removedAt: evidence.removedAt,
    removalReason: evidence.removalReason,
  };
}

async function listTargetEvidence(target: EvidenceTarget) {
  const conditions =
    target.kind === 'case'
      ? [eq(evidenceFiles.caseId, target.id), isNull(evidenceFiles.removedAt)]
      : [eq(evidenceFiles.disputeId, target.id), isNull(evidenceFiles.removedAt)];
  const rows = await db
    .select({ evidence: evidenceFiles, file: uploadedFiles })
    .from(evidenceFiles)
    .innerJoin(uploadedFiles, eq(evidenceFiles.fileId, uploadedFiles.id))
    .where(and(...conditions))
    .orderBy(asc(evidenceFiles.createdAt));
  return rows.map((row) => sanitizeEvidence(row.evidence, row.file));
}

export async function listCaseEvidence(auth: AuthContext, caseId: string) {
  return listTargetEvidence(await targetForCaseDownload(auth, caseId));
}

export async function listDisputeEvidence(auth: AuthContext, disputeId: string) {
  return listTargetEvidence(await targetForDispute(auth, disputeId));
}

export async function getFileForDownload(auth: AuthContext, fileId: string) {
  const [row] = await db
    .select({ file: uploadedFiles, evidence: evidenceFiles })
    .from(uploadedFiles)
    .innerJoin(evidenceFiles, eq(evidenceFiles.fileId, uploadedFiles.id))
    .where(
      and(
        eq(uploadedFiles.id, fileId),
        isNull(evidenceFiles.removedAt),
        isNull(uploadedFiles.archivedAt),
      ),
    );
  if (!row) throw notFound('File not found.');

  let permitted = false;
  if (row.evidence.caseId) {
    const scope = await loadCaseScope(row.evidence.caseId);
    permitted = canManageCase(auth, scope) || canReviewCase(auth, scope);
  } else if (row.evidence.disputeId) {
    const scope = await loadDisputeScope(row.evidence.disputeId);
    permitted =
      canReviewDispute(auth, scope) || scope.dispute.submittedBy === auth.userId;
  }
  if (!permitted || !hasPermission(auth, PERMISSIONS.filesRead)) {
    throw notFound('File not found.');
  }

  const data = await storage().get(row.file.storageKey);
  return { file: row.file, data };
}

export async function getFileMetadata(auth: AuthContext, fileId: string) {
  const { file } = await getFileForDownload(auth, fileId);
  return {
    id: file.id,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    uploadedBy: file.uploadedBy,
    createdAt: file.createdAt,
  };
}

export async function removeEvidence(
  auth: AuthContext,
  evidenceId: string,
  reason: string | null,
  expected?: { kind: 'case' | 'dispute'; id: string },
) {
  const [row] = await db
    .select({ evidence: evidenceFiles, file: uploadedFiles })
    .from(evidenceFiles)
    .innerJoin(uploadedFiles, eq(evidenceFiles.fileId, uploadedFiles.id))
    .where(eq(evidenceFiles.id, evidenceId));
  if (!row || row.evidence.removedAt) throw notFound('Evidence not found.');
  if (
    expected &&
    ((expected.kind === 'case' && row.evidence.caseId !== expected.id) ||
      (expected.kind === 'dispute' && row.evidence.disputeId !== expected.id))
  ) {
    throw notFound('Evidence not found.');
  }

  let target: EvidenceTarget;
  let permitted = false;
  if (row.evidence.caseId) {
    target = await targetForCaseDownload(auth, row.evidence.caseId);
    const scope = await loadCaseScope(row.evidence.caseId);
    permitted = canManageCase(auth, scope);
  } else if (row.evidence.disputeId) {
    target = await targetForDispute(auth, row.evidence.disputeId);
    const scope = await loadDisputeScope(row.evidence.disputeId);
    permitted =
      canManageDispute(auth, scope) ||
      (row.evidence.attachedBy === auth.userId && scope.dispute.status !== 'closed');
  } else {
    throw notFound('Evidence not found.');
  }
  if (!permitted) throw forbidden('You cannot remove this evidence.');

  const removedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(evidenceFiles)
      .set({ removedAt, removedBy: auth.userId, removalReason: reason })
      .where(and(eq(evidenceFiles.id, evidenceId), isNull(evidenceFiles.removedAt)));
    await tx
      .update(uploadedFiles)
      .set({ archivedAt: removedAt })
      .where(eq(uploadedFiles.id, row.file.id));
    await tx.insert(auditLogs).values({
      actorUserId: auth.userId,
      competitionId: target.competitionId,
      seasonId: target.seasonId,
      action: 'file.evidence_removed',
      entityType: target.kind === 'case' ? 'disciplinary_case' : 'dispute',
      entityId: target.id,
      before: {
        evidenceId,
        fileId: row.file.id,
        originalName: row.file.originalName,
      },
      after: { removedAt },
      reason,
    });
  });

  await storage().remove(row.file.storageKey).catch(() => undefined);
  return { id: evidenceId, removed: true, removedAt };
}
