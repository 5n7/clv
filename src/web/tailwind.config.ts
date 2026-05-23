import type { Config } from "tailwindcss";

export default {
	darkMode: ["selector", ".theme-dark"],
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {},
	},
	plugins: [],
} satisfies Config;
