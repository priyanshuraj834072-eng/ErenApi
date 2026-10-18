// Reads a FamPay "You have successfully received" payment email.
const MONTHS = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
};

function toIso(timeText, dateText) {
  const t = timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  const d = dateText.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!t || !d) return null;
  const month = MONTHS[d[2].toLowerCase()];
  if (!month) return null;
  let hour = Number(t[1]) % 12;
  if (t[3].toUpperCase() === "PM") hour += 12;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d[3]}-${month}-${pad(d[1])}T${pad(hour)}:${t[2]}:00+05:30`;
}

export function parseFamPayEmail(raw) {
  const text = String(raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const amount = text.match(/received\s*₹\s*([\d,]+(?:\.\d+)?)/i);
  const from = text.match(/received\s*₹\s*[\d,.]+\s*from\s+(.+?)\s+Transaction ID/i);
  const tid = text.match(/Transaction ID\s*:?\s*([A-Za-z0-9]+)/i);
  const utr = text.match(/UTR\s*:?\s*([A-Za-z0-9]+)/i);
  const date = text.match(/Date\s*:?\s*(\d{1,2}:\d{2}\s*[AP]M)\s*IST,?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);

  if (!amount || (!tid && !utr)) return null;

  return {
    amount: Number(amount[1].replace(/,/g, "")),
    senderName: from ? from[1].trim() : null,
    transactionId: tid ? tid[1].toUpperCase() : null,
    utr: utr ? utr[1].toUpperCase() : null,
    date: date ? toIso(date[1], date[2]) : null
  };
  // The "Updated Balance" in the email is never read or returned.
}
