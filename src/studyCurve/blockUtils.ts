// コードブロックの中身は `key: value` の羅列として読む。
// 例:
//   ```study-today
//   deck: AWS ANS
//   limit: 10
//   ```
export function parseBlockSource(source: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of source.split('\n')) {
		const match = /^\s*([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
		if (!match) continue;
		result[match[1]!.toLowerCase()] = match[2]!.trim();
	}
	return result;
}

export function parseNumberOption(
	options: Record<string, string>,
	key: string,
	fallback: number,
): number {
	const raw = options[key];
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}
