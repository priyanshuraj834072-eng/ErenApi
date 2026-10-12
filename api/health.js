export default function handler(req, res) {
  res.status(200).json({
    success: true,
    service: "ErenApi",
    status: "Backend is running"
  });
}
