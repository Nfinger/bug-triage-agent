// Vite `?raw` imports (the bundled business docs in src/prospecting/business-docs.ts).
declare module '*.md?raw' {
	const content: string;
	export default content;
}
