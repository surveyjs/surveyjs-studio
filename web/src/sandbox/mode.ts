/** True in the sandbox build (`vite build --mode sandbox`); Vite removes the sandbox branches elsewhere. */
export const IS_SANDBOX: boolean = import.meta.env.MODE === "sandbox";
