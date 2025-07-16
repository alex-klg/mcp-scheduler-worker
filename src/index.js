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
		let input = {};
		if (request.method === "POST") {
			input = await request.json();
		} else if (request.method === "GET") {
			const url = new URL(request.url);
			for (const [k, v] of url.searchParams.entries()) {
				input[k] = v;
			}
		} else {
			return new Response("Method Not Allowed", { status: 405 });
		}

		const { action, url, params, job_id, user_id, cron } = input;
		const db = env.DB;

		try {
			if (action === "create") {
				if (!url || !params || !job_id || !user_id || !cron) {
					return new Response("缺少参数", { status: 400 });
				}
				await db.prepare(
					"INSERT INTO mcp_scheduler_jobs (url, params, job_id, user_id, cron) VALUES (?, ?, ?, ?, ?)"
				).bind(url, params, job_id, user_id, cron).run();
				return new Response("创建成功");
			}

			if (action === "delete") {
				if (!job_id) {
					return new Response("缺少 job_id", { status: 400 });
				}
				await db.prepare("DELETE FROM mcp_scheduler_jobs WHERE job_id = ?").bind(job_id).run();
				return new Response("删除成功");
			}

			if (action === "query") {
				let result;
				if (job_id) {
					result = await db.prepare("SELECT * FROM mcp_scheduler_jobs WHERE job_id = ?").bind(job_id).all();
				} else if (user_id) {
					result = await db.prepare("SELECT * FROM mcp_scheduler_jobs WHERE user_id = ?").bind(user_id).all();
				} else {
					result = await db.prepare("SELECT * FROM mcp_scheduler_jobs").all();
				}
				return new Response(JSON.stringify(result.results), {
					headers: { "Content-Type": "application/json" }
				});
			}

			return new Response("未知 action", { status: 400 });
		} catch (err) {
			return new Response("数据库操作失败: " + err.message, { status: 500 });
		}
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
