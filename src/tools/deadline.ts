export function withDeadline<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} exceeded its ${timeoutMs}ms deadline`)),
			timeoutMs,
		);
	});

	return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}
