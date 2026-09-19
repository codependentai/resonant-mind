/** Attach daemon work to the Worker lifecycle without hiding failures. */
export function scheduleDaemon(
  ctx: ExecutionContext,
  task: () => void | Promise<void>,
  log: Pick<Console, "error">["error"] = console.error,
): void {
  const lifecycle = Promise.resolve()
    .then(task)
    .catch((error) => {
      log("daemon failed:", error);
      throw error;
    });

  ctx.waitUntil(lifecycle);
}
