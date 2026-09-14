const RETRY_DELAY_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;
const TERMINAL_PROVIDER_RETRY_DELAY_MS = 6 * 60 * 60_000;

export function digestRetryDelayMs(attemptCount: number, error?: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? "");
	const terminalPattern = /\b402\b|insufficient balance|no available accounts/i;
	const providerFailures = message.includes("Summary providers failed")
		? (message.split("—").at(-1)?.split(";") ?? [])
		: [];
	const hasRetriableProvider = providerFailures.some(
		(failure) => !terminalPattern.test(failure),
	);
	if (terminalPattern.test(message) && !hasRetriableProvider) {
		return TERMINAL_PROVIDER_RETRY_DELAY_MS;
	}
	if (hasRetriableProvider) return RETRY_DELAY_MS;
	const exponent = Math.max(0, Math.min(8, Math.trunc(attemptCount) - 1));
	return Math.min(MAX_RETRY_DELAY_MS, RETRY_DELAY_MS * 2 ** exponent);
}
