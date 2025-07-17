/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { CronExpressionParser } from 'cron-parser';

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

		const { action, url, params, job_id, user_id, cron, method, header, type } = input;
		if (!type) {
			return new Response("Missing type", { status: 400 });
		}
		const db = env.DB;

		try {
			if (action === "create") {
				if (!url || !params || !job_id || !user_id || !cron || !method) {
					return new Response(JSON.stringify({ code: 1, msg: "Missing parameters" }), { headers: { "Content-Type": "application/json" } });
				}

				// Convert params and header objects to strings for storage
				const paramsStr = typeof params === 'object' ? JSON.stringify(params) : params;
				const headerStr = typeof header === 'object' ? JSON.stringify(header) : (header || '');

				// Calculate next_run_time
				const interval = CronExpressionParser.parse(cron);
				const nextRunTime = interval.next().getTime();

				await db.prepare(
					"INSERT INTO mcp_scheduler_jobs (url, params, job_id, user_id, cron, last_run_time, next_run_time, method, header, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
				).bind(url, paramsStr, job_id, user_id, cron, null, nextRunTime, method, headerStr, type || '').run();
				return new Response(JSON.stringify({ code: 0, msg: "Creation successful" }), { headers: { "Content-Type": "application/json" } });
			}

			if (action === "delete") {
				if (!job_id) {
					return new Response(JSON.stringify({ code: 1, msg: "Missing job_id" }), { headers: { "Content-Type": "application/json" } });
				}
				await db.prepare("DELETE FROM mcp_scheduler_jobs WHERE job_id = ?").bind(job_id).run();
				return new Response(JSON.stringify({ code: 0, msg: "Deletion successful" }), { headers: { "Content-Type": "application/json" } });
			}

			if (action === "update") {
				if (!job_id || !user_id) {
					return new Response(JSON.stringify({ code: 1, msg: "Missing job_id or user_id" }), { headers: { "Content-Type": "application/json" } });
				}

				// Check if job exists and belongs to the user
				const existingJob = await db.prepare("SELECT * FROM mcp_scheduler_jobs WHERE job_id = ? AND user_id = ?").bind(job_id, user_id).first();
				if (!existingJob) {
					return new Response(JSON.stringify({ code: 2, msg: "Job not found or access denied" }), { headers: { "Content-Type": "application/json" } });
				}

				// Convert params and header objects to strings for storage
				const paramsStr = typeof params === 'object' ? JSON.stringify(params) : (params || existingJob.params);
				const headerStr = typeof header === 'object' ? JSON.stringify(header) : (header || existingJob.header);

				// Calculate next_run_time if cron is changed
				let nextRunTime = existingJob.next_run_time;
				if (cron && cron !== existingJob.cron) {
					const interval = CronExpressionParser.parse(cron);
					nextRunTime = interval.next().getTime();
				}

				await db.prepare(
					"UPDATE mcp_scheduler_jobs SET url = ?, params = ?, cron = ?, method = ?, header = ?, next_run_time = ? WHERE job_id = ? AND user_id = ?"
				).bind(
					url || existingJob.url,
					paramsStr,
					cron || existingJob.cron,
					method || existingJob.method,
					headerStr,
					nextRunTime,
					job_id,
					user_id
				).run();
				return new Response(JSON.stringify({ code: 0, msg: "Update successful" }), { headers: { "Content-Type": "application/json" } });
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
				return new Response(JSON.stringify({ code: 0, msg: "Query successful", data: result.results }), { headers: { "Content-Type": "application/json" } });
			}

			return new Response(JSON.stringify({ code: 1, msg: "Unknown action" }), { headers: { "Content-Type": "application/json" } });
		} catch (err) {
			return new Response(JSON.stringify({ code: 500, msg: "Database operation failed: " + err.message }), { headers: { "Content-Type": "application/json" } });
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
				const interval = CronExpressionParser.parse(job.cron);
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
