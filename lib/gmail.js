// Placeholder until the Gmail connection (Google OAuth) is built.
// Later this will look in the merchant's own inbox and return the
// plain text (or HTML) body of matching payment emails.
export class GmailNotConnectedError extends Error {}

export async function searchPaymentEmails(uid, { utr, transactionId }) {
  throw new GmailNotConnectedError("Gmail is not connected for this account");
}
