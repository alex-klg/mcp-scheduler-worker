/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import cronParser from 'cron-parser';

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

		const { action, url, params, job_id, user_id, cron, method } = input;
		const db = env.DB;

		try {
			if (action === "create") {
				if (!url || !params || !job_id || !user_id || !cron || !method) {
					return new Response("缺少参数", { status: 400 });
				}

				// 计算 next_run_time
				const interval = cronParser.parseExpression(cron);
				const nextRunTime = interval.next().getTime();

				await db.prepare(
					"INSERT INTO mcp_scheduler_jobs (url, params, job_id, user_id, cron, last_run_time, next_run_time, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
				).bind(url, params, job_id, user_id, cron, null, nextRunTime, method).run();
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
		const db = env.DB;
		const now = Date.now();

		// 1. 查找所有需要执行的任务
		const result = await db.prepare(
			"SELECT * FROM mcp_scheduler_jobs WHERE next_run_time <= ?"
		).bind(now).all();

		const jobs = result.results || [];
		if (jobs.length === 0) {
			console.log('没有需要执行的定时任务');
			return;
		}

		// 2. 依次异步处理每个 job
		await Promise.all(jobs.map(async (job) => {
			try {
				const method = job.method ? job.method.toUpperCase() : "POST";
				const fetchOptions = {
					method,
					headers: { "Content-Type": "application/json" }
				};
				if (method !== "GET") {
					fetchOptions.body = job.params;
				}
				const response = await fetch(job.url, fetchOptions);
				console.log(response.text());

				// 2.2 计算下次运行时间
				const interval = cronParser.parseExpression(job.cron);
				const nextRunTime = interval.next().getTime();
				const lastRunTime = Date.now();

				// 2.3 更新数据库
				await db.prepare(
					"UPDATE mcp_scheduler_jobs SET last_run_time = ?, next_run_time = ? WHERE job_id = ?"
				).bind(lastRunTime, nextRunTime, job.job_id).run();

				console.log(`任务 ${job.job_id} 执行并更新成功`);
			} catch (err) {
				console.error(`任务 ${job.job_id} 执行失败:`, err);
			}
		}));
	}
};
