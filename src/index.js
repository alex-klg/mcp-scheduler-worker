/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx) {
		return new Response('Hello World!');
	},

	async scheduled(event, env, ctx) {
		try {
			const response = await fetch("https://gateway-dev.xcelsior.ai/v1/mcp/task/me");
			const data = await response.text(); // 如果 API 返回 JSON，可改为 response.json()
			console.log('API 响应:', data);
		} catch (err) {
			console.error('API 调用失败:', err);
		}
	},
};
