// The browser's "Leave site?" question while the run page sends the answers (`submit.ts`).

/**
 * Makes the page ask before it is left (closed, reloaded or navigated away); the answer stops
 * asking. Each guard has its own listener, so releasing one leaves the others asking.
 */
export function guardLeaving(): () => void {
  const ask = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Older browsers (Chrome and Edge before 119) ask only when `returnValue` is set.
    event.returnValue = true;
  };
  window.addEventListener("beforeunload", ask);
  return () => window.removeEventListener("beforeunload", ask);
}
