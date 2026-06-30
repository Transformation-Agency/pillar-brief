const defaultFeedbackApiBase = "https://project-cw1bz.vercel.app";

function feedbackApiBase() {
  return (
    import.meta.env.VITE_PILLAR_FEEDBACK_API_BASE ||
    import.meta.env.VITE_PRISM_FEEDBACK_API_BASE ||
    defaultFeedbackApiBase
  ).replace(/\/$/, "");
}

async function safeJson(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function submitFeedback(payload = {}) {
  try {
    const response = await fetch(`${feedbackApiBase()}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await safeJson(response);
    if (!response.ok) {
      return {
        success: false,
        error: data?.error || response.statusText || "Failed to submit feedback.",
      };
    }
    return {
      success: true,
      issueNumber: data?.issueNumber || null,
      issueUrl: data?.issueUrl || null,
      screenshotStored: Boolean(data?.screenshotStored),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Failed to submit feedback.",
    };
  }
}
