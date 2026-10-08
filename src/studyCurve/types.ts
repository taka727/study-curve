// 復習時の手応え。エビングハウスの固定間隔を土台にしつつ、ステージを
// 進める／据え置く／戻すことで「苦手な項目ほど頻繁に出る」ようにする。
//
// `fresh`（初見）だけは毛色が違う。忘却曲線は「一度覚えたものが保持できているか」を
// 測る道具なので、まだ学習していない項目に good/hard/again を付けると
// 「忘れた」と「そもそも習っていない」が同じ尺度に混ざり、ステージが永遠に進まない。
// 初見はステージを据え置いたまま FRESH_INTERVAL_DAYS 後に回し、
// 「読んで理解した直後」から適度に間を空けて初回の保持テストを行う。
export type Grade = 'good' | 'hard' | 'again' | 'fresh';

export const GRADE_LABELS: Record<Grade, string> = {
	good: '◯ 覚えてた',
	hard: '△ あいまい',
	again: '✗ 忘れた',
	fresh: '☆ 初見',
};

// 記号と文字を別々に描いておき、狭い画面では CSS で文字だけ隠す。
// 幅が変わるたびにボタンを作り直さずに済ませるため。
export const GRADE_SYMBOLS: Record<Grade, string> = {
	good: '◯',
	hard: '△',
	again: '✗',
	fresh: '☆',
};

export const GRADE_TEXTS: Record<Grade, string> = {
	good: '覚えてた',
	hard: 'あいまい',
	again: '忘れた',
	fresh: '初見',
};

// frontmatter の study-history に書く短いトークン。
// 日本語や記号だとYAMLのクォートが必要になるのでASCIIにしている。
export const GRADE_TOKENS: Record<Grade, string> = {
	good: 'ok',
	hard: 'hard',
	again: 'ng',
	fresh: 'new',
};

export interface ReviewLogEntry {
	date: string;
	grade: Grade;
}

// 復習対象として登録済みのノート1件。frontmatter の study-* から組み立てる。
export interface StudyNote {
	filePath: string;
	basename: string;
	deck: string;
	stage: number;
	nextDate: string | null;
	history: ReviewLogEntry[];
	suspended: boolean;
}

// 資格1つ分のまとまり。フォルダは「未登録ノートの洗い出し」と
// 登録時のデッキ自動判定に使う。
export interface DeckConfig {
	name: string;
	folder: string;
	examDate: string | null;
}

export type QueueReason = 'overdue' | 'due' | 'sprint';

export interface QueueItem {
	note: StudyNote;
	reason: QueueReason;
	// 期日から何日遅れているか（当日なら0、直前総ざらいで前倒しなら負の値）
	overdueDays: number;
	/**
	 * 所属デッキが直前総ざらいの期間中か。期間中は予定日に関係なく全件が一覧に出るので、
	 * 「明日に送る」を押しても消えない。そのため UI は時計ボタンを出さない。
	 */
	inSprint: boolean;
}
