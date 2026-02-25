/**
 * Prompt response queue for mocking prompts module.
 *
 * Each call to the mock pops the next response from the queue.
 * Throws if more calls are made than expected.
 */

export function createPromptQueue(responses: unknown[]): {
  next: () => unknown;
  remaining: () => number;
} {
  const queue = [...responses];
  return {
    next: () => {
      if (queue.length === 0) {
        throw new Error("Unexpected prompt call — no more queued responses");
      }
      return queue.shift();
    },
    remaining: () => queue.length,
  };
}
