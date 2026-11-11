// Runs once when the server starts. Starts the night job timer (Node.js server only).
// Never lets a problem here stop the website from starting.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startNightJobs } = await import("./lib/night-jobs");
      startNightJobs();
    } catch (error) {
      console.error("Night jobs could not start:", error);
    }
  }
}
