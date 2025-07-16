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
		// 这里放置您的定时任务逻辑
		console.log('定时任务执行时间:', new Date().toISOString());
		
		// 示例：您可以在这里执行各种定时任务
		// 比如发送 HTTP 请求、处理数据、发送通知等
		
		// 返回成功状态
		return new Response('定时任务执行成功', { status: 200 });
	},
};
