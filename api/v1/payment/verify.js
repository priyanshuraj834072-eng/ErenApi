          : "No matching payment found in the last 24 hours"
      });
    }

    // Duplicate protection: only the first verification of a payment succeeds
    const paymentKey = (match.transactionId || match.utr).replace(/[.#$/\[\]]/g, "_");
    const result = await db.ref(`verifiedPayments/${uid}/${paymentKey}`).transaction((current) => {
      if (current) return undefined; // already exists: abort
      return { verifiedAt: Date.now(), amount: match.amount, utr: match.utr };
    });

    if (!result.committed) {
      return reply(res, 200, {
        success: true,
        received: false,
        already_verified: true,
        message: "Payment was already verified"
      });
    }

    return reply(res, 200, {
      success: true,
      received: true,
      amount: match.amount,
      currency: "INR",
      transaction_id: match.transactionId,
      utr: match.utr,
      sender_name: match.senderName,
      date: match.date,
      message: "Payment received successfully"
    });
  } catch (error) {
    if (error instanceof GmailNotConnectedError) {
      return reply(res, 500, { success: false, message: "Gmail is not connected for this account" });
    }
    console.error("Payment verification failed:", error.message);
    return reply(res, 500, { success: false, message: "Verification failed on our side" });
  }
}

