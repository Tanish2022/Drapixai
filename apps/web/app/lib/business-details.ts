// Server-rendered public facts only. Configuration is not evidence of registration
// or mailbox delivery; the business must verify these values before publication.
export function businessIdentitySections() {
  const legalName = process.env.DRAPIXAI_PUBLIC_LEGAL_NAME?.trim();
  const address = process.env.DRAPIXAI_PUBLIC_BUSINESS_ADDRESS?.trim();
  const registration = process.env.DRAPIXAI_PUBLIC_REGISTRATION?.trim();
  const grievance = process.env.DRAPIXAI_PUBLIC_GRIEVANCE_CONTACT?.trim();
  return [{
    heading: 'Business Identity',
    body: [
      'DrapixAI is the service name for this virtual try-on platform.',
      legalName ? `Legal operator: ${legalName}.` : 'Legal operator details have not yet been published. Please request them before entering a commercial agreement.',
      address ? `Business postal address: ${address}.` : 'The business postal address has not yet been published.',
      ...(registration ? [`Registration details: ${registration}.`] : []),
      grievance ? `Privacy and grievance contact: ${grievance}.` : 'For privacy or grievance requests, use privacy@drapixai.com. A named grievance contact has not yet been published.',
    ],
  }];
}
