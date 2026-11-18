CREATE TABLE "TermsDocument" (
  "version" TEXT PRIMARY KEY,
  "sha256" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TermsDocument_version_sha256_key" UNIQUE ("version", "sha256"),
  CONSTRAINT "TermsDocument_content_hash" CHECK (
    "sha256" = encode(sha256(convert_to("content", 'UTF8')), 'hex')
    AND COALESCE("content"::jsonb ->> 'version', '') = "version"
    AND COALESCE("content"::jsonb ->> 'kind', '') = 'terms'
  )
);

CREATE TABLE "AccountTermsAcceptance" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "documentVersion" TEXT NOT NULL,
  "documentHash" TEXT NOT NULL,
  "flow" TEXT NOT NULL CHECK ("flow" IN ('password_signup', 'authenticated_account')),
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountTermsAcceptance_document_fkey" FOREIGN KEY ("documentVersion", "documentHash")
    REFERENCES "TermsDocument"("version", "sha256") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AccountTermsAcceptance_userId_documentVersion_key" UNIQUE ("userId", "documentVersion")
);
CREATE INDEX "AccountTermsAcceptance_userId_acceptedAt_idx" ON "AccountTermsAcceptance"("userId", "acceptedAt");

CREATE FUNCTION drapixai_reject_terms_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Terms documents and acceptance records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TermsDocument_immutable_rows" BEFORE UPDATE OR DELETE ON "TermsDocument"
  FOR EACH ROW EXECUTE FUNCTION drapixai_reject_terms_mutation();
CREATE TRIGGER "TermsDocument_no_truncate" BEFORE TRUNCATE ON "TermsDocument"
  FOR EACH STATEMENT EXECUTE FUNCTION drapixai_reject_terms_mutation();
CREATE TRIGGER "AccountTermsAcceptance_immutable_rows" BEFORE UPDATE OR DELETE ON "AccountTermsAcceptance"
  FOR EACH ROW EXECUTE FUNCTION drapixai_reject_terms_mutation();
CREATE TRIGGER "AccountTermsAcceptance_no_truncate" BEFORE TRUNCATE ON "AccountTermsAcceptance"
  FOR EACH STATEMENT EXECUTE FUNCTION drapixai_reject_terms_mutation();

CREATE FUNCTION drapixai_set_terms_acceptance_time() RETURNS trigger AS $$
BEGIN
  NEW."acceptedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AccountTermsAcceptance_server_time" BEFORE INSERT ON "AccountTermsAcceptance"
  FOR EACH ROW EXECUTE FUNCTION drapixai_set_terms_acceptance_time();
