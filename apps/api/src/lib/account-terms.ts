import crypto from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import terms from '../legal/terms-2026-10-19.json';
import metadata from '../legal/terms-metadata.json';

// The public terms page uses this same retained document. Add a new version for
// future changes; never rewrite a version that accounts may already have accepted.
const archivedContent = JSON.stringify(terms);
const archivedHash = '5a7e225d6a4608492105f4431f973460b9cbcd9506034af3a73501f63b34a24f';
if (crypto.createHash('sha256').update(archivedContent, 'utf8').digest('hex') !== archivedHash) {
  throw new Error('TERMS_ARCHIVE_CONTENT_CHANGED');
}
if (metadata.version !== terms.version || metadata.documentHash !== archivedHash) throw new Error('TERMS_METADATA_MISMATCH');
export const CURRENT_TERMS = Object.freeze({
  version: terms.version,
  documentHash: archivedHash,
  content: archivedContent,
});
export type TermsAcceptanceInput = { accepted: true; version: string; documentHash: string };
export type TermsAcceptanceFlow = 'password_signup' | 'authenticated_account';
export const TERMS_PENDING_SCOPE = 'terms:accept';
export const TERMS_PENDING_MAX_AGE_MS = 15 * 60 * 1000;

export const validateTermsAcceptance = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'TERMS_ACCEPTANCE_REQUIRED';
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['accepted', 'version', 'documentHash'].includes(key))) return 'INVALID_TERMS_ACCEPTANCE';
  if (input.accepted !== true) return 'TERMS_ACCEPTANCE_REQUIRED';
  if (input.version !== CURRENT_TERMS.version || input.documentHash !== CURRENT_TERMS.documentHash) return 'TERMS_VERSION_CHANGED';
  return null;
};

type TermsClient = Pick<Prisma.TransactionClient, 'termsDocument' | 'accountTermsAcceptance'>;

export const retainCurrentTerms = async (tx: TermsClient) => {
  const document = await tx.termsDocument.upsert({
    where: { version: CURRENT_TERMS.version }, update: {},
    create: { version: CURRENT_TERMS.version, sha256: CURRENT_TERMS.documentHash, content: CURRENT_TERMS.content },
  });
  if (document.sha256 !== CURRENT_TERMS.documentHash || document.content !== CURRENT_TERMS.content) {
    throw new Error('TERMS_ARCHIVE_MISMATCH');
  }
};

// Use the authenticated account ID and a server-selected flow. Never accept an
// account ID, timestamp, IP address or user agent as acceptance evidence here.
export const recordAccountTermsAcceptance = async (
  tx: TermsClient, userId: number, input: unknown, flow: TermsAcceptanceFlow,
) => {
  const error = validateTermsAcceptance(input);
  if (error) throw new Error(error);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID_TERMS_ACCOUNT');
  if (!['password_signup', 'authenticated_account'].includes(flow)) throw new Error('INVALID_TERMS_FLOW');
  await retainCurrentTerms(tx);
  return tx.accountTermsAcceptance.upsert({
    where: { userId_documentVersion: { userId, documentVersion: CURRENT_TERMS.version } },
    update: {},
    create: { userId, documentVersion: CURRENT_TERMS.version, documentHash: CURRENT_TERMS.documentHash, flow },
  });
};

export const hasCurrentAccountTerms = async (prisma: Pick<PrismaClient, 'accountTermsAcceptance'>, userId: number) => {
  const acceptance = await prisma.accountTermsAcceptance.findUnique({
    where: { userId_documentVersion: { userId, documentVersion: CURRENT_TERMS.version } },
    select: { documentHash: true },
  });
  return acceptance?.documentHash === CURRENT_TERMS.documentHash;
};
