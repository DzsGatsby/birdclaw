import fs from "node:fs/promises";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ensureDailyDigestPdf } from "#/lib/daily-digest-pdf";
import {
	getPeriodDigestHistory,
	listPeriodDigestHistory,
	preparePeriodDigestDateRetry,
} from "#/lib/period-digest-history";
import { queuePeriodDigestDate } from "#/lib/period-digest-scheduler";
import {
	jsonResponse,
	parseBoundedInteger,
	sensitiveRequestErrorResponse,
} from "#/lib/http-effect";

function notFound() {
	return jsonResponse(
		{ ok: false, message: "Daily digest history not found" },
		{ status: 404 },
	);
}

const retrySchema = z.object({
	action: z.literal("retry"),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const Route = createFileRoute("/api/period-digest-history")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const denied = sensitiveRequestErrorResponse(request);
				if (denied) return denied;
				const url = new URL(request.url);
				const id = url.searchParams.get("id")?.trim();
				if (!id) {
					const limit = parseBoundedInteger(url.searchParams.get("limit"), {
						defaultValue: 90,
						max: 366,
					});
					const kind =
						url.searchParams.get("kind") === "intraday" ? "intraday" : "daily";
					return jsonResponse({
						items: listPeriodDigestHistory({ limit, kind }),
					});
				}
				const item = getPeriodDigestHistory(id);
				if (!item) return notFound();
				if (url.searchParams.get("pdf") !== "1") {
					return jsonResponse({ item });
				}
				try {
					const filePath = await ensureDailyDigestPdf({ id });
					const pdf = await fs.readFile(filePath);
					return new Response(pdf, {
						headers: {
							"content-type": "application/pdf",
							"content-disposition": `attachment; filename="BirdClaw-${item.metadata.archiveKey.replace("@", "-")}-${item.metadata.kind === "intraday" ? "intraday-" : ""}digest.pdf"`,
							"cache-control": "private, no-store",
						},
					});
				} catch (error) {
					return jsonResponse(
						{
							ok: false,
							message:
								error instanceof Error
									? error.message
									: "Daily digest PDF generation failed",
						},
						{ status: 503 },
					);
				}
			},
			POST: async ({ request }) => {
				const denied = sensitiveRequestErrorResponse(request);
				if (denied) return denied;
				const parsed = retrySchema.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return jsonResponse(
						{ ok: false, message: "Daily digest retry request is invalid" },
						{ status: 400 },
					);
				}
				try {
					preparePeriodDigestDateRetry(parsed.data.date);
					queuePeriodDigestDate(parsed.data.date);
					return jsonResponse(
						{ ok: true, date: parsed.data.date, status: "queued" },
						{ status: 202 },
					);
				} catch (error) {
					return jsonResponse(
						{
							ok: false,
							message: error instanceof Error ? error.message : String(error),
						},
						{ status: 400 },
					);
				}
			},
		},
	},
});
