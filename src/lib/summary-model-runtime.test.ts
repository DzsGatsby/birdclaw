// @vitest-environment node
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeServices } from "./runtime-services";
import { __test__, streamSummaryAnalysisEffect } from "./summary-model-runtime";

function interruptedOpenAIStream() {
	const encoder = new TextEncoder();
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({
							type: "response.output_text.delta",
							delta: "Primary partial output that must be discarded.",
						})}\n\n`,
					),
				);
				setTimeout(
					() => controller.error(new Error("primary interrupted")),
					10,
				);
			},
		}),
	);
}

function deepSeekStream() {
	const text =
		'Backup complete.\n\n---\n{"answer":"backup","summary":"recovered"}';
	return new Response(
		`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}

function openAIStream(answer: string) {
	const text = `Primary complete.\n\n---\n${JSON.stringify({ answer, summary: "primary" })}`;
	return new Response(
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\ndata: [DONE]\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}

function malformedOpenAIStream() {
	return new Response(
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Malformed output" })}\n\ndata: [DONE]\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}

describe("summary model runtime", () => {
	it("keeps both provider failures when primary and backup are unavailable", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response('{"error":{"message":"no available accounts"}}', {
					status: 400,
				}),
			)
			.mockResolvedValueOnce(
				new Response('{"error":{"message":"Insufficient Balance"}}', {
					status: 402,
				}),
			);
		const runtime = createRuntimeServices({
			fetch,
			env: (name) =>
				name === "OPENAI_API_KEY"
					? "openai-test-key"
					: name === "DEEPSEEK_API_KEY"
						? "deepseek-test-key"
						: undefined,
		});
		await expect(
			Effect.runPromise(
				streamSummaryAnalysisEffect({
					body: { input: [], stream: true },
					options: {},
					runtime,
					parse: (value) => value,
					fallback: () => ({}),
					bufferDeltasUntilSuccess: true,
				}),
			),
		).rejects.toThrow(
			/openai: .*no available accounts.*deepseek: .*Insufficient Balance/,
		);
	});

	it("redacts API keys embedded in DeepSeek SSE errors", () => {
		const state = {
			buffer: "",
			rawText: "",
			pendingVisible: "",
			jsonMode: false,
			error: undefined as string | undefined,
		};
		__test__.processChatSseChunk(
			state,
			`data: ${JSON.stringify({
				error: { message: "bad key sk-example-private-value-1234" },
			})}\n\n`,
			undefined,
			/\n---\s*\n/,
		);
		expect(state.error).toBe("bad key sk-exam...1234");
		expect(state.error).not.toContain("sk-example-private-value-1234");
	});

	it("buffers a background attempt so a mid-stream failure can use backup cleanly", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(interruptedOpenAIStream())
			.mockResolvedValueOnce(deepSeekStream());
		const runtime = createRuntimeServices({
			fetch,
			env: (name) => {
				if (name === "OPENAI_API_KEY") return "openai-test-key";
				if (name === "DEEPSEEK_API_KEY") return "deepseek-test-key";
				return undefined;
			},
			random: () => 0,
		});
		const deltas: string[] = [];
		const failovers: string[] = [];
		const result = await Effect.runPromise(
			streamSummaryAnalysisEffect({
				body: {
					input: [
						{ role: "system", content: "Summarize" },
						{ role: "user", content: "Local data" },
					],
					max_output_tokens: 500,
					stream: true,
				},
				options: {},
				runtime,
				parse: (value) => value as { answer: string; summary: string },
				fallback: () => ({ answer: "fallback", summary: "fallback" }),
				onDelta: (delta) => deltas.push(delta),
				onFailover: (target) => failovers.push(target.provider),
				bufferDeltasUntilSuccess: true,
			}),
		);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			"https://api.openai.com/v1/responses",
		);
		expect(String(fetch.mock.calls[1]?.[0])).toBe(
			"https://api.deepseek.com/chat/completions",
		);
		expect(failovers).toEqual(["deepseek"]);
		expect(deltas.join("")).toContain("Backup complete.");
		expect(deltas.join("")).not.toContain("Primary partial");
		expect(result).toMatchObject({
			provider: "deepseek",
			model: "deepseek-v4-flash",
			value: { answer: "backup", summary: "recovered" },
		});
	});

	it("fails over before emitting when result-level validation rejects a provider", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(openAIStream("primary"))
			.mockResolvedValueOnce(deepSeekStream());
		const runtime = createRuntimeServices({
			fetch,
			env: (name) => {
				if (name === "OPENAI_API_KEY") return "openai-test-key";
				if (name === "DEEPSEEK_API_KEY") return "deepseek-test-key";
				return undefined;
			},
		});
		const deltas: string[] = [];
		const result = await Effect.runPromise(
			streamSummaryAnalysisEffect({
				body: { input: [], stream: true },
				options: {},
				runtime,
				parse: (value) => value as { answer: string; summary: string },
				fallback: () => ({ answer: "fallback", summary: "fallback" }),
				validateResult: (candidate) => {
					if (candidate.value.answer === "primary") {
						throw new Error("primary result failed coverage validation");
					}
				},
				onDelta: (delta) => deltas.push(delta),
				bufferDeltasUntilSuccess: true,
			}),
		);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(result.provider).toBe("deepseek");
		expect(result.value.answer).toBe("backup");
		expect(deltas.join("")).toContain("Backup complete.");
		expect(deltas.join("")).not.toContain("Primary complete.");
	});

	it("retries a buffered malformed result on the same provider", async () => {
		class StructuredOutputError extends Error {}
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(malformedOpenAIStream())
			.mockResolvedValueOnce(openAIStream("recovered"));
		const runtime = createRuntimeServices({
			fetch,
			env: (name) =>
				name === "OPENAI_API_KEY" ? "openai-test-key" : undefined,
		});
		const deltas: string[] = [];
		const retries: number[] = [];
		const result = await Effect.runPromise(
			streamSummaryAnalysisEffect({
				body: { input: [], stream: true },
				options: {},
				runtime,
				parse: (value) => value as { answer: string; summary: string },
				fallback: () => {
					throw new StructuredOutputError("invalid structured output");
				},
				onDelta: (delta) => deltas.push(delta),
				bufferDeltasUntilSuccess: true,
				retryFailedResult: {
					maxAttempts: 3,
					shouldRetry: (error) => error instanceof StructuredOutputError,
					onRetry: ({ attempt }) => retries.push(attempt),
				},
			}),
		);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(retries).toEqual([2]);
		expect(result.provider).toBe("openai");
		expect(result.value.answer).toBe("recovered");
		expect(deltas.join("")).toContain("Primary complete.");
		expect(deltas.join("")).not.toContain("Malformed output");
	});

	it("fails over after structured-output retries are exhausted", async () => {
		class StructuredOutputError extends Error {}
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(malformedOpenAIStream())
			.mockResolvedValueOnce(malformedOpenAIStream())
			.mockResolvedValueOnce(deepSeekStream());
		const runtime = createRuntimeServices({
			fetch,
			env: (name) => {
				if (name === "OPENAI_API_KEY") return "openai-test-key";
				if (name === "DEEPSEEK_API_KEY") return "deepseek-test-key";
				return undefined;
			},
		});
		const failovers: string[] = [];
		const result = await Effect.runPromise(
			streamSummaryAnalysisEffect({
				body: { input: [], stream: true },
				options: {},
				runtime,
				parse: (value) => value as { answer: string; summary: string },
				fallback: () => {
					throw new StructuredOutputError("invalid structured output");
				},
				bufferDeltasUntilSuccess: true,
				retryFailedResult: {
					maxAttempts: 2,
					shouldRetry: (error) => error instanceof StructuredOutputError,
				},
				onFailover: (target) => failovers.push(target.provider),
			}),
		);

		expect(fetch).toHaveBeenCalledTimes(3);
		expect(failovers).toEqual(["deepseek"]);
		expect(result.provider).toBe("deepseek");
		expect(result.value.answer).toBe("backup");
	});

	it("does not splice providers after interactive text was emitted", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(interruptedOpenAIStream())
			.mockResolvedValueOnce(deepSeekStream());
		const runtime = createRuntimeServices({
			fetch,
			env: (name) =>
				name === "OPENAI_API_KEY"
					? "openai-test-key"
					: name === "DEEPSEEK_API_KEY"
						? "deepseek-test-key"
						: undefined,
		});

		await expect(
			Effect.runPromise(
				streamSummaryAnalysisEffect({
					body: { input: [], stream: true },
					options: {},
					runtime,
					parse: (value) => value,
					fallback: () => ({}),
					onDelta: () => undefined,
				}),
			),
		).rejects.toThrow("primary interrupted");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("can force DeepSeek without trying OpenAI or reusing an OpenAI model override", async () => {
		const fetch = vi.fn().mockResolvedValue(deepSeekStream());
		const runtime = createRuntimeServices({
			fetch,
			env: (name) =>
				name === "DEEPSEEK_API_KEY" ? "deepseek-test-key" : undefined,
		});

		const result = await Effect.runPromise(
			streamSummaryAnalysisEffect({
				body: { input: [], stream: true },
				options: { model: "gpt-5.5" },
				provider: "deepseek",
				allowFailover: false,
				runtime,
				parse: (value) => value as { answer: string; summary: string },
				fallback: () => ({ answer: "fallback", summary: "fallback" }),
			}),
		);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			"https://api.deepseek.com/chat/completions",
		);
		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).model).toBe(
			"deepseek-v4-flash",
		);
		expect(result.provider).toBe("deepseek");
	});
});
