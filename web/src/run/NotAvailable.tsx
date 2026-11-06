import { useEffect } from "react";
import "./run-page.css";

/**
 * The page of a survey that cannot run (unknown, unpublished, or no id): surveyjs.io's heading,
 * its markup, inline style and text copied from the site's run page (D14).
 */
export function NotAvailable() {
  useEffect(() => {
    document.title = "Survey not available";
  }, []);
  return (
    <main className="running-survey">
      <h3
        className="running-survey-not-available-header"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: "80px",
          right: 0,
          textAlign: "center",
          fontFamily: "Arial",
          color: "red",
        }}
      >
        This survey is not currently available. <br />
      </h3>
    </main>
  );
}
