import React from "react";
import { Bug, ImagePlus, Send, X as XIcon } from "lucide-react";
import { desktopRuntime } from "./desktopRuntime.js";
import { submitFeedback } from "./feedbackClient.js";

const maxScreenshotBytes = 5 * 1024 * 1024;
const successMessage = "Thanks for the feedback. We'll take a look soon.";
const genericErrorMessage = "Something went wrong while sending your feedback. Please try again.";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read screenshot."));
    reader.readAsDataURL(file);
  });
}

function normalizeScreenshotName(name = "") {
  return String(name || "screenshot").trim() || "screenshot";
}

function feedbackContext({ route, appVersion }) {
  const now = new Date().toISOString();
  if (typeof window === "undefined") {
    return {
      product: "pillar-brief",
      route,
      appVersion,
      platform: "web",
      userAgent: "",
      timestamp: now,
    };
  }
  return {
    product: "pillar-brief",
    route,
    appVersion,
    platform: desktopRuntime.isDesktop() ? "desktop" : "web",
    userAgent: window.navigator?.userAgent || "",
    timestamp: now,
  };
}

export default function FeedbackWidget({ route, appVersion = "", openSignal = 0, onOpened }) {
  const fileInputRef = React.useRef(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [type, setType] = React.useState("bug");
  const [summary, setSummary] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [screenshotDataUrl, setScreenshotDataUrl] = React.useState("");
  const [screenshotName, setScreenshotName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [formMessage, setFormMessage] = React.useState("");
  const [formMessageTone, setFormMessageTone] = React.useState("info");

  const resetForm = React.useCallback(() => {
    setType("bug");
    setSummary("");
    setDetails("");
    setAlias("");
    setScreenshotDataUrl("");
    setScreenshotName("");
    setFormMessage("");
    setFormMessageTone("info");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const openFeedback = React.useCallback(() => {
    setIsOpen(true);
    onOpened?.();
  }, [onOpened]);

  const closeFeedback = React.useCallback(() => {
    setIsOpen(false);
    resetForm();
  }, [resetForm]);

  React.useEffect(() => {
    if (openSignal > 0) openFeedback();
  }, [openSignal, openFeedback]);

  React.useEffect(() => {
    function handlePaste(event) {
      if (!isOpen) return;
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type?.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      handleScreenshotFile(file).catch((error) => {
        setFormMessage(error.message || "Failed to use pasted screenshot.");
        setFormMessageTone("error");
      });
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen]);

  async function handleScreenshotFile(file) {
    if (!file) return;
    if (!file.type?.startsWith("image/")) {
      throw new Error("Please choose an image file.");
    }
    if (file.size > maxScreenshotBytes) {
      throw new Error("Screenshot must be 5 MB or smaller.");
    }
    const dataUrl = await fileToDataUrl(file);
    setScreenshotDataUrl(dataUrl);
    setScreenshotName(normalizeScreenshotName(file.name));
    setFormMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!details.trim()) {
      setFormMessage("Please describe the feedback, bug, or feature request first.");
      setFormMessageTone("error");
      return;
    }

    setFormMessage("");
    setSubmitting(true);
    const result = await submitFeedback({
      ...feedbackContext({ route, appVersion }),
      type,
      summary: summary.trim(),
      details: details.trim(),
      alias: alias.trim(),
      screenshotDataUrl,
      screenshotName,
    });
    setSubmitting(false);

    if (!result.success) {
      setFormMessage(genericErrorMessage);
      setFormMessageTone("error");
      return;
    }

    setFormMessage(successMessage);
    setFormMessageTone("success");
    window.setTimeout(() => {
      resetForm();
      setIsOpen(false);
    }, 1200);
  }

  return <>
    <button type="button" className="feedback-fab" onClick={openFeedback} title="Send feedback" aria-label="Send feedback">
      <Bug className="ico" aria-hidden="true" />
    </button>

    {isOpen && <div className="modal-backdrop feedback-backdrop" role="presentation">
      <div className="modal-card feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <div className="modal-head">
          <div>
            <h2 id="feedback-title">Send feedback</h2>
            <p>Report a bug, request a feature, or share what would make Pillar Brief better.</p>
          </div>
          <button type="button" onClick={closeFeedback} aria-label="Close feedback">
            <XIcon className="ico" aria-hidden="true" />
          </button>
        </div>

        <form className="feedback-form" onSubmit={handleSubmit}>
          <div className="feedback-grid">
            <label className="field">
              <span>Type</span>
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="bug">Bug</option>
                <option value="feature">Feature request</option>
                <option value="feedback">Feedback</option>
              </select>
            </label>
            <label className="field">
              <span>Alias</span>
              <input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="Optional first name or alias" />
            </label>
          </div>

          <label className="field">
            <span>Summary</span>
            <input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Short title" />
          </label>

          <label className="field">
            <span>Details</span>
            <textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={7} placeholder="What happened, what you expected, and any context that would help." />
          </label>

          <div className="feedback-screenshot">
            <div>
              <strong>Screenshot</strong>
              <span>Upload an image or paste one while this modal is open.</span>
            </div>
            <div className="feedback-screenshot-actions">
              <ButtonLike type="button" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className="ico" aria-hidden="true" />Choose image
              </ButtonLike>
              {screenshotDataUrl && <ButtonLike type="button" onClick={() => {
                setScreenshotDataUrl("");
                setScreenshotName("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}>Remove</ButtonLike>}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="feedback-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                handleScreenshotFile(file).catch((error) => {
                  setFormMessage(error.message || "Please choose a PNG, JPG, or WebP image.");
                  setFormMessageTone("error");
                });
              }}
            />
            {screenshotDataUrl && <div className="feedback-preview">
              <img src={screenshotDataUrl} alt="Feedback screenshot preview" />
              <span>{screenshotName || "Screenshot attached"}</span>
            </div>}
          </div>

          {formMessage && <div className={`feedback-message ${formMessageTone === "success" ? "success" : "error"}`}>
            {formMessage}
          </div>}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={closeFeedback}>Cancel</button>
            <button type="submit" className="btn accent" disabled={submitting}>
              <Send className="ico" aria-hidden="true" />{submitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}

function ButtonLike({ children, ...props }) {
  return <button className="btn feedback-small-button" {...props}>{children}</button>;
}
