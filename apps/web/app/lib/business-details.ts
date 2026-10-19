// Public business particulars supplied and confirmed by the owner in this chat.
// Certificate numbers, registry extracts and mailbox delivery were not examined.
export const BUSINESS_DETAILS = {
  legalName: 'DRAPIXAI SOFTWARE SOLUTIONS LLP',
  address: 'A-104, Avadh highland, S.P. Ring road, Bhadaj, Ahmedabad, Gujarat, 380060, India',
  email: 'contact@drapixai.com',
  phone: '+91 63510 79022',
  phoneHref: 'tel:+916351079022',
} as const;

export function businessIdentitySections() {
  return [{
    heading: 'Business Identity',
    body: [
      'DrapixAI is the service name for this virtual try-on platform.',
      `Legal operator: ${BUSINESS_DETAILS.legalName}, registered in India as a limited liability partnership.`,
      `Business postal address: ${BUSINESS_DETAILS.address}.`,
      'The business holds DPIIT startup recognition.',
    ],
  }];
}
