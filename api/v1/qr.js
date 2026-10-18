import QRCode from "qrcode";

const UPI_ID = /^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z]{2,64}$/;

function bad(res, message) {
  return res.status(400).json({ success: false, message });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { upi_id, name, amount, note } = req.query;

    if (typeof upi_id !== "string" || !UPI_ID.test(upi_id)) {
      return bad(res, "upi_id is missing or invalid");
    }

    const params = [`pa=${encodeURIComponent(upi_id)}`];

    if (name) {
      if (typeof name !== "string" || name.length > 50) return bad(res, "name is too long");
      params.push(`pn=${encodeURIComponent(name)}`);
    }

    if (amount) {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0 || value > 1000000) {
        return bad(res, "amount must be a positive number");
      }
      params.push(`am=${value.toFixed(2)}`);
    }

    params.push("cu=INR");

    if (note) {
      if (typeof note !== "string" || note.length > 50) return bad(res, "note is too long");
      params.push(`tn=${encodeURIComponent(note)}`);
    }

    const svg = await QRCode.toString(`upi://pay?${params.join("&")}`, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2
    });

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(svg);
  } catch (error) {
    console.error("QR generation failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not generate QR" });
  }
}
