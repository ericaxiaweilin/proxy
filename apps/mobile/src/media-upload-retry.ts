export async function uploadOriginalWithRetry(
  attempt: () => Promise<number>,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 3
): Promise<void> {
  let lastError: unknown;
  for (let index = 0; index < maxAttempts; index += 1) {
    let status: number | undefined;
    try {
      status = await attempt();
    } catch (error) {
      lastError = error;
      if (index === maxAttempts - 1) throw error;
    }
    if (status !== undefined) {
      if (status >= 200 && status < 300) return;
      const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
      const error = new Error(`照片上传失败（${status}）`);
      if (!retryable || index === maxAttempts - 1) throw error;
      lastError = error;
    }
    await sleep(index === 0 ? 300 : 900);
  }
  throw lastError instanceof Error ? lastError : new Error("照片上传失败");
}

