import {
	AlertCircle,
	CalendarDays,
	Download,
	Loader2,
	Search,
	X,
} from "lucide-react";
import { cx, searchFieldIconClass, searchFieldInputClass } from "#/lib/ui";

export interface DailyDigestHistoryListItem {
	id: string;
	kind?: "daily" | "intraday" | "weekly";
	date: string;
	endDate?: string;
	archiveKey?: string;
	slotLabel?: string;
	timezone: string;
	status: "pending" | "ready" | "failed";
	title: string;
	summary: string;
	counts: {
		home: number;
		mentions: number;
		authored: number;
		likes: number;
		bookmarks: number;
		dms: number;
		links: number;
	};
	provider?: string;
	model?: string;
	attemptCount: number;
	error?: string;
	createdAt: string;
	updatedAt: string;
	finishedAt?: string;
	pdfAvailable: boolean;
	coverage?: {
		expected: number;
		processed: number;
		complete: boolean;
		sourceTruncated: boolean;
		cited: number;
	};
}

function displayDate(value: string) {
	const date = new Date(`${value}T12:00:00`);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		weekday: "short",
	}).format(date);
}

function displayRange(item: DailyDigestHistoryListItem) {
	if (item.kind === "intraday") {
		return `${displayDate(item.date)} · ${item.slotLabel ?? "8-hour window"}`;
	}
	if (item.kind !== "weekly" || !item.endDate) return displayDate(item.date);
	return `${displayDate(item.date)} – ${displayDate(item.endDate)}`;
}

function providerLabel(item: DailyDigestHistoryListItem) {
	if (item.provider === "deepseek") return "DeepSeek V4 / Flash";
	if (item.provider === "openai") return "ChatGPT";
	return item.model ?? "Summary model";
}

function HistoryRow({
	item,
	active,
	onSelect,
}: {
	item: DailyDigestHistoryListItem;
	active: boolean;
	onSelect: (id: string) => void;
}) {
	const ready = item.status === "ready";
	return (
		<article
			className={cx(
				"group relative border-b border-[var(--line)] transition-colors",
				ready && "hover:bg-[var(--bg-hover)]",
				active &&
					"bg-[var(--accent-soft)] shadow-[inset_3px_0_0_var(--accent)]",
			)}
		>
			<button
				type="button"
				aria-pressed={active}
				className="w-full px-4 py-3 pr-12 text-left disabled:cursor-default"
				disabled={!ready}
				onClick={() => onSelect(item.id)}
			>
				<div className="flex items-center gap-2">
					<time
						className="min-w-0 flex-1 text-[14px] font-bold text-[var(--ink)]"
						dateTime={item.date}
					>
						{displayRange(item)}
					</time>
					<span
						className={cx(
							"rounded-full px-2 py-0.5 text-[10px] font-bold",
							item.status === "ready"
								? "bg-[var(--accent-soft)] text-[var(--accent)]"
								: item.status === "failed"
									? "bg-[var(--alert-soft)] text-[var(--alert)]"
									: "bg-[var(--bg-active)] text-[var(--ink-soft)]",
						)}
					>
						{item.status === "ready"
							? "Saved"
							: item.status === "failed"
								? "Failed"
								: "Generating"}
					</span>
				</div>
				<h3 className="mt-1 line-clamp-1 text-[13px] font-semibold text-[var(--ink)]">
					{item.title}
				</h3>
				<p className="mt-1 line-clamp-2 text-[12px] leading-[1.4] text-[var(--ink-soft)]">
					{item.summary}
				</p>
				<div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-[var(--ink-soft)]">
					<span>{providerLabel(item)}</span>
					<span aria-hidden="true">·</span>
					<span>{String(item.counts.home)} home</span>
					<span aria-hidden="true">·</span>
					<span>{String(item.counts.links)} links</span>
					{item.coverage ? (
						<>
							<span aria-hidden="true">·</span>
							<span>
								{String(item.coverage.processed)}/
								{String(item.coverage.expected)} reviewed
								{item.coverage.complete
									? ` · ${String(item.coverage.cited)} cited`
									: ""}
							</span>
						</>
					) : null}
					{item.attemptCount > 1 ? (
						<>
							<span aria-hidden="true">·</span>
							<span>attempt {String(item.attemptCount)}</span>
						</>
					) : null}
				</div>
			</button>
			{ready ? (
				<a
					aria-label={`Download ${item.archiveKey ?? item.date} PDF`}
					className="absolute right-2 top-2 grid size-8 place-items-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-active)] hover:text-[var(--accent)]"
					download={
						item.kind === "weekly"
							? `BirdClaw-${item.date}-weekly-digest.pdf`
							: item.kind === "intraday"
								? `BirdClaw-${(item.archiveKey ?? item.date).replace("@", "-")}-intraday-digest.pdf`
								: `BirdClaw-${item.date}-digest.pdf`
					}
					href={`${item.kind === "weekly" ? "/api/weekly-digest-history" : "/api/period-digest-history"}?id=${encodeURIComponent(item.id)}&pdf=1`}
				>
					<Download className="size-4" aria-hidden="true" />
				</a>
			) : item.status === "failed" ? (
				<AlertCircle
					className="absolute right-4 top-4 size-4 text-[var(--alert)]"
					aria-hidden="true"
				/>
			) : (
				<Loader2
					className="absolute right-4 top-4 size-4 animate-spin text-[var(--ink-soft)]"
					aria-hidden="true"
				/>
			)}
		</article>
	);
}

export function DailyDigestHistoryPanel({
	items,
	activeId,
	loading,
	error,
	filter,
	kind,
	onFilterChange,
	onKindChange,
	onSelect,
	onClose,
}: {
	items: DailyDigestHistoryListItem[];
	activeId: string;
	loading: boolean;
	error: string | null;
	filter: string;
	kind: "daily" | "intraday" | "weekly";
	onFilterChange: (value: string) => void;
	onKindChange: (kind: "daily" | "intraday" | "weekly") => void;
	onSelect: (id: string) => void;
	onClose?: () => void;
}) {
	const normalized = filter.trim().toLocaleLowerCase();
	const filtered = normalized
		? items.filter((item) =>
				[item.date, item.title, item.summary, item.model ?? ""]
					.join(" ")
					.toLocaleLowerCase()
					.includes(normalized),
			)
		: items;
	return (
		<aside
			aria-label="Digest history"
			className="flex h-full min-h-0 flex-col bg-[var(--bg)]"
		>
			<header className="border-b border-[var(--line)] px-3 pb-3 pt-3">
				<div className="flex items-center gap-2 px-1">
					<CalendarDays
						className="size-4 text-[var(--accent)]"
						aria-hidden="true"
					/>
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-bold text-[var(--ink)]">
							{kind === "daily"
								? "Daily archive"
								: kind === "intraday"
									? "Intraday overview"
									: "Weekly archive"}
						</h2>
						<p className="text-[10px] text-[var(--ink-soft)]">
							{kind === "daily"
								? "Previous day generated at 00:00 local"
								: kind === "intraday"
									? "Closed 8-hour windows generated at 00:00, 08:00, and 16:00 local"
									: "Previous Monday–Sunday generated after week close"}
						</p>
					</div>
					<span className="text-[11px] text-[var(--ink-soft)]">
						{items.length}
					</span>
					{onClose ? (
						<button
							type="button"
							aria-label="Close digest history"
							className="grid size-8 place-items-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--bg-hover)]"
							onClick={onClose}
						>
							<X className="size-4" aria-hidden="true" />
						</button>
					) : null}
				</div>
				<div
					aria-label="Archive period"
					className="mt-3 grid grid-cols-3 rounded-full bg-[var(--bg-active)] p-1"
				>
					{(["daily", "intraday", "weekly"] as const).map((value) => (
						<button
							aria-pressed={kind === value}
							className={cx(
								"rounded-full px-3 py-1.5 text-[12px] font-bold capitalize text-[var(--ink-soft)]",
								kind === value &&
									"bg-[var(--bg)] text-[var(--accent)] shadow-sm",
							)}
							key={value}
							onClick={() => onKindChange(value)}
							type="button"
						>
							{value}
						</button>
					))}
				</div>
				<label className="mt-3 flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg-active)] px-3 py-2 focus-within:border-[var(--accent)]">
					<Search className={searchFieldIconClass} aria-hidden="true" />
					<input
						aria-label={`Search ${kind} history`}
						className={searchFieldInputClass}
						placeholder={
							kind === "daily"
								? "Search saved days"
								: kind === "intraday"
									? "Search 8-hour windows"
									: "Search saved weeks"
						}
						value={filter}
						onChange={(event) => onFilterChange(event.currentTarget.value)}
					/>
				</label>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				{loading && items.length === 0 ? (
					<div className="flex items-center gap-2 px-4 py-5 text-[13px] text-[var(--ink-soft)]">
						<Loader2 className="size-4 animate-spin" aria-hidden="true" />
						Loading {kind} archive…
					</div>
				) : error ? (
					<p className="px-4 py-5 text-[13px] text-[var(--alert)]">{error}</p>
				) : filtered.length === 0 ? (
					<div className="px-4 py-8 text-center">
						<p className="text-[13px] font-semibold text-[var(--ink)]">
							{items.length === 0 ? `No ${kind} reports yet` : "No matches"}
						</p>
						<p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-soft)]">
							{items.length === 0
								? kind === "daily"
									? "Yesterday’s report appears here after the next midnight run."
									: kind === "intraday"
										? "The latest closed 8-hour window appears after the next 00:00, 08:00, or 16:00 run."
										: "The previous Monday–Sunday report appears after the week closes."
								: "Try another date or report keyword."}
						</p>
					</div>
				) : (
					filtered.map((item) => (
						<HistoryRow
							active={item.id === activeId}
							item={item}
							key={item.id}
							onSelect={onSelect}
						/>
					))
				)}
			</div>
		</aside>
	);
}
